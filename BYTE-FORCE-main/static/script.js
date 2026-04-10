'use strict';

const STORAGE_KEY = 'tokenscope_session_id';
let sessionId = null;
let lastAnalysis = null;
let modelPricing = {};

let chartPos = null;
let chartPie = null;
let chartBar = null;
let chartHist = null;

const $ = (id) => document.getElementById(id);

function showToast(msg) {
  let el = document.querySelector('.error-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'error-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 5000);
}

function formatUSD(v) {
  if (v === 0) return '$0.000000';
  if (Math.abs(v) < 0.0001) return `$${v.toExponential(2)}`;
  return `$${v.toFixed(6)}`;
}

async function ensureSession() {
  let sid = localStorage.getItem(STORAGE_KEY);
  if (sid) {
    const r = await fetch(`/api/session/${encodeURIComponent(sid)}`);
    if (r.ok) {
      sessionId = sid;
      return sid;
    }
  }
  const cr = await fetch('/api/session', { method: 'POST' });
  if (!cr.ok) {
    sessionId = null;
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  const d = await cr.json();
  sessionId = d.session_id;
  localStorage.setItem(STORAGE_KEY, sessionId);
  return sessionId;
}

function setTab(name) {
  document.querySelectorAll('.dash-tab').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    const on = p.id === `panel-${name}`;
    p.classList.toggle('is-active', on);
    p.hidden = !on;
  });
  if (name === 'conversation') refreshConversation();
  if (name === 'history') refreshHistory();
}

function scoreToHeatColor(score) {
  if (score < 0.12) return 'rgba(71, 85, 105, 0.55)';
  if (score < 0.35) return 'rgba(100, 116, 139, 0.65)';
  if (score < 0.55) return 'rgba(34, 211, 238, 0.45)';
  if (score < 0.78) return 'rgba(251, 146, 60, 0.65)';
  return 'rgba(248, 113, 113, 0.75)';
}

function renderHeatmap(tokenData) {
  const el = $('heatmap-output');
  el.innerHTML = '';
  const frag = document.createDocumentFragment();
  tokenData.forEach((tok) => {
    const s = document.createElement('span');
    s.className = 'token-span';
    s.textContent = tok.text;
    s.style.backgroundColor = scoreToHeatColor(tok.score);
    s.style.color = tok.score < 0.35 ? '#cbd5e1' : '#fff';
    s.addEventListener('mouseenter', (e) => showTip(e, tok));
    s.addEventListener('mousemove', moveTip);
    s.addEventListener('mouseleave', hideTip);
    frag.appendChild(s);
  });
  el.appendChild(frag);
}

const tip = $('token-tooltip');
function showTip(e, tok) {
  $('tooltip-token').textContent = `"${String(tok.text).replace(/\n/g, '↵')}"`;
  $('tooltip-tfidf').textContent = tok.tfidf != null ? String(tok.tfidf) : '—';
  $('tooltip-freq').textContent = tok.freq != null ? String(tok.freq) : '—';
  $('tooltip-pos').textContent = tok.pos || '—';
  $('tooltip-score').textContent = `${Math.round(tok.score * 100)}%`;
  tip.classList.add('visible');
  moveTip(e);
}

function moveTip(e) {
  const pad = 12;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  const tw = tip.offsetWidth || 240;
  const th = tip.offsetHeight || 120;
  if (x + tw > innerWidth - 8) x = e.clientX - tw - pad;
  if (y + th > innerHeight - 8) y = e.clientY - th - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function hideTip() {
  tip.classList.remove('visible');
}

function destroyChart(c) {
  if (c) {
    c.destroy();
    return null;
  }
  return null;
}

function renderPosChart(pos) {
  const ctx = $('chart-pos').getContext('2d');
  chartPos = destroyChart(chartPos);
  const labels = ['Nouns', 'Verbs', 'Adj', 'Adv', 'Other'];
  const data = [pos.noun || 0, pos.verb || 0, pos.adj || 0, pos.adv || 0, pos.other || 0];
  chartPos = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Count',
        data,
        backgroundColor: [
          'rgba(99, 102, 241, 0.75)',
          'rgba(34, 211, 238, 0.65)',
          'rgba(251, 146, 60, 0.7)',
          'rgba(167, 139, 250, 0.65)',
          'rgba(100, 116, 139, 0.5)',
        ],
        borderRadius: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8b93a7' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { beginAtZero: true, ticks: { color: '#8b93a7' }, grid: { color: 'rgba(255,255,255,0.04)' } },
      },
    },
  });
}

