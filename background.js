async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_CHAT_URL = "https://chatgpt.com/c/69afa3d3-0fac-8321-9c3f-9fbdd9be6715";

async function getChatUrlFromSettings() {
  const data = await chrome.storage.local.get(["chatUrl"]);
  return data.chatUrl || DEFAULT_CHAT_URL;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
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

async function findOpenChatGPTTab(targetUrl) {
  const existing = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
  const matched = existing.find((tab) => tab.url && tab.url.startsWith(targetUrl));
  if (matched) return matched;

  throw new Error(
    "ChatGPT tab is not already open. Please open the target ChatGPT conversation tab first, then run automation."
  );
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

async function runCaptureAndPromptFlow({ sourceTabId, maxHtmlChars, includeAllFields = false }) {
  const chatUrl = await getChatUrlFromSettings();
  const chatTab = await findOpenChatGPTTab(chatUrl);
  await waitForTabComplete(chatTab.id);

  const capture = await sendToTab(sourceTabId, {
    type: "CAPTURE_REQUIRED_FIELDS",
    includeAllFields,
    maxHtmlChars
  });

  if (!capture?.requiredFields?.length) {
    return { ok: false, message: "No required fields found on this page." };
  }

  await chrome.tabs.update(chatTab.id, { active: true });
  await sendToTab(chatTab.id, {
    type: "CHATGPT_SEND_AND_WAIT",
    promptText: capture.prompt,
    timeoutMs: 120000
  });

  await chrome.tabs.update(sourceTabId, { active: true });
  return { ok: true, message: `Sent ${capture.requiredFields.length} fields to ChatGPT and got response.` };
}

async function runFillFromLatestChatResponse({ sourceTabId, autoSubmit }) {
  const chatUrl = await getChatUrlFromSettings();
  const chatTab = await findOpenChatGPTTab(chatUrl);
  await waitForTabComplete(chatTab.id);

  const extraction = await sendToTab(chatTab.id, {
    type: "CHATGPT_EXTRACT_MAPPINGS"
  });

  if (!extraction?.mappingText) {
    return { ok: false, message: "Could not extract xpath/value output from ChatGPT tab." };
  }

  await chrome.tabs.update(sourceTabId, { active: true });
  const fill = await sendToTab(sourceTabId, {
    type: "FILL_FROM_MAPPING_TEXT",
    mappingText: extraction.mappingText,
    autoSubmit: Boolean(autoSubmit)
  });

  if (!fill?.ok) {
    return { ok: false, message: fill?.error || "Fill failed." };
  }

  return {
    ok: true,
    message: `Filled ${fill.filled}/${fill.total}${fill.submitted ? " and submitted" : ""}.`
  };
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "AUTOMATE_FORM_LINKS") {
      const formUrls = Array.isArray(message.formUrls) ? message.formUrls : [];
      if (!formUrls.length) throw new Error("No form URLs provided.");

      const chatTab = await findOpenChatGPTTab(message.chatUrl);
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
      return;
    }

    if (message?.type === "MANUAL_CAPTURE_AND_SEND") {
      const sourceTabId = sender?.tab?.id;
      if (!sourceTabId) throw new Error("Source tab not found.");
      const result = await runCaptureAndPromptFlow({
        sourceTabId,
        maxHtmlChars: Number(message.maxHtmlChars || 120000),
        includeAllFields: Boolean(message.includeAllFields)
      });
      sendResponse(result);
      return;
    }

    if (message?.type === "MANUAL_FILL_FROM_CHATGPT") {
      const sourceTabId = sender?.tab?.id;
      if (!sourceTabId) throw new Error("Source tab not found.");
      const result = await runFillFromLatestChatResponse({ sourceTabId, autoSubmit: Boolean(message.autoSubmit) });
      sendResponse(result);
      return;
    }

    if (message?.type === "MANUAL_GET_CAPTURE_FOR_ACTIVE_TAB") {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error("No active tab found.");

      const capture = await sendToTab(tab.id, {
        type: "CAPTURE_REQUIRED_FIELDS",
        includeAllFields: Boolean(message.includeAllFields)
      });

      sendResponse({
        ok: true,
        fieldCount: capture?.requiredFields?.length || 0,
        prompt: capture?.prompt || ""
      });
      return;
    }

    if (message?.type === "MANUAL_FILL_ACTIVE_TAB_FROM_TEXT") {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error("No active tab found.");

      const fill = await sendToTab(tab.id, {
        type: "FILL_FROM_MAPPING_TEXT",
        mappingText: message.mappingText || "",
        autoSubmit: Boolean(message.autoSubmit)
      });

      if (!fill?.ok) {
        sendResponse({ ok: false, error: fill?.error || "Fill failed." });
        return;
      }

      sendResponse({
        ok: true,
        message: `Filled ${fill.filled}/${fill.total}${fill.submitted ? " and submitted" : ""}.`
      });
      return;
    }

    throw new Error("Unsupported message type");
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });

  return true;
});
