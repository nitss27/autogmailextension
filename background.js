async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return tab;
    await sleep(200);
  }
  throw new Error("Timed out waiting for tab to load");
}

async function findOrOpenChatGPT(targetUrl) {
  const existing = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
  const matched = existing.find((tab) => tab.url && tab.url.startsWith(targetUrl));
  if (matched) return matched;
  return chrome.tabs.create({ url: targetUrl, active: false });
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (_error) {
    // Ignore: content script may already be injected or execution may be restricted on special pages.
  }
}

async function sendToTab(tabId, message, retries = 5) {
  let lastError = null;

  for (let i = 0; i < retries; i += 1) {
    try {
      await ensureContentScript(tabId);
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response;
    } catch (error) {
      lastError = error;
      await sleep(350);
    }
  }

  throw new Error(lastError?.message || "Could not communicate with tab content script.");
}

async function automateSingleForm({ url, chatTabId, maxHtmlChars, autoSubmit }) {
  const formTab = await chrome.tabs.create({ url, active: false });
  await waitForTabComplete(formTab.id);

  const capture = await sendToTab(formTab.id, {
    type: "CAPTURE_REQUIRED_FIELDS",
    maxHtmlChars
  });

  if (!capture?.requiredFields?.length) {
    return { ok: false, url, message: "No required fields found." };
  }

  await chrome.tabs.update(chatTabId, { active: true });
  await sendToTab(chatTabId, {
    type: "CHATGPT_SEND_AND_WAIT",
    promptText: capture.prompt,
    timeoutMs: 120000
  });

  const extraction = await sendToTab(chatTabId, {
    type: "CHATGPT_EXTRACT_MAPPINGS"
  });

  if (!extraction?.mappingText) {
    return { ok: false, url, message: "Could not extract mappings from ChatGPT response." };
  }

  await chrome.tabs.update(formTab.id, { active: true });
  const fill = await sendToTab(formTab.id, {
    type: "FILL_FROM_MAPPING_TEXT",
    mappingText: extraction.mappingText,
    autoSubmit
  });

  if (!fill?.ok) {
    return { ok: false, url, message: fill?.error || "Fill failed" };
  }

  return {
    ok: true,
    url,
    message: `Filled ${fill.filled}/${fill.total}${fill.submitted ? " and submitted" : ""}.`
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type !== "AUTOMATE_FORM_LINKS") {
      throw new Error("Unsupported message type");
    }

    const formUrls = Array.isArray(message.formUrls) ? message.formUrls : [];
    if (!formUrls.length) throw new Error("No form URLs provided.");

    const chatTab = await findOrOpenChatGPT(message.chatUrl);
    await waitForTabComplete(chatTab.id);

    const items = [];
    for (const url of formUrls) {
      try {
        const result = await automateSingleForm({
          url,
          chatTabId: chatTab.id,
          maxHtmlChars: Number(message.maxHtmlChars || 120000),
          autoSubmit: Boolean(message.autoSubmit)
        });
        items.push(result);
      } catch (error) {
        items.push({ ok: false, url, message: error.message || String(error) });
      }
    }

    const summary = {
      total: items.length,
      filled: items.filter((x) => x.ok).length,
      failed: items.filter((x) => !x.ok).length,
      items
    };

    sendResponse({ ok: true, summary });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });

  return true;
});
