const SETTINGS_KEY = 'popupSettings';

const input = document.getElementById('websiteInput');
const excludeInput = document.getElementById('excludeInput');
const timeoutInput = document.getElementById('timeoutInput');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const skipBtn = document.getElementById('skipBtn');
const copyBtn = document.getElementById('copyBtn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

let latestResults = [];

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

function parseWebsiteList(raw) {
  return [...new Set(raw.split('\n').map((item) => item.trim()).filter(Boolean))];
}

function parseTimeoutSeconds(rawValue) {
  const parsed = Number.parseInt(String(rawValue || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 10;
  return parsed;
}

async function saveSettings() {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      websites: input.value,
      exclude: excludeInput.value,
      timeoutSeconds: parseTimeoutSeconds(timeoutInput.value)
    }
  });
}

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = data[SETTINGS_KEY] || {};
  input.value = settings.websites || '';
  excludeInput.value = settings.exclude || '';
  timeoutInput.value = String(parseTimeoutSeconds(settings.timeoutSeconds));
}

function renderResults(results) {
  latestResults = Array.isArray(results) ? results : [];
  if (!latestResults.length) {
    resultsEl.innerHTML = '';
    copyBtn.disabled = true;
    return;
  }

  const rows = latestResults.map((result) => {
    const emailCell = result.emails?.length
      ? result.emails.join(', ')
      : '<span class="small">No emails found</span>';

    return `<tr>
      <td>${result.website || ''}</td>
      <td>${emailCell}</td>
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

  copyBtn.disabled = latestResults.length === 0;
}

function toClipboardTable(results) {
  const headers = ['Website', 'Emails'];
  const rows = (results || []).map((result) => [
    result.website || '',
    (result.emails || []).join(', ')
  ]);

  return [headers, ...rows]
    .map((row) => row.map((value) => String(value).replaceAll('\t', ' ').replaceAll('\n', ' ')).join('\t'))
    .join('\n');
}

async function copyResults(results) {
  await navigator.clipboard.writeText(toClipboardTable(results));
}

function renderStatusFromState(state) {
  if (!state) {
    setStatus('Ready.');
    return;
  }

  const current = Math.min(state.currentIndex || 0, state.queue?.length || 0);
  const total = state.queue?.length || 0;

  switch (state.status) {
    case 'running':
      setStatus(`Running ${current}/${total}: ${state.currentWebsite || '...'}`);
      break;
    case 'paused':
      setStatus(`Paused at ${current}/${total}. Press Start to resume.`, 'error');
      break;
    case 'done':
      setStatus(`Done. Processed ${state.results?.length || 0} website(s).`, 'success');
      break;
    default:
      setStatus('Ready.');
      break;
  }
}

function setButtonsForState(state) {
  const running = state?.status === 'running';
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  skipBtn.disabled = !running;
  copyBtn.disabled = latestResults.length === 0;
}

async function loadLatestState() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_LATEST_RESULTS' });
  if (!response?.ok) return;

  const { state } = response;
  if (!state) {
    renderResults([]);
    renderStatusFromState(state);
    setButtonsForState(state);
    return;
  }

  if (state.queue?.length && !input.value.trim()) {
    input.value = state.queue.join('\n');
  }

  if (typeof state.timeoutSeconds === 'number') {
    timeoutInput.value = String(parseTimeoutSeconds(state.timeoutSeconds));
  }

  if (Array.isArray(state.excludeEmails) && !excludeInput.value.trim()) {
    excludeInput.value = state.excludeEmails.join('\n');
  }

  renderResults(state.results || []);
  renderStatusFromState(state);
  setButtonsForState(state);
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message?.type) return;

  if (message.type === 'RUN_STATE_UPDATED') {
    const state = message.state || null;
    renderResults(state?.results || []);
    renderStatusFromState(state);
    setButtonsForState(state);
  }
});

async function startProcessing() {
  const urls = parseWebsiteList(input.value);
  const excludeEmails = parseExcludeList(excludeInput.value);
  const timeoutSeconds = parseTimeoutSeconds(timeoutInput.value);

  await saveSettings();

  const response = await chrome.runtime.sendMessage({
    type: 'START_PROCESSING',
    urls,
    excludeEmails,
    timeoutSeconds
  });

  if (!response?.ok) {
    setStatus(response?.error || 'Failed to start processing.', 'error');
    return;
  }

  await loadLatestState();
}

async function stopProcessing() {
  const response = await chrome.runtime.sendMessage({ type: 'STOP_PROCESSING' });
  if (!response?.ok) {
    setStatus(response?.error || 'Failed to stop processing.', 'error');
  }
}

async function skipCurrentWebsite() {
  const response = await chrome.runtime.sendMessage({ type: 'SKIP_CURRENT_WEBSITE' });
  if (!response?.ok) {
    setStatus(response?.error || 'Failed to skip current website.', 'error');
  }
}

startBtn.addEventListener('click', () => {
  startProcessing().catch((error) => {
    setStatus(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  });
});

stopBtn.addEventListener('click', () => {
  stopProcessing().catch((error) => {
    setStatus(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  });
});

skipBtn.addEventListener('click', () => {
  skipCurrentWebsite().catch((error) => {
    setStatus(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  });
});

copyBtn.addEventListener('click', async () => {
  if (!latestResults.length) {
    setStatus('No results available to copy.', 'error');
    return;
  }

  try {
    await copyResults(latestResults);
    setStatus('Copied Website/Emails table to clipboard.', 'success');
  } catch (error) {
    setStatus(`Copy failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  }
});

for (const element of [input, excludeInput, timeoutInput]) {
  element.addEventListener('blur', () => {
    saveSettings().catch(() => {
      // ignore settings save errors
    });
  });
}

Promise.all([loadSettings(), loadLatestState()]).catch(() => {
  setStatus('Ready.');
});
