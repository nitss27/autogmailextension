(function () {
  const SELECTORS = {
    composerInput: [
      'div[contenteditable="true"][aria-label="Enter a prompt for Gemini"]',
      'rich-textarea .ql-editor[contenteditable="true"]',
      'div[contenteditable="true"]'
    ],
    sendButton: [
      'button[aria-label="Send message"]:not([aria-disabled="true"])',
      'button.send-button[aria-label*="Send"]:not([aria-disabled="true"])',
      'button[aria-label*="Send"]:not([aria-disabled="true"])'
    ],
    stopButton: [
      'button[aria-label*="Stop"]',
      'button[mattooltip*="Stop"]'
    ],
    plusButton: [
      'button[aria-label="Open upload file menu"]',
      'uploader button.upload-card-button',
      'button[aria-controls="upload-file-menu"]'
    ],
    uploadMenuButton: [
      'button[data-test-id="local-images-files-uploader-button"]',
      'button[aria-label*="Upload files"]',
      'images-files-uploader button[data-test-id="local-images-files-uploader-button"]'
    ],
    hiddenImageUploadButton: [
      'button[data-test-id="hidden-local-image-upload-button"]',
      'button.hidden-local-upload-button[xapfileselectortrigger]'
    ],
    dropzone: '[xapfileselectordropzone]',
    fileInput: 'input[type="file"]',
    messageContainers: '[class*="container_b7e1cb"], [class*="messageContent"]',
    downloadLinks: 'a[aria-label="Download"]'
  };

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  }

  function queryDeep(selector, root = document) {
    const direct = root.querySelector(selector);
    if (direct) return direct;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.shadowRoot) {
        const nested = queryDeep(selector, node.shadowRoot);
        if (nested) return nested;
      }
    }
    return null;
  }

  function findFirstVisible(selectors) {
    const arr = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of arr) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (isVisible(node)) {
          return node;
        }
      }
    }
    return null;
  }

  async function waitForSelector(selectors, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = findFirstVisible(selectors);
      if (el) return el;
      await delay(120);
    }
    throw new Error(`Timeout waiting for: ${Array.isArray(selectors) ? selectors.join(' | ') : selectors}`);
  }

  async function waitForFileInput(timeoutMs = 7000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const input = queryDeep(SELECTORS.fileInput);
      if (input) return input;
      await delay(100);
    }
    return null;
  }

  function clickElement(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.click();
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

  function dataUrlToFile(dataUrl, name, type) {
    const [meta, data] = dataUrl.split(',');
    const mime = type || (meta.match(/data:(.*?);base64/) || [])[1] || 'image/png';
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name || 'image.png', { type: mime });
  }

  function uploadViaDropzone(file) {
    const zone = findFirstVisible(SELECTORS.dropzone);
    if (!zone) return false;

    const dt = new DataTransfer();
    dt.items.add(file);

    ['dragenter', 'dragover', 'drop'].forEach((type) => {
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt
      });
      zone.dispatchEvent(event);
    });
    return true;
  }

  async function openUploadMenu() {
    const plusBtn = await waitForSelector(SELECTORS.plusButton, 12000);
    clickElement(plusBtn);
    await delay(400);

    const uploadBtn = await waitForSelector(SELECTORS.uploadMenuButton, 12000);
    clickElement(uploadBtn);
    await delay(500);

    const hiddenUploadTrigger = findFirstVisible(SELECTORS.hiddenImageUploadButton);
    if (hiddenUploadTrigger) {
      clickElement(hiddenUploadTrigger);
    }
  }

  async function attachFile(fileLike) {
    const file = fileLike instanceof File
      ? fileLike
      : dataUrlToFile(fileLike.dataUrl, fileLike.name, fileLike.type);

    await openUploadMenu();

    const input = await waitForFileInput(7000);
    if (input) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await delay(1800);
      return;
    }

    const dropped = uploadViaDropzone(file);
    if (dropped) {
      await delay(1800);
      return;
    }

    throw new Error('Could not find file input or dropzone after clicking Upload files.');
  }

  async function sendCurrentPromptAndWait() {
    const sendBtn = await waitForSelector(SELECTORS.sendButton, 10000);
    clickElement(sendBtn);

    await delay(1800);
    while (findFirstVisible(SELECTORS.stopButton)) {
      await delay(1000);
    }
  }

  async function runBatch(files, prompts, delayMs) {
    if (!Array.isArray(files) || files.length === 0) throw new Error('No files received by content script.');

    console.clear();
    console.log('%c🤖 Gemini Image Edit Batch Processor', 'color: lime; font-weight: bold;');

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const prompt = prompts[i] || prompts[prompts.length - 1];
      const fileName = file?.name || `image_${i + 1}.png`;

      console.log(`
🟩 Item ${i + 1}/${files.length}: ${fileName}`);
      await attachFile(file);
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
