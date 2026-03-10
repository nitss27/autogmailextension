const chatUrlEl = document.getElementById("chatUrl");
const formUrlsEl = document.getElementById("formUrls");
const includeAllFieldsEl = document.getElementById("includeAllFields");
const autoSubmitEl = document.getElementById("autoSubmit");
const promptTextEl = document.getElementById("promptText");
const mappingTextEl = document.getElementById("mappingText");
const captureBtn = document.getElementById("captureBtn");
const copyPromptBtn = document.getElementById("copyPromptBtn");
const fillBtn = document.getElementById("fillBtn");
const runBtn = document.getElementById("runBtn");
const statusEl = document.getElementById("status");

const DEFAULT_CHAT_URL = "https://chatgpt.com/c/69afa3d3-0fac-8321-9c3f-9fbdd9be6715";

function setStatus(msg) {
  statusEl.textContent = msg;
}

function parseUrls(input) {
  return String(input || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function loadSettings() {
  const saved = await chrome.storage.local.get([
    "chatUrl",
    "formUrls",
    "autoSubmit",
    "includeAllFields",
    "promptText",
    "mappingText"
  ]);

  chatUrlEl.value = saved.chatUrl || DEFAULT_CHAT_URL;
  formUrlsEl.value = saved.formUrls || "";
  autoSubmitEl.checked = Boolean(saved.autoSubmit);
  includeAllFieldsEl.checked = Boolean(saved.includeAllFields);
  promptTextEl.value = saved.promptText || "";
  mappingTextEl.value = saved.mappingText || "";
}

async function saveSettings() {
  await chrome.storage.local.set({
    chatUrl: chatUrlEl.value.trim() || DEFAULT_CHAT_URL,
    formUrls: formUrlsEl.value,
    autoSubmit: autoSubmitEl.checked,
    includeAllFields: includeAllFieldsEl.checked,
    promptText: promptTextEl.value,
    mappingText: mappingTextEl.value
  });
}

captureBtn.addEventListener("click", async () => {
  try {
    setStatus("Capturing current tab inputs...");
    await saveSettings();

    const resp = await chrome.runtime.sendMessage({
      type: "MANUAL_GET_CAPTURE_FOR_ACTIVE_TAB",
      includeAllFields: includeAllFieldsEl.checked
    });

    if (!resp?.ok) throw new Error(resp?.error || "Capture failed");

    promptTextEl.value = resp.prompt || "";
    await saveSettings();
    setStatus(`Captured ${resp.fieldCount} fields. Copy prompt and paste into ChatGPT.`);
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
  }
});

copyPromptBtn.addEventListener("click", async () => {
  try {
    const txt = promptTextEl.value.trim();
    if (!txt) throw new Error("No prompt to copy. Capture first.");
    await navigator.clipboard.writeText(txt);
    setStatus("Prompt copied. Paste it into ChatGPT.");
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
  }
});

fillBtn.addEventListener("click", async () => {
  try {
    const mappingText = mappingTextEl.value.trim();
    if (!mappingText) throw new Error("Paste ChatGPT output first.");

    setStatus("Filling current form tab...");
    await saveSettings();

    const resp = await chrome.runtime.sendMessage({
      type: "MANUAL_FILL_ACTIVE_TAB_FROM_TEXT",
      mappingText,
      autoSubmit: autoSubmitEl.checked
    });

    if (!resp?.ok) throw new Error(resp?.error || "Fill failed");
    setStatus(resp.message || "Filled successfully.");
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
  }
});

runBtn.addEventListener("click", async () => {
  try {
    await saveSettings();
    const formUrls = parseUrls(formUrlsEl.value);
    if (!formUrls.length) throw new Error("Please enter at least one form URL.");

    setStatus(`Starting automation for ${formUrls.length} form(s)...`);

    const resp = await chrome.runtime.sendMessage({
      type: "AUTOMATE_FORM_LINKS",
      chatUrl: chatUrlEl.value.trim() || DEFAULT_CHAT_URL,
      formUrls,
      autoSubmit: autoSubmitEl.checked
    });

    if (!resp?.ok) throw new Error(resp?.error || "Automation failed");

    const lines = [
      `Done. Total: ${resp.summary.total}`,
      `Filled: ${resp.summary.filled}`,
      `Failed: ${resp.summary.failed}`,
      "",
      ...resp.summary.items.map((item) => `${item.ok ? "✅" : "❌"} ${item.url} - ${item.message}`)
    ];
    setStatus(lines.join("\n"));
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
  }
});

loadSettings();
