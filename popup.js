const SETTINGS_KEY = 'excludeEmailsList';
const TAB_TIMEOUT_KEY = 'tabLoadTimeoutMs';
const STRICT_TIMEOUT_KEY = 'strictSkipTimeoutSec';

const input = document.getElementById('websiteInput');
const excludeInput = document.getElementById('excludeInput');
const tabLoadTimeoutInput = document.getElementById('tabLoadTimeoutMs');
const strictSkipTimeoutInput = document.getElementById('strictSkipTimeoutSec');
const startNewBtn = document.getElementById('startNewBtn');
const continueBtn = document.getElementById('continueBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const copyBtn = document.getElementById('copyBtn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

let latestResults = [];
let activeRequestId = null;

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
    const emails = result.emails?.length ? result.emails.join('<br>') : '<span class="small">No emails found</span>';
    const errorLine = result.error ? `<div class="small">Error: ${escapeHtml(result.error)}</div>` : '';
    return `<tr><td>${escapeHtml(result.domain)}${errorLine}</td><td>${emails}</td></tr>`;
  }).join('');

  resultsEl.innerHTML = `<table><thead><tr><th>Domain</th><th>Emails</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function toClipboardTable(results) {
  const headers = ['Domain', 'Emails'];
  const rows = results.map((result) => [
    sanitizeCell(result.domain),
    sanitizeCell((result.emails || []).join(', '))
  ]);
  return [headers, ...rows].map((row) => row.join('\t')).join('\n');
}

function toClipboardHtmlTable(results) {
  const rows = results.map((result) => {
    const emails = (result.emails || []).map((email) => escapeHtml(email)).join('<br>');
    return `<tr><td>${escapeHtml(result.domain)}</td><td>${emails || ''}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Domain</th><th>Emails</th></tr></thead><tbody>${rows}</tbody></table>`;
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
  let active = true;

  const tick = async () => {
    if (!active) return;
    try {
      await loadLatestState();
      const response = await chrome.runtime.sendMessage({ type: 'GET_LATEST_RESULTS' });
      if (response?.ok && response.state?.status !== 'running') {
        active = false;
        return;
      }
    } catch {
      // ignore polling failures
    }

    setTimeout(tick, 1000);
  };

  tick();
}

function applyStateToUi(state) {
  const isRunning = state?.status === 'running';
  startNewBtn.disabled = isRunning;
  continueBtn.disabled = isRunning;
  stopBtn.disabled = !isRunning;

  if (Array.isArray(state?.results)) {
    latestResults = state.results;
    renderResults(latestResults);
    copyBtn.disabled = latestResults.length === 0;
  }

  if (state?.status === 'paused') {
    setStatus(`Paused at ${state.current} of ${state.total}. Click Continue Left to resume.`, 'error');
  } else if (state?.status === 'done') {
    setStatus(`Done. Processed ${state.total} website(s).`, 'success');
  } else if (isRunning) {
    setStatus(`Processing ${state.current} of ${state.total}: ${state.domain || '...'}`);
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

async function runStart(mode) {
  const urls = input.value.split('\n').map((value) => value.trim()).filter(Boolean);
  const excludeEmails = parseExcludeList(excludeInput.value);
  const tabLoadTimeoutMs = Math.max(1000, Math.min(120000, Number(tabLoadTimeoutInput.value) || 20000));
  const strictSkipTimeoutSec = Math.max(1, Math.min(300, Number(strictSkipTimeoutInput.value) || 10));
  tabLoadTimeoutInput.value = String(tabLoadTimeoutMs);
  strictSkipTimeoutInput.value = String(strictSkipTimeoutSec);

  await saveSettings();
  activeRequestId = crypto.randomUUID();

  startNewBtn.disabled = true;
  continueBtn.disabled = true;
  stopBtn.disabled = false;
  copyBtn.disabled = true;
  startLiveStatePolling();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_OR_RESUME',
      mode,
      requestId: activeRequestId,
      urls,
      excludeEmails,
      tabLoadTimeoutMs,
      strictSkipTimeoutSec
    });

    if (!response?.ok) throw new Error('Unexpected extension response.');
    if (response.state) {
      applyStateToUi(response.state);
      if (response.state.status === 'done' && latestResults.length) {
        await copyResults(latestResults);
      }
    }
  } catch (error) {
    setStatus(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    startNewBtn.disabled = false;
    continueBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

async function stopProcess() {
  await chrome.runtime.sendMessage({ type: 'STOP_PROCESS' });
  await loadLatestState();
}

function clearList() {
  input.value = '';
  setStatus('Website list cleared.');
}

startNewBtn.addEventListener('click', () => {
  runStart('new').catch(() => setStatus('Failed to start new run.', 'error'));
});

continueBtn.addEventListener('click', () => {
  runStart('continue').catch(() => setStatus('Failed to continue run.', 'error'));
});

stopBtn.addEventListener('click', () => {
  stopProcess().catch(() => setStatus('Failed to stop process.', 'error'));
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
