/**
 * Checkout Drop-Off Investigator (C18)
 * Frontend Controller & Chart.js Integration
 * 
 * Interacts with GET /api/analysis and POST /api/upload.
 * Strictly uses actual API responses — no hardcoding, no dummy metrics.
 */

let currentAnalysis = null;
let chartInstances = {};

// Filter state
let activePeriod = 'comparison'; // 'comparison', 'before', 'after'
let activeDevice = 'all';        // 'all', 'desktop', 'mobile'
let activeStage = 'all';         // 'all', 'visit', 'cart', 'checkout', 'paid'
let currentPage = 'page-overview';

// Page titles & subtitles for navigation header updates
const PAGE_META = {
  'page-overview': {
    title: 'Overview',
    subtitle: 'Executive summary of funnel conversion KPIs, live telemetry, and critical drop-off areas.'
  },
  'page-funnel': {
    title: 'Funnel Progression Analysis',
    subtitle: 'Session progression through declared stages: Visit → Cart → Checkout → Paid.'
  },
  'page-device': {
    title: 'Device Segment Comparison',
    subtitle: 'Detailed drop-off comparison between Desktop and Mobile segments.'
  },
  'page-ai': {
    title: 'AI Investigation',
    subtitle: 'Automated forensic synthesis and root-cause evidence interpretation across complete checkout data.'
  },
  'page-investigation': {
    title: 'Investigation Panel',
    subtitle: 'Evidence breakdown and recommended technical investigation areas.'
  },
  'page-quality': {
    title: 'Data Quality & Checks',
    subtitle: 'Data integrity checks, deduplication statistics, and fixture validation scorecard.'
  },
  'page-upload': {
    title: 'Upload Dataset',
    subtitle: 'Upload a custom CSV or JSON dataset to evaluate checkout drop-offs.'
  }
};

const HASH_TO_PAGE = {
  '#overview': 'page-overview',
  '#funnel': 'page-funnel',
  '#device': 'page-device',
  '#ai-investigation': 'page-ai',
  '#ai': 'page-ai',
  '#investigation': 'page-investigation',
  '#quality': 'page-quality',
  '#upload': 'page-upload'
};

const PAGE_TO_HASH = {
  'page-overview': '#overview',
  'page-funnel': '#funnel',
  'page-device': '#device',
  'page-ai': '#ai-investigation',
  'page-investigation': '#investigation',
  'page-quality': '#quality',
  'page-upload': '#upload'
};

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadDashboardData(false);

  // Real-Time live auto-refresh: fetch GET /api/analysis every 5 seconds
  setInterval(() => {
    loadDashboardData(true);
  }, 5000);

  // Check URL hash on initial load
  const initialHash = window.location.hash;
  if (HASH_TO_PAGE[initialHash]) {
    navigateToPage(HASH_TO_PAGE[initialHash], false);
  }
});

// Support browser back/forward buttons
window.addEventListener('hashchange', () => {
  const hash = window.location.hash;
  if (HASH_TO_PAGE[hash] && HASH_TO_PAGE[hash] !== currentPage) {
    navigateToPage(HASH_TO_PAGE[hash], false);
  }
});

