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

  el.startBtn.addEventListener('click', startNewRun);
  el.continueBtn.addEventListener('click', continueRun);
  el.stopBtn.addEventListener('click', stopRun);
  el.forceStopBtn.addEventListener('click', forceStopRun);
  el.clearBtn.addEventListener('click', clearAll);
  el.copyTableBtn.addEventListener('click', copyTable);
  el.copyEmailsBtn.addEventListener('click', copyEmailsOnly);

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
  });
}

async function restoreSavedInputs() {
  const data = await chrome.storage.local.get([
    'excludeEmailsList',
    'tabLoadTimeoutMs',
    'forceSkipTimeoutMs',
    'hardUrlTimeoutMs'
  ]);
  el.excludeInput.value = data.excludeEmailsList || '';
  if (typeof data.tabLoadTimeoutMs === 'number') el.tabLoadTimeoutMs.value = String(data.tabLoadTimeoutMs);
  if (typeof data.forceSkipTimeoutMs === 'number') el.forceSkipTimeoutMs.value = String(data.forceSkipTimeoutMs);
  if (typeof data.hardUrlTimeoutMs === 'number') el.hardUrlTimeoutMs.value = String(data.hardUrlTimeoutMs);
  refreshExcludeLabel();
}

async function hydrateState() {
  const res = await sendMessage({ type: 'GET_LATEST_RESULTS' });
  const state = res?.state || null;
  currentState = state;
  renderAllRows(state?.results || []);
  updateCopyButtons();

  if (!state) {
    setStatus('idle', 'Idle');
    el.summary.textContent = 'No run yet.';
    return;
  }

  if (state.status === 'running') {
    setStatus('running', `Resumed listener · ${state.current || 0}/${state.total || 0}`);
  } else if (state.status === 'done') {
    setStatus('success', 'Done');
  } else {
    setStatus('warning', 'Paused');
  }
  renderSummary(state);
}

function setStatus(kind, text) {
  el.statusBar.className = `status ${kind}`;
  el.statusText.textContent = text;
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

function refreshExcludeLabel() {
  const count = parseExcludeRules(el.excludeInput.value).length;
  el.excludeLabel.textContent = `Exclude (${count} rules)`;
}

async function persistExclusions() {
  refreshExcludeLabel();
  await chrome.storage.local.set({ excludeEmailsList: el.excludeInput.value });
}

async function persistSettings() {
  await chrome.storage.local.set({
    tabLoadTimeoutMs: toNum(el.tabLoadTimeoutMs.value, 12000),
    forceSkipTimeoutMs: toNum(el.forceSkipTimeoutMs.value, 0),
    hardUrlTimeoutMs: toNum(el.hardUrlTimeoutMs.value, 45000)
  });
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
    } catch {
      // ignore invalid URL lines
    }
  }
  return out;
}

function newRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function startNewRun() {
  const urls = normalizeInputUrls(el.urlsInput.value);
  if (!urls.length) {
    setStatus('error', 'No valid URLs/domains provided.');
    return;
  }

  const requestId = newRequestId();
  const excludeEmails = parseExcludeRules(el.excludeInput.value);
  await persistExclusions();
  await persistSettings();

  const payload = {
    type: 'PROCESS_URLS',
    urls,
    excludeEmails,
    requestId,
    reset: true,
    tabLoadTimeoutMs: toNum(el.tabLoadTimeoutMs.value, 12000),
    forceSkipAfterMs: normalizeOptionalMs(el.forceSkipTimeoutMs.value),
    hardUrlTimeoutMs: normalizeOptionalMs(el.hardUrlTimeoutMs.value, 45000)
  };

  setStatus('running', `Starting ${urls.length} sites...`);
  const res = await sendMessage(payload);
  if (!res?.ok) {
    setStatus('error', res?.error || 'Failed to start run.');
    return;
  }
  await hydrateState();
}

async function continueRun() {
  await persistExclusions();
  await persistSettings();
  const stateRes = await sendMessage({ type: 'GET_LATEST_RESULTS' });
  if (!stateRes?.state?.requestId) {
    setStatus('error', 'No paused run state to continue.');
    return;
  }
  const payload = {
    type: 'PROCESS_REMAINING',
    requestId: stateRes.state.requestId,
    excludeEmails: parseExcludeRules(el.excludeInput.value),
    tabLoadTimeoutMs: toNum(el.tabLoadTimeoutMs.value, 12000),
    forceSkipAfterMs: normalizeOptionalMs(el.forceSkipTimeoutMs.value),
    hardUrlTimeoutMs: normalizeOptionalMs(el.hardUrlTimeoutMs.value, 45000)
  };
  setStatus('running', 'Continuing...');
  const res = await sendMessage(payload);
  if (!res?.ok) setStatus('error', res?.error || 'Continue failed.');
  await hydrateState();
}

