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

// 1. Executive Summary Cards (Updates in real time according to Device & Period filters)
function renderSummaryCards() {
  const periods = currentAnalysis.periods;
  const decline = currentAnalysis.largest_decline;
  const quality = currentAnalysis.event_quality;
  const sessions = currentAnalysis.session_count;

  // Filtered session numbers
  let beforeVisits, beforePaid, afterVisits, afterPaid;
  let beforePaidPct, afterPaidPct;

  if (activeDevice === 'all') {
    beforeVisits = periods.before.counts.visit;
    beforePaid = periods.before.counts.paid;
    afterVisits = periods.after.counts.visit;
    afterPaid = periods.after.counts.paid;
    beforePaidPct = periods.before.conversions.visit_to_paid.percent;
    afterPaidPct = periods.after.conversions.visit_to_paid.percent;
  } else {
    const bDev = periods.before.devices[activeDevice] || { counts: { visit: 0, paid: 0 }, visit_to_paid: { percent: 0 } };
    const aDev = periods.after.devices[activeDevice] || { counts: { visit: 0, paid: 0 }, visit_to_paid: { percent: 0 } };
    beforeVisits = bDev.counts.visit;
    beforePaid = bDev.counts.paid;
    afterVisits = aDev.counts.visit;
    afterPaid = aDev.counts.paid;
    beforePaidPct = bDev.visit_to_paid.percent;
    afterPaidPct = aDev.visit_to_paid.percent;
  }

  // Before Paid Conv
  const elBeforePaid = document.getElementById('cardBeforePaid');
  if (elBeforePaid) elBeforePaid.textContent = `${beforePaidPct}%`;
  const elBeforePaidSub = document.getElementById('cardBeforePaidSub');
  if (elBeforePaidSub) {
    const devSuffix = activeDevice !== 'all' ? ` (${capitalize(activeDevice)})` : '';
    elBeforePaidSub.textContent = `${beforePaid} of ${beforeVisits} visits${devSuffix}`;
  }

  // After Paid Conv
  const elAfterPaid = document.getElementById('cardAfterPaid');
  if (elAfterPaid) elAfterPaid.textContent = `${afterPaidPct}%`;
  const elAfterPaidSub = document.getElementById('cardAfterPaidSub');
  if (elAfterPaidSub) {
    const devSuffix = activeDevice !== 'all' ? ` (${capitalize(activeDevice)})` : '';
    elAfterPaidSub.textContent = `${afterPaid} of ${afterVisits} visits${devSuffix}`;
  }

  // Overall Change (pp)
  const changeVal = parseFloat((afterPaidPct - beforePaidPct).toFixed(2));
  const changeCard = document.getElementById('cardOverallChange');
  const changeSub = document.getElementById('cardOverallChangeSub');
  const sign = changeVal > 0 ? '+' : '';
  if (changeCard) changeCard.textContent = `${sign}${changeVal} pp`;

  if (changeCard && changeSub) {
    if (changeVal < 0) {
      changeCard.style.color = 'var(--danger)';
      changeSub.innerHTML = `<span class="badge-pill badge-danger">${changeVal} pp Drop</span>`;
    } else if (changeVal > 0) {
      changeCard.style.color = 'var(--success)';
      changeSub.innerHTML = `<span class="badge-pill badge-success">+${changeVal} pp Gain</span>`;
    } else {
      changeCard.style.color = 'var(--text-main)';
      changeSub.innerHTML = `<span class="badge-pill badge-neutral">No Net Change</span>`;
    }
  }

  // Largest Declining Segment
  const affCard = document.getElementById('cardAffectedSegment');
  const affBadge = document.getElementById('cardAffectedBadge');
  const affSub = document.getElementById('cardAffectedSub');
  if (affCard && affBadge && affSub) {
    if (activeDevice !== 'all' && periods.before.devices[activeDevice] && periods.after.devices[activeDevice]) {
      const devChange = parseFloat((afterPaidPct - beforePaidPct).toFixed(2));
      const devSign = devChange > 0 ? '+' : '';
      affCard.textContent = capitalize(activeDevice);
      affBadge.textContent = `${devSign}${devChange} pp`;
      affSub.innerHTML = `
        <span class="badge-pill ${devChange < 0 ? 'badge-danger' : (devChange > 0 ? 'badge-success' : 'badge-neutral')}">${devSign}${devChange} pp</span>
        <span style="font-size: 0.75rem; color: #64748b; margin-left: 4px;">(${beforePaidPct}% → ${afterPaidPct}%)</span>
      `;
    } else if (decline && decline.device) {
      affCard.textContent = capitalize(decline.device);
      affBadge.textContent = `${decline.change_percentage_points} pp decline`;
      affSub.innerHTML = `
        <span class="badge-pill badge-danger">${decline.change_percentage_points} pp</span>
        <span style="font-size: 0.75rem; color: #64748b; margin-left: 4px;">(${decline.before_percent}% → ${decline.after_percent}%)</span>
      `;
    } else {
      affCard.textContent = 'None';
      affBadge.textContent = '0 pp';
      affSub.innerHTML = '<span class="badge-pill badge-neutral">No Net Decline</span>';
    }
  }

  // Sessions Analysed
  const elTotalSessions = document.getElementById('cardTotalSessions');
  const elSessionsSub = document.getElementById('cardSessionsSub');
  if (elTotalSessions) {
    if (activePeriod === 'before') {
      elTotalSessions.textContent = beforeVisits;
    } else if (activePeriod === 'after') {
      elTotalSessions.textContent = afterVisits;
    } else {
      elTotalSessions.textContent = beforeVisits + afterVisits;
    }
  }
  if (elSessionsSub) {
    const devLabel = activeDevice !== 'all' ? ` (${capitalize(activeDevice)})` : '';
    elSessionsSub.textContent = `Before: ${beforeVisits} | After: ${afterVisits}${devLabel}`;
  }

  // Duplicates Removed
  const elDuplicates = document.getElementById('cardDuplicates');
  if (elDuplicates) elDuplicates.textContent = quality.duplicates_removed;
  const elDuplicatesSub = document.getElementById('cardDuplicatesSub');
  if (elDuplicatesSub) elDuplicatesSub.textContent = `From ${quality.raw_events} raw events (${quality.unique_event_ids} unique)`;
}

