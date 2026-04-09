/**
 * TokenScope v2.0 — Frontend Application
 * ─────────────────────────────────────────
 * Responsibilities:
 *   - Fetch /api/models on load to build pricing bar
 *   - POST /api/analyze with prompt + model
 *   - Render token heatmap with smooth gradient colors
 *   - Render Chart.js bar chart (original vs trimmed)
 *   - Display side-by-side trimmed comparison
 *   - Animated stats counters + tooltips
 *   - Example chip injection + live char count
 */

'use strict';

/* ════════════════════════════════════════════
   DOM REFERENCES
   ════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);

const DOM = {
  analyzeBtn:        $('analyze-btn'),
  copyBtn:           $('copy-btn'),
  promptInput:       $('prompt-input'),
  modelSelect:       $('model-select'),
  charCount:         $('char-count'),
  pricingInfo:       $('pricing-info'),

  // Stats
  statOrigCost:      $('stat-orig-cost'),
  statOrigTokens:    $('stat-orig-tokens'),
  statTrimCost:      $('stat-trim-cost'),
  statTrimTokens:    $('stat-trim-tokens'),
  statSavingsPct:    $('stat-savings-pct'),
  statSavedTokens:   $('stat-saved-tokens'),
  statModelName:     $('stat-model-name'),
  statMoneySaved:    $('stat-money-saved'),

  // Chart
  tokenChart:        $('token-chart'),
  chartPlaceholder:  $('chart-placeholder'),

  // Heatmap
  heatmapOutput:     $('heatmap-output'),
  tokenTooltip:      $('token-tooltip'),
  tooltipToken:      $('tooltip-token'),
  tooltipBar:        $('tooltip-bar'),
  tooltipPct:        $('tooltip-pct'),
  tooltipStatus:     $('tooltip-status'),

  // Trimmed
  trimComparison:    $('trim-comparison'),
  trimPlaceholder:   $('trim-placeholder'),
  originalTextDisplay: $('original-text-display'),
  trimmedTextDisplay:  $('trimmed-text-display'),

  // Session & conversation
  sessionIdDisplay:  $('session-id-display'),
  convTotalTokens:   $('conv-total-tokens'),
  resetSessionBtn:   $('reset-session-btn'),
  chatThread:        $('chat-thread'),
  chatPlaceholder:   $('chat-placeholder'),

  // Compare
  compareBtn:        $('compare-btn'),
  comparePromptA:   $('compare-prompt-a'),
  comparePromptB:   $('compare-prompt-b'),
  compareSummary:    $('compare-summary'),
  compareWinner:     $('compare-winner'),
  compareMetrics:    $('compare-metrics'),
  compareColA:       $('compare-col-a'),
  compareColB:       $('compare-col-b'),

  // History chart & export
  historyChart:      $('history-chart'),
  historyPlaceholder: $('history-chart-placeholder'),
  downloadReportBtn: $('download-report-btn'),
};

/* ════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════ */
const STORAGE_KEY = 'tokenscope_session_id';

let modelPricing       = {};
let chartInstance      = null;
let historyChartInstance = null;
/** @type {string|null} */
let sessionId          = null;
/** @type {object|null} */
let lastAnalysis       = null;

/* ════════════════════════════════════════════
   UTILITY HELPERS
   ════════════════════════════════════════════ */

/**
 * Smoothly animate a numeric value change in a DOM element.
 */