async function stopRun() {
  if (!currentState?.requestId) return;
  await sendMessage({ type: 'STOP_PROCESSING', requestId: currentState.requestId });
  setStatus('warning', 'Stop requested. Pausing after current URL.');
}

async function forceStopRun() {
  if (!currentState?.requestId) return;
  await sendMessage({ type: 'FORCE_STOP_PROCESSING', requestId: currentState.requestId });
  setStatus('warning', 'Force stop requested.');
}

async function clearAll() {
  el.urlsInput.value = '';
  el.summary.textContent = 'Cleared.';
  el.resultsBody.innerHTML = '';
  rowByIndex.clear();
  await sendMessage({ type: 'RESET_RUN_STATE' });
  currentState = null;
  updateCopyButtons();
  setStatus('idle', 'Idle');
}

function renderAllRows(results = []) {
  el.resultsBody.innerHTML = '';
  rowByIndex.clear();
  results.forEach((r, i) => {
    if (!r) return;
    upsertResultRow(i, r);
  });
}

function upsertResultRow(index, result) {
  if (!result) return;
  let row = rowByIndex.get(index);
  if (!row) {
    row = el.rowTemplate.content.firstElementChild.cloneNode(true);
    rowByIndex.set(index, row);
    el.resultsBody.appendChild(row);
  }

  row.querySelector('.domain').textContent = result.domain || result.url || '(unknown)';
  row.querySelector('.error').textContent = result.error || '';
  const emailsEl = row.querySelector('.emails');
  emailsEl.innerHTML = '';

  if (!result.emails?.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No emails found';
    emailsEl.appendChild(empty);
  } else {
    for (const item of result.emails) {
      const email = typeof item === 'string' ? item : item.email;
      const confidence = typeof item === 'string' ? 'medium' : item.confidence || 'medium';
      const line = document.createElement('div');
      line.className = 'email-line';
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

function renderSummary(state) {
  const results = (state?.results || []).filter(Boolean);
  const emails = new Set();
  const domains = new Set();
  for (const r of results) {
    if (r.domain) domains.add(r.domain);
    for (const entry of r.emails || []) {
      emails.add(typeof entry === 'string' ? entry : entry.email);
    }
  }
  if (state?.status === 'done') {
    el.summary.textContent = `Done. ${results.length} sites processed. ${emails.size} emails found across ${domains.size} domains.`;
  } else if (state?.status === 'running') {
    el.summary.textContent = `Running: ${state.current}/${state.total} · ${state.domain || ''}`;
  } else if (state?.status === 'paused') {
    el.summary.textContent = `Paused at ${state.nextIndex}/${state.total}.`;
  }
}

function collectEmailsFromRows() {
  const out = [];
  for (const row of rowByIndex.values()) {
    row.querySelectorAll('.email-line').forEach((line) => {
      out.push(line.firstChild?.textContent || '');
    });
  }
  return [...new Set(out.filter(Boolean))];
}

async function copyTable() {
  const lines = ['Domain\tEmails\tError'];
  for (const row of rowByIndex.values()) {
    const domain = row.querySelector('.domain')?.textContent || '';
    const emails = [...row.querySelectorAll('.email-line')].map((l) => l.firstChild?.textContent || '').join('\n');
    const error = row.querySelector('.error')?.textContent || '';
    lines.push(`${domain}\t${emails}\t${error}`);
  }
  await navigator.clipboard.writeText(lines.join('\n'));
  setStatus('success', 'TSV copied.');
}

async function copyEmailsOnly() {
  const emails = collectEmailsFromRows();
  await navigator.clipboard.writeText(emails.join('\n'));
  setStatus('success', `Copied ${emails.length} emails.`);
}

function updateCopyButtons() {
  const hasRows = rowByIndex.size > 0;
  el.copyTableBtn.disabled = !hasRows;
  el.copyEmailsBtn.disabled = !hasRows;
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeOptionalMs(v, fallback = null) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0) return null;
  return n;
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (res) => {
      resolve(res);
    });
  });
}
