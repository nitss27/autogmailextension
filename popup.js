const SETTINGS_KEY = 'excludeEmailsList';
const TAB_TIMEOUT_KEY = 'tabLoadTimeoutMs';
const STRICT_TIMEOUT_KEY = 'strictSkipTimeoutSec';

const input = document.getElementById('websiteInput');
const excludeInput = document.getElementById('excludeInput');
const tabLoadTimeoutInput = document.getElementById('tabLoadTimeoutMs');
const strictSkipTimeoutInput = document.getElementById('strictSkipTimeoutSec');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const skipBtn = document.getElementById('skipBtn');
const clearBtn = document.getElementById('clearBtn');
const copyBtn = document.getElementById('copyBtn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

let latestResults = [];
let activeRequestId = null;
let pollingHandle = null;

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function parseExcludeList(raw) {
  return [...new Set(
    raw
      .split('\n')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  )];
}

function sanitizeCell(value) {
  return String(value || '').replace(/\t/g, ' ').replace(/\r?\n/g, ', ').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function saveSettings() {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: excludeInput.value,
    [TAB_TIMEOUT_KEY]: tabLoadTimeoutInput.value,
    [STRICT_TIMEOUT_KEY]: strictSkipTimeoutInput.value
  });
}

async function loadSettings() {
  const data = await chrome.storage.local.get([SETTINGS_KEY, TAB_TIMEOUT_KEY, STRICT_TIMEOUT_KEY]);
  excludeInput.value = data[SETTINGS_KEY] || '';
  tabLoadTimeoutInput.value = data[TAB_TIMEOUT_KEY] || '20000';
  strictSkipTimeoutInput.value = data[STRICT_TIMEOUT_KEY] || '10';
}

function renderResults(results) {
  if (!results.length) {
    resultsEl.innerHTML = '';
    return;
  }

  const rows = results.map((result) => {
    const emails = result.emails?.length ? escapeHtml(result.emails.join(', ')) : '<span class="small">No emails found</span>';
    const error = result.error ? escapeHtml(result.error) : '';
    return `<tr><td>${escapeHtml(result.domain)}</td><td>${emails}</td><td>${error}</td></tr>`;
  }).join('');

  resultsEl.innerHTML = `<table><thead><tr><th>Domain</th><th>Emails</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function toClipboardTable(results) {
  const headers = ['Domain', 'Emails', 'Error'];
  const rows = results.map((result) => [
    sanitizeCell(result.domain),
    sanitizeCell((result.emails || []).join(', ')),
    sanitizeCell(result.error || '')
  ]);
  return [headers, ...rows].map((row) => row.join('\t')).join('\n');
}

function toClipboardHtmlTable(results) {
  const rows = results.map((result) => {
    const emails = escapeHtml((result.emails || []).join(', '));
    const error = escapeHtml(result.error || '');
    return `<tr><td>${escapeHtml(result.domain)}</td><td>${emails || ''}</td><td>${error}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Domain</th><th>Emails</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function copyResults(results) {
  const plainText = toClipboardTable(results);
  const htmlText = toClipboardHtmlTable(results);

  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
        'text/html': new Blob([htmlText], { type: 'text/html' })
      })
    ]);
    return;
  }

  await navigator.clipboard.writeText(plainText);
}

function startLiveStatePolling() {
  if (pollingHandle) return;

  const tick = async () => {
    try {
      await loadLatestState();
      const response = await chrome.runtime.sendMessage({ type: 'GET_LATEST_RESULTS' });
      if (response?.ok && response.state?.status !== 'running') {
        pollingHandle = null;
        return;
      }
    } catch {
      // ignore polling failures
    }

    pollingHandle = setTimeout(tick, 400);
  };

  pollingHandle = setTimeout(tick, 0);
}

