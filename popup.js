const statusEl = document.getElementById('status');
const promptsEl = document.getElementById('prompts');
const delayEl = document.getElementById('delay');
const imagesEl = document.getElementById('images');

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  return tab.id;
}

function parsePrompts() {
  return promptsEl.value
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

async function sendMessage(payload) {
  const tabId = await getActiveTabId();
  return chrome.tabs.sendMessage(tabId, payload);
}

document.getElementById('run').addEventListener('click', async () => {
  try {
    const prompts = parsePrompts();
    const files = Array.from(imagesEl.files || []);
    const delayMs = Math.max(500, Number(delayEl.value) || 1500);

    if (!files.length) {
      setStatus('Select at least 1 image.');
      return;
    }
    if (!prompts.length) {
      setStatus('Add at least 1 prompt.');
      return;
    }

    setStatus(`Starting ${files.length} image(s)...`);
    await sendMessage({ type: 'RUN_IMAGE_EDIT_BATCH', files, prompts, delayMs });
    setStatus('Batch started. Check page console for progress.');
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});

document.getElementById('download').addEventListener('click', async () => {
  try {
    const prompts = parsePrompts();
    if (!prompts.length) {
      setStatus('Add prompts first to match generated items.');
      return;
    }
    const result = await sendMessage({ type: 'DOWNLOAD_BY_PROMPTS', prompts });
    setStatus(result?.message || 'Download command sent.');
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});
