const SETTINGS_KEY = 'excludeEmailsList';
const SETTINGS_TIMEOUT_KEY = 'tabLoadTimeoutMs';

const input = document.getElementById('websiteInput');
const excludeInput = document.getElementById('excludeInput');
const timeoutInput = document.getElementById('timeoutInput');
const processBtn = document.getElementById('processBtn');
const continueBtn = document.getElementById('continueBtn');
const stopBtn = document.getElementById('stopBtn');
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

function parseTimeoutValue(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1000) return null;
  return Math.round(numeric);
}

async function saveSettings() {
  const tabLoadTimeoutMs = parseTimeoutValue(timeoutInput.value);
  await chrome.storage.local.set({
    [SETTINGS_KEY]: excludeInput.value,
    [SETTINGS_TIMEOUT_KEY]: tabLoadTimeoutMs === null ? '' : String(tabLoadTimeoutMs)
  });
}

async function loadSettings() {
  const data = await chrome.storage.local.get([SETTINGS_KEY, SETTINGS_TIMEOUT_KEY]);
  excludeInput.value = data[SETTINGS_KEY] || '';
  timeoutInput.value = data[SETTINGS_TIMEOUT_KEY] || '';
}

function renderResults(results) {
  if (!results.length) {
    resultsEl.innerHTML = '';
    return;
  }

  const rows = results.map((result) => {
    const emails = result.emails?.length ? result.emails.join('<br>') : '<span class="small">No emails found</span>';
    const errorLine = result.error ? `<div class="small">Error: ${result.error}</div>` : '';

    return `<tr>
      <td>${result.domain}${errorLine}</td>
      <td>${emails}</td>
    </tr>`;
  }).join('');

  resultsEl.innerHTML = `<table>
    <thead>
      <tr>
        <th>Domain</th>
        <th>Emails</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function toClipboardTable(results) {
  const headers = ['Domain', 'Emails', 'Error'];
  const rows = results.map((result) => [
    result.domain,
    (result.emails || []).join(', '),
    result.error || ''
  ]);
  return [headers, ...rows].map((row) => row.join('\t')).join('\n');
}

async function copyResults(results) {
  await navigator.clipboard.writeText(toClipboardTable(results));
}

function setProcessingUi(running) {
  processBtn.disabled = running;
  continueBtn.disabled = running;
  stopBtn.disabled = !running;
}

function getRunOptions() {
  return {
    tabLoadTimeoutMs: parseTimeoutValue(timeoutInput.value)
  };
}

async function loadLatestState() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_LATEST_RESULTS' });
  if (!response?.ok || !response.state) return;

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
    setStatus(`Done. Processed ${state.total} website(s). You can copy the table now.`, 'success');
    return;
  }

  const nextIndex = Number(state.nextIndex || 0);
  const total = Array.isArray(state.urls) ? state.urls.length : 0;
  if (state.status === 'paused' && nextIndex < total) {
    setStatus(`Paused at ${nextIndex} of ${total}. Click Continue Left to process remaining websites.`, '');
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'PROCESS_PROGRESS') return;
  if (!activeRequestId || message.requestId !== activeRequestId) return;

  setStatus(`Processing ${message.current} of ${message.total}: ${message.domain}`);
});

async function startNewProcessing() {
  const urls = input.value.split('\n').map((value) => value.trim()).filter(Boolean);
  if (!urls.length) {
    setStatus('Please enter at least one website.', 'error');
    return;
  }

  const excludeEmails = parseExcludeList(excludeInput.value);
  const options = getRunOptions();
  await saveSettings();

  activeRequestId = crypto.randomUUID();
  setStatus(`Processing 0 of ${urls.length}...`);
  setProcessingUi(true);
  copyBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'PROCESS_URLS',
      urls,
      excludeEmails,
      requestId: activeRequestId,
      reset: true,
      tabLoadTimeoutMs: options.tabLoadTimeoutMs
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Unexpected extension response.');
    }

    latestResults = response.results || [];
    renderResults(latestResults);

    if (latestResults.length) {
      await copyResults(latestResults);
      copyBtn.disabled = false;
      setStatus(`Done. Processed ${latestResults.length} website(s). Table copied to clipboard.`, 'success');
    } else {
      setStatus('No valid websites were provided.', 'error');
    }
  } catch (error) {
    setStatus(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  } finally {
    setProcessingUi(false);
    activeRequestId = null;
  }
}

async function continueRemaining() {
  const excludeEmails = parseExcludeList(excludeInput.value);
  const options = getRunOptions();
  await saveSettings();

  activeRequestId = crypto.randomUUID();
  setStatus('Continuing remaining websites...');
  setProcessingUi(true);
  copyBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'PROCESS_REMAINING',
      requestId: activeRequestId,
      excludeEmails,
      tabLoadTimeoutMs: options.tabLoadTimeoutMs
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'No paused run found to continue.');
    }

    latestResults = response.results || [];
    renderResults(latestResults);

    if (latestResults.length) {
      await copyResults(latestResults);
      copyBtn.disabled = false;
      setStatus(`Done. Processed ${latestResults.length} website(s). Table copied to clipboard.`, 'success');
    } else {
      setStatus('No results available to continue.', 'error');
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

  setStatus('Stopping after current website...');
  stopBtn.disabled = true;

  try {
    await chrome.runtime.sendMessage({ type: 'STOP_PROCESSING', requestId: activeRequestId });
  } catch {
    // ignore stop signal errors
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

processBtn.addEventListener('click', startNewProcessing);
continueBtn.addEventListener('click', continueRemaining);
stopBtn.addEventListener('click', stopProcessing);
clearListBtn.addEventListener('click', clearListAndReset);

excludeInput.addEventListener('blur', () => {
  saveSettings().catch(() => {
    // ignore settings save errors
  });
});

timeoutInput.addEventListener('blur', () => {
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
