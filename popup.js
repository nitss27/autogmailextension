const SETTINGS_KEY = 'excludeEmailsList';
const SETTINGS_TIMEOUT_KEY = 'tabLoadTimeoutMs';
const STRICT_TIMEOUT_KEY = 'strictSkipTimeoutSec';

const input = document.getElementById('websiteInput');
const excludeInput = document.getElementById('excludeInput');
const timeoutInput = document.getElementById('timeoutInput');
const strictTimeoutInput = document.getElementById('strictTimeoutInput');
const processBtn = document.getElementById('processBtn');
const stopBtn = document.getElementById('stopBtn');
const skipBtn = document.getElementById('skipBtn');
const copyBtn = document.getElementById('copyBtn');
const clearListBtn = document.getElementById('clearListBtn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

let latestResults = [];
let activeRequestId = null;
let pollingTimer = null;

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

function parseTimeoutValue(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1000) return null;
  return Math.round(numeric);
}

async function saveSettings() {
  const tabLoadTimeoutMs = parseTimeoutValue(timeoutInput.value);
  const strictSkipTimeoutSec = Math.max(1, Math.min(300, Number(strictTimeoutInput.value) || 10));

  await chrome.storage.local.set({
    [SETTINGS_KEY]: excludeInput.value,
    [SETTINGS_TIMEOUT_KEY]: tabLoadTimeoutMs === null ? '' : String(tabLoadTimeoutMs),
    [STRICT_TIMEOUT_KEY]: String(strictSkipTimeoutSec)
  });
}

async function loadSettings() {
  const data = await chrome.storage.local.get([SETTINGS_KEY, SETTINGS_TIMEOUT_KEY, STRICT_TIMEOUT_KEY]);
  excludeInput.value = data[SETTINGS_KEY] || '';
  timeoutInput.value = data[SETTINGS_TIMEOUT_KEY] || '';
  strictTimeoutInput.value = data[STRICT_TIMEOUT_KEY] || '10';
}

function renderResults(results) {
  if (!results.length) {
    resultsEl.innerHTML = '';
    return;
  }

  const rows = results.map((result) => {
    const emails = result.emails?.length
      ? result.emails.join(', ')
      : '<span class="small">No emails found</span>';

    return `<tr><td>${result.domain}</td><td>${emails}</td></tr>`;
  }).join('');

  resultsEl.innerHTML = `<table><thead><tr><th>Website</th><th>Emails</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function toClipboardTable(results) {
  const headers = ['Website', 'Emails'];
  const rows = results.map((result) => [result.domain, (result.emails || []).join(', ')]);
  return [headers, ...rows].map((row) => row.join('\t')).join('\n');
}

async function copyResults(results) {
  await navigator.clipboard.writeText(toClipboardTable(results));
}

function setProcessingUi(running) {
  processBtn.disabled = running;
  stopBtn.disabled = !running;
  skipBtn.disabled = !running;
}

function getRunOptions() {
  return {
    tabLoadTimeoutMs: parseTimeoutValue(timeoutInput.value),
    strictSkipTimeoutSec: Math.max(1, Math.min(300, Number(strictTimeoutInput.value) || 10))
  };
}

function startPolling() {
  if (pollingTimer) return;

  const tick = async () => {
    try {
      await loadLatestState();
      const response = await chrome.runtime.sendMessage({ type: 'GET_LATEST_RESULTS' });
      if (response?.ok && response.state?.status === 'running') {
        pollingTimer = setTimeout(tick, 400);
        return;
      }
      pollingTimer = null;
    } catch {
      pollingTimer = setTimeout(tick, 1000);
    }
  };

  pollingTimer = setTimeout(tick, 0);
}

async function loadLatestState() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_LATEST_RESULTS' });
  if (!response?.ok || !response.state) return;

  const { state } = response;

  if (Array.isArray(state.results)) {
    latestResults = state.results;
    renderResults(latestResults);
    copyBtn.disabled = latestResults.length === 0;
  }

  if (state.status === 'running') {
    activeRequestId = state.requestId || activeRequestId;
    setStatus(`Processing ${state.current} of ${state.total}: ${state.domain || '...'}`);
    setProcessingUi(true);
    return;
  }

  setProcessingUi(false);

  if (state.status === 'done') {
    setStatus(`Done. Processed ${state.total} website(s).`, 'success');
    return;
  }

  const nextIndex = Number(state.current || 0);
  const total = Array.isArray(state.urls) ? state.urls.length : Number(state.total || 0);
  if (state.status === 'paused' && nextIndex < total) {
    setStatus(`Paused at ${nextIndex} of ${total}. Click Start to resume.`, '');
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!activeRequestId || message.requestId !== activeRequestId) return;

  if (message?.type === 'PROCESS_PROGRESS') {
    setStatus(`Processing ${message.current} of ${message.total}: ${message.domain}`);
    return;
  }

  if (message?.type === 'PROCESS_RESULT') {
    const index = Number(message.index);
    if (Number.isInteger(index) && index >= 0 && message.result) {
      latestResults[index] = message.result;
      renderResults(latestResults.filter(Boolean));
      copyBtn.disabled = false;
    }
  }
});

async function startProcessing() {
  const urls = input.value.split('\n').map((value) => value.trim()).filter(Boolean);
  const excludeEmails = parseExcludeList(excludeInput.value);
  const options = getRunOptions();
  await saveSettings();

  activeRequestId = crypto.randomUUID();
  setProcessingUi(true);
  startPolling();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_PROCESS',
      urls,
      excludeEmails,
      requestId: activeRequestId,
      tabLoadTimeoutMs: options.tabLoadTimeoutMs,
      strictSkipTimeoutSec: options.strictSkipTimeoutSec
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Unexpected extension response.');
    }

    if (response.state?.status === 'running') {
      setStatus(`Processing ${response.state.current} of ${response.state.total}: ${response.state.domain || '...'}`);
    }
  } catch (error) {
    setStatus(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    setProcessingUi(false);
  }
}

async function stopProcessing() {
  try {
    await chrome.runtime.sendMessage({ type: 'STOP_PROCESS' });
    await loadLatestState();
  } catch {
    setStatus('Failed to stop.', 'error');
  }
}

async function skipCurrent() {
  try {
    await chrome.runtime.sendMessage({ type: 'SKIP_CURRENT' });
  } catch {
    setStatus('Failed to skip current website.', 'error');
  }
}

async function clearListAndReset() {
  input.value = '';
  latestResults = [];
  renderResults([]);
  copyBtn.disabled = true;
  setStatus('Website list and current results cleared.');
  activeRequestId = null;

  try {
    await chrome.runtime.sendMessage({ type: 'RESET_RUN_STATE' });
  } catch {
    // ignore reset errors
  }
}

processBtn.addEventListener('click', startProcessing);
stopBtn.addEventListener('click', stopProcessing);
skipBtn.addEventListener('click', skipCurrent);
clearListBtn.addEventListener('click', clearListAndReset);

excludeInput.addEventListener('blur', () => saveSettings().catch(() => {}));
timeoutInput.addEventListener('blur', () => saveSettings().catch(() => {}));
strictTimeoutInput.addEventListener('blur', () => saveSettings().catch(() => {}));

copyBtn.addEventListener('click', async () => {
  if (!latestResults.length) {
    setStatus('No results available to copy.', 'error');
    return;
  }

  try {
    await copyResults(latestResults);
    setStatus('Copied results to clipboard.', 'success');
  } catch (error) {
    setStatus(`Copy failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  }
});

(async () => {
  copyBtn.disabled = true;
  setProcessingUi(false);
  await loadSettings();
  await loadLatestState();
  startPolling();
})();
