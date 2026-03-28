const SETTINGS_KEY = 'excludeEmailsList';
const TIMEOUT_KEY = 'strictTimeoutSec';

const input = document.getElementById('websiteInput');
const excludeInput = document.getElementById('excludeInput');
const strictTimeoutInput = document.getElementById('strictTimeoutSec');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const skipBtn = document.getElementById('skipBtn');
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
  return String(value || '')
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, ', ')
    .trim();
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
    [TIMEOUT_KEY]: strictTimeoutInput.value
  });
}

async function loadSettings() {
  const data = await chrome.storage.local.get([SETTINGS_KEY, TIMEOUT_KEY]);
  excludeInput.value = data[SETTINGS_KEY] || '';
  strictTimeoutInput.value = data[TIMEOUT_KEY] || '10';
}

function renderResults(results) {
  if (!results.length) {
    resultsEl.innerHTML = '';
    return;
  }

  const rows = results.map((result) => {
    const emails = result.emails?.length ? result.emails.join('<br>') : '<span class="small">No emails found</span>';
    const errorLine = result.error ? `<div class="small">Error: ${escapeHtml(result.error)}</div>` : '';

    return `<tr>
      <td>${escapeHtml(result.domain)}${errorLine}</td>
      <td>${emails}</td>
    </tr>`;
  }).join('');

  resultsEl.innerHTML = `<table>
    <thead><tr><th>Domain</th><th>Emails</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
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
    const emails = (result.emails || []).map((email) => escapeHtml(email)).join('<br>');
    return `<tr><td>${escapeHtml(result.domain)}</td><td>${emails || ''}</td><td>${escapeHtml(result.error || '')}</td></tr>`;
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
    setStatus(`Paused at ${state.current} of ${state.total}. Click Start / Resume to continue.`, 'error');
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

async function startOrResume() {
  const urls = input.value.split('\n').map((value) => value.trim()).filter(Boolean);
  const excludeEmails = parseExcludeList(excludeInput.value);
  const strictTimeoutSec = Math.max(1, Math.min(120, Number(strictTimeoutInput.value) || 10));
  strictTimeoutInput.value = String(strictTimeoutSec);

  await saveSettings();
  activeRequestId = crypto.randomUUID();

  startBtn.disabled = true;
  stopBtn.disabled = false;
  skipBtn.disabled = false;
  copyBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_OR_RESUME',
      requestId: activeRequestId,
      urls,
      excludeEmails,
      strictTimeoutSec
    });

    if (!response?.ok) throw new Error('Unexpected extension response.');

    const state = response.state || null;
    if (state) {
      applyStateToUi(state);
      if (state.status === 'done' && latestResults.length) {
        await copyResults(latestResults);
      }
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
}

startBtn.addEventListener('click', () => {
  startOrResume().catch(() => {
    setStatus('Failed to start/resume process.', 'error');
  });
});

stopBtn.addEventListener('click', () => {
  stopProcess().catch(() => {
    setStatus('Failed to stop process.', 'error');
  });
});

skipBtn.addEventListener('click', () => {
  skipCurrent().catch(() => {
    setStatus('Failed to skip current website.', 'error');
  });
});

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

excludeInput.addEventListener('blur', () => {
  saveSettings().catch(() => {
    // ignore settings save errors
  });
});

strictTimeoutInput.addEventListener('blur', () => {
  saveSettings().catch(() => {
    // ignore settings save errors
  });
});

Promise.all([loadSettings(), loadLatestState()]).catch(() => {
  // ignore bootstrap errors
});