function renderPieChart(useful, noise) {
  const ctx = $('chart-pie').getContext('2d');
  chartPie = destroyChart(chartPie);
  chartPie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Useful words', 'Noise words'],
      datasets: [{
        data: [Math.max(1, useful), Math.max(0, noise)],
        backgroundColor: ['rgba(52, 211, 153, 0.7)', 'rgba(248, 113, 113, 0.55)'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#8b93a7' } },
      },
    },
  });
}

function renderBarCompare(orig, trim) {
  const ctx = $('chart-bar').getContext('2d');
  chartBar = destroyChart(chartBar);
  chartBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Original', 'Optimized'],
      datasets: [{
        data: [orig, trim],
        backgroundColor: ['rgba(99, 102, 241, 0.65)', 'rgba(52, 211, 153, 0.65)'],
        borderRadius: 10,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#8b93a7' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        x: { ticks: { color: '#8b93a7' }, grid: { display: false } },
      },
    },
  });
}

function fillPills(container, items, mapFn) {
  const el = $(container);
  el.innerHTML = '';
  if (!items || (Array.isArray(items) && !items.length)) {
    el.innerHTML = '<span class="pill">—</span>';
    return;
  }
  if (Array.isArray(items)) {
    items.forEach((item) => {
      const span = document.createElement('span');
      span.className = 'pill';
      span.textContent = mapFn ? mapFn(item) : String(item);
      el.appendChild(span);
    });
  } else {
    Object.entries(items).forEach((item) => {
      const span = document.createElement('span');
      span.className = 'pill';
      span.textContent = mapFn ? mapFn(item) : String(item);
      el.appendChild(span);
    });
  }
}

function renderAnalyzer(data) {
  $('analyzer-results').classList.add('visible');
  $('st-total').textContent = data.total_tokens.toLocaleString();
  $('st-unique').textContent = (data.unique_tokens ?? data.original_tokens).toLocaleString();
  $('st-words').textContent = (data.unique_words ?? '—').toLocaleString();
  $('st-rep').textContent = `${((data.repetition_rate || 0) * 100).toFixed(1)}%`;
  $('st-sw').textContent = `${data.stopword_pct ?? 0}%`;
  $('st-eff').textContent = data.efficiency_score ?? '—';

  $('cost-before').textContent = formatUSD(data.cost_before ?? data.cost_original_usd);
  $('cost-after').textContent = formatUSD(data.cost_after ?? data.cost_trimmed_usd);
  $('cost-saved').textContent = `${(data.tokens_saved ?? data.saved_tokens).toLocaleString()} tok`;
  $('cost-pct').textContent = `${(data.savings_percentage ?? 0).toFixed(1)}%`;

  $('noise-level').textContent = `Noise level: ${data.noise_level || '—'}`;
  fillPills('noise-list', data.noise_suggested_removals || data.noise_words || []);
  const rep = data.repetition || {};
  fillPills('rep-list', Object.entries(rep).slice(0, 12), ([w, c]) => `${w} ×${c}`);

  const pos = data.pos_tags || {};
  const posSum = (pos.noun || 0) + (pos.verb || 0) + (pos.adj || 0) + (pos.adv || 0);
  $('pos-badge').textContent = posSum > 0 ? 'spaCy' : 'install en_core_web_sm';

  renderPosChart(pos);
  renderPieChart(data.useful_token_words ?? 1, data.noise_token_words ?? 0);
  renderBarCompare(data.original_tokens, data.trimmed_tokens);
  renderHeatmap(data.token_data || []);
  $('optimized-text').textContent = data.optimized_prompt || data.trimmed_prompt || '';

  $('download-pdf-btn').disabled = false;
  $('download-json-btn').disabled = false;
}

