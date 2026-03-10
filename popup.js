const chatUrlEl = document.getElementById("chatUrl");
const formUrlsEl = document.getElementById("formUrls");
const maxCharsEl = document.getElementById("maxChars");
const autoSubmitEl = document.getElementById("autoSubmit");
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
  const saved = await chrome.storage.local.get(["chatUrl", "formUrls", "maxChars", "autoSubmit"]);
  chatUrlEl.value = saved.chatUrl || DEFAULT_CHAT_URL;
  formUrlsEl.value = saved.formUrls || "";
  maxCharsEl.value = String(saved.maxChars || 120000);
  autoSubmitEl.checked = Boolean(saved.autoSubmit);
}

async function saveSettings() {
  await chrome.storage.local.set({
    chatUrl: chatUrlEl.value.trim() || DEFAULT_CHAT_URL,
    formUrls: formUrlsEl.value,
    maxChars: Number(maxCharsEl.value || 120000),
    autoSubmit: autoSubmitEl.checked
  });
}

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
      maxHtmlChars: Number(maxCharsEl.value || 120000),
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
