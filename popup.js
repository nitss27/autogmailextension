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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed reading file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function serializeFiles(files) {
  const out = [];
  for (const file of files) {
    out.push({
      name: file.name,
      type: file.type || 'image/png',
      dataUrl: await fileToDataUrl(file)
    });
  }
  return out;
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

    setStatus(`Preparing ${files.length} image(s)...`);
    const serializedFiles = await serializeFiles(files);

    setStatus(`Starting ${serializedFiles.length} image(s)...`);
    const result = await sendMessage({
      type: 'RUN_IMAGE_EDIT_BATCH',
      files: serializedFiles,
      prompts,
      delayMs
    });

    if (result?.ok === false) {
      setStatus(`Batch failed: ${result.error || 'unknown error'}`);
      return;
    }

    setStatus('Batch completed. Check page console for details.');
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