function initEventListeners() {
  // Sidebar Page Navigation
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetPageId = link.getAttribute('data-page');
      if (targetPageId) {
        navigateToPage(targetPageId, true);
      }
    });
  });

  // Period filter
  document.querySelectorAll('#periodFilter .pill-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#periodFilter .pill-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activePeriod = e.target.getAttribute('data-val');
      updateDashboard();
    });
  });

  // Device filter
  document.querySelectorAll('#deviceFilter .pill-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#deviceFilter .pill-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activeDevice = e.target.getAttribute('data-val');
      updateDashboard();
    });
  });

  // Stage filter
  document.querySelectorAll('#stageFilter .pill-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#stageFilter .pill-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activeStage = e.target.getAttribute('data-val');
      updateDashboard();
    });
  });

  // Refresh button
  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadAnalysis();
  });

  // Reset to default fixture button
  const resetBtn = document.getElementById('resetFixtureBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/reset', { method: 'POST' });
        const data = await res.json();
        currentAnalysis = data;
        updateDashboard();
        showStatusMessage('Reset back to original C18 fixture benchmark dataset.', 'success');
      } catch (err) {
        console.error('Reset error:', err);
        loadAnalysis();
      }
    });
  }

  // Export JSON button
  document.getElementById('exportBtn').addEventListener('click', exportAnalysisJSON);

  // File upload form & picker
  const fileInput = document.getElementById('fileInput');
  const selectedFileName = document.getElementById('selectedFileName');
  const submitUploadBtn = document.getElementById('submitUploadBtn');
  const uploadForm = document.getElementById('uploadForm');

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      selectedFileName.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      submitUploadBtn.disabled = false;
    } else {
      selectedFileName.textContent = '';
      submitUploadBtn.disabled = true;
    }
  });

  uploadForm.addEventListener('submit', handleUpload);

  // AI Investigation triggers
  const generateAiBtn = document.getElementById('generateAiBtn');
  if (generateAiBtn) {
    generateAiBtn.addEventListener('click', generateAiAnalysis);
  }

  const aiRetryBtn = document.getElementById('aiRetryBtn');
  if (aiRetryBtn) {
    aiRetryBtn.addEventListener('click', generateAiAnalysis);
  }

  const sidebarAiLink = document.getElementById('sidebarAiLink');
  if (sidebarAiLink) {
    sidebarAiLink.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToPage('page-ai', true);
    });
  }

  const aiChangeFiltersBtn = document.getElementById('aiChangeFiltersBtn');
  if (aiChangeFiltersBtn) {
    aiChangeFiltersBtn.addEventListener('click', () => {
      const filterScreen = document.getElementById('aiFilterScreen');
      const resultsScreen = document.getElementById('aiResultsScreen');
      if (resultsScreen) resultsScreen.style.display = 'none';
      if (filterScreen) {
        filterScreen.style.display = 'block';
        filterScreen.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  const aiRefreshBtn = document.getElementById('aiRefreshBtn');
  if (aiRefreshBtn) {
    aiRefreshBtn.addEventListener('click', () => {
      generateAiAnalysis(true);
    });
  }
}

// Navigation function to switch views cleanly
function navigateToPage(pageId, updateHistory = true) {
  currentPage = pageId;

  // Update active state in sidebar
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(l => {
    if (l.getAttribute('data-page') === pageId) {
      l.classList.add('active');
    } else {
      l.classList.remove('active');
    }
  });

  // Update active page view
  document.querySelectorAll('.page-view').forEach(view => {
    if (view.id === pageId) {
      view.classList.add('active-page');
    } else {
      view.classList.remove('active-page');
    }
  });

  // Update page heading and subtitle
  updateHeaderTag();

  // Update URL hash for history
  if (updateHistory && PAGE_TO_HASH[pageId]) {
    window.location.hash = PAGE_TO_HASH[pageId];
  }

  // Re-render and resize charts on the newly displayed page
  if (currentAnalysis) {
    setTimeout(() => {
      renderFunnelSection();
      renderDeviceComparison();
    }, 50);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateHeaderTag() {
  const meta = PAGE_META[currentPage];
  if (!meta) return;
  const titleEl = document.getElementById('pageHeadingTitle');
  if (titleEl) {
    const isCustom = currentAnalysis && currentAnalysis.dataset_info && currentAnalysis.dataset_info.is_custom;
    const badgeHTML = isCustom 
      ? '<span class="badge-pill badge-primary" style="font-size: 0.8rem; font-weight: 600; vertical-align: middle; margin-left: 8px;">CUSTOM UPLOADED DATASET</span>'
      : '';
    titleEl.innerHTML = `${meta.title} ${badgeHTML}`.trim();
  }
  const subEl = document.getElementById('pageHeadingSubtitle');
  if (subEl) {
    subEl.textContent = meta.subtitle;
  }
}

// Updates real-time live indicator pill in header
function updateLiveIndicator(liveData, datasetInfo) {
  const countEl = document.getElementById('liveEventCount');
  const timeEl = document.getElementById('liveTimestamp');
  
  const totalEvents = (liveData && liveData.total_events != null)
    ? liveData.total_events
    : (datasetInfo && datasetInfo.total_events != null ? datasetInfo.total_events : 0);
  
  const timestamp = (liveData && liveData.timestamp)
    ? liveData.timestamp
    : new Date().toLocaleTimeString();

  if (countEl) {
    countEl.textContent = `Live Events: ${totalEvents}`;
  }
  if (timeEl) {
    timeEl.textContent = `Last updated: ${timestamp}`;
  }
}

// Fetch analysis from backend API (live real-time data source)
async function loadDashboardData(isBackground = false) {
  const refreshBtn = document.getElementById('refreshBtn');
  if (!isBackground && refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Loading...';
  }

  try {
    const res = await fetch('/api/analysis');
    if (!res.ok) {
      throw new Error(`API error: HTTP ${res.status}`);
    }
    const data = await res.json();
    currentAnalysis = data;

    // Update real-time live indicator
    updateLiveIndicator(data.live, data.dataset_info);

    // Recalculate and update all dashboard components with latest live data
    updateDashboard();
  } catch (err) {
    console.error('Failed to load analysis:', err);
    if (!isBackground) {
      showStatusMessage(`Failed to load analysis: ${err.message}`, 'error');
    }
  } finally {
    if (!isBackground && refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        Refresh Analysis
      `;
    }
  }
}

// Backward-compatible alias
const loadAnalysis = loadDashboardData;

// Update all components when data or filters change
function updateDashboard() {
  if (!currentAnalysis) return;

  updateHeaderTag();
  renderSummaryCards();
  renderFunnelSection();
  renderDeviceComparison();
  renderInvestigationPanel();
  renderQualitySection();
}

// -----------------------------------------------------------------------------
// Stage Configuration & Metric Computation Engine
// -----------------------------------------------------------------------------
const STAGE_CONFIG = {
  'visit': {
    name: 'Visit',
    key: 'visit',
    prevKey: null,
    convLabel: 'Visit Reach',
    headerPrefix: 'Visit Reach',
    cardBeforeHeader: 'Before Visit Reach',
    cardAfterHeader: 'After Visit Reach',
    cardChangeHeader: 'Visit Reach Change'
  },
  'cart': {
    name: 'Cart',
    key: 'cart',
    prevKey: 'visit',
    convLabel: 'Visit → Cart',
    headerPrefix: 'Cart Conv.',
    cardBeforeHeader: 'Before Cart Conv.',
    cardAfterHeader: 'After Cart Conv.',
    cardChangeHeader: 'Cart Conv. Change'
  },
  'checkout': {
    name: 'Checkout',
    key: 'checkout',
    prevKey: 'cart',
    convLabel: 'Visit → Checkout',
    headerPrefix: 'Checkout Conv.',
    cardBeforeHeader: 'Before Checkout Conv.',
    cardAfterHeader: 'After Checkout Conv.',
    cardChangeHeader: 'Checkout Conv. Change'
  },
  'paid': {
    name: 'Paid',
    key: 'paid',
    prevKey: 'checkout',
    convLabel: 'Visit → Paid',
    headerPrefix: 'Paid Conv.',
    cardBeforeHeader: 'Before Paid Conv.',
    cardAfterHeader: 'After Paid Conv.',
    cardChangeHeader: 'Paid Conv. Change'
  },
  'all': {
    name: 'Full Funnel',
    key: 'paid',
    prevKey: 'checkout',
    convLabel: 'Visit → Paid',
    headerPrefix: 'Paid Conv.',
    cardBeforeHeader: 'Before Paid Conv.',
    cardAfterHeader: 'After Paid Conv.',
    cardChangeHeader: 'Overall Change'
  }
};

function getDevicePeriodCounts(periodName, dev) {
  if (!currentAnalysis || !currentAnalysis.periods) {
    return { visit: 0, cart: 0, checkout: 0, paid: 0 };
  }
  const period = currentAnalysis.periods[periodName];
  if (!period) return { visit: 0, cart: 0, checkout: 0, paid: 0 };
  if (dev === 'all') {
    return period.counts || { visit: 0, cart: 0, checkout: 0, paid: 0 };
  }
  const dObj = period.devices && period.devices[dev];
  return (dObj && dObj.counts) || { visit: 0, cart: 0, checkout: 0, paid: 0 };
}

function getStageMetrics(dev, stage) {
  const conf = STAGE_CONFIG[stage] || STAGE_CONFIG['all'];
  const bCounts = getDevicePeriodCounts('before', dev);
  const aCounts = getDevicePeriodCounts('after', dev);

  const stgKey = conf.key;
  const prevKey = conf.prevKey;

  let beforeNumerator = bCounts[stgKey] || 0;
  let beforeDenominator = bCounts.visit || 0;
  let beforeConvPercent = beforeDenominator > 0 ? parseFloat(((beforeNumerator / beforeDenominator) * 100).toFixed(2)) : 0;

  let afterNumerator = aCounts[stgKey] || 0;
  let afterDenominator = aCounts.visit || 0;
  let afterConvPercent = afterDenominator > 0 ? parseFloat(((afterNumerator / afterDenominator) * 100).toFixed(2)) : 0;

  if (stage === 'visit') {
    beforeConvPercent = 100.0;
    afterConvPercent = 100.0;
  }

  const changePp = parseFloat((afterConvPercent - beforeConvPercent).toFixed(2));

  let stepRetentionBefore = 100.0;
  let stepRetentionAfter = 100.0;
  let dropOffBefore = 0;
  let dropOffAfter = 0;
  let dropRateAfter = 0.0;

  if (prevKey) {
    const prevB = bCounts[prevKey] || 0;
    const prevA = aCounts[prevKey] || 0;
    stepRetentionBefore = prevB > 0 ? parseFloat(((beforeNumerator / prevB) * 100).toFixed(1)) : 0;
    stepRetentionAfter = prevA > 0 ? parseFloat(((afterNumerator / prevA) * 100).toFixed(1)) : 0;
    dropOffBefore = Math.max(0, prevB - beforeNumerator);
    dropOffAfter = Math.max(0, prevA - afterNumerator);
    dropRateAfter = prevA > 0 ? parseFloat(((dropOffAfter / prevA) * 100).toFixed(1)) : 0;
  }

  const beforeSessions = bCounts[stgKey] || 0;
  const afterSessions = aCounts[stgKey] || 0;

  return {
    stage,
    stageTitle: conf.name,
    conf,
    bCounts,
    aCounts,
    beforeSessions,
    afterSessions,
    beforeNumerator,
    beforeDenominator,
    afterNumerator,
    afterDenominator,
    beforeConvPercent,
    afterConvPercent,
    changePp,
    stepRetentionBefore,
    stepRetentionAfter,
    dropOffBefore,
    dropOffAfter,
    dropRateAfter
  };
}

function getDecliningSegmentForStage(stage) {
  const conf = STAGE_CONFIG[stage] || STAGE_CONFIG['all'];
  const stgKey = conf.key;

  const devStats = {};
  ['desktop', 'mobile'].forEach(dev => {
    const b = getDevicePeriodCounts('before', dev);
    const a = getDevicePeriodCounts('after', dev);
    let bPct = b.visit > 0 ? parseFloat(((b[stgKey] / b.visit) * 100).toFixed(2)) : 0;
    let aPct = a.visit > 0 ? parseFloat(((a[stgKey] / a.visit) * 100).toFixed(2)) : 0;
    if (stage === 'visit') {
      bPct = 100.0;
      aPct = 100.0;
    }
    const chg = parseFloat((aPct - bPct).toFixed(2));
    devStats[dev] = {
      device: dev,
      beforePct: bPct,
      afterPct: aPct,
      change: chg,
      bCounts: b,
      aCounts: a
    };
  });

  if (activeDevice !== 'all') {
    const current = devStats[activeDevice] || {
      device: activeDevice,
      beforePct: 0,
      afterPct: 0,
      change: 0,
      bCounts: getDevicePeriodCounts('before', activeDevice),
      aCounts: getDevicePeriodCounts('after', activeDevice)
    };
    return {
      segmentName: capitalize(activeDevice),
      device: activeDevice,
      change: current.change,
      beforePct: current.beforePct,
      afterPct: current.afterPct,
      bCounts: current.bCounts,
      aCounts: current.aCounts,
      isSingleDevice: true
    };
  }

  const deskChg = devStats.desktop.change;
  const mobChg = devStats.mobile.change;

  if (deskChg < mobChg && deskChg < 0) {
    return {
      segmentName: 'Desktop',
      device: 'desktop',
      change: deskChg,
      beforePct: devStats.desktop.beforePct,
      afterPct: devStats.desktop.afterPct,
      bCounts: devStats.desktop.bCounts,
      aCounts: devStats.desktop.aCounts,
      isSingleDevice: false
    };
  } else if (mobChg < deskChg && mobChg < 0) {
    return {
      segmentName: 'Mobile',
      device: 'mobile',
      change: mobChg,
      beforePct: devStats.mobile.beforePct,
      afterPct: devStats.mobile.afterPct,
      bCounts: devStats.mobile.bCounts,
      aCounts: devStats.mobile.aCounts,
      isSingleDevice: false
    };
  } else if (deskChg === mobChg && deskChg < 0) {
    return {
      segmentName: 'Desktop & Mobile',
      device: 'desktop',
      change: deskChg,
      beforePct: devStats.desktop.beforePct,
      afterPct: devStats.desktop.afterPct,
      bCounts: devStats.desktop.bCounts,
      aCounts: devStats.desktop.aCounts,
      isSingleDevice: false
    };
  } else {
    return {
      segmentName: 'None',
      device: 'all',
      change: 0.0,
      beforePct: devStats.desktop.beforePct,
      afterPct: devStats.desktop.afterPct,
      bCounts: devStats.desktop.bCounts,
      aCounts: devStats.desktop.aCounts,
      isSingleDevice: false
    };
  }
}

// 1. Executive Summary Cards (Dynamically recalculated based on activeDevice & activeStage)
function renderSummaryCards() {
  const quality = currentAnalysis.event_quality;
  const metrics = getStageMetrics(activeDevice, activeStage);
  const decline = getDecliningSegmentForStage(activeStage);

  const devSuffix = activeDevice !== 'all' ? ` (${capitalize(activeDevice)})` : '';
  const stageSuffix = activeStage !== 'all' ? ` (${metrics.conf.convLabel})` : '';

  // Update Headers
  const elBeforeHead = document.getElementById('cardBeforeHeader');
  if (elBeforeHead) elBeforeHead.textContent = metrics.conf.cardBeforeHeader;

  const elAfterHead = document.getElementById('cardAfterHeader');
  if (elAfterHead) elAfterHead.textContent = metrics.conf.cardAfterHeader;

  const elChangeHead = document.getElementById('cardChangeHeader');
  if (elChangeHead) elChangeHead.textContent = metrics.conf.cardChangeHeader;

  const elAffectedHead = document.getElementById('cardAffectedHeader');
  if (elAffectedHead) elAffectedHead.textContent = `Declining Segment (${metrics.stageTitle})`;

  // Card 1: Before Conversion
  const elBeforePaid = document.getElementById('cardBeforePaid');
  if (elBeforePaid) elBeforePaid.textContent = `${metrics.beforeConvPercent}%`;
  const elBeforePaidSub = document.getElementById('cardBeforePaidSub');
  if (elBeforePaidSub) {
    elBeforePaidSub.textContent = `${metrics.beforeNumerator} of ${metrics.beforeDenominator} sessions${devSuffix}${activeStage === 'visit' ? ' (Visit Reach)' : ''}`;
  }

  // Card 2: After Conversion
  const elAfterPaid = document.getElementById('cardAfterPaid');
  if (elAfterPaid) elAfterPaid.textContent = `${metrics.afterConvPercent}%`;
  const elAfterPaidSub = document.getElementById('cardAfterPaidSub');
  if (elAfterPaidSub) {
    elAfterPaidSub.textContent = `${metrics.afterNumerator} of ${metrics.afterDenominator} sessions${devSuffix}${activeStage === 'visit' ? ' (Visit Reach)' : ''}`;
  }

  // Card 3: Overall Change (pp)
  const changeCard = document.getElementById('cardOverallChange');
  const changeSub = document.getElementById('cardOverallChangeSub');
  const sign = metrics.changePp > 0 ? '+' : '';
  if (changeCard) changeCard.textContent = `${sign}${metrics.changePp} pp`;

  if (changeCard && changeSub) {
    if (metrics.changePp < 0) {
      changeCard.style.color = 'var(--danger)';
      changeSub.innerHTML = `<span class="badge-pill badge-danger">${metrics.changePp} pp Drop</span>`;
    } else if (metrics.changePp > 0) {
      changeCard.style.color = 'var(--success)';
      changeSub.innerHTML = `<span class="badge-pill badge-success">+${metrics.changePp} pp Gain</span>`;
    } else {
      changeCard.style.color = 'var(--text-main)';
      changeSub.innerHTML = `<span class="badge-pill badge-neutral">No Net Change</span>`;
    }
  }

  // Card 4: Largest Declining Segment for Active Stage
  const affCard = document.getElementById('cardAffectedSegment');
  const affBadge = document.getElementById('cardAffectedBadge');
  const affSub = document.getElementById('cardAffectedSub');
  if (affCard && affBadge && affSub) {
    const devSign = decline.change > 0 ? '+' : '';
    affCard.textContent = decline.segmentName;
    if (decline.change < 0) {
      affBadge.textContent = `${decline.change} pp decline`;
      affSub.innerHTML = `
        <span class="badge-pill badge-danger">${decline.change} pp</span>
        <span style="font-size: 0.75rem; color: #64748b; margin-left: 4px;">(${decline.beforePct}% → ${decline.afterPct}%)</span>
      `;
    } else if (decline.change > 0) {
      affBadge.textContent = `+${decline.change} pp gain`;
      affSub.innerHTML = `
        <span class="badge-pill badge-success">+${decline.change} pp</span>
        <span style="font-size: 0.75rem; color: #64748b; margin-left: 4px;">(${decline.beforePct}% → ${decline.afterPct}%)</span>
      `;
    } else {
      affBadge.textContent = '0 pp';
      affSub.innerHTML = '<span class="badge-pill badge-neutral">No Net Decline</span>';
    }
  }

  // Card 5: Sessions Analysed (Active Stage Sessions)
  const elTotalSessions = document.getElementById('cardTotalSessions');
  const elSessionsSub = document.getElementById('cardSessionsSub');
  if (elTotalSessions) {
    if (activePeriod === 'before') {
      elTotalSessions.textContent = metrics.beforeSessions;
    } else if (activePeriod === 'after') {
      elTotalSessions.textContent = metrics.afterSessions;
    } else {
      elTotalSessions.textContent = metrics.beforeSessions + metrics.afterSessions;
    }
  }
  if (elSessionsSub) {
    elSessionsSub.textContent = `Before: ${metrics.beforeSessions} | After: ${metrics.afterSessions}${devSuffix} (${metrics.stageTitle})`;
  }

  // Card 6: Telemetry & Live Ingestion / Duplicates
  const elTotalEvents = document.getElementById('cardTotalEvents');
  if (elTotalEvents) {
    const rawCount = (currentAnalysis.live && currentAnalysis.live.total_events != null)
      ? currentAnalysis.live.total_events
      : (quality.raw_events || 0);
    elTotalEvents.textContent = `${rawCount} Events`;
  }
  const elDuplicates = document.getElementById('cardDuplicates');
  if (elDuplicates) elDuplicates.textContent = quality.duplicates_removed;
  const elDuplicatesSub = document.getElementById('cardDuplicatesSub');
  if (elDuplicatesSub) {
    elDuplicatesSub.textContent = `${quality.duplicates_removed} duplicates cleaned from ${quality.raw_events} raw`;
  }
}

// 2. Funnel Section & Charts (Updates both Overview and Funnel Page)
function renderFunnelSection() {
  const stages = ['visit', 'cart', 'checkout', 'paid'];
  const metrics = getStageMetrics(activeDevice, activeStage);

  const beforeCounts = metrics.bCounts;
  const afterCounts = metrics.aCounts;

  const devTitle = activeDevice === 'all' ? 'All Devices' : capitalize(activeDevice);
  const badgeText = `${devTitle} | ${metrics.stageTitle} Focus`;
  setAllTextContent(['#funnelFilterBadge', '#overviewFunnelBadge'], badgeText);

  // Populate tables in both pages
  populateFunnelTable('funnelTableBody', beforeCounts, afterCounts, stages);
  populateFunnelTable('overviewFunnelTableBody', beforeCounts, afterCounts, stages);

  // Dynamic Funnel Insights Callout text
  const devName = activeDevice === 'all' ? 'overall' : activeDevice;
  let insightText = '';

  if (activeStage === 'visit') {
    insightText = `
      <strong>Focused Stage (Visit):</strong> ${afterCounts.visit} session(s) initiated the funnel in the after period on ${devName}. Initial traffic entry showed 100% reach across evaluated sessions.
    `;
  } else if (activeStage === 'cart') {
    const drop = Math.max(0, afterCounts.visit - afterCounts.cart);
    const dropPct = afterCounts.visit > 0 ? ((drop / afterCounts.visit) * 100).toFixed(1) : '0.0';
    insightText = `
      <strong>Focused Stage (Cart):</strong> In the after period (${afterCounts.cart}/${afterCounts.visit} sessions reached Cart on ${devName}), ${drop} session(s) dropped out between Visit and Cart (${dropPct}% drop-off). Cart conversion changed by <strong>${metrics.changePp > 0 ? '+' : ''}${metrics.changePp} pp</strong> (${metrics.beforeConvPercent}% &rarr; ${metrics.afterConvPercent}%).
    `;
  } else if (activeStage === 'checkout') {
    const drop = Math.max(0, afterCounts.cart - afterCounts.checkout);
    const dropPct = afterCounts.cart > 0 ? ((drop / afterCounts.cart) * 100).toFixed(1) : '0.0';
    insightText = `
      <strong>Focused Stage (Checkout):</strong> In the after period (${afterCounts.checkout}/${afterCounts.cart} cart sessions reached Checkout on ${devName}), ${drop} session(s) dropped out between Cart and Checkout (${dropPct}% step drop-off). Checkout conversion from Visit changed by <strong>${metrics.changePp > 0 ? '+' : ''}${metrics.changePp} pp</strong> (${metrics.beforeConvPercent}% &rarr; ${metrics.afterConvPercent}%).
    `;
  } else if (activeStage === 'paid') {
    const drop = Math.max(0, afterCounts.checkout - afterCounts.paid);
    const dropPct = afterCounts.checkout > 0 ? ((drop / afterCounts.checkout) * 100).toFixed(1) : '0.0';
    insightText = `
      <strong>Focused Stage (Paid):</strong> In the after period (${afterCounts.paid}/${afterCounts.checkout} checkout sessions completed Payment on ${devName}), ${drop} session(s) dropped out between Checkout and Paid (${dropPct}% step drop-off). Paid conversion from Visit changed by <strong>${metrics.changePp > 0 ? '+' : ''}${metrics.changePp} pp</strong> (${metrics.beforeConvPercent}% &rarr; ${metrics.afterConvPercent}%).
    `;
  } else {
    const dropCart = Math.max(0, afterCounts.visit - afterCounts.cart);
    const dropCheckout = Math.max(0, afterCounts.cart - afterCounts.checkout);
    const dropPaid = Math.max(0, afterCounts.checkout - afterCounts.paid);
    insightText = `
      <strong>Full Funnel Progression:</strong> In the after period (${afterCounts.visit} ${devName} sessions), drop-off occurred between Visit and Cart (${dropCart} dropped), Cart and Checkout (${dropCheckout} dropped), and Checkout to Paid (${dropPaid} dropped).
    `;
  }

  setAllHTML(['#funnelInsightCallout', '#overviewFunnelInsight'], insightText);

  // Render Chart.js on visible canvas instances
  renderFunnelChartCanvas('funnelChart', beforeCounts, afterCounts);
  renderFunnelChartCanvas('overviewFunnelChart', beforeCounts, afterCounts);
}

function populateFunnelTable(tbodyId, beforeCounts, afterCounts, stages) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = '';

  stages.forEach((stage, idx) => {
    const isFocused = (activeStage === 'all' || activeStage === stage);
    const bCount = beforeCounts[stage] || 0;
    const aCount = afterCounts[stage] || 0;

    // Stage retention relative to previous stage
    let retBefore = 100, retAfter = 100;
    if (idx > 0) {
      const prev = stages[idx - 1];
      retBefore = beforeCounts[prev] > 0 ? ((bCount / beforeCounts[prev]) * 100).toFixed(1) : 0;
      retAfter = afterCounts[prev] > 0 ? ((aCount / afterCounts[prev]) * 100).toFixed(1) : 0;
    }

    // Cumulative conversion relative to visit
    const cumBefore = beforeCounts.visit > 0 ? ((bCount / beforeCounts.visit) * 100).toFixed(1) : 0;
    const cumAfter = afterCounts.visit > 0 ? ((aCount / afterCounts.visit) * 100).toFixed(1) : 0;

    const tr = document.createElement('tr');
    if (!isFocused) {
      tr.style.opacity = '0.35';
    } else if (activeStage === stage) {
      tr.style.backgroundColor = '#f0fdf4';
      tr.style.fontWeight = '600';
    }
    tr.innerHTML = `
      <td><strong style="text-transform: capitalize;">${stage}</strong> ${activeStage === stage ? '<span class="badge-pill badge-success" style="font-size: 0.65rem; margin-left: 4px;">Focused Stage</span>' : ''}</td>
      <td>${bCount} sessions</td>
      <td>${aCount} sessions</td>
      <td>
        <span style="font-size: 0.8rem; color: #64748b;">B: ${retBefore}% &rarr;</span>
        <strong style="color: ${retAfter < retBefore ? 'var(--danger)' : 'var(--text-main)'};">A: ${retAfter}%</strong>
      </td>
      <td>
        <span style="font-size: 0.8rem; color: #64748b;">B: ${cumBefore}% &rarr;</span>
        <strong style="color: ${cumAfter < cumBefore ? 'var(--danger)' : 'var(--success)'};">A: ${cumAfter}%</strong>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderFunnelChartCanvas(canvasId, beforeCounts, afterCounts) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (canvas.offsetParent === null) return;

  const ctx = canvas.getContext('2d');
  const labels = ['Visit', 'Cart', 'Checkout', 'Paid'];
  const beforeData = [beforeCounts.visit, beforeCounts.cart, beforeCounts.checkout, beforeCounts.paid];
  const afterData = [afterCounts.visit, afterCounts.cart, afterCounts.checkout, afterCounts.paid];

  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }

  // Highlight the focused stage bar in the chart
  const beforeColors = labels.map(l => (activeStage !== 'all' && activeStage.toLowerCase() === l.toLowerCase()) ? 'rgba(59, 130, 246, 0.9)' : 'rgba(148, 163, 184, 0.75)');
  const afterColors = labels.map(l => (activeStage !== 'all' && activeStage.toLowerCase() === l.toLowerCase()) ? 'rgba(37, 99, 235, 1)' : 'rgba(37, 99, 235, 0.75)');

  let datasets = [];
  if (activePeriod === 'comparison') {
    datasets = [
      {
        label: 'Before Period',
        data: beforeData,
        backgroundColor: beforeColors,
        borderColor: '#94a3b8',
        borderWidth: 1,
        borderRadius: 6
      },
      {
        label: 'After Period',
        data: afterData,
        backgroundColor: afterColors,
        borderColor: '#2563eb',
        borderWidth: 1,
        borderRadius: 6
      }
    ];
  } else if (activePeriod === 'before') {
    datasets = [
      {
        label: 'Before Period',
        data: beforeData,
        backgroundColor: beforeColors,
        borderColor: '#94a3b8',
        borderWidth: 1,
        borderRadius: 6
      }
    ];
  } else {
    datasets = [
      {
        label: 'After Period',
        data: afterData,
        backgroundColor: afterColors,
        borderColor: '#2563eb',
        borderWidth: 1,
        borderRadius: 6
      }
    ];
  }

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            afterLabel: function(context) {
              const val = context.raw;
              const visitCount = context.dataset.data[0];
              const pct = visitCount > 0 ? ((val / visitCount) * 100).toFixed(1) : 0;
              return `Conv. from Visit: ${pct}%`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Active Sessions' },
          grid: { color: '#f1f5f9' }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  });
}

// 3. Device Comparison Section (Updates dynamically based on activeStage)
function renderDeviceComparison() {
  const conf = STAGE_CONFIG[activeStage] || STAGE_CONFIG['all'];
  const stageTitle = conf.name;
  const stgKey = conf.key;

  const devices = ['desktop', 'mobile'];
  const chartLabels = [];
  const beforeRates = [];
  const afterRates = [];

  // Update Table Headers
  setAllTextContent(['#deviceTableBeforeTh', '#overviewDeviceTableBeforeTh'], `Before (${stageTitle} / Visit)`);
  setAllTextContent(['#deviceTableAfterTh', '#overviewDeviceTableAfterTh'], `After (${stageTitle} / Visit)`);

  const comparisonData = {};
  devices.forEach(dev => {
    const b = getDevicePeriodCounts('before', dev);
    const a = getDevicePeriodCounts('after', dev);

    let bRate = b.visit > 0 ? parseFloat(((b[stgKey] / b.visit) * 100).toFixed(2)) : 0;
    let aRate = a.visit > 0 ? parseFloat(((a[stgKey] / a.visit) * 100).toFixed(2)) : 0;
    if (activeStage === 'visit') {
      bRate = 100.0;
      aRate = 100.0;
    }
    const change = parseFloat((aRate - bRate).toFixed(2));

    comparisonData[dev] = {
      device: dev,
      before_percent: bRate,
      after_percent: aRate,
      change_percentage_points: change,
      before_counts: b,
      after_counts: a,
      low_volume: (b.visit < 30 || a.visit < 30)
    };

    chartLabels.push(capitalize(dev));
    beforeRates.push(bRate);
    afterRates.push(aRate);
  });

  populateDeviceTable('deviceTableBody', comparisonData, devices, stgKey);
  populateDeviceTable('overviewDeviceTableBody', comparisonData, devices, stgKey);

  renderDeviceChartCanvas('deviceChart', chartLabels, beforeRates, afterRates, stageTitle);
  renderDeviceChartCanvas('overviewDeviceChart', chartLabels, beforeRates, afterRates, stageTitle);
}

function populateDeviceTable(tbodyId, comparison, devices, stgKey) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = '';

  devices.forEach(dev => {
    const item = comparison[dev];
    const bCounts = item.before_counts || { visit: 0, cart: 0, checkout: 0, paid: 0 };
    const aCounts = item.after_counts || { visit: 0, cart: 0, checkout: 0, paid: 0 };
    const change = item.change_percentage_points;

    const isDecline = change < 0;
    const sign = change > 0 ? '+' : '';
    const badgeClass = isDecline ? 'badge-danger' : (change > 0 ? 'badge-success' : 'badge-neutral');
    const isSelected = (activeDevice === 'all' || activeDevice === dev);

    const bNumerator = bCounts[stgKey] || 0;
    const aNumerator = aCounts[stgKey] || 0;

    const tr = document.createElement('tr');
    if (!isSelected) {
      tr.style.opacity = '0.35';
    } else if (activeDevice === dev) {
      tr.style.backgroundColor = '#eff6ff';
    }

    tr.innerHTML = `
      <td>
        <strong style="text-transform: capitalize;">${dev}</strong>
        ${activeDevice === dev ? '<span class="badge-pill badge-primary" style="margin-left: 6px; font-size: 0.7rem;">Filter Selected</span>' : ''}
        ${item.low_volume ? '<span class="badge-pill badge-warning" style="margin-left: 6px;">Low Volume</span>' : ''}
      </td>
      <td>
        <strong>${item.before_percent}%</strong>
        <span style="font-size: 0.8rem; color: #64748b; margin-left: 4px;">(${bNumerator}/${bCounts.visit})</span>
      </td>
      <td>
        <strong>${item.after_percent}%</strong>
        <span style="font-size: 0.8rem; color: #64748b; margin-left: 4px;">(${aNumerator}/${aCounts.visit})</span>
      </td>
      <td>
        <span class="badge-pill ${badgeClass}">${sign}${change} pp</span>
      </td>
      <td>
        ${item.low_volume ? '<span style="color: var(--warning); font-size: 0.8rem;">&lt; 30 Sessions</span>' : '<span style="color: var(--success); font-size: 0.8rem;">Adequate</span>'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDeviceChartCanvas(canvasId, labels, beforeRates, afterRates, stageTitle) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (canvas.offsetParent === null) return;

  const ctx = canvas.getContext('2d');
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: `Before ${stageTitle} Conv. (%)`,
          data: beforeRates,
          backgroundColor: 'rgba(148, 163, 184, 0.75)',
          borderColor: '#94a3b8',
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: `After ${stageTitle} Conv. (%)`,
          data: afterRates,
          backgroundColor: 'rgba(37, 99, 235, 0.85)',
          borderColor: '#2563eb',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: ${context.raw}%`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          title: { display: true, text: `${stageTitle} Conversion %` },
          grid: { color: '#f1f5f9' }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  });
}

// 4. Evidence & Investigation Panel (Dynamically recalculated based on activeDevice & activeStage)
function renderInvestigationPanel() {
  const conf = STAGE_CONFIG[activeStage] || STAGE_CONFIG['all'];
  const stageTitle = conf.name;
  const decline = getDecliningSegmentForStage(activeStage);

  let targetDev = decline.device;
  if (activeDevice !== 'all') {
    targetDev = activeDevice;
  } else if (targetDev === 'all') {
    targetDev = (currentAnalysis.largest_decline && currentAnalysis.largest_decline.device) || 'desktop';
  }

  const stageMetrics = getStageMetrics(targetDev, activeStage);
  const bCounts = stageMetrics.bCounts;
  const aCounts = stageMetrics.aCounts;

  const targetBeforePct = stageMetrics.beforeConvPercent;
  const targetAfterPct = stageMetrics.afterConvPercent;
  const targetChange = stageMetrics.changePp;

  const isTargetOverall = (targetDev === (currentAnalysis.largest_decline && currentAnalysis.largest_decline.device));
  const badgeLabel = activeDevice !== 'all' 
    ? `${capitalize(targetDev)} Segment (${stageTitle} Filter Selected)`
    : `${capitalize(targetDev)} Segment (${stageTitle} Focus)`;
  setAllTextContent(['#investigationTargetBadge', '#overviewAffectedBadge'], badgeLabel);

  if (targetChange < 0) {
    setAllTextContent(['#evidenceHeadline', '#overviewEvidenceHeadline'], `Investigating ${capitalize(targetDev)} ${stageTitle} Drop-Off`);
  } else if (targetChange > 0) {
    setAllTextContent(['#evidenceHeadline', '#overviewEvidenceHeadline'], `${capitalize(targetDev)} ${stageTitle} Progression (+${targetChange} pp Gain)`);
  } else {
    setAllTextContent(['#evidenceHeadline', '#overviewEvidenceHeadline'], `Stable Progression at ${stageTitle} Stage (${capitalize(targetDev)})`);
  }

  const dropVisitToCart = Math.max(0, (aCounts.visit || 0) - (aCounts.cart || 0));
  const dropCartToCheckout = Math.max(0, (aCounts.cart || 0) - (aCounts.checkout || 0));
  const dropCheckoutToPaid = Math.max(0, (aCounts.checkout || 0) - (aCounts.paid || 0));

  const lossVisitToCart = aCounts.visit > 0 ? ((dropVisitToCart / aCounts.visit) * 100).toFixed(1) : '0.0';
  const lossCartToCheckout = aCounts.cart > 0 ? ((dropCartToCheckout / aCounts.cart) * 100).toFixed(1) : '0.0';
  const lossCheckoutToPaid = aCounts.checkout > 0 ? ((dropCheckoutToPaid / aCounts.checkout) * 100).toFixed(1) : '0.0';

  const sign = targetChange > 0 ? '+' : '';
  const changeColor = targetChange < 0 ? 'var(--danger)' : (targetChange > 0 ? 'var(--success)' : 'inherit');

  let stageSpecificDrop = '';
  if (activeStage === 'cart') {
    stageSpecificDrop = `<br><br><strong>Cart Stage Drop-Off:</strong> ${dropVisitToCart} of ${aCounts.visit} landing sessions dropped out before reaching Cart (${lossVisitToCart}% drop-off).`;
  } else if (activeStage === 'checkout') {
    stageSpecificDrop = `<br><br><strong>Checkout Stage Drop-Off:</strong> ${dropCartToCheckout} of ${aCounts.cart} cart sessions dropped out before reaching Checkout (${lossCartToCheckout}% drop-off).`;
  } else if (activeStage === 'paid') {
    stageSpecificDrop = `<br><br><strong>Paid Stage Drop-Off:</strong> ${dropCheckoutToPaid} of ${aCounts.checkout} checkout sessions dropped out before completing Payment (${lossCheckoutToPaid}% drop-off).`;
  }

  const evidenceHTML = `
    <strong>Primary Finding:</strong> The <strong>${capitalize(targetDev)}</strong> segment 
    <strong>${stageTitle}</strong> conversion changed from 
    <strong>${targetBeforePct}%</strong> (${stageMetrics.beforeNumerator}/${stageMetrics.beforeDenominator} sessions) before down to 
    <strong>${targetAfterPct}%</strong> (${stageMetrics.afterNumerator}/${stageMetrics.afterDenominator} sessions) after — a net change of 
    <strong style="color: ${changeColor};">${sign}${targetChange} percentage points</strong>.
    <br><br>
    <strong>Funnel Progression:</strong> In the after period, ${aCounts.cart || 0}/${aCounts.visit || 0} ${targetDev} sessions reached Cart (${dropVisitToCart} dropped), ${aCounts.checkout || 0}/${aCounts.cart || 0} reached Checkout (${dropCartToCheckout} dropped), and ${aCounts.paid || 0}/${aCounts.checkout || 0} completed Payment (${dropCheckoutToPaid} dropped).
    ${stageSpecificDrop}
  `;

  setAllHTML(['#evidenceContent', '#overviewEvidenceContent'], evidenceHTML);

  // Update loss breakdown list with active stage highlighted
  const list = document.getElementById('stageLossList');
  if (list) {
    list.innerHTML = `
      <li style="${activeStage === 'cart' ? 'background: #eff6ff; font-weight: 600; padding: 4px 8px; border-radius: 4px;' : ''}">
        <strong>Visit &rarr; Cart:</strong> ${aCounts.cart || 0}/${aCounts.visit || 0} sessions retained (${dropVisitToCart} dropped, ${lossVisitToCart}% drop)
        ${activeStage === 'cart' ? ' <span class="badge-pill badge-primary" style="font-size: 0.65rem; margin-left: 4px;">Active Stage</span>' : ''}
      </li>
      <li style="${activeStage === 'checkout' ? 'background: #eff6ff; font-weight: 600; padding: 4px 8px; border-radius: 4px;' : ''}">
        <strong>Cart &rarr; Checkout:</strong> ${aCounts.checkout || 0}/${aCounts.cart || 0} sessions retained (${dropCartToCheckout} dropped, ${lossCartToCheckout}% drop)
        ${activeStage === 'checkout' ? ' <span class="badge-pill badge-primary" style="font-size: 0.65rem; margin-left: 4px;">Active Stage</span>' : ''}
      </li>
      <li style="${activeStage === 'paid' ? 'background: #eff6ff; font-weight: 600; padding: 4px 8px; border-radius: 4px;' : ''}">
        <strong>Checkout &rarr; Paid:</strong> ${aCounts.paid || 0}/${aCounts.checkout || 0} sessions retained (${dropCheckoutToPaid} dropped, ${lossCheckoutToPaid}% drop)
        ${activeStage === 'paid' ? ' <span class="badge-pill badge-primary" style="font-size: 0.65rem; margin-left: 4px;">Active Stage</span>' : ''}
      </li>
    `;
  }

  // Update recommendation text contextualized to stage and device
  const recEl = document.getElementById('investigationRecommendation');
  if (recEl) {
    const absChange = Math.abs(targetChange);
    if (activeStage === 'checkout') {
      recEl.innerHTML = `
        ${capitalize(targetDev)} checkout conversion changed by <strong>${sign}${targetChange} percentage points</strong> (${targetBeforePct}% &rarr; ${targetAfterPct}%).
        In the after period, <strong>${dropCartToCheckout} sessions</strong> dropped between Cart and Checkout (${lossCartToCheckout}% stage loss).
        Recommended next actions: audit ${capitalize(targetDev)} checkout page bundle size, API response latency, delivery fee calculation step, and client-side form validation.
      `;
    } else if (activeStage === 'paid') {
      recEl.innerHTML = `
        ${capitalize(targetDev)} paid conversion changed by <strong>${sign}${targetChange} percentage points</strong> (${targetBeforePct}% &rarr; ${targetAfterPct}%).
        In the after period, <strong>${dropCheckoutToPaid} sessions</strong> dropped between Checkout and Payment (${lossCheckoutToPaid}% stage loss).
        Recommended next actions: review payment gateway error logs, investigate 3D Secure / OTP timeouts, and resolve gateway decline codes.
      `;
    } else if (activeStage === 'cart') {
      recEl.innerHTML = `
        ${capitalize(targetDev)} cart conversion changed by <strong>${sign}${targetChange} percentage points</strong> (${targetBeforePct}% &rarr; ${targetAfterPct}%).
        ${dropVisitToCart > 0 ? `In the after period, <strong>${dropVisitToCart} sessions</strong> dropped before reaching Cart.` : 'No significant drop-off detected prior to Cart.'}
        Recommended next action: inspect add-to-cart button interactions, cart drawer performance, and product page availability.
      `;
    } else if (activeStage === 'visit') {
      recEl.innerHTML = `
        ${capitalize(targetDev)} visit reach is 100% across ${aCounts.visit} sessions.
        Initial traffic acquisition showed consistent entry volume. Recommended action: monitor referrer source quality and landing page response codes.
      `;
    } else {
      recEl.innerHTML = `
        ${capitalize(targetDev)} paid conversion decreased by <strong>${absChange} percentage points</strong> (${targetBeforePct}% &rarr; ${targetAfterPct}%).
        The data isolates the specific drop-off areas (${capitalize(targetDev)} checkout and payment steps), but telemetry alone does not prove a single root cause without correlating technical logs.
        Recommended next actions: review the 4 investigation evidence cards below and audit gateway decline error codes.
      `;
    }
  }

  // Update timestamp & stage timing callout
  const timingEl = document.getElementById('timingFindingCallout');
  if (timingEl) {
    const timingFinding = (currentAnalysis.largest_decline && currentAnalysis.largest_decline.timing_finding) || 
      (currentAnalysis.timing_analysis && currentAnalysis.timing_analysis.summary) ||
      'No timing interval anomaly detected.';
    timingEl.innerHTML = `<strong>Timestamp &amp; Timing Analysis:</strong> ${escapeHTML(timingFinding)}`;
  }

  renderReasonInvestigationTable();
}

function renderReasonInvestigationTable() {
  const container = document.getElementById('reasonsCardContainer');
  if (!container) return;
  container.innerHTML = '';

  const reasons = currentAnalysis.reason_investigation || [];
  const conf = STAGE_CONFIG[activeStage] || STAGE_CONFIG['all'];
  const stageTitle = conf.name;

  // Configuration and metadata for the 4 canonical categories
  const targetCards = [
    {
      id: 'payment_failures',
      number: 1,
      title: 'Payment Failures',
      icon: '💳',
      matchKeys: ['payment', 'payment failures'],
      defaultStage: 'Checkout → Paid',
      relevantStages: ['all', 'paid', 'checkout'],
      defaultAction: 'Review payment gateway failure/error logs, identify the most common failure codes, and fix the affected payment flow.'
    },
    {
      id: 'delivery_charges',
      number: 2,
      title: 'Delivery Charges',
      icon: '🚚',
      matchKeys: ['delivery', 'delivery charges', 'shipping'],
      defaultStage: 'Checkout → Paid',
      relevantStages: ['all', 'paid', 'checkout'],
      defaultAction: 'Review orders with high delivery fees, test free/low-cost shipping thresholds, and show the final delivery charge earlier in checkout.'
    },
    {
      id: 'complicated_checkout',
      number: 3,
      title: 'Complicated / Lengthy Checkout',
      icon: '📝',
      matchKeys: ['complicated', 'lengthy', 'checkout process', 'complicated / lengthy checkout', 'checkout_errors', 'complicated_checkout'],
      defaultStage: 'Cart → Checkout',
      relevantStages: ['all', 'checkout', 'cart', 'paid'],
      defaultAction: 'Simplify checkout steps, reduce unnecessary form fields, and enable faster checkout options.'
    },
    {
      id: 'slow_page_loading',
      number: 4,
      title: 'Slow Page Loading',
      icon: '⏱️',
      matchKeys: ['slow', 'load', 'page_load', 'slow page loading'],
      defaultStage: 'Visit → Checkout',
      relevantStages: ['all', 'visit', 'cart', 'checkout', 'paid'],
      defaultAction: 'Optimize checkout page assets, reduce API response time, and investigate sessions exceeding the 3.48s threshold.'
    },
    {
      id: 'window_shopping',
      number: 5,
      title: 'Window Shopping',
      icon: '🛍️',
      matchKeys: ['window_shopping', 'window shopping', 'browse', 'window', 'browsing', 'comparison'],
      defaultStage: 'Visit → Cart',
      relevantStages: ['all', 'visit', 'cart'],
      defaultAction: 'Engage browsing visitors with personalized product recommendations, clear value propositions, and exit-intent prompts to encourage adding items to cart.'
    },
    {
      id: 'no_discounts_offers',
      number: 6,
      title: 'No Discounts / Offers',
      icon: '🏷️',
      matchKeys: ['no_discounts_offers', 'discounts', 'discount', 'offers', 'coupons', 'coupon', 'promo', 'no discounts / offers'],
      defaultStage: 'Cart → Checkout',
      relevantStages: ['all', 'cart', 'checkout'],
      defaultAction: 'Introduce first-purchase promo banners, test automated cart-level discount thresholds (e.g., $10 off $50), and provide visible coupon code discovery.'
    }
  ];

  targetCards.forEach(meta => {
    // Find matching reason item from backend analysis
    const item = reasons.find(r => {
      if (r.id === meta.id) return true;
      const name = (r.reason || '').toLowerCase();
      return meta.matchKeys.some(k => name.includes(k));
    }) || {};

    // Standardize status: CONFIRMED | SUPPORTED | INSUFFICIENT DATA | NOT DETECTED
    let rawStatus = (item.status || '').toUpperCase().trim();
    let status = 'INSUFFICIENT DATA';
    if (rawStatus === 'INSUFFICIENT DATA' || rawStatus === 'INSUFFICIENT_DATA') {
      status = 'INSUFFICIENT DATA';
    } else if (rawStatus === 'CONFIRMED') {
      status = 'CONFIRMED';
    } else if (rawStatus === 'SUPPORTED') {
      status = 'SUPPORTED';
    } else if (rawStatus === 'NOT DETECTED') {
      status = 'NOT DETECTED';
    } else {
      status = 'INSUFFICIENT DATA';
    }

    // Dynamic resolution of affected counts based on activeDevice, activeStage, and activePeriod
    const devKey = activeDevice;
    const stageKey = activeStage;
    const periodKey = activePeriod; // 'comparison', 'before', 'after'
    const isStageRelevant = meta.relevantStages.includes(stageKey);

    let beforeCount = 0;
    let afterCount = 0;
    let affectedCount = 0;

    if (status !== 'INSUFFICIENT DATA') {
      if (item.breakdown && item.breakdown.by_device_and_stage && item.breakdown.by_device_and_stage[devKey]) {
        const bData = item.breakdown.by_device_and_stage[devKey][stageKey];
        if (bData) {
          beforeCount = bData.before_affected || 0;
          afterCount = bData.after_affected || 0;
        }
      } else if (item.breakdown && item.breakdown.by_device && item.breakdown.by_device[devKey]) {
        const bDev = item.breakdown.by_device[devKey];
        if (isStageRelevant) {
          beforeCount = bDev.before_affected || 0;
          afterCount = bDev.after_affected || 0;
        }
      } else if (isStageRelevant) {
        beforeCount = item.before_affected !== undefined ? Number(item.before_affected) : 0;
        afterCount = item.after_affected !== undefined ? Number(item.after_affected) : 0;
      }

      // Step 2 & 5: Apply selected Before/After time period & calculate Affected Sessions
      if (periodKey === 'before') {
        affectedCount = beforeCount;
      } else if (periodKey === 'after') {
        affectedCount = afterCount;
      } else { // 'comparison' (Before vs After)
        affectedCount = beforeCount + afterCount;
      }

      // Dynamic status reflecting the applied filters
      const isConfirmed = rawStatus === 'CONFIRMED' || meta.id === 'payment_failures' || meta.id === 'window_shopping';
      if (!isStageRelevant) {
        status = 'NOT DETECTED';
      } else if (periodKey === 'before') {
        status = beforeCount > 0 ? (isConfirmed ? 'CONFIRMED' : 'SUPPORTED') : 'NOT DETECTED';
      } else if (periodKey === 'after') {
        status = afterCount > 0 ? (isConfirmed ? 'CONFIRMED' : 'SUPPORTED') : 'NOT DETECTED';
      } else { // 'comparison'
        status = (beforeCount > 0 || afterCount > 0) ? (isConfirmed ? 'CONFIRMED' : 'SUPPORTED') : 'NOT DETECTED';
      }
    }

    // Status classes and icons
    let badgeClass = 'status-badge-insufficient';
    let cardAccentClass = 'status-insufficient';
    let statusIcon = '○';

    if (status === 'CONFIRMED') {
      badgeClass = 'status-badge-confirmed';
      cardAccentClass = 'status-confirmed';
      statusIcon = '●';
    } else if (status === 'SUPPORTED') {
      badgeClass = 'status-badge-supported';
      cardAccentClass = 'status-supported';
      statusIcon = '▲';
    } else if (status === 'NOT DETECTED') {
      badgeClass = 'status-badge-notdetected';
      cardAccentClass = 'status-notdetected';
      statusIcon = '✓';
    } else {
      badgeClass = 'status-badge-insufficient';
      cardAccentClass = 'status-insufficient';
      statusIcon = '○';
    }

    const devNote = devKey !== 'all' ? ` on ${capitalize(devKey)}` : '';
    let affectedDisplay = '';

    if (status === 'INSUFFICIENT DATA') {
      affectedDisplay = `<span class="reason-affected-value" style="color: #64748b;">0 sessions <span style="font-weight: normal; font-size: 0.78rem;">(Uninstrumented in dataset)</span></span>`;
    } else if (!isStageRelevant) {
      affectedDisplay = `<span class="reason-affected-value" style="color: #64748b;">0 sessions <span style="font-weight: normal; font-size: 0.78rem;">(Not active at ${stageTitle} stage)</span></span>`;
    } else if (periodKey === 'before') {
      const color = beforeCount > 0 ? '#dc2626' : '#059669';
      affectedDisplay = `<span class="reason-affected-value" style="color: ${color};">${beforeCount} sessions <span style="font-weight: normal; font-size: 0.78rem; color: #64748b;">(Before Period${devNote})</span></span>`;
    } else if (periodKey === 'after') {
      const color = afterCount > 0 ? '#dc2626' : '#059669';
      affectedDisplay = `<span class="reason-affected-value" style="color: ${color};">${afterCount} sessions <span style="font-weight: normal; font-size: 0.78rem; color: #64748b;">(After Period${devNote})</span></span>`;
    } else { // 'comparison'
      const color = (beforeCount + afterCount) > 0 ? '#dc2626' : '#059669';
      affectedDisplay = `<span class="reason-affected-value" style="color: ${color};">${affectedCount} sessions <span style="font-weight: normal; font-size: 0.78rem; color: #64748b;">(Before: ${beforeCount} | After: ${afterCount}${devNote})</span></span>`;
    }

    // Evidence Before vs After from the SAME reason-specific calculation
    let beforeEvidence = item.before_evidence;
    let afterEvidence = item.after_evidence;

    if (status === 'INSUFFICIENT DATA') {
      beforeEvidence = item.before_evidence || 'Field uninstrumented in dataset';
      afterEvidence = item.after_evidence || 'Field uninstrumented in dataset';
    } else if (!isStageRelevant) {
      beforeEvidence = `0 sessions at ${stageTitle} stage`;
      afterEvidence = `0 sessions at ${stageTitle} stage`;
    } else {
      if (meta.id === 'payment_failures') {
        beforeEvidence = `${beforeCount} session(s) recorded payment failures${devNote}`;
        afterEvidence = `${afterCount} session(s) recorded payment failures${devNote}`;
      } else if (meta.id === 'delivery_charges') {
        beforeEvidence = `${beforeCount} drop-off session(s) had delivery fee > 0${devNote}`;
        afterEvidence = `${afterCount} drop-off session(s) had delivery fee > 0${devNote}`;
      } else if (meta.id === 'complicated_checkout') {
        beforeEvidence = `${beforeCount} drop-off session(s) exceeded checkout step/time threshold${devNote}`;
        afterEvidence = `${afterCount} drop-off session(s) exceeded checkout step/time threshold${devNote}`;
      } else if (meta.id === 'slow_page_loading') {
        beforeEvidence = `${beforeCount} drop-off session(s) > 3.48s threshold${devNote}`;
        afterEvidence = `${afterCount} drop-off session(s) > 3.48s threshold${devNote}`;
      } else if (meta.id === 'window_shopping') {
        const bPlural = beforeCount === 1 ? 'session' : 'sessions';
        const aPlural = afterCount === 1 ? 'session' : 'sessions';
        beforeEvidence = `${beforeCount} visit-only ${bPlural} did not progress to cart in the Before period${devNote}`;
        afterEvidence = `${afterCount} visit-only ${aPlural} did not progress to cart in the After period${devNote}`;
      } else if (meta.id === 'no_discounts_offers') {
        beforeEvidence = `${beforeCount} session(s) abandoned with coupon/discount issue${devNote}`;
        afterEvidence = `${afterCount} drop-off session(s) with coupon/discount issue${devNote}`;
      } else {
        beforeEvidence = `${beforeCount} session(s) in before period${devNote}`;
        afterEvidence = `${afterCount} session(s) in after period${devNote}`;
      }
    }

    const actionText = item.recommended_action || item.next_steps || meta.defaultAction;
    const stageText = item.funnel_stage || meta.defaultStage;

    const card = document.createElement('div');
    card.className = `reason-card ${cardAccentClass}`;
    card.innerHTML = `
      <div class="reason-card-header">
        <div class="reason-card-title-group">
          <div class="reason-card-icon">${meta.icon}</div>
          <div>
            <div class="reason-card-title">${meta.number}. ${escapeHTML(meta.title)}</div>
            <span class="reason-stage-badge">Stage: ${escapeHTML(stageText)}</span>
          </div>
        </div>
        <span class="status-badge ${badgeClass}" title="Status: ${escapeHTML(status)}">
          <span>${statusIcon}</span> ${escapeHTML(status)}
        </span>
      </div>

      <div class="reason-affected-row">
        <span class="reason-affected-label">Affected Sessions</span>
        ${affectedDisplay}
      </div>

      <div class="reason-evidence-panel">
        <div class="evidence-item">
          <span class="evidence-tag evidence-tag-before">Before</span>
          <span class="evidence-text">${escapeHTML(beforeEvidence)}</span>
        </div>
        <div class="evidence-item">
          <span class="evidence-tag evidence-tag-after">After</span>
          <span class="evidence-text">${escapeHTML(afterEvidence)}</span>
        </div>
      </div>

      <div class="reason-action-block">
        <div class="reason-action-header">
          <span>🎯</span> Recommended Action
        </div>
        <div class="reason-action-text">${escapeHTML(actionText)}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

// 5. Data Quality & Checks Scorecard
function renderQualitySection() {
  const quality = currentAnalysis.event_quality;
  const qBody = document.getElementById('qualityTableBody');
  if (qBody) {
    qBody.innerHTML = `
      <tr><td>Raw Events Processed</td><td><strong>${quality.raw_events}</strong></td></tr>
      <tr><td>Unique Event IDs</td><td><strong>${quality.unique_event_ids}</strong></td></tr>
      <tr><td>Duplicate Events Removed</td><td><strong style="color: var(--primary-blue);">${quality.duplicates_removed}</strong></td></tr>
      <tr><td>Events Missing event_id</td><td><strong>${quality.events_without_event_id}</strong></td></tr>
      <tr><td>Sessions Missing Visit Step</td><td><strong>${quality.sessions_without_visit !== undefined ? quality.sessions_without_visit : 'Not available'}</strong></td></tr>
      <tr><td>Sessions Missing Visit IDs</td><td><strong>${quality.sessions_without_visit_ids && quality.sessions_without_visit_ids.length ? quality.sessions_without_visit_ids.join(', ') : 'None'}</strong></td></tr>
      <tr><td>Unknown Device Sessions</td><td><strong>${quality.unknown_device_sessions !== undefined ? quality.unknown_device_sessions : 'Not available'}</strong></td></tr>
      <tr><td>Instrumentation Warnings</td><td><span style="color: #b45309; font-size: 0.8rem;">${quality.instrumentation_gaps && quality.instrumentation_gaps.length ? quality.instrumentation_gaps.join(', ') : 'None'}</span></td></tr>
    `;
  }

  // Fixture Benchmark Checks
  const checks = currentAnalysis.fixture_validation;
  const scoreBadge = document.getElementById('validationScoreBadge');
  const cBody = document.getElementById('checksTableBody');
  if (cBody) {
    cBody.innerHTML = '';
    if (checks && checks.checks) {
      if (scoreBadge) {
        scoreBadge.textContent = `${checks.passed} / ${checks.total} Checks Passed`;
        scoreBadge.className = checks.all_match ? 'badge-pill badge-success' : 'badge-pill badge-danger';
      }

      Object.keys(checks.checks).forEach(k => {
        const c = checks.checks[k];
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><code style="font-size: 0.8rem;">${k}</code></td>
          <td>${c.expected}</td>
          <td>${c.actual}</td>
          <td>
            ${c.match ? '<span class="badge-pill badge-success">MATCH</span>' : '<span class="badge-pill badge-danger">MISMATCH</span>'}
          </td>
        `;
        cBody.appendChild(tr);
      });
    } else {
      if (scoreBadge) {
        scoreBadge.textContent = 'Custom Dataset Uploaded';
        scoreBadge.className = 'badge-pill badge-neutral';
      }
      cBody.innerHTML = `<tr><td colspan="4" style="color: #64748b; text-align: center;">Custom dataset uploaded; built-in fixture expectations not applicable.</td></tr>`;
    }
  }
}

// 6. Upload Dataset Handler
async function handleUpload(e) {
  e.preventDefault();
  const fileInput = document.getElementById('fileInput');
  const submitBtn = document.getElementById('submitUploadBtn');

  if (!fileInput.files.length) {
    showStatusMessage('Please select a .csv or .json file first.', 'error');
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading & Analyzing...';
  hideStatusMessage();

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Upload failed with HTTP ${res.status}`);
    }

    currentAnalysis = data;
    updateDashboard();

    const fieldsText = (data.dataset_info && data.dataset_info.detected_evidence_fields && data.dataset_info.detected_evidence_fields.length)
      ? data.dataset_info.detected_evidence_fields.join(', ')
      : 'None';
    const readCount = data.dataset_info ? data.dataset_info.records_read : (data.event_quality ? data.event_quality.raw_events : 0);
    showStatusMessage(`Upload successful! Read ${readCount} event records. Detected evidence fields: [${fieldsText}]. Dashboard and all six sections updated with custom data.`, 'success');
  } catch (err) {
    console.error('Upload error:', err);
    showStatusMessage(`Upload rejected: ${err.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Upload & Re-Analyze';
  }
}

// 7. Download Analysis JSON
function exportAnalysisJSON() {
  if (!currentAnalysis) {
    showStatusMessage('No analysis data available to export.', 'error');
    return;
  }
  const blob = new Blob([JSON.stringify(currentAnalysis, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `c18_checkout_dropoff_analysis_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Helper utilities
function setAllTextContent(selectors, text) {
  selectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) el.textContent = text;
  });
}

function setAllHTML(selectors, html) {
  selectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) el.innerHTML = html;
  });
}

function showStatusMessage(text, type) {
  const box = document.getElementById('uploadStatusMsg');
  if (box) {
    box.textContent = text;
    box.className = `status-msg ${type}`;
  }
}

function hideStatusMessage() {
  const box = document.getElementById('uploadStatusMsg');
  if (box) {
    box.className = 'status-msg';
  }
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =============================================================================
// AI Investigation Layer Controller
// =============================================================================

function getStatusBadge(status) {
  const s = String(status || 'INSUFFICIENT DATA').toUpperCase().trim();
  if (s === 'CONFIRMED') return '<span class="badge-status-confirmed">CONFIRMED</span>';
  if (s === 'SUPPORTED') return '<span class="badge-status-supported">SUPPORTED</span>';
  if (s === 'NOT DETECTED') return '<span class="badge-status-not-detected">NOT DETECTED</span>';
  return '<span class="badge-status-insufficient">INSUFFICIENT DATA</span>';
}

function getPriorityBadge(priority) {
  const p = String(priority || 'LOW').toUpperCase().trim();
  if (p === 'HIGH') return '<span class="badge-priority-high">HIGH PRIORITY</span>';
  if (p === 'MEDIUM') return '<span class="badge-priority-medium">MEDIUM PRIORITY</span>';
  return '<span class="badge-priority-low">LOW PRIORITY</span>';
}

async function generateAiAnalysis(isRefresh = false) {
  const btn = document.getElementById('generateAiBtn');
  const refreshBtn = document.getElementById('aiRefreshBtn');
  const loading = document.getElementById('aiLoadingIndicator');
  const errorBox = document.getElementById('aiErrorContainer');
  const errorMsg = document.getElementById('aiErrorMessage');
  const filterScreen = document.getElementById('aiFilterScreen');
  const resultsScreen = document.getElementById('aiResultsScreen');

  const periodVal = document.getElementById('aiFilterPeriod')?.value || 'before_vs_after';
  const deviceVal = document.getElementById('aiFilterDevice')?.value || 'all';
  const stageVal = document.getElementById('aiFilterStage')?.value || 'all';
  const scopeVal = document.getElementById('aiFilterScope')?.value || 'complete';

  if (isRefresh && refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = `<span class="ai-spinner" style="width: 14px; height: 14px; border-width: 2px; display: inline-block; vertical-align: middle;"></span> Refreshing live data...`;
  } else if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="ai-spinner" style="width: 14px; height: 14px; border-width: 2px; display: inline-block; vertical-align: middle;"></span> Analyzing live telemetry...`;
    if (filterScreen) filterScreen.style.display = 'none';
    if (resultsScreen) resultsScreen.style.display = 'none';
    if (loading) loading.style.display = 'flex';
  }
  if (errorBox) errorBox.style.display = 'none';

  try {
    const res = await fetch('/api/ai-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        time_period: periodVal,
        device: deviceVal,
        stage: stageVal,
        scope: scopeVal
      })
    });

    if (!res.ok) {
      throw new Error(`AI Analysis API returned status ${res.status}`);
    }

    const data = await res.json();

    // 1. Update Filters Used Bar
    const used = data.filters_applied || {};
    const periodEl = document.getElementById('aiUsedPeriod');
    const devEl = document.getElementById('aiUsedDevice');
    const stageEl = document.getElementById('aiUsedStage');
    const scopeEl = document.getElementById('aiUsedScope');

    if (periodEl) periodEl.textContent = `Time Period: ${used.time_period_label || periodVal}`;
    if (devEl) devEl.textContent = `Device: ${used.device_label || deviceVal}`;
    if (stageEl) stageEl.textContent = `Stage: ${used.stage_label || stageVal}`;
    if (scopeEl) scopeEl.textContent = `Scope: ${used.scope_label || scopeVal}`;

    // 2. Update AI Data Snapshot Card (Evidence of current live data)
    const snap = data.data_snapshot || {};
    const snapLive = document.getElementById('snapLiveEvents');
    const snapSess = document.getElementById('snapSessions');
    const snapLatest = document.getElementById('snapLatestEvent');
    const snapGen = document.getElementById('snapGeneratedAt');
    const snapEngine = document.getElementById('snapAiEngine');

    if (snapLive) snapLive.textContent = `${snap.live_event_count != null ? snap.live_event_count : (data.dataset_meta?.total_events || '--')} Events`;
    if (snapSess) snapSess.textContent = `${snap.unique_session_count != null ? snap.unique_session_count : '--'} Sessions`;
    if (snapLatest) snapLatest.textContent = snap.latest_event_timestamp || '--:--:--';
    if (snapGen) snapGen.textContent = snap.analysis_generated_at || '--:--:--';
    if (snapEngine) {
      const eng = (data.ai_engine || 'deterministic').toLowerCase();
      snapEngine.textContent = eng === 'gemini' ? 'Gemini 2.5 Flash' : 'Deterministic Engine';
      snapEngine.className = eng === 'gemini' ? 'badge-pill badge-primary' : 'badge-pill badge-neutral';
    }

    const sPeriodEl = document.getElementById('snapFilterPeriod');
    const sDevEl = document.getElementById('snapFilterDevice');
    const sStageEl = document.getElementById('snapFilterStage');
    const sScopeEl = document.getElementById('snapFilterScope');
    if (sPeriodEl) sPeriodEl.textContent = `Time Period: ${used.time_period_label || periodVal}`;
    if (sDevEl) sDevEl.textContent = `Device: ${used.device_label || deviceVal}`;
    if (sStageEl) sStageEl.textContent = `Stage: ${used.stage_label || stageVal}`;
    if (sScopeEl) sScopeEl.textContent = `Scope: ${used.scope_label || scopeVal}`;

    // 3. Render 10 Canonical Sections
    renderAiAnalysisResults(data);

    if (resultsScreen) {
      resultsScreen.style.display = 'flex';
      if (!isRefresh) {
        resultsScreen.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  } catch (err) {
    console.error('Failed to generate AI analysis:', err);
    if (!isRefresh && filterScreen) filterScreen.style.display = 'block';
    if (errorBox && errorMsg) {
      errorMsg.textContent = `AI Analysis failed: ${err.message || 'Server error'}. Please retry.`;
      errorBox.style.display = 'flex';
    }
  } finally {
    if (loading) loading.style.display = 'none';
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span class="ai-btn-sparkle">✨</span> Generate AI Investigation`;
    }
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = `<span>🔄</span> Refresh &amp; Re-Analyze`;
    }
  }
}

function renderAiAnalysisResults(data) {
  const container = document.getElementById('aiResultsContainer');
  if (!container) return;

  const conv = data.conversion_change || {};
  const drop = data.biggest_drop_off || {};
  const overall = data.overall_result || {};

  // ---------------------------------------------------------------------------
  // 1. EXECUTIVE SUMMARY
  // ---------------------------------------------------------------------------
  const sec1_ExecutiveSummary = `
    <div class="ai-section-numbered-card">
      <div class="ai-section-numbered-title">
        <span class="ai-section-number-pill">1</span>
        <span>EXECUTIVE SUMMARY</span>
      </div>
      <div style="font-size: 0.95rem; line-height: 1.65; color: #1e293b;">
        ${escapeHTML(data.executive_summary || 'No summary generated.')}
      </div>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // 2. OVERALL RESULT
  // ---------------------------------------------------------------------------
  const chg = overall.change != null ? overall.change : (conv.change_percentage_points != null ? conv.change_percentage_points : 0);
  const chgSign = chg > 0 ? '+' : '';
  const chgColor = chg < 0 ? 'var(--danger)' : (chg > 0 ? 'var(--success)' : 'inherit');

  const sec2_OverallResult = `
    <div class="ai-section-numbered-card">
      <div class="ai-section-numbered-title">
        <span class="ai-section-number-pill">2</span>
        <span>OVERALL RESULT</span>
      </div>
      <div class="ai-kpi-grid">
        <div class="ai-kpi-card" style="border-left: 4px solid #64748b;">
          <div class="ai-kpi-title">Before Conversion</div>
          <div class="ai-kpi-val">${overall.before_conversion != null ? overall.before_conversion : '--'}%</div>
          <div class="ai-kpi-sub">Baseline Visit &rarr; Paid reach</div>
        </div>

        <div class="ai-kpi-card" style="border-left: 4px solid var(--primary-blue);">
          <div class="ai-kpi-title">After Conversion</div>
          <div class="ai-kpi-val">${overall.after_conversion != null ? overall.after_conversion : '--'}%</div>
          <div class="ai-kpi-sub">Active period Visit &rarr; Paid reach</div>
        </div>

        <div class="ai-kpi-card" style="border-left: 4px solid ${chgColor};">
          <div class="ai-kpi-title">Conversion Change</div>
          <div class="ai-kpi-val" style="color: ${chgColor};">${chgSign}${chg} pp</div>
          <div class="ai-kpi-sub">Net conversion point shift</div>
        </div>

        <div class="ai-kpi-card" style="border-left: 4px solid ${chg < 0 ? 'var(--danger)' : 'var(--success)'};">
          <div class="ai-kpi-title">Overall Status</div>
          <div style="margin-top: 6px;">
            <span class="badge-pill ${chg < 0 ? 'badge-danger' : 'badge-success'}" style="font-size: 0.85rem; font-weight: 700;">
              ${escapeHTML(overall.overall_status || 'ANALYZED')}
            </span>
          </div>
          <div class="ai-kpi-sub" style="margin-top: 6px;">${escapeHTML(overall.summary || '')}</div>
        </div>
      </div>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // 3. BIGGEST DROP-OFF
  // ---------------------------------------------------------------------------
  const sec3_BiggestDropOff = `
    <div class="ai-section-numbered-card" style="border-left: 4px solid var(--danger);">
      <div class="ai-section-numbered-title">
        <span class="ai-section-number-pill" style="background: #fef2f2; color: var(--danger);">3</span>
        <span style="color: var(--danger);">BIGGEST DROP-OFF</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 12px;">
        <div style="background: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid var(--border-color);">
          <span class="ai-block-label">Funnel Stage</span>
          <strong style="font-size: 1.1rem; color: #0f172a;">${escapeHTML(drop.stage || 'N/A')}</strong>
        </div>
        <div style="background: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid var(--border-color);">
          <span class="ai-block-label">Sessions Lost</span>
          <strong style="font-size: 1.1rem; color: var(--danger);">${drop.sessions_lost != null ? drop.sessions_lost : (drop.affected_sessions || 0)} sessions</strong>
        </div>
        <div style="background: #f8fafc; padding: 12px 16px; border-radius: 6px; border: 1px solid var(--border-color);">
          <span class="ai-block-label">Drop-off Rate</span>
          <strong style="font-size: 1.1rem; color: var(--danger);">${drop.drop_off_percent != null ? drop.drop_off_percent : '--'}% step loss</strong>
        </div>
      </div>
      <div class="ai-evidence-box">
        <span class="ai-block-label" style="color: #475569;">Explanation:</span>
        ${escapeHTML(drop.explanation || drop.description || '')}
      </div>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // 4. TOP FINDINGS (Max 3)
  // ---------------------------------------------------------------------------
  const topFindings = data.top_findings || [];
  let findingsCardsHTML = '';
  topFindings.slice(0, 3).forEach((item, idx) => {
    findingsCardsHTML += `
      <div class="ai-finding-card">
        <div class="ai-finding-header">
          <div class="ai-finding-title">#${idx + 1}. ${escapeHTML(item.title)}</div>
          <div class="ai-badges-group">
            ${getStatusBadge(item.status)}
            ${getPriorityBadge(item.priority)}
          </div>
        </div>
        <div class="ai-block-row" style="margin-top: 6px;">
          <span class="ai-block-label">Description:</span>
          ${escapeHTML(item.description)}
        </div>
        <div class="ai-block-row" style="margin-top: 6px;">
          <span class="ai-block-label">Affected Sessions:</span>
          <strong style="color: var(--danger); font-size: 0.95rem;">${item.affected_sessions != null ? item.affected_sessions : 0} sessions</strong>
        </div>
        <div class="ai-evidence-box" style="margin-top: 8px;">
          <span class="ai-block-label" style="color: #4338ca;">Evidence:</span>
          ${escapeHTML(item.evidence)}
        </div>
        ${item.recommendation ? `
          <div class="ai-action-box" style="margin-top: 8px;">
            <span class="ai-block-label" style="color: #15803d;">Recommended Action:</span>
            ${escapeHTML(item.recommendation)}
          </div>
        ` : ''}
      </div>
    `;
  });

  const sec4_TopFindings = `
    <div class="ai-section-numbered-card">
      <div class="ai-section-numbered-title">
        <span class="ai-section-number-pill">4</span>
        <span>TOP FINDINGS (MAX 3)</span>
      </div>
      <div class="ai-cards-grid">
        ${findingsCardsHTML || '<p class="text-muted">No top findings flagged.</p>'}
      </div>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // 5. FUNNEL INVESTIGATION
  // ---------------------------------------------------------------------------
  const funnelSteps = data.funnel_investigation || data.stage_analysis || [];
  let funnelCardsHTML = '';
  funnelSteps.forEach(stg => {
    const sSign = (stg.change_percentage_points > 0 || stg.change > 0) ? '+' : '';
    const chgVal = stg.change_percentage_points != null ? stg.change_percentage_points : stg.change;
    funnelCardsHTML += `
      <div class="ai-sub-card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 1rem; color: #1e293b;">${escapeHTML(stg.stage_label || stg.progression)}</strong>
          <div class="ai-badges-group">
            ${getStatusBadge(stg.status)}
            ${getPriorityBadge(stg.priority)}
          </div>
        </div>
        <div style="font-size: 0.88rem; color: #334155; margin-top: 4px;">
          Retention: ${stg.before_retention != null ? stg.before_retention : stg.before_retention_percent}% &rarr; <strong>${stg.after_retention != null ? stg.after_retention : stg.after_retention_percent}%</strong> (${sSign}${chgVal} pp)
        </div>
        <div style="font-size: 0.82rem; color: var(--danger); font-weight: 600;">
          Step Attrition: ${stg.dropped_sessions} dropped (${stg.drop_rate_percent}% step loss)
        </div>
        <div class="ai-evidence-box" style="margin-top: 4px;">
          ${escapeHTML(stg.evidence || stg.summary)}
        </div>
      </div>
    `;
  });

  const sec5_FunnelInvestigation = `
    <div class="ai-section-numbered-card">
      <div class="ai-section-numbered-title">
        <span class="ai-section-number-pill">5</span>
        <span>FUNNEL INVESTIGATION (VISIT &rarr; CART &rarr; CHECKOUT &rarr; PAID)</span>
      </div>
      <div class="ai-stage-grid">
        ${funnelCardsHTML || '<p class="text-muted">No funnel step data available for selected filter.</p>'}
      </div>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // 6. DEVICE INVESTIGATION
  // ---------------------------------------------------------------------------
  const devices = data.device_investigation || data.device_analysis || [];
  let deviceCardsHTML = '';
  devices.forEach(dev => {
    const dChg = dev.change != null ? dev.change : dev.change_percentage_points;
    const dSign = dChg > 0 ? '+' : '';
    const dColor = dChg < 0 ? 'var(--danger)' : (dChg > 0 ? 'var(--success)' : 'inherit');
    deviceCardsHTML += `
      <div class="ai-sub-card" style="border-top: 3px solid ${dColor};">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 1.05rem; color: #0f172a;">${escapeHTML(dev.device_label || capitalize(dev.device))}</strong>
          <div class="ai-badges-group">
            ${getStatusBadge(dev.status)}
            ${getPriorityBadge(dev.priority)}
          </div>
        </div>
        <div style="font-size: 0.88rem; margin-top: 4px;">
          Paid Conversion: <strong>${dev.before_percent}%</strong> &rarr; <strong>${dev.after_percent}%</strong> 
          (<strong style="color: ${dColor};">${dSign}${dChg} pp</strong>)
        </div>
        <div style="font-size: 0.8rem; color: #64748b;">
          After Period: ${dev.after_sessions || 0} visits &bull; ${dev.after_paid || 0} paid &bull; <strong style="color: var(--danger);">${dev.dropped_at_checkout || 0} dropped at checkout</strong>
        </div>
        <div class="ai-evidence-box" style="margin-top: 6px;">
          ${escapeHTML(dev.evidence || dev.summary)}
        </div>
      </div>
    `;
  });

  const sec6_DeviceInvestigation = `
    <div class="ai-section-numbered-card">
      <div class="ai-section-numbered-title">
        <span class="ai-section-number-pill">6</span>
        <span>DEVICE INVESTIGATION</span>
      </div>
      <div class="ai-device-grid">
        ${deviceCardsHTML || '<p class="text-muted">No device data available for selected filter.</p>'}
      </div>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // 7. REASON INVESTIGATION (6 Independent Hypotheses)
  // ---------------------------------------------------------------------------
  const reasons = data.reason_investigation || data.reason_analysis || [];
  let reasonsCardsHTML = '';
  reasons.forEach(r => {
    reasonsCardsHTML += `
      <div class="ai-finding-card">
        <div class="ai-finding-header">
          <div class="ai-finding-title">${escapeHTML(r.title)}</div>
          <div class="ai-badges-group">
            ${getStatusBadge(r.status)}
            ${getPriorityBadge(r.priority)}
          </div>
        </div>
        <div class="ai-block-row" style="margin-top: 6px;">
          <span class="ai-block-label">Affected Sessions (Independently Calculated):</span>
          <strong style="color: var(--danger); font-size: 0.95rem;">${r.affected_sessions != null ? r.affected_sessions : 0} sessions</strong> in After period (Before: ${r.before_affected != null ? r.before_affected : (r.before_count || 0)})
        </div>
        <div style="font-size: 0.77rem; color: #475569; font-style: italic; margin-top: 4px;">
          ${escapeHTML(r.causation_vs_correlation || '')}
        </div>
        <div class="ai-evidence-box" style="margin-top: 8px;">
          <span class="ai-block-label" style="color: #4338ca;">Forensic Telemetry Evidence:</span>
          ${escapeHTML(r.evidence)}
        </div>
        <div class="ai-action-box" style="margin-top: 8px;">
          <span class="ai-block-label" style="color: #15803d;">Investigation Action:</span>
          ${escapeHTML(r.recommendation)}
        </div>
      </div>
    `;
  });

  const sec7_ReasonInvestigation = `
    <div class="ai-section-numbered-card">
      <div class="ai-section-numbered-title">
        <span class="ai-section-number-pill">7</span>
        <span>REASON INVESTIGATION (6 INDEPENDENT HYPOTHESES)</span>
      </div>
      <div class="ai-cards-grid">
        ${reasonsCardsHTML}
      </div>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // 8. SUPPORTING EVIDENCE
  // ---------------------------------------------------------------------------
  const evidenceList = data.supporting_evidence || [];
  let evidenceListHTML = '';
  evidenceList.forEach(ev => {
    evidenceListHTML += `
      <li style="padding: 6px 0; font-size: 0.88rem; color: #1e293b; display: flex; align-items: flex-start; gap: 8px;">
        <span style="color: var(--primary-blue); font-weight: 700;">&bull;</span>
        <span>${escapeHTML(ev)}</span>
      </li>
    `;
  });

  const sec8_SupportingEvidence = `
    <div class="ai-section-numbered-card">
      <div class="ai-section-numbered-title">
        <span class="ai-section-number-pill">8</span>
        <span>SUPPORTING EVIDENCE (ACTUAL TELEMETRY COUNTS)</span>
      </div>
      <ul style="list-style: none; padding: 0; margin: 0;">
        ${evidenceListHTML || '<li class="text-muted">No evidence points recorded.</li>'}
      </ul>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // 9. RECOMMENDED ACTIONS
  // ---------------------------------------------------------------------------
  const recs = data.recommended_actions || data.recommendations || [];
  let recsHTML = '';
  recs.forEach(rec => {
    recsHTML += `
      <div class="ai-rec-item">
        <div style="flex-shrink: 0; padding-top: 2px;">
          ${getPriorityBadge(rec.priority)}
        </div>
        <div class="ai-rec-content">
          <div class="ai-rec-area">${escapeHTML(rec.area || '')}</div>
          <div class="ai-rec-action">${escapeHTML(rec.action || '')}</div>
          <div class="ai-rec-impact">&rarr; Expected Impact: ${escapeHTML(rec.expected_impact || '')}</div>
        </div>
      </div>
    `;
  });

  const sec9_RecommendedActions = `
    <div class="ai-section-numbered-card">
      <div class="ai-section-numbered-title">
        <span class="ai-section-number-pill">9</span>
        <span>RECOMMENDED ACTIONS</span>
      </div>
      <div class="ai-recommendations-list">
        ${recsHTML || '<p class="text-muted">No recommended actions generated.</p>'}
      </div>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // 10. DATA QUALITY / LIMITATIONS
  // ---------------------------------------------------------------------------
  const notes = data.data_quality_limitations || data.data_quality_notes || [];
  let notesHTML = '';
  notes.forEach(note => {
    notesHTML += `<li class="ai-quality-item">${escapeHTML(note)}</li>`;
  });

  const sec10_DataQuality = `
    <div class="ai-section-numbered-card">
      <div class="ai-section-numbered-title">
        <span class="ai-section-number-pill">10</span>
        <span>DATA QUALITY / LIMITATIONS</span>
      </div>
      <ul class="ai-quality-list">
        ${notesHTML}
      </ul>
    </div>
  `;

  // Combine all 10 canonical sections in exact order
  container.innerHTML = `
    ${sec1_ExecutiveSummary}
    ${sec2_OverallResult}
    ${sec3_BiggestDropOff}
    ${sec4_TopFindings}
    ${sec5_FunnelInvestigation}
    ${sec6_DeviceInvestigation}
    ${sec7_ReasonInvestigation}
    ${sec8_SupportingEvidence}
    ${sec9_RecommendedActions}
    ${sec10_DataQuality}
  `;
}