function animateValue(el, from, to, duration, formatter) {
  const start = performance.now();
  const diff  = to - from;

  function update(now) {
    const elapsed  = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out cubic
    const eased    = 1 - Math.pow(1 - progress, 3);
    el.textContent = formatter(from + diff * eased);
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

/**
 * Map a 0-1 score to a smooth gradient color (gray → yellow → orange → red).
 * Returns an rgba() string.
 */
function scoreToColor(score) {
  // Define gradient stops: [score, [r, g, b, a]]
  const stops = [
    [0.00, [55,  65,  81,  0.50]],  // dark gray — noise
    [0.15, [55,  65,  81,  0.60]],  // still gray
    [0.30, [234, 179, 8,   0.55]],  // yellow
    [0.60, [249, 115, 22,  0.72]],  // orange
    [1.00, [239, 68,  68,  0.88]],  // red
  ];

  // Clamp
  const s = Math.max(0, Math.min(1, score));

  // Find surrounding stops
  for (let i = 1; i < stops.length; i++) {
    const [s0, c0] = stops[i - 1];
    const [s1, c1] = stops[i];

    if (s <= s1) {
      const t = (s - s0) / (s1 - s0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      const a = +(c0[3] + (c1[3] - c0[3]) * t).toFixed(3);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
  }

  // Fallback
  return `rgba(239, 68, 68, 0.88)`;
}

/**
 * Return status label & CSS class for a token score.
 */
function scoreStatus(score) {
  if (score < 0.15) return { label: 'Noise',     cls: 'status-noise'     };
  if (score < 0.40) return { label: 'Context',   cls: 'status-context'   };
  if (score < 0.70) return { label: 'Important', cls: 'status-important' };
  return               { label: 'Critical',  cls: 'status-critical'  };
}

/**
 * Format USD values dynamically based on magnitude.
 */
function formatUSD(val) {
  if (val === 0) return '$0.000000';
  if (val < 0.0001) return `$${val.toExponential(3)}`;
  return `$${val.toFixed(6)}`;
}

/**
 * Pulse animation on stat elements to indicate update.
 */
function pulse(el) {
  el.classList.remove('pulse');
  void el.offsetWidth; // reflow
  el.classList.add('pulse');
}

/* ════════════════════════════════════════════
   PRICING BAR
   ════════════════════════════════════════════ */
function updatePricingBar(model) {
  const pricing = modelPricing[model];
  if (!pricing) return;

  const modelLabels = {
    'gpt-4o-mini':   'GPT-4o Mini',
    'gpt-4o':        'GPT-4o',
    'gpt-3.5-turbo': 'GPT-3.5 Turbo',
  };

  DOM.pricingInfo.textContent =
    `${modelLabels[model] || model} — ` +
    `Input: $${pricing.input.toFixed(2)} / 1M tokens · ` +
    `Output: $${pricing.output.toFixed(2)} / 1M tokens`;
}

async function fetchModels() {
  try {
    const res  = await fetch('/api/models');
    const data = await res.json();
    modelPricing = data.models || {};
    updatePricingBar(DOM.modelSelect.value);
  } catch (e) {
    console.warn('Could not fetch model pricing:', e);
  }
}

/* ════════════════════════════════════════════
   CHART (Chart.js)
   ════════════════════════════════════════════ */
function renderChart(originalTokens, trimmedTokens) {
  DOM.chartPlaceholder.classList.add('hidden');

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const ctx = DOM.tokenChart.getContext('2d');

  // Gradient fills
  const gradOrig = ctx.createLinearGradient(0, 0, 0, 260);
  gradOrig.addColorStop(0,   'rgba(99,  102, 241, 0.9)');
  gradOrig.addColorStop(1,   'rgba(99,  102, 241, 0.2)');

  const gradTrim = ctx.createLinearGradient(0, 0, 0, 260);
  gradTrim.addColorStop(0,   'rgba(16,  185, 129, 0.9)');
  gradTrim.addColorStop(1,   'rgba(16,  185, 129, 0.2)');

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Original Prompt', 'Trimmed Prompt'],
      datasets: [{
        label: 'Token Count',
        data:  [originalTokens, trimmedTokens],
        backgroundColor: [gradOrig, gradTrim],
        borderColor:     ['rgba(99,102,241,1)', 'rgba(16,185,129,1)'],
        borderWidth:     2,
        borderRadius:    10,
        borderSkipped:   false,
        barThickness:    64,
      }]
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation: {
        duration: 800,
        easing:   'easeOutQuart',
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d2e',
          borderColor:     'rgba(255,255,255,0.12)',
          borderWidth:     1,
          titleColor:      '#e2e8f0',
          bodyColor:       '#94a3b8',
          padding:         12,
          cornerRadius:    10,
          callbacks: {
            title: (items) => items[0].label,
            label: (item)  => ` ${item.raw.toLocaleString()} tokens`,
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
          ticks: { color: '#64748b', font: { family: "'Inter', sans-serif", size: 12 } },
          border: { color: 'rgba(255,255,255,0.06)' },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
          ticks: {
            color:    '#64748b',
            font:     { family: "'Inter', sans-serif", size: 11 },
            callback: (v) => v.toLocaleString(),
          },
          border: { color: 'rgba(255,255,255,0.06)' },
        }
      }
    }
  });
}

/* ════════════════════════════════════════════
   SESSION & CONVERSATION
   ════════════════════════════════════════════ */

function shortId(sid) {
  if (!sid || sid.length < 10) return sid || '—';
  return `${sid.slice(0, 8)}…`;
}

function renderChatThread(messages) {
  const holder = DOM.chatThread;
  holder.innerHTML = '';
  if (!messages || messages.length === 0) {
    const p = document.createElement('p');
    p.className = 'placeholder-text';
    p.id = 'chat-placeholder';
    p.textContent = 'Analyze a prompt to build the thread…';
    holder.appendChild(p);
    return;
  }
  messages.forEach((m) => {
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble chat-bubble-user';
    const body = document.createElement('div');
    body.className = 'chat-bubble-body';
    body.textContent = m.content || '';
    const meta = document.createElement('div');
    meta.className = 'chat-bubble-meta';
    meta.innerHTML = `<span>${(m.role || 'user').toUpperCase()}</span><span>${Number(m.tokens || 0).toLocaleString()} tok</span>`;
    wrap.appendChild(body);
    wrap.appendChild(meta);
    holder.appendChild(wrap);
  });
  holder.scrollTop = holder.scrollHeight;
}

function renderHistoryChart(queryHistory) {
  const hist = queryHistory && queryHistory.length ? queryHistory : [];
  if (!hist.length) {
    if (historyChartInstance) {
      historyChartInstance.destroy();
      historyChartInstance = null;
    }
    DOM.historyPlaceholder.classList.remove('hidden');
    return;
  }

  DOM.historyPlaceholder.classList.add('hidden');

  if (historyChartInstance) {
    historyChartInstance.destroy();
    historyChartInstance = null;
  }

  const ctx = DOM.historyChart.getContext('2d');
  const labels = hist.map((q) => `Q${q.query_id}`);
  const values = hist.map((q) => q.tokens_used);

  const grad = ctx.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0, 'rgba(139, 92, 246, 0.85)');
  grad.addColorStop(1, 'rgba(99, 102, 241, 0.15)');

  historyChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Tokens (analyze)',
        data: values,
        fill: true,
        backgroundColor: grad,
        borderColor: 'rgba(167, 139, 250, 1)',
        tension: 0.25,
        pointRadius: 4,
        pointBackgroundColor: '#fff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 650, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d2e',
          borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          callbacks: {
            footer: (items) => {
              const i = items[0].dataIndex;
              const t = hist[i] && hist[i].timestamp ? hist[i].timestamp : '';
              return t || '';
            },
            label: (item) => ` ${Number(item.raw).toLocaleString()} tokens`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
          ticks: { color: '#64748b', font: { family: "'Inter', sans-serif", size: 11 } },
          border: { color: 'rgba(255,255,255,0.06)' },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
          ticks: {
            color: '#64748b',
            font: { family: "'Inter', sans-serif", size: 11 },
            callback: (v) => v.toLocaleString(),
          },
          border: { color: 'rgba(255,255,255,0.06)' },
        },
      },
    },
  });
}

