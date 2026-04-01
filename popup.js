const el = {
  urlsInput: document.getElementById('urlsInput'),
  excludeInput: document.getElementById('excludeInput'),
  excludeLabel: document.getElementById('excludeLabel'),
  tabLoadTimeoutMs: document.getElementById('tabLoadTimeoutMs'),
  forceSkipTimeoutMs: document.getElementById('forceSkipTimeoutMs'),
  hardUrlTimeoutMs: document.getElementById('hardUrlTimeoutMs'),
  startBtn: document.getElementById('startBtn'),
  continueBtn: document.getElementById('continueBtn'),
  stopBtn: document.getElementById('stopBtn'),
  forceStopBtn: document.getElementById('forceStopBtn'),
  skipBtn: document.getElementById('skipBtn'),
  clearBtn: document.getElementById('clearBtn'),
  copyTableBtn: document.getElementById('copyTableBtn'),
  copyEmailsBtn: document.getElementById('copyEmailsBtn'),
  statusBar: document.getElementById('statusBar'),
  statusText: document.getElementById('statusText'),
  summary: document.getElementById('summary'),
  resultsBody: document.getElementById('resultsBody'),
  rowTemplate: document.getElementById('rowTemplate')
};

let currentState = null;
const rowByIndex = new Map();

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await restoreSavedInputs();
  await hydrateState();

  el.excludeInput.addEventListener('input', persistExclusions);
  el.tabLoadTimeoutMs.addEventListener('change', persistSettings);
  el.forceSkipTimeoutMs.addEventListener('change', persistSettings);
  el.hardUrlTimeoutMs.addEventListener('change', persistSettings);

  el.startBtn.addEventListener('click', () => startNewRun());
  el.continueBtn.addEventListener('click', () => continueRun());
  el.stopBtn.addEventListener('click', () => stopRun());
  el.forceStopBtn.addEventListener('click', () => forceStopRun());
  el.skipBtn.addEventListener('click', () => skipCurrent());
  el.clearBtn.addEventListener('click', () => clearAll());
  el.copyTableBtn.addEventListener('click', () => copyTable());
  el.copyEmailsBtn.addEventListener('click', () => copyEmailsOnly());

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg?.type) return;
    if (msg.type === 'PROCESS_PROGRESS') {
      if (currentState && msg.requestId !== currentState.requestId) return;
      setStatus('running', `Processing ${msg.current}/${msg.total} · ${msg.domain || ''}`);
    }
    if (msg.type === 'PROCESS_RESULT') {
      if (currentState && msg.requestId !== currentState.requestId) return;
      upsertResultRow(msg.index, msg.result);
    }
    if (msg.type === 'PROCESS_COMPLETE') {
      hydrateState();
    }
  });
}

async function restoreSavedInputs() {
  const data = await chrome.storage.local.get(['excludeEmailsList', 'tabLoadTimeoutMs', 'forceSkipTimeoutMs', 'hardUrlTimeoutMs']);
  el.excludeInput.value = data.excludeEmailsList || '';
  if (typeof data.tabLoadTimeoutMs === 'number') el.tabLoadTimeoutMs.value = String(data.tabLoadTimeoutMs);
  if (typeof data.forceSkipTimeoutMs === 'number') el.forceSkipTimeoutMs.value = String(data.forceSkipTimeoutMs);
  if (typeof data.hardUrlTimeoutMs === 'number') el.hardUrlTimeoutMs.value = String(data.hardUrlTimeoutMs);
  refreshExcludeLabel();
}

async function hydrateState() {
  const res = await sendMessage({ type: 'GET_LATEST_RESULTS' });
  currentState = res?.state || null;
  renderAllRows(currentState?.results || []);
  renderSummary(currentState);
  updateCopyButtons();

  if (!currentState) return setStatus('idle', 'Idle');
  if (currentState.status === 'running') return setStatus('running', `Resumed listener · ${currentState.current || 0}/${currentState.total || 0}`);
  if (currentState.status === 'done') return setStatus('success', 'Done');
  return setStatus('warning', 'Paused');
}

function parseExcludeRules(raw) {
  const dedup = new Set();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    dedup.add(trimmed.toLowerCase());
  }
  return [...dedup];
}

function normalizeInputUrls(raw) {
  const seen = new Set();
  const out = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const u = new URL(withScheme);
      const normalized = `${u.protocol}//${u.host}`;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        out.push(normalized);
      }
    } catch { }
  }
  return out;
}

async function startNewRun() {
  const urls = normalizeInputUrls(el.urlsInput.value);
  if (!urls.length) return setStatus('error', 'No valid URLs/domains provided.');
  await persistExclusions();
  await persistSettings();
  const res = await sendMessage({
    type: 'PROCESS_URLS',
    urls,
    excludeEmails: parseExcludeRules(el.excludeInput.value),
    requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    reset: true,
    tabLoadTimeoutMs: toNum(el.tabLoadTimeoutMs.value, 12000),
    forceSkipAfterMs: normalizeOptionalMs(el.forceSkipTimeoutMs.value),
    hardUrlTimeoutMs: normalizeOptionalMs(el.hardUrlTimeoutMs.value, 15000)
  });
  if (!res?.ok) return setStatus('error', res?.error || 'Failed to start run.');
  await hydrateState();
}

