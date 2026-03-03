const input = document.getElementById('websiteInput');
const maxTabsAtTimeInput = document.getElementById('maxTabsAtTime');
const processBtn = document.getElementById('processBtn');
const copyBtn = document.getElementById('copyBtn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

let latestResults = [];

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function renderResults(results) {
  if (!results.length) {
    resultsEl.innerHTML = '';
    return;
  }

  const rows = results
    .map((result) => {
      const renderedEmails = result.renderedEmails?.length ? result.renderedEmails.join('<br>') : '<span class="small">None</span>';
      const sourceEmails = result.sourceEmails?.length ? result.sourceEmails.join('<br>') : '<span class="small">None</span>';
      const allEmails = result.emails?.length ? result.emails.join('<br>') : '<span class="small">No emails found</span>';
      const contacts = result.contactLinks.length;
      const errorLine = result.error ? `<div class="small">Error: ${result.error}</div>` : '';

      return `<tr>
        <td>${result.domain}${errorLine}</td>
        <td>${renderedEmails}</td>
        <td>${sourceEmails}</td>
        <td>${allEmails}</td>
        <td>${contacts}</td>
      </tr>`;
    })
    .join('');

  resultsEl.innerHTML = `<table>
    <thead>
      <tr>
        <th>Domain</th>
        <th>Rendered Emails</th>
        <th>Source Emails (home+contact view-source)</th>
        <th>All Emails</th>
        <th>Contact URLs</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function toClipboardTable(results) {
  const headers = ['Domain', 'Rendered Emails', 'Source Emails', 'All Emails', 'Contact URLs Found', 'Error'];
  const rows = results.map((result) => [
    result.domain,
    (result.renderedEmails || []).join(', '),
    (result.sourceEmails || []).join(', '),
    (result.emails || []).join(', '),
    String(result.contactLinks.length),
    result.error || ''
  ]);

  return [headers, ...rows].map((row) => row.join('\t')).join('\n');
}

async function copyResults(results) {
  await navigator.clipboard.writeText(toClipboardTable(results));
}

async function processWebsites() {
  const urls = input.value
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);

  const maxTabsAtTime = Math.max(1, Math.min(20, Number(maxTabsAtTimeInput.value) || 5));
  maxTabsAtTimeInput.value = String(maxTabsAtTime);

  if (!urls.length) {
    setStatus('Please enter at least one website.', 'error');
    return;
  }

  setStatus(`Processing ${urls.length} websites (batch size: ${maxTabsAtTime})...`);
  processBtn.disabled = true;
  copyBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'PROCESS_URLS', urls, maxTabsAtTime });

    if (!response?.ok) {
      throw new Error('Unexpected extension response.');
    }

    latestResults = response.results || [];
    renderResults(latestResults);

    if (latestResults.length) {
      await copyResults(latestResults);
      copyBtn.disabled = false;
      setStatus(`Done. Processed ${latestResults.length} website(s). Results copied to clipboard.`, 'success');
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
