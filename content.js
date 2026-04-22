(function () {
  const SELECTORS = {
    composerInput: 'div[contenteditable="true"]',
    sendButton: 'button[aria-label*="Send message"]',
    stopButton: 'button[aria-label*="Stop"]',
    attachToggle: 'span.mat-mdc-button-touch-target',
    uploadMenuButton: '[data-test-id="local-images-files-uploader-button"]',
    fileInput: 'input[type="file"]',
    messageContainers: '[class*="container_b7e1cb"], [class*="messageContent"]',
    downloadLinks: 'a[aria-label="Download"]'
  };

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitForSelector(selector, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await delay(100);
    }
    throw new Error(`Timeout waiting for: ${selector}`);
  }

  async function clearAndType(text) {
    const input = await waitForSelector(SELECTORS.composerInput, 10000);
    input.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function setSingleFile(file) {
    // User-requested click flow
    const attachTarget = await waitForSelector(SELECTORS.attachToggle, 10000);
    attachTarget.click();
    await delay(300);

    const uploadBtn = await waitForSelector(SELECTORS.uploadMenuButton, 10000);
    uploadBtn.click();
    await delay(500);

    const input = await waitForSelector(SELECTORS.fileInput, 15000);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await delay(1200);
  }

  async function sendCurrentPromptAndWait() {
    const sendBtn = await waitForSelector(SELECTORS.sendButton, 10000);
    if (sendBtn.disabled) throw new Error('Send button is disabled.');
    sendBtn.click();

    await delay(1500);
    while (document.querySelector(SELECTORS.stopButton)) {
      await delay(1000);
    }
  }

  async function runBatch(files, prompts, delayMs) {
    console.clear();
    console.log('%c🤖 Gemini Image Edit Batch Processor', 'color: lime; font-weight: bold;');
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const prompt = prompts[i] || prompts[prompts.length - 1];
      console.log(`\n🟩 Item ${i + 1}/${files.length}: ${file.name}`);

      await setSingleFile(file);
      await clearAndType(prompt);
      await delay(500);
      await sendCurrentPromptAndWait();
      console.log('✅ Completed item.');
      await delay(delayMs);
    }
    console.log('%c🎉 All prompts completed!', 'color: cyan; font-weight: bold;');
  }

  async function downloadByPrompts(promptList) {
    const prompts = promptList
      .map((p) => p.trim().replace(/^["']|["'],?$/g, ''))
      .filter(Boolean);

    const containers = document.querySelectorAll(SELECTORS.messageContainers);
    let matchCount = 0;

    const downloadWithRename = async (url, filename) => {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch {
        window.open(url, '_blank');
      }
    };

    for (const fullPrompt of prompts) {
      const words = fullPrompt.split(/\s+/);
      const fileNameBase = words.slice(0, 2).join('_').replace(/[^a-z0-9_]/gi, '') || 'output';
      const searchStr = fullPrompt.substring(0, 15).toLowerCase().trim();

      containers.forEach((container) => {
        if (container.innerText.toLowerCase().includes(searchStr)) {
          const parent = container.closest('[class*="container_b7e1cb"]') || container;
          const links = parent.querySelectorAll(SELECTORS.downloadLinks);
          if (links.length) {
            parent.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
            links.forEach((link, index) => {
              matchCount += 1;
              const filename = `${fileNameBase}_${index + 1}.png`;
              setTimeout(() => downloadWithRename(link.href, filename), matchCount * 1000);
            });
          }
        }
      });
    }

    return matchCount;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'RUN_IMAGE_EDIT_BATCH') {
      runBatch(message.files || [], message.prompts || [], message.delayMs || 1500)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error('Batch failed:', err);
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    if (message?.type === 'DOWNLOAD_BY_PROMPTS') {
      downloadByPrompts(message.prompts || [])
        .then((count) => {
          if (!count) {
            sendResponse({ ok: true, message: 'No matches found. Scroll older messages and retry.' });
            return;
          }
          sendResponse({ ok: true, message: `Triggered ${count} download(s).` });
        })
        .catch((err) => sendResponse({ ok: false, message: err.message }));
      return true;
    }

    return undefined;
  });
})();