async function handleAnalyze() {
  const prompt = $('prompt-input').value.trim();
  if (!prompt) {
    showToast('Enter a prompt to analyze.');
    return;
  }
  const model = $('global-model').value;
  const btn = $('analyze-btn');
  btn.classList.add('loading');
  btn.disabled = true;
  try {
    await ensureSession();
    const body = { prompt, model };
    if (sessionId) body.session_id = sessionId;
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    lastAnalysis = data;
    renderAnalyzer(data);
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Analysis failed');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

async function exportPdf() {
  if (!lastAnalysis) return;
  const btn = $('download-pdf-btn');
  btn.disabled = true;
  try {
    const body = {
      prompt: lastAnalysis.prompt,
      trimmed_prompt: lastAnalysis.trimmed_prompt || lastAnalysis.optimized_prompt,
      model: lastAnalysis.model,
      original_tokens: lastAnalysis.original_tokens,
      trimmed_tokens: lastAnalysis.trimmed_tokens,
      cost_original_usd: lastAnalysis.cost_original_usd,
      cost_trimmed_usd: lastAnalysis.cost_trimmed_usd,
      saved_tokens: lastAnalysis.saved_tokens,
      savings_percentage: lastAnalysis.savings_percentage,
      token_data: lastAnalysis.token_data,
      tfidf_top_terms: lastAnalysis.tfidf_top_terms,
      pos_tags: lastAnalysis.pos_tags,
      noise_level: lastAnalysis.noise_level,
      noise_words: lastAnalysis.noise_words,
      efficiency_score: lastAnalysis.efficiency_score,
      repetition: lastAnalysis.repetition,
    };
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('PDF failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tokenscope_report.pdf';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    showToast(e.message || 'PDF error');
  } finally {
    btn.disabled = false;
  }
}

function exportJson() {
  if (!lastAnalysis) return;
  const blob = new Blob([JSON.stringify(lastAnalysis, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tokenscope_analysis.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function handleCompare() {
  const a = $('cmp-input-a').value.trim();
  const b = $('cmp-input-b').value.trim();
  if (!a || !b) {
    showToast('Both prompts required.');
    return;
  }
  const model = $('global-model').value;
  const btn = $('compare-btn');
  btn.classList.add('loading');
  btn.disabled = true;
  $('cmp-a').classList.remove('winner');
  $('cmp-b').classList.remove('winner');
  try {
    const res = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_a: a, prompt_b: b, model }),
    });
    if (!res.ok) throw new Error('Compare failed');
    const d = await res.json();
    const w = d.more_cost_efficient;
    if (w === 'A') $('cmp-a').classList.add('winner');
    if (w === 'B') $('cmp-b').classList.add('winner');
    const out = $('compare-out');
    out.classList.add('visible');
    out.innerHTML = `
      <div class="win">${w === 'tie' ? 'Tie — same token cost' : `More cost-efficient: Prompt ${w}`}</div>
      <div>A: ${d.prompt_a.tokens} tok · ${formatUSD(d.prompt_a.cost_usd)} · rep ${(d.prompt_a.repetition_rate * 100).toFixed(1)}% · diversity ${d.prompt_a.lexical_diversity}</div>
      <div>B: ${d.prompt_b.tokens} tok · ${formatUSD(d.prompt_b.cost_usd)} · rep ${(d.prompt_b.repetition_rate * 100).toFixed(1)}% · diversity ${d.prompt_b.lexical_diversity}</div>
      <div>Δ tokens: ${d.token_difference} · Δ cost: ${formatUSD(d.cost_difference_usd)}</div>`;
  } catch (e) {
    showToast(e.message);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

async function refreshConversation() {
  if (!sessionId) await ensureSession();
  if (!sessionId) return;
  const model = $('global-model').value;
  try {
    const r = await fetch(`/api/session/${encodeURIComponent(sessionId)}/conversation?model=${encodeURIComponent(model)}`);
    if (!r.ok) return;
    const d = await r.json();
    $('cv-msgs').textContent = String(d.message_count);
    $('cv-user').textContent = d.user_tokens.toLocaleString();
    $('cv-asst').textContent = d.assistant_tokens.toLocaleString();
    $('cv-total').textContent = d.total_tokens.toLocaleString();
    $('cv-cost').textContent = formatUSD(d.estimated_cost_usd);
    $('cv-saved').textContent = (d.tokens_saved || 0).toLocaleString();
    const th = $('conv-thread');
    th.innerHTML = '';
    (d.messages || []).forEach((m) => {
      const div = document.createElement('div');
      div.className = `conv-msg ${m.role}`;
      div.innerHTML = `<div>${escapeHtml(m.content)}</div><div class="conv-msg-meta">${m.role} · ${m.tokens} tok</div>`;
      th.appendChild(div);
    });
  } catch (e) {
    console.warn(e);
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function addConversationMessage() {
  const content = $('conv-input').value.trim();
  if (!content) return;
  if (!sessionId) await ensureSession();
  if (!sessionId) {
    showToast('No session');
    return;
  }
  const model = $('global-model').value;
  const role = $('conv-role').value;
  try {
    const res = await fetch('/api/conversation/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, role, content, model }),
    });
    if (!res.ok) throw new Error('Failed to add');
    $('conv-input').value = '';
    await refreshConversation();
  } catch (e) {
    showToast(e.message);
  }
}

async function clearConversation() {
  if (!sessionId) return;
  try {
    const res = await fetch('/api/conversation/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    if (!res.ok) throw new Error('Clear failed');
    await refreshConversation();
  } catch (e) {
    showToast(e.message);
  }
}

async function refreshHistory() {
  if (!sessionId) await ensureSession();
  if (!sessionId) return;
  try {
    const r = await fetch(`/api/history/${encodeURIComponent(sessionId)}`);
    if (!r.ok) return;
    const d = await r.json();
    const t = d.totals || {};
    $('hs-orig').textContent = (t.total_original || 0).toLocaleString();
    $('hs-trim').textContent = (t.total_trimmed || 0).toLocaleString();
    $('hs-saved').textContent = (t.total_saved || 0).toLocaleString();
    $('hs-avg').textContent = `${t.avg_savings_pct ?? 0}%`;

    const runs = d.runs || d.query_history || [];
    $('hist-empty').style.display = runs.length ? 'none' : 'block';
    const tb = $('hist-tbody');
    tb.innerHTML = '';
    chartHist = destroyChart(chartHist);
    if (!runs.length) return;
    runs.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.query_id}</td>
        <td>${escapeHtml((row.prompt_preview || '').slice(0, 60))}</td>
        <td>${escapeHtml(row.model || '')}</td>
        <td>${row.original_tokens ?? row.tokens_used ?? '—'}</td>
        <td>${row.trimmed_tokens ?? '—'}</td>
        <td>${row.saved_tokens ?? '—'}</td>
        <td>${row.savings_pct ?? '—'}%</td>`;
      tb.appendChild(tr);
    });

    const ctx = $('chart-history').getContext('2d');
    const labels = runs.map((x) => `#${x.query_id}`);
    const o = runs.map((x) => x.original_tokens ?? x.tokens_used ?? 0);
    const tr = runs.map((x) => x.trimmed_tokens ?? 0);
    const sv = runs.map((x) => x.saved_tokens ?? 0);
    chartHist = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Original', data: o, borderColor: 'rgba(99, 102, 241, 1)', tension: 0.25, fill: false },
          { label: 'Trimmed', data: tr, borderColor: 'rgba(34, 211, 238, 1)', tension: 0.25, fill: false },
          { label: 'Saved', data: sv, borderColor: 'rgba(52, 211, 153, 1)', tension: 0.25, fill: false },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#8b93a7' } } },
        scales: {
          x: { ticks: { color: '#8b93a7' }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { beginAtZero: true, ticks: { color: '#8b93a7' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        },
      },
    });
  } catch (e) {
    console.warn(e);
  }
}

function updatePricingBar() {
  const m = $('global-model').value;
  const p = modelPricing[m];
  const el = $('pricing-info');
  if (!p || !el) return;
  const names = { 'gpt-4o-mini': 'GPT-4o Mini', 'gpt-4o': 'GPT-4o', 'gpt-3.5-turbo': 'GPT-3.5 Turbo' };
  el.textContent = `${names[m] || m} — in $${p.input}/1M · out $${p.output}/1M`;
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.dash-tab').forEach((b) => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
  });

  $('analyze-btn').addEventListener('click', handleAnalyze);
  $('download-pdf-btn').addEventListener('click', exportPdf);
  $('download-json-btn').addEventListener('click', exportJson);
  $('compare-btn').addEventListener('click', handleCompare);
  $('conv-add-btn').addEventListener('click', addConversationMessage);
  $('conv-clear-btn').addEventListener('click', clearConversation);
  $('copy-opt-btn').addEventListener('click', () => {
    const t = $('optimized-text').textContent;
    if (t) navigator.clipboard.writeText(t);
  });
  $('global-model').addEventListener('change', updatePricingBar);

  document.querySelectorAll('.chip').forEach((c) => {
    c.addEventListener('click', () => {
      $('prompt-input').value = c.dataset.example || '';
    });
  });

  try {
    const r = await fetch('/api/models');
    const d = await r.json();
    modelPricing = d.models || {};
  } catch (_) {}
  updatePricingBar();

  await ensureSession();

  $('prompt-input').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleAnalyze();
  });
});