// 2. Funnel Section & Charts (Updates both Overview and Funnel Page)
function renderFunnelSection() {
  const periods = currentAnalysis.periods;
  const stages = ['visit', 'cart', 'checkout', 'paid'];

  // Determine counts based on activeDevice filter
  let beforeCounts, afterCounts;
  if (activeDevice === 'all') {
    beforeCounts = periods.before.counts;
    afterCounts = periods.after.counts;
    setAllTextContent(['#funnelFilterBadge', '#overviewFunnelBadge'], 'All Devices');
  } else {
    beforeCounts = (periods.before.devices[activeDevice] && periods.before.devices[activeDevice].counts) || { visit: 0, cart: 0, checkout: 0, paid: 0 };
    afterCounts = (periods.after.devices[activeDevice] && periods.after.devices[activeDevice].counts) || { visit: 0, cart: 0, checkout: 0, paid: 0 };
    setAllTextContent(['#funnelFilterBadge', '#overviewFunnelBadge'], capitalize(activeDevice));
  }

  // Populate tables in both pages
  populateFunnelTable('funnelTableBody', beforeCounts, afterCounts, stages);
  populateFunnelTable('overviewFunnelTableBody', beforeCounts, afterCounts, stages);

  // Funnel Insights Callout text
  const devName = activeDevice === 'all' ? 'total' : activeDevice;
  const insightText = `
    <strong>Funnel Progression Observation:</strong> In the after period (${afterCounts.visit} ${devName} sessions), drop-off occurred between Cart and Checkout (${afterCounts.cart} &rarr; ${afterCounts.checkout} sessions) and Checkout to Paid (${afterCounts.checkout} &rarr; ${afterCounts.paid} sessions).
  `;
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
    const bCount = beforeCounts[stage];
    const aCount = afterCounts[stage];

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
      <td><strong style="text-transform: capitalize;">${stage}</strong> ${activeStage === stage ? '<span class="badge-pill badge-success" style="font-size: 0.65rem; margin-left: 4px;">Focused</span>' : ''}</td>
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

  // If container is hidden (display: none), avoid initializing with 0 width
  if (canvas.offsetParent === null) return;

  const ctx = canvas.getContext('2d');
  const labels = ['Visit', 'Cart', 'Checkout', 'Paid'];
  const beforeData = [beforeCounts.visit, beforeCounts.cart, beforeCounts.checkout, beforeCounts.paid];
  const afterData = [afterCounts.visit, afterCounts.cart, afterCounts.checkout, afterCounts.paid];

  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }

  let datasets = [];
  if (activePeriod === 'comparison') {
    datasets = [
      {
        label: 'Before Period',
        data: beforeData,
        backgroundColor: 'rgba(148, 163, 184, 0.75)',
        borderColor: '#94a3b8',
        borderWidth: 1,
        borderRadius: 6
      },
      {
        label: 'After Period',
        data: afterData,
        backgroundColor: 'rgba(37, 99, 235, 0.85)',
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
        backgroundColor: 'rgba(148, 163, 184, 0.85)',
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
        backgroundColor: 'rgba(37, 99, 235, 0.85)',
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

// 3. Device Comparison Section (Updates both Overview and Device Page)
function renderDeviceComparison() {
  const comparison = currentAnalysis.device_comparison;
  const devices = Object.keys(comparison).sort();
  const chartLabels = [];
  const beforeRates = [];
  const afterRates = [];

  devices.forEach(dev => {
    chartLabels.push(capitalize(dev));
    beforeRates.push(comparison[dev].before_percent);
    afterRates.push(comparison[dev].after_percent);
  });

  populateDeviceTable('deviceTableBody', comparison, devices);
  populateDeviceTable('overviewDeviceTableBody', comparison, devices);

  renderDeviceChartCanvas('deviceChart', chartLabels, beforeRates, afterRates);
  renderDeviceChartCanvas('overviewDeviceChart', chartLabels, beforeRates, afterRates);
}

function populateDeviceTable(tbodyId, comparison, devices) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = '';

  devices.forEach(dev => {
    const item = comparison[dev];
    const bCounts = item.before_counts || { visit: 0, paid: 0 };
    const aCounts = item.after_counts || { visit: 0, paid: 0 };
    const change = item.change_percentage_points;

    const isDecline = change < 0;
    const sign = change > 0 ? '+' : '';
    const badgeClass = isDecline ? 'badge-danger' : (change > 0 ? 'badge-success' : 'badge-neutral');

    const isSelected = (activeDevice === 'all' || activeDevice === dev);

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
        <span style="font-size: 0.8rem; color: #64748b; margin-left: 4px;">(${bCounts.paid}/${bCounts.visit})</span>
      </td>
      <td>
        <strong>${item.after_percent}%</strong>
        <span style="font-size: 0.8rem; color: #64748b; margin-left: 4px;">(${aCounts.paid}/${aCounts.visit})</span>
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

function renderDeviceChartCanvas(canvasId, labels, beforeRates, afterRates) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // If container is hidden (display: none), avoid initializing with 0 width
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
          label: 'Before Paid Conv. (%)',
          data: beforeRates,
          backgroundColor: 'rgba(148, 163, 184, 0.75)',
          borderColor: '#94a3b8',
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: 'After Paid Conv. (%)',
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
          title: { display: true, text: 'Paid Conversion %' },
          grid: { color: '#f1f5f9' }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  });
}

// 4. Evidence & Investigation Panel
function renderInvestigationPanel() {
  const decline = currentAnalysis.largest_decline;

  let targetDev = decline && decline.device;
  let targetBeforePct = decline ? decline.before_percent : 0;
  let targetAfterPct = decline ? decline.after_percent : 0;
  let targetChange = decline ? decline.change_percentage_points : 0;
  let bCounts = (decline && decline.before_counts) || { visit: 0, cart: 0, checkout: 0, paid: 0 };
  let aCounts = (decline && decline.after_counts) || { visit: 0, cart: 0, checkout: 0, paid: 0 };

  if (activeDevice !== 'all' && currentAnalysis.device_comparison && currentAnalysis.device_comparison[activeDevice]) {
    targetDev = activeDevice;
    const comp = currentAnalysis.device_comparison[activeDevice];
    targetBeforePct = comp.before_percent;
    targetAfterPct = comp.after_percent;
    targetChange = comp.change_percentage_points;
    bCounts = comp.before_counts || { visit: 0, cart: 0, checkout: 0, paid: 0 };
    aCounts = comp.after_counts || { visit: 0, cart: 0, checkout: 0, paid: 0 };
  }

  if (!targetDev) {
    setAllTextContent(['#evidenceContent', '#overviewEvidenceContent'], 'No significant declining segment identified in active dataset.');
    setAllTextContent(['#investigationTargetBadge', '#overviewAffectedBadge'], 'None');
    setAllTextContent(['#evidenceHeadline', '#overviewEvidenceHeadline'], 'No Significant Drop-Off Detected');
    const list = document.getElementById('stageLossList');
    if (list) list.innerHTML = '<li>No segment drop-off detected.</li>';
    const recEl = document.getElementById('investigationRecommendation');
    if (recEl) recEl.textContent = 'Conversion rates across evaluated segments did not show a net decline.';
    renderReasonInvestigationTable();
    return;
  }

  const dev = targetDev;
  const isTargetOverall = (dev === (decline && decline.device));
  const badgeLabel = isTargetOverall ? `${capitalize(dev)} Segment (Largest Decline)` : `${capitalize(dev)} Segment (Selected)`;
  setAllTextContent(['#investigationTargetBadge', '#overviewAffectedBadge'], badgeLabel);
  setAllTextContent(['#evidenceHeadline', '#overviewEvidenceHeadline'], `Investigating ${capitalize(dev)} Checkout Funnel Progression`);

  const dropVisitToCart = Math.max(0, (aCounts.visit || 0) - (aCounts.cart || 0));
  const dropCartToCheckout = Math.max(0, (aCounts.cart || 0) - (aCounts.checkout || 0));
  const dropCheckoutToPaid = Math.max(0, (aCounts.checkout || 0) - (aCounts.paid || 0));

  const lossVisitToCart = aCounts.visit > 0 ? ((dropVisitToCart / aCounts.visit) * 100).toFixed(1) : '0.0';
  const lossCartToCheckout = aCounts.cart > 0 ? ((dropCartToCheckout / aCounts.cart) * 100).toFixed(1) : '0.0';
  const lossCheckoutToPaid = aCounts.checkout > 0 ? ((dropCheckoutToPaid / aCounts.checkout) * 100).toFixed(1) : '0.0';

  const sign = targetChange > 0 ? '+' : '';
  const changeColor = targetChange < 0 ? 'var(--danger)' : (targetChange > 0 ? 'var(--success)' : 'inherit');

  const evidenceHTML = `
    <strong>Primary Finding:</strong> The <strong>${capitalize(dev)}</strong> segment paid conversion changed from 
    <strong>${targetBeforePct}%</strong> (${bCounts.paid || 0}/${bCounts.visit || 0} sessions) before down to 
    <strong>${targetAfterPct}%</strong> (${aCounts.paid || 0}/${aCounts.visit || 0} sessions) after — a net change of 
    <strong style="color: ${changeColor};">${sign}${targetChange} percentage points</strong>.
    <br><br>
    <strong>Funnel Progression:</strong> In the after period, ${aCounts.cart || 0}/${aCounts.visit || 0} ${dev} sessions reached Cart (${dropVisitToCart} dropped), ${aCounts.checkout || 0}/${aCounts.cart || 0} reached Checkout (${dropCartToCheckout} dropped), and ${aCounts.paid || 0}/${aCounts.checkout || 0} completed Payment (${dropCheckoutToPaid} dropped).
  `;

  setAllHTML(['#evidenceContent', '#overviewEvidenceContent'], evidenceHTML);

  // Update loss breakdown list
  const list = document.getElementById('stageLossList');
  if (list) {
    list.innerHTML = `
      <li><strong>Visit &rarr; Cart:</strong> ${aCounts.cart || 0}/${aCounts.visit || 0} sessions retained (${lossVisitToCart}% drop)</li>
      <li><strong>Cart &rarr; Checkout:</strong> ${aCounts.checkout || 0}/${aCounts.cart || 0} sessions retained (${lossCartToCheckout}% drop)</li>
      <li><strong>Checkout &rarr; Paid:</strong> ${aCounts.paid || 0}/${aCounts.checkout || 0} sessions retained (${lossCheckoutToPaid}% drop)</li>
    `;
  }

  // Update recommendation text
  const recEl = document.getElementById('investigationRecommendation');
  if (recEl) {
    const absChange = Math.abs(targetChange);
    if (targetChange < 0) {
      recEl.innerHTML = `
        ${capitalize(dev)} paid conversion decreased by <strong>${absChange} percentage points</strong> (from ${bCounts.paid || 0}/${bCounts.visit || 0} sessions down to ${aCounts.paid || 0}/${aCounts.visit || 0} sessions).
        The observed data identifies exactly <em>where</em> to investigate (${capitalize(dev)} checkout flow), but does <strong>not</strong> prove the root cause on its own. Recommended next actions: audit ${capitalize(dev)} frontend errors, payment gateway response codes, and session recordings around step transitions.
      `;
    } else {
      recEl.innerHTML = `
        ${capitalize(dev)} paid conversion changed by <strong>${sign}${targetChange} percentage points</strong> (from ${bCounts.paid || 0}/${bCounts.visit || 0} to ${aCounts.paid || 0}/${aCounts.visit || 0} sessions).
        No significant decline observed in this segment. Recommended action: continue monitoring conversion telemetry across browser updates.
      `;
    }
  }

  // Update timestamp & stage timing callout
  const timingEl = document.getElementById('timingFindingCallout');
  if (timingEl) {
    const timingFinding = (decline && decline.timing_finding) || 
      (currentAnalysis.timing_analysis && currentAnalysis.timing_analysis.summary) ||
      'No timing interval anomaly detected.';
    timingEl.innerHTML = `<strong>Timestamp &amp; Timing Analysis:</strong> ${escapeHTML(timingFinding)}`;
  }

  renderReasonInvestigationTable();
}

function renderReasonInvestigationTable() {
  const tbody = document.getElementById('reasonInvestigationTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const reasons = currentAnalysis.reason_investigation || [];
  if (!reasons.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="color: #64748b; text-align: center;">No reason investigation data available.</td></tr>';
    return;
  }

  reasons.forEach(item => {
    const tr = document.createElement('tr');
    const isFound = Boolean(item.evidence_present);
    const badgeClass = isFound ? 'badge-danger' : 'badge-neutral';
    const statusText = item.status || (isFound ? 'Evidence found' : 'Insufficient data');

    tr.innerHTML = `
      <td><strong style="color: #0f172a;">${escapeHTML(item.reason)}</strong></td>
      <td><span class="badge-pill ${badgeClass}">${escapeHTML(statusText)}</span></td>
      <td><strong>${item.affected_sessions}</strong> <span style="font-size: 0.8rem; color: #64748b;">sessions</span></td>
      <td><code style="font-size: 0.825rem; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${escapeHTML(item.funnel_stage || 'N/A')}</code></td>
      <td style="font-size: 0.875rem; color: #334155;">
        ${item.observation ? `<div style="margin-bottom: 4px; font-weight: 500;">${escapeHTML(item.observation)}</div>` : ''}
        <div style="color: #64748b; font-size: 0.825rem;"><strong>Action:</strong> ${escapeHTML(item.next_steps || '')}</div>
      </td>
    `;
    tbody.appendChild(tr);
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
