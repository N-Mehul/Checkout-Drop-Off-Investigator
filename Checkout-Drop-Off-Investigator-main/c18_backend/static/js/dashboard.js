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
    title: 'Checkout Drop-Off Investigator',
    subtitle: 'Find where customers drop out of the checkout funnel and identify which segment needs investigation.'
  },
  'page-funnel': {
    title: 'Funnel Analysis',
    subtitle: 'Step-by-step session progression and retention across Visit, Cart, Checkout, and Paid stages.'
  },
  'page-device': {
    title: 'Device Comparison',
    subtitle: 'Detailed drop-off comparison between Desktop and Mobile segments.'
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
  '#investigation': 'page-investigation',
  '#quality': 'page-quality',
  '#upload': 'page-upload'
};

const PAGE_TO_HASH = {
  'page-overview': '#overview',
  'page-funnel': '#funnel',
  'page-device': '#device',
  'page-investigation': '#investigation',
  'page-quality': '#quality',
  'page-upload': '#upload'
};

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadAnalysis();

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
      : '<span class="badge-pill badge-neutral" style="font-size: 0.8rem; font-weight: normal; vertical-align: middle; margin-left: 8px;">SYNTHETIC DEMO DATA</span>';
    titleEl.innerHTML = `${meta.title} ${badgeHTML}`;
  }
  const subEl = document.getElementById('pageHeadingSubtitle');
  if (subEl) {
    subEl.textContent = meta.subtitle;
  }
}

// Fetch analysis from backend API
async function loadAnalysis() {
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Loading...';

  try {
    const res = await fetch('/api/analysis');
    if (!res.ok) {
      throw new Error(`API error: HTTP ${res.status}`);
    }
    const data = await res.json();
    currentAnalysis = data;
    updateDashboard();
  } catch (err) {
    console.error('Failed to load analysis:', err);
    showStatusMessage(`Failed to load analysis: ${err.message}`, 'error');
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
      Refresh Analysis
    `;
  }
}

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

  // Card 6: Duplicates Removed
  const elDuplicates = document.getElementById('cardDuplicates');
  if (elDuplicates) elDuplicates.textContent = quality.duplicates_removed;
  const elDuplicatesSub = document.getElementById('cardDuplicatesSub');
  if (elDuplicatesSub) elDuplicatesSub.textContent = `From ${quality.raw_events} raw events (${quality.unique_event_ids} unique)`;
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
      relevantStages: ['all', 'visit'],
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
      const isConfirmed = rawStatus === 'CONFIRMED' || meta.id === 'payment_failures';
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
        beforeEvidence = `${beforeCount} session(s) with window shopping/browsing intent${devNote}`;
        afterEvidence = `${afterCount} drop-off session(s) with window shopping/browsing intent${devNote}`;
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
