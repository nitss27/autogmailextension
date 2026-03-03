const input = document.getElementById('websiteInput');
const processBtn = document.getElementById('processBtn');
const copyBtn = document.getElementById('copyBtn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

let latestResults = [];

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function resultTableRows(results) {
  return results
    .map((result) => {
      const emails = result.emails.length > 0 ? result.emails.join('<br>') : '<span class="small">No emails found</span>';
      const contacts = result.contactLinks.length;
      const errorLine = result.error ? `<div class="small">Error: ${result.error}</div>` : '';

      return `<tr>
        <td>${result.domain}${errorLine}</td>
        <td>${emails}</td>
        <td>${contacts}</td>
      </tr>`;
    })
    .join('');
}

function renderResults(results) {
  if (!results.length) {
    resultsEl.innerHTML = '';
    return;
  }

  resultsEl.innerHTML = `<table>
    <thead>
      <tr>
        <th>Domain</th>
        <th>Emails</th>
        <th>Contact URLs</th>
      </tr>
    </thead>
    <tbody>
      ${resultTableRows(results)}
    </tbody>
  </table>`;
}

function toClipboardTable(results) {
  const headers = ['Domain', 'Emails', 'Contact URLs Found', 'Error'];
  const rows = results.map((result) => [
    result.domain,
    result.emails.join(', '),
    String(result.contactLinks.length),
    result.error || ''
  ]);

  return [headers, ...rows].map((row) => row.join('\t')).join('\n');
}

async function copyResults(results) {
  const content = toClipboardTable(results);
  await navigator.clipboard.writeText(content);
}

async function processWebsites() {
  const urls = input.value
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!urls.length) {
    setStatus('Please enter at least one website.', 'error');
    return;
  }

  setStatus('Processing websites...');
  processBtn.disabled = true;
  copyBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'PROCESS_URLS', urls });

    if (!response?.ok) {
      throw new Error('Unexpected extension response.');
    }

    latestResults = response.results || [];
    renderResults(latestResults);

    if (latestResults.length > 0) {
      await copyResults(latestResults);
      copyBtn.disabled = false;
      setStatus(`Done. Processed ${latestResults.length} website(s). Table copied to clipboard.`, 'success');
    } else {
      setStatus('No valid websites were provided.', 'error');
    }
  } catch (error) {
    setStatus(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  } finally {
    processBtn.disabled = false;
  }
}

processBtn.addEventListener('click', processWebsites);
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
