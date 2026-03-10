const chatUrlEl = document.getElementById("chatUrl");
const maxCharsEl = document.getElementById("maxChars");
const mappingTextEl = document.getElementById("mappingText");
const captureSendBtn = document.getElementById("captureSendBtn");
const fillBtn = document.getElementById("fillBtn");
const statusEl = document.getElementById("status");

const DEFAULT_CHAT_URL = "https://chatgpt.com/c/69afa3d3-0fac-8321-9c3f-9fbdd9be6715";

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function loadSettings() {
  const saved = await chrome.storage.local.get(["chatUrl", "maxChars", "mappingText"]);
  chatUrlEl.value = saved.chatUrl || DEFAULT_CHAT_URL;
  maxCharsEl.value = String(saved.maxChars || 120000);
  mappingTextEl.value = saved.mappingText || "";
}

async function saveSettings() {
  await chrome.storage.local.set({
    chatUrl: chatUrlEl.value.trim() || DEFAULT_CHAT_URL,
    maxChars: Number(maxCharsEl.value || 120000),
    mappingText: mappingTextEl.value
  });
}

captureSendBtn.addEventListener("click", async () => {
  try {
    setStatus("Capturing form HTML and required fields...");
    await saveSettings();

    const resp = await chrome.runtime.sendMessage({
      type: "CAPTURE_AND_SEND",
      chatUrl: chatUrlEl.value.trim() || DEFAULT_CHAT_URL,
      maxHtmlChars: Number(maxCharsEl.value || 120000)
    });

    if (!resp?.ok) throw new Error(resp?.error || "Unknown error");
    setStatus(`Sent to ChatGPT. Required fields found: ${resp.fieldCount}. URL: ${resp.sourceUrl}`);
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
  }
});

fillBtn.addEventListener("click", async () => {
  try {
    const mappingText = mappingTextEl.value.trim();
    if (!mappingText) throw new Error("Please paste ChatGPT TSV output first.");

    await saveSettings();
    setStatus("Filling current form tab...");

    const resp = await chrome.runtime.sendMessage({
      type: "FILL_CURRENT_TAB",
      mappingText
    });

    if (!resp?.ok) throw new Error(resp?.error || "Unknown error");
    setStatus(`Filled ${resp.result.filled}/${resp.result.total} mapped fields.`);
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
  }
});

loadSettings();
