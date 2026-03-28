const SETTINGS_KEY = 'excludeEmailsList';
const SETTINGS_TIMEOUT_KEY = 'strictTimeoutSeconds';
const WEBSITE_LIST_KEY = 'websiteInputList';

const input = document.getElementById('websiteInput');
const excludeInput = document.getElementById('excludeInput');
const timeoutInput = document.getElementById('timeoutInput');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const skipBtn = document.getElementById('skipBtn');
const copyBtn = document.getElementById('copyBtn');
const clearListBtn = document.getElementById('clearListBtn');
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

function parseTimeoutSeconds(raw) {
  const value = String(raw || '').trim();
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return 10;
  return Math.round(numeric);
}

function parseWebsiteInput() {
  return input.value.split('\n').map((value) => value.trim()).filter(Boolean);
}

async function saveSettings() {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: excludeInput.value,
    [SETTINGS_TIMEOUT_KEY]: String(parseTimeoutSeconds(timeoutInput.value)),
    [WEBSITE_LIST_KEY]: input.value
  });
}

async function loadSettings() {
  const data = await chrome.storage.local.get([SETTINGS_KEY, SETTINGS_TIMEOUT_KEY, WEBSITE_LIST_KEY]);
  excludeInput.value = data[SETTINGS_KEY] || '';
  timeoutInput.value = data[SETTINGS_TIMEOUT_KEY] || '10';
  input.value = data[WEBSITE_LIST_KEY] || '';
}

function renderResults(results) {
  if (!results.length) {
    resultsEl.innerHTML = '';
    return;
  }

  const rows = results.map((result) => {
    const emails = result.emails?.length ? result.emails.join(', ') : '';
    return `<tr>
      <td>${result.website}</td>
      <td>${emails}</td>
    </tr>`;
  }).join('');

  resultsEl.innerHTML = `<table>
    <thead>
      <tr>
        <th>Website</th>
        <th>Emails</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function toClipboardTable(results) {
  const headers = ['Website', 'Emails'];
  const rows = results.map((result) => [result.website, (result.emails || []).join(', ')]);
  return [headers, ...rows].map((row) => row.join('\t')).join('\n');
}

async function copyResults(results) {
  await navigator.clipboard.writeText(toClipboardTable(results));
}

function setProcessingUi(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  skipBtn.disabled = !running;
}

async function loadLatestState() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_LATEST_RESULTS' });
  if (!response?.ok || !response.state) {
    setProcessingUi(false);
    return;
  }

  const { state } = response;

  if (Array.isArray(state.results) && state.results.length) {
    latestResults = state.results;
    renderResults(latestResults);
    copyBtn.disabled = false;
  }

  if (state.status === 'running') {
    activeRequestId = state.requestId || activeRequestId;
    setStatus(`Processing ${state.current} of ${state.total}: ${state.domain || '...'}`);
    setProcessingUi(true);
    return;
  }

  setProcessingUi(false);

  if (state.status === 'done') {
    setStatus(`Done. Processed ${state.results?.length || 0} website(s).`, 'success');
    return;
  }

  const total = Array.isArray(state.urls) ? state.urls.length : 0;
  const nextIndex = Number(state.nextIndex || 0);
  if (state.status === 'paused') {
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
    if (message.result) {
      latestResults = [...latestResults, message.result];
      renderResults(latestResults);
      copyBtn.disabled = true;
    }
  }
});

async function startProcessing() {
  const urls = parseWebsiteInput();
  if (!urls.length) {
    setStatus('Please enter at least one website.', 'error');
    return;
  }

  const excludeEmails = parseExcludeList(excludeInput.value);
  const strictTimeoutSeconds = parseTimeoutSeconds(timeoutInput.value);
  await saveSettings();

  activeRequestId = crypto.randomUUID();
  setStatus('Starting/resuming processing...');
  setProcessingUi(true);
  copyBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'PROCESS_START',
      urls,
      excludeEmails,
      requestId: activeRequestId,
      strictTimeoutSeconds
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Unexpected extension response.');
    }

    latestResults = response.results || [];
    renderResults(latestResults);
    copyBtn.disabled = !latestResults.length;

    if (response.status === 'paused') {
      setStatus('Stopped immediately. Progress saved. Click Start to resume.', '');
    } else {
      setStatus(`Done. Processed ${latestResults.length} website(s).`, 'success');
    }
  } catch (error) {
    setStatus(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  } finally {
    setProcessingUi(false);
    activeRequestId = null;
  }
}

async function stopProcessing() {
  if (!activeRequestId) {
    setStatus('No active run to stop.', 'error');
    return;
  }

  setStatus('Force-stopping now...');

  try {
    await chrome.runtime.sendMessage({ type: 'STOP_PROCESSING', requestId: activeRequestId });
  } catch {
    // ignore stop signal errors
  }
}

async function skipCurrentWebsite() {
  if (!activeRequestId) {
    setStatus('No active run to skip.', 'error');
    return;
  }

  setStatus('Skipping current website...');

  try {
    await chrome.runtime.sendMessage({ type: 'SKIP_CURRENT', requestId: activeRequestId });
  } catch {
    // ignore skip signal errors
  }
}

async function clearListAndReset() {
  input.value = '';
  latestResults = [];
  renderResults([]);
  copyBtn.disabled = true;
  setStatus('Website list and current results cleared.');
  activeRequestId = null;

  await chrome.storage.local.remove([WEBSITE_LIST_KEY]);

  try {
    await chrome.runtime.sendMessage({ type: 'RESET_RUN_STATE' });
  } catch {
    // ignore reset errors
  }
}

startBtn.addEventListener('click', startProcessing);
stopBtn.addEventListener('click', stopProcessing);
skipBtn.addEventListener('click', skipCurrentWebsite);
clearListBtn.addEventListener('click', clearListAndReset);

excludeInput.addEventListener('blur', () => {
  saveSettings().catch(() => {
    // ignore settings save errors
  });
});

timeoutInput.addEventListener('blur', () => {
  timeoutInput.value = String(parseTimeoutSeconds(timeoutInput.value));
  saveSettings().catch(() => {
    // ignore settings save errors
  });
});

input.addEventListener('blur', () => {
  saveSettings().catch(() => {
    // ignore settings save errors
  });
});

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
})();