function applyStateToUi(state) {
  const isRunning = state?.status === 'running';
  startBtn.disabled = isRunning;
  stopBtn.disabled = !isRunning;
  skipBtn.disabled = !isRunning;

  if (Array.isArray(state?.results)) {
    latestResults = state.results;
    renderResults(latestResults);
    copyBtn.disabled = latestResults.length === 0;
  }

  if (state?.status === 'paused') {
    setStatus(`Paused at ${state.current} of ${state.total}. Click Start to resume.`, 'error');
  } else if (state?.status === 'done') {
    setStatus(`Done. Processed ${state.total} website(s).`, 'success');
  } else if (isRunning) {
    setStatus(`Processing ${state.current} of ${state.total}: ${state.domain || '...'}`);
  } else {
    setStatus('Ready. Click Start to begin or resume.');
  }
}

async function loadLatestState() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_LATEST_RESULTS' });
  if (!response?.ok || !response.state) return;

  const { state } = response;
  activeRequestId = state.requestId || activeRequestId;
  applyStateToUi(state);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'PROCESS_PROGRESS') return;
  if (!activeRequestId || message.requestId !== activeRequestId) return;
  const suffix = message.note ? ` — ${message.note}` : '';
  setStatus(`Processing ${message.current} of ${message.total}: ${message.domain}${suffix}`);
});

async function startProcess() {
  const urls = input.value.split('\n').map((value) => value.trim()).filter(Boolean);
  const excludeEmails = parseExcludeList(excludeInput.value);
  const tabLoadTimeoutMs = Math.max(1000, Math.min(120000, Number(tabLoadTimeoutInput.value) || 20000));
  const strictSkipTimeoutSec = Math.max(1, Math.min(300, Number(strictSkipTimeoutInput.value) || 10));
  tabLoadTimeoutInput.value = String(tabLoadTimeoutMs);
  strictSkipTimeoutInput.value = String(strictSkipTimeoutSec);

  await saveSettings();
  activeRequestId = crypto.randomUUID();

  startBtn.disabled = true;
  stopBtn.disabled = false;
  skipBtn.disabled = false;
  startLiveStatePolling();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_PROCESS',
      requestId: activeRequestId,
      urls,
      excludeEmails,
      tabLoadTimeoutMs,
      strictSkipTimeoutSec
    });

    if (!response?.ok) throw new Error('Unexpected extension response.');
    if (response.state) {
      applyStateToUi(response.state);
    }
  } catch (error) {
    setStatus(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    skipBtn.disabled = true;
  }
}

async function stopProcess() {
  await chrome.runtime.sendMessage({ type: 'STOP_PROCESS' });
  await loadLatestState();
}

async function skipCurrent() {
  await chrome.runtime.sendMessage({ type: 'SKIP_CURRENT' });
  await loadLatestState();
}

function clearList() {
  input.value = '';
  setStatus('Website list cleared.');
}

startBtn.addEventListener('click', () => {
  startProcess().catch(() => setStatus('Failed to start process.', 'error'));
});

stopBtn.addEventListener('click', () => {
  stopProcess().catch(() => setStatus('Failed to stop process.', 'error'));
});

skipBtn.addEventListener('click', () => {
  skipCurrent().catch(() => setStatus('Failed to skip current website.', 'error'));
});

clearBtn.addEventListener('click', clearList);

copyBtn.addEventListener('click', async () => {
  if (!latestResults.length) {
    setStatus('No results available to copy.', 'error');
    return;
  }

  try {
    await copyResults(latestResults);
    setStatus('Copied results table to clipboard.', 'success');
  } catch (error) {
    setStatus(`Copy failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  }
});

excludeInput.addEventListener('blur', () => saveSettings().catch(() => {}));
tabLoadTimeoutInput.addEventListener('blur', () => saveSettings().catch(() => {}));
strictSkipTimeoutInput.addEventListener('blur', () => saveSettings().catch(() => {}));

Promise.all([loadSettings(), loadLatestState()]).catch(() => {
  // ignore bootstrap errors
});
