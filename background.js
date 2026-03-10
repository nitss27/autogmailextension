async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function findOrOpenChatGPT(targetUrl) {
  const existing = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
  const matched = existing.find((tab) => tab.url && tab.url.startsWith(targetUrl));
  if (matched) {
    await chrome.tabs.update(matched.id, { active: true });
    if (matched.windowId) await chrome.windows.update(matched.windowId, { focused: true });
    return matched;
  }

  const tab = await chrome.tabs.create({ url: targetUrl, active: true });
  return tab;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "CAPTURE_AND_SEND") {
      const sourceTab = await getActiveTab();
      if (!sourceTab?.id) throw new Error("No active tab found.");

      const capture = await sendToTab(sourceTab.id, {
        type: "CAPTURE_REQUIRED_FIELDS",
        maxHtmlChars: message.maxHtmlChars || 120000
      });

      const chatTab = await findOrOpenChatGPT(message.chatUrl);
      if (!chatTab?.id) throw new Error("Unable to open ChatGPT tab.");

      await chrome.tabs.update(chatTab.id, { active: true });

      await sendToTab(chatTab.id, {
        type: "INSERT_PROMPT_IN_CHATGPT",
        promptText: capture.prompt
      });

      sendResponse({ ok: true, fieldCount: capture.requiredFields.length, sourceUrl: capture.url });
      return;
    }

    if (message?.type === "FILL_CURRENT_TAB") {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error("No active tab found.");

      const result = await sendToTab(tab.id, {
        type: "FILL_FROM_MAPPING_TEXT",
        mappingText: message.mappingText
      });

      sendResponse({ ok: true, result });
      return;
    }

    throw new Error("Unsupported message type");
  })()
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });

  return true;
});