function applySessionSnapshot(snap) {
  if (!snap) return;
  DOM.sessionIdDisplay.textContent = shortId(snap.session_id);
  DOM.convTotalTokens.textContent = Number(snap.total_tokens || 0).toLocaleString();
  renderChatThread(snap.messages || []);
  renderHistoryChart(snap.query_history || []);
}

async function ensureSession() {
  let sid = localStorage.getItem(STORAGE_KEY);
  if (sid) {
    try {
      const r = await fetch(`/api/session/${encodeURIComponent(sid)}`);
      if (r.ok) {
        const snap = await r.json();
        sessionId = snap.session_id;
        applySessionSnapshot(snap);
        return sessionId;
      }
    } catch (e) {
      console.warn('[TokenScope] session fetch failed', e);
    }
  }
  const cr = await fetch('/api/session', { method: 'POST' });
  if (!cr.ok) {
    sessionId = null;
    localStorage.removeItem(STORAGE_KEY);
    if (DOM.sessionIdDisplay) DOM.sessionIdDisplay.textContent = '—';
    console.warn('[TokenScope] Session API unavailable — analyze still works without chat/history.');
    return null;
  }
  const data = await cr.json();
  sessionId = data.session_id;
  localStorage.setItem(STORAGE_KEY, sessionId);
  applySessionSnapshot({
    session_id: sessionId,
    messages: [],
    total_tokens: 0,
    query_history: [],
  });
  return sessionId;
}