async function continueRun() {
  await persistExclusions();
  await persistSettings();
  const stateRes = await sendMessage({ type: 'GET_LATEST_RESULTS' });
  const requestId = stateRes?.state?.requestId;
  if (!requestId) return setStatus('error', 'No paused run state to continue.');
  const res = await sendMessage({
    type: 'PROCESS_REMAINING',
    requestId,
    excludeEmails: parseExcludeRules(el.excludeInput.value),
    tabLoadTimeoutMs: toNum(el.tabLoadTimeoutMs.value, 12000),
    forceSkipAfterMs: normalizeOptionalMs(el.forceSkipTimeoutMs.value),
    hardUrlTimeoutMs: normalizeOptionalMs(el.hardUrlTimeoutMs.value, 15000)
  });
  if (!res?.ok) setStatus('error', res?.error || 'Continue failed.');
  await hydrateState();
}

async function stopRun() {
  if (!currentState?.requestId) return;
  await sendMessage({ type: 'STOP_PROCESSING', requestId: currentState.requestId });
  setStatus('warning', 'Stop requested.');
}

async function forceStopRun() {
  if (!currentState?.requestId) return;
  await sendMessage({ type: 'FORCE_STOP_PROCESSING', requestId: currentState.requestId });
  setStatus('warning', 'Force stop requested.');
}

async function skipCurrent() {
  await sendMessage({ type: 'SKIP_CURRENT_URL' });
  setStatus('warning', 'Skipped current URL.');
}

async function clearAll() {
  el.urlsInput.value = '';
  el.resultsBody.innerHTML = '';
  el.summary.textContent = 'Cleared.';
  rowByIndex.clear();
  await sendMessage({ type: 'RESET_RUN_STATE' });
  currentState = null;
  updateCopyButtons();
  setStatus('idle', 'Idle');
}

async function persistExclusions() {
  refreshExcludeLabel();
  await chrome.storage.local.set({ excludeEmailsList: el.excludeInput.value });
}

async function persistSettings() {
  await chrome.storage.local.set({
    tabLoadTimeoutMs: toNum(el.tabLoadTimeoutMs.value, 12000),
    forceSkipTimeoutMs: toNum(el.forceSkipTimeoutMs.value, 0),
    hardUrlTimeoutMs: toNum(el.hardUrlTimeoutMs.value, 15000)
  });
}

function refreshExcludeLabel() {
  el.excludeLabel.textContent = `Exclude (${parseExcludeRules(el.excludeInput.value).length} rules)`;
}

function setStatus(kind, text) {
  el.statusBar.className = `status ${kind}`;
  el.statusText.textContent = text;
}

function renderSummary(state) {
  if (!state) return (el.summary.textContent = 'No run yet.');
  const results = (state.results || []).filter(Boolean);
  const emails = new Set();
  const domains = new Set();
  for (const r of results) {
    if (r.domain) domains.add(r.domain);
    for (const e of r.emails || []) emails.add(typeof e === 'string' ? e : e.email);
  }
  if (state.status === 'done') el.summary.textContent = `Done. ${results.length} sites processed. ${emails.size} emails found across ${domains.size} domains.`;
  else if (state.status === 'running') el.summary.textContent = `Running: ${state.current}/${state.total} · ${state.domain || ''}`;
  else el.summary.textContent = `Paused: ${state.nextIndex}/${state.total}.`;
}

function renderAllRows(results = []) {
  el.resultsBody.innerHTML = '';
  rowByIndex.clear();
  for (let i = 0; i < results.length; i += 1) if (results[i]) upsertResultRow(i, results[i]);
}

function upsertResultRow(index, result) {
  let row = rowByIndex.get(index);
  if (!row) {
    row = el.rowTemplate.content.firstElementChild.cloneNode(true);
    el.resultsBody.appendChild(row);
    rowByIndex.set(index, row);
  }
  row.querySelector('.domain').textContent = result.domain || result.url || '(unknown)';
  row.querySelector('.error').textContent = `${result.status ? `[${result.status}] ` : ''}${result.error || ''}`;
  const emailsEl = row.querySelector('.emails');
  emailsEl.innerHTML = '';

  if (!result.emails?.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = 'No emails found';
    emailsEl.appendChild(d);
  } else {
    for (const item of result.emails) {
      const line = document.createElement('div');
      line.className = 'email-line';
      const email = typeof item === 'string' ? item : item.email;
      const confidence = typeof item === 'string' ? 'medium' : (item.confidence || 'medium');
      line.textContent = email;
      const badge = document.createElement('span');
      badge.className = `badge ${confidence}`;
      badge.textContent = confidence;
      line.appendChild(badge);
      emailsEl.appendChild(line);
    }
  }
  updateCopyButtons();
}

async function copyTable() {
  const rows = ['Domain\tEmails\tError'];
  for (const row of rowByIndex.values()) {
    const domain = row.querySelector('.domain')?.textContent || '';
    const error = row.querySelector('.error')?.textContent || '';
    const emails = [...row.querySelectorAll('.email-line')].map((e) => e.firstChild?.textContent || '').join('\n');
    rows.push(`${domain}\t${emails}\t${error}`);
  }
  await navigator.clipboard.writeText(rows.join('\n'));
  setStatus('success', 'TSV copied.');
}

async function copyEmailsOnly() {
  const emails = [];
  for (const row of rowByIndex.values()) {
    row.querySelectorAll('.email-line').forEach((e) => emails.push(e.firstChild?.textContent || ''));
  }
  await navigator.clipboard.writeText([...new Set(emails.filter(Boolean))].join('\n'));
  setStatus('success', 'Emails copied.');
}

function updateCopyButtons() {
  const has = rowByIndex.size > 0;
  el.copyTableBtn.disabled = !has;
  el.copyEmailsBtn.disabled = !has;
}

function toNum(v, f) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function normalizeOptionalMs(v, fallback = null) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : fallback; }
function sendMessage(payload) { return new Promise((resolve) => chrome.runtime.sendMessage(payload, resolve)); }