async function handleResetSession() {
  DOM.resetSessionBtn.disabled = true;
  try {
    const res = await fetch('/api/session/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    if (!res.ok) throw new Error('Reset failed');
    const data = await res.json();
    sessionId = data.session_id;
    localStorage.setItem(STORAGE_KEY, sessionId);
    lastAnalysis = null;
    DOM.downloadReportBtn.disabled = true;
    applySessionSnapshot({
      session_id: sessionId,
      messages: [],
      total_tokens: 0,
      query_history: [],
    });
  } catch (e) {
    showErrorBanner(e.message || 'Reset failed');
  } finally {
    DOM.resetSessionBtn.disabled = false;
  }
}

/* ════════════════════════════════════════════
   HEATMAP RENDERER
   ════════════════════════════════════════════ */
function renderHeatmap(tokenData) {
  const container = DOM.heatmapOutput;
  container.innerHTML = '';

  const fragment = document.createDocumentFragment();

  tokenData.forEach((token, idx) => {
    const span = document.createElement('span');
    span.className   = 'token-span';
    span.textContent = token.text;

    const bgColor = scoreToColor(token.score);
    span.style.backgroundColor = bgColor;

    // Text color: stay white for high-intensity backgrounds, dim for low
    if (token.score < 0.15) {
      span.style.color = '#4b5563';
    } else {
      span.style.color = '#ffffff';
    }

    // Tooltip on mouse-enter
    span.addEventListener('mouseenter', (e) => showTokenTooltip(e, token));
    span.addEventListener('mousemove',  (e) => repositionTooltip(e));
    span.addEventListener('mouseleave',      () => hideTokenTooltip());

    fragment.appendChild(span);
  });

  container.appendChild(fragment);
}

/* ════════════════════════════════════════════
   TOKEN TOOLTIP
   ════════════════════════════════════════════ */
function showTokenTooltip(e, token) {
  const tooltip = DOM.tokenTooltip;

  // Token text
  DOM.tooltipToken.textContent = `"${token.text.replace(/\n/g, '↵')}"`;

  // Score bar
  const pct = Math.round(token.score * 100);
  DOM.tooltipBar.style.width = `${pct}%`;
  DOM.tooltipPct.textContent = `${pct}%`;

  // Status label
  const status = scoreStatus(token.score);
  DOM.tooltipStatus.textContent  = status.label;
  DOM.tooltipStatus.className    = `tooltip-status ${status.cls}`;

  repositionTooltip(e);

  tooltip.removeAttribute('aria-hidden');
  tooltip.classList.add('visible');
}

function repositionTooltip(e) {
  const tooltip = DOM.tokenTooltip;
  const pad     = 14;
  const tw      = tooltip.offsetWidth  || 200;
  const th      = tooltip.offsetHeight || 120;
  const vw      = window.innerWidth;
  const vh      = window.innerHeight;

  let x = e.clientX + pad;
  let y = e.clientY + pad;

  if (x + tw > vw - 8) x = e.clientX - tw - pad;
  if (y + th > vh - 8) y = e.clientY - th - pad;

  tooltip.style.left = `${x}px`;
  tooltip.style.top  = `${y}px`;
}

function hideTokenTooltip() {
  DOM.tokenTooltip.classList.remove('visible');
  DOM.tokenTooltip.setAttribute('aria-hidden', 'true');
}

/* ════════════════════════════════════════════
   STATS UPDATER
   ════════════════════════════════════════════ */
function updateStats(data) {
  const modelLabels = {
    'gpt-4o-mini':   'GPT-4o Mini',
    'gpt-4o':        'GPT-4o',
    'gpt-3.5-turbo': 'GPT-3.5 Turbo',
  };

  // Cost: animate from 0
  const animDuration = 600;

  animateValue(DOM.statOrigCost, 0, data.cost_original_usd, animDuration, (v) => formatUSD(v));
  animateValue(DOM.statTrimCost, 0, data.cost_trimmed_usd,  animDuration, (v) => formatUSD(v));
  animateValue(DOM.statSavingsPct, 0, data.savings_percentage, animDuration, (v) => `${v.toFixed(1)}%`);

  DOM.statOrigTokens.textContent  = `${data.original_tokens.toLocaleString()} tokens`;
  DOM.statTrimTokens.textContent  = `${data.trimmed_tokens.toLocaleString()} tokens`;
  DOM.statSavedTokens.textContent = `${data.saved_tokens.toLocaleString()} tokens saved`;
  DOM.statModelName.textContent   = modelLabels[data.model] || data.model;

  const moneySaved = data.cost_original_usd - data.cost_trimmed_usd;
  DOM.statMoneySaved.textContent = `${formatUSD(moneySaved)} saved`;

  // Pulse all stat values
  [DOM.statOrigCost, DOM.statTrimCost, DOM.statSavingsPct, DOM.statModelName].forEach(pulse);
}

/* ════════════════════════════════════════════
   TRIMMED PROMPT DISPLAY
   ════════════════════════════════════════════ */
function renderTrimmedComparison(originalText, trimmedText) {
  DOM.originalTextDisplay.textContent = originalText;
  DOM.trimmedTextDisplay.textContent  = trimmedText;

  DOM.trimPlaceholder.hidden     = true;
  DOM.trimComparison.hidden      = false;
  DOM.trimComparison.classList.add('animate-fade-up');
}

/* ════════════════════════════════════════════
   LOADING STATE
   ════════════════════════════════════════════ */
function setLoading(loading) {
  const btn = DOM.analyzeBtn;
  if (loading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

/* ════════════════════════════════════════════
   MAIN ANALYZE HANDLER
   ════════════════════════════════════════════ */
async function postAnalyze(payload) {
  const response = await fetch('/api/analyze', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  if (response.status === 404) {
    await ensureSession();
    const retry = { prompt: payload.prompt, model: payload.model };
    if (sessionId) {
      retry.session_id = sessionId;
      retry.append_to_session = true;
    }
    return fetch('/api/analyze', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(retry),
    });
  }
  return response;
}

async function handleAnalyze() {
  const prompt = DOM.promptInput.value.trim();
  if (!prompt) {
    DOM.promptInput.focus();
    DOM.promptInput.style.borderColor = 'rgba(239,68,68,0.7)';
    setTimeout(() => { DOM.promptInput.style.borderColor = ''; }, 1200);
    return;
  }

  const model = DOM.modelSelect.value;

  setLoading(true);

  try {
    if (!sessionId) await ensureSession();

    const payload = { prompt, model };
    if (sessionId) {
      payload.session_id = sessionId;
      payload.append_to_session = true;
    }

    let response = await postAnalyze(payload);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail) || `HTTP ${response.status}`,
      );
    }

    const data = await response.json();

    lastAnalysis = data;
    DOM.downloadReportBtn.disabled = false;

    if (data.session) applySessionSnapshot(data.session);

    updateStats(data);
    renderChart(data.original_tokens, data.trimmed_tokens);
    renderHeatmap(data.token_data);
    renderTrimmedComparison(prompt, data.trimmed_prompt);

    DOM.heatmapOutput.closest('.panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    console.error('[TokenScope] Analysis error:', err);
    showErrorBanner(err.message || 'Unexpected error. Check the console.');
  } finally {
    setLoading(false);
  }
}

function setCompareLoading(loading) {
  const btn = DOM.compareBtn;
  if (loading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

async function handleCompare() {
  const a = DOM.comparePromptA.value.trim();
  const b = DOM.comparePromptB.value.trim();
  if (!a || !b) {
    showErrorBanner('Enter both prompts to compare.');
    return;
  }
  const model = DOM.modelSelect.value;
  setCompareLoading(true);
  DOM.compareColA.classList.remove('compare-col-winner');
  DOM.compareColB.classList.remove('compare-col-winner');
  try {
    const res = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_a: a, prompt_b: b, model }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const d = await res.json();
    const w = d.more_cost_efficient;
    if (w === 'A') DOM.compareColA.classList.add('compare-col-winner');
    if (w === 'B') DOM.compareColB.classList.add('compare-col-winner');

    DOM.compareWinner.textContent =
      w === 'tie' ? 'Same token count — tie' : `Prompt ${w} is more cost-efficient (fewer input tokens)`;
    DOM.compareMetrics.innerHTML = `
<div>Prompt A — ${d.prompt_a.tokens.toLocaleString()} tokens · $${d.prompt_a.cost_usd.toFixed(8)} · $${d.prompt_a.cost_per_1k_tokens_usd.toFixed(8)} / 1K</div>
<div>Prompt B — ${d.prompt_b.tokens.toLocaleString()} tokens · $${d.prompt_b.cost_usd.toFixed(8)} · $${d.prompt_b.cost_per_1k_tokens_usd.toFixed(8)} / 1K</div>
<div>Δ tokens: ${Number(d.token_difference).toLocaleString()} · Δ cost: $${Number(d.cost_difference_usd).toFixed(10)}</div>
<div>${d.summary}</div>`;
    DOM.compareSummary.hidden = false;
  } catch (e) {
    showErrorBanner(e.message || 'Compare failed');
  } finally {
    setCompareLoading(false);
  }
}

async function handleExportPdf() {
  if (!lastAnalysis) {
    showErrorBanner('Run analysis first to build a report.');
    return;
  }
  const btn = DOM.downloadReportBtn;
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    let conversationMessages = null;
    if (sessionId) {
      const r = await fetch(`/api/session/${encodeURIComponent(sessionId)}`);
      if (r.ok) {
        const snap = await r.json();
        conversationMessages = snap.messages || null;
      }
    }
    const body = {
      prompt: lastAnalysis.prompt,
      trimmed_prompt: lastAnalysis.trimmed_prompt,
      model: lastAnalysis.model,
      original_tokens: lastAnalysis.original_tokens,
      trimmed_tokens: lastAnalysis.trimmed_tokens,
      cost_original_usd: lastAnalysis.cost_original_usd,
      cost_trimmed_usd: lastAnalysis.cost_trimmed_usd,
      saved_tokens: lastAnalysis.saved_tokens,
      savings_percentage: lastAnalysis.savings_percentage,
      token_data: lastAnalysis.token_data,
      tfidf_top_terms: lastAnalysis.tfidf_top_terms,
      conversation_messages: conversationMessages,
    };
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tokenscope_report.pdf';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    showErrorBanner(e.message || 'PDF export failed');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

/* ════════════════════════════════════════════
   ERROR BANNER
   ════════════════════════════════════════════ */
function showErrorBanner(message) {
  let banner = document.getElementById('ts-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'ts-error-banner';
    Object.assign(banner.style, {
      position:     'fixed',
      bottom:       '1.5rem',
      left:         '50%',
      transform:    'translateX(-50%)',
      background:   'rgba(239,68,68,0.15)',
      border:       '1px solid rgba(239,68,68,0.4)',
      color:        '#fca5a5',
      borderRadius: '12px',
      padding:      '0.75rem 1.5rem',
      fontSize:     '0.875rem',
      fontFamily:   'var(--font-sans)',
      zIndex:       '9999',
      backdropFilter: 'blur(12px)',
      boxShadow:    '0 8px 32px rgba(0,0,0,0.4)',
      maxWidth:     '90vw',
      textAlign:    'center',
    });
    document.body.appendChild(banner);
  }
  banner.textContent = `⚠ ${message}`;
  banner.style.opacity = '1';
  clearTimeout(banner._timeout);
  banner._timeout = setTimeout(() => { banner.style.opacity = '0'; }, 5000);
}

/* ════════════════════════════════════════════
   COPY BUTTON
   ════════════════════════════════════════════ */
function handleCopy() {
  const text = DOM.trimmedTextDisplay.textContent;
  if (!text || DOM.trimComparison.hidden) return;

  navigator.clipboard.writeText(text).then(() => {
    const origHTML = DOM.copyBtn.innerHTML;
    DOM.copyBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <polyline points="20 6 9 17 4 12"/>
      </svg> Copied!`;
    DOM.copyBtn.style.color       = 'var(--green)';
    DOM.copyBtn.style.borderColor = 'rgba(16,185,129,0.4)';
    setTimeout(() => {
      DOM.copyBtn.innerHTML         = origHTML;
      DOM.copyBtn.style.color       = '';
      DOM.copyBtn.style.borderColor = '';
    }, 2200);
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

/* ════════════════════════════════════════════
   EXAMPLE CHIPS
   ════════════════════════════════════════════ */
function initChips() {
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const example = chip.dataset.example;
      if (!example) return;
      DOM.promptInput.value = example;
      DOM.promptInput.dispatchEvent(new Event('input')); // update char count
      DOM.promptInput.focus();
    });
  });
}

/* ════════════════════════════════════════════
   LIVE CHARACTER COUNT
   ════════════════════════════════════════════ */
function initCharCounter() {
  DOM.promptInput.addEventListener('input', () => {
    const len = DOM.promptInput.value.length;
    DOM.charCount.textContent = len.toLocaleString();
    // Rough token estimate: ~4 chars per token
    const estimatedTokens = Math.round(len / 4);
    DOM.charCount.title = `~${estimatedTokens.toLocaleString()} estimated tokens`;
  });
}

/* ════════════════════════════════════════════
   MODEL SELECT
   ════════════════════════════════════════════ */
function initModelSelect() {
  DOM.modelSelect.addEventListener('change', () => {
    updatePricingBar(DOM.modelSelect.value);
  });
}

/* ════════════════════════════════════════════
   KEYBOARD SHORTCUT (Ctrl/Cmd + Enter)
   ════════════════════════════════════════════ */
function initKeyboardShortcut() {
  DOM.promptInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleAnalyze();
    }
  });
}

/* ════════════════════════════════════════════
   INITIALISE
   ════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  DOM.analyzeBtn.addEventListener('click', handleAnalyze);
  DOM.copyBtn.addEventListener('click', handleCopy);
  DOM.resetSessionBtn.addEventListener('click', handleResetSession);
  DOM.compareBtn.addEventListener('click', handleCompare);
  DOM.downloadReportBtn.addEventListener('click', handleExportPdf);

  initChips();
  initCharCounter();
  initModelSelect();
  initKeyboardShortcut();

  await fetchModels();

  try {
    await ensureSession();
  } catch (e) {
    console.error(e);
    showErrorBanner('Session init failed — you can still analyze; refresh if the UI acts oddly.');
  }

  console.info('[TokenScope] Ready. Ctrl+Enter to analyze. Session in localStorage:', STORAGE_KEY);
});
