function getLabelForField(field) {
  if (field.id) {
    const label = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    if (label) return label.textContent?.trim() || "";
  }

  const wrapped = field.closest("label");
  if (wrapped) return wrapped.textContent?.trim() || "";

  return field.getAttribute("aria-label") || field.getAttribute("placeholder") || "";
}

function getXPath(el) {
  if (el.id) return `//*[@id="${el.id}"]`;
  if (el.name) return `//*[@name="${el.name}"]`;

  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === Node.ELEMENT_NODE && cur !== document.body) {
    let idx = 1;
    let sib = cur.previousElementSibling;
    while (sib) {
      if (sib.tagName === cur.tagName) idx += 1;
      sib = sib.previousElementSibling;
    }
    parts.unshift(`${cur.tagName.toLowerCase()}[${idx}]`);
    cur = cur.parentElement;
  }
  return `/${parts.join("/")}`;
}

function serializeFields(includeAllFields = false) {
  const fields = Array.from(document.querySelectorAll("input, textarea, select")).filter((el) => {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "file"].includes(type)) return false;
    return includeAllFields || el.required || el.getAttribute("aria-required") === "true";
  });

  return fields.map((field) => ({
    xpath: getXPath(field),
    id: field.id || "",
    name: field.name || "",
    tag: field.tagName.toLowerCase(),
    type: (field.getAttribute("type") || "").toLowerCase(),
    label: getLabelForField(field),
    options:
      field.tagName.toLowerCase() === "select"
        ? Array.from(field.options)
            .map((o) => o.textContent.trim())
            .filter(Boolean)
            .slice(0, 50)
        : []
  }));
}

function buildPrompt(requiredFields, url) {
  const compactFields = requiredFields.map((field) => ({
    xpath: field.xpath,
    name: field.name,
    id: field.id,
    label: field.label,
    tag: field.tag,
    type: field.type,
    options: field.options
  }));

  return [
    "Fill this form using realistic candidate values.",
    `Form URL: ${url}`,
    "",
    "Return ONLY plain TSV with exact header:",
    "xpath	value",
    "",
    "Rules:",
    "1) Include one row for each field below.",
    "2) Keep xpath exactly unchanged.",
    "3) For selects, choose only from provided options.",
    "4) Do not return markdown, mailto links, or explanations.",
    "5) If unsure, return a safe placeholder value.",
    "",
    "Field metadata:",
    JSON.stringify(compactFields, null, 2)
  ].join("\n");
}

function evaluateXPath(xpath) {
  try {
    return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  } catch (_error) {
    return null;
  }
}

function fillField(el, value) {
  const tag = el.tagName.toLowerCase();
  const str = String(value || "").trim();

  if (tag === "select") {
    const options = Array.from(el.options);
    const byValue = options.find((o) => o.value.toLowerCase() === str.toLowerCase());
    const byText = options.find((o) => o.textContent.trim().toLowerCase() === str.toLowerCase());
    const opt = byValue || byText;
    if (opt) el.value = opt.value;
  } else if (el.type === "checkbox" || el.type === "radio") {
    el.checked = ["yes", "true", "1", "checked"].includes(str.toLowerCase());
  } else {
    el.focus();
    el.value = str;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function normalizeMappingText(text) {
  let out = String(text || "").trim();
  if (!out) return "";
  out = out.replace(/\r\n/g, "\n");
  if (out.includes("\\n")) out = out.replace(/\\n/g, "\n");
  return out;
}

function cleanValue(value) {
  let out = String(value || "").trim();
  const markdownLink = out.match(/^\[(.*?)\]\((.*?)\)$/);
  if (markdownLink) {
    const label = markdownLink[1] || "";
    const href = markdownLink[2] || "";
    if (/^mailto:/i.test(href)) {
      out = href.replace(/^mailto:/i, "").trim() || label.trim();
    } else {
      out = label.trim() || href.trim();
    }
  }
  out = out.replace(/^['"]|['"]$/g, "");
  return out;
}

function normalizeXPath(xpathRaw) {
  let xpath = String(xpathRaw || "").trim();
  if (!xpath) return "";

  if (/^\/\/\[/.test(xpath)) xpath = `//*${xpath.slice(2)}`;
  if (/^\/\*\*\[@/.test(xpath)) xpath = xpath.replace(/^\/\*\*/, "//*");
  xpath = xpath.replace(/^[-•\"']+\s*/, "").trim();
  return xpath;
}

function parseLineToMapping(line) {
  const clean = String(line || "").trim();
  if (!clean || /^xpath\s+value$/i.test(clean) || /^xpath\tvalue$/i.test(clean)) return null;

  if (clean.includes("\t")) {
    const [left, ...rest] = clean.split("\t");
    const xpath = normalizeXPath(left);
    const value = cleanValue(rest.join("\t"));
    if (xpath && value) return { xpath, value };
  }

  const m = clean.match(/^(\/\/[\S]+|\/\*[\S]+)\s{2,}(.+)$/);
  if (m) {
    const xpath = normalizeXPath(m[1]);
    const value = cleanValue(m[2]);
    if (xpath && value) return { xpath, value };
  }

  return null;
}

function parseMappingText(mappingText) {
  const normalized = normalizeMappingText(mappingText);
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows = [];
  for (const line of lines) {
    const parsed = parseLineToMapping(line);
    if (parsed) rows.push(parsed);
  }
  return rows;
}


function getChatEditor() {
  return (
    document.querySelector("#prompt-textarea") ||
    document.querySelector("textarea[data-testid='prompt-textarea']") ||
    document.querySelector("[contenteditable='true']")
  );
}

function getChatSubmitButton() {
  return (
    document.querySelector('button[id="composer-submit-button"]:not([data-testid="stop-button"])') ||
    document.querySelector("button[data-testid='send-button']") ||
    document.querySelector("button[aria-label*='Send']")
  );
}

function getStopButton() {
  return document.querySelector('button[aria-label="Stop streaming"], button[data-testid="stop-button"]');
}


async function waitForChatEditor(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const editor = getChatEditor();
    if (editor) return editor;
    await sleep(300);
  }
  return null;
}

function isSubmitReady(button) {
  if (!button) return false;
  if (button.disabled) return false;
  if (button.getAttribute("aria-disabled") === "true") return false;
  if (button.getAttribute("data-testid") === "stop-button") return false;
  if ((button.getAttribute("aria-label") || "").toLowerCase().includes("stop streaming")) return false;
  return true;
}

async function waitForSendButtonReady(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getStopButton()) {
      await sleep(500);
      continue;
    }

    const button = getChatSubmitButton();
    if (isSubmitReady(button)) return button;
    await sleep(250);
  }
  return null;
}

function setEditorText(editor, text) {
  editor.focus();
  const value = String(text || "");

  if (editor.tagName.toLowerCase() === "textarea") {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) {
      setter.call(editor, value);
    } else {
      editor.value = value;
    }
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  editor.textContent = "";
  const inserted = document.execCommand("insertText", false, value);
  if (!inserted) {
    editor.textContent = value;
  }
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilNotStreaming(timeoutMs = 120000) {
  const start = Date.now();
  let sawStreaming = false;

  while (Date.now() - start < timeoutMs) {
    const stop = getStopButton();
    if (stop) {
      sawStreaming = true;
      await sleep(1200);
      continue;
    }

    if (sawStreaming) {
      await sleep(1000);
      return true;
    }

    await sleep(700);
  }

  return !getStopButton();
}

function parseAssistantTablesToTsv() {
  const tables = document.querySelectorAll("article table, main table, table");
  let output = "xpath\tvalue\n";
  let count = 0;

  tables.forEach((table) => {
    const rows = table.querySelectorAll("tr");
    rows.forEach((row) => {
      const cells = row.querySelectorAll("td,th");
      if (cells.length < 2) return;
      const left = (cells[0].textContent || "").trim();
      const right = (cells[1].textContent || "").trim().replace(/\n/g, " ");
      if (!left || !right) return;
      if (left.toLowerCase() === "xpath" && right.toLowerCase() === "value") return;
      if (left.startsWith("/") || left.startsWith("//*[@")) {
        output += `${left}\t${right}\n`;
        count += 1;
      }
    });
  });

  return count > 0 ? output.trim() : "";
}

function parseAssistantCodeBlockTsv() {
  const blocks = Array.from(document.querySelectorAll("article pre code, main pre code, pre code"));
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const text = (blocks[i].textContent || "").trim();
    if (!text) continue;
    if (/^xpath\tvalue/im.test(text) || /\*\[@id=/.test(text)) {
      return text;
    }
  }
  return "";
}

function getLatestAssistantText() {
  const messages = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
  const latest = messages[messages.length - 1];
  if (!latest) return "";

  const md = latest.querySelector('.markdown');
  return normalizeMappingText((md || latest).innerText || (md || latest).textContent || "");
}

function parseAssistantPlainTextTsv() {
  const text = getLatestAssistantText() || normalizeMappingText(document.body.innerText);
  if (!text) return "";

  const rawLines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const lines = [];

  for (const line of rawLines) {
    if (/^xpath\s+value$/i.test(line) || /^xpath\tvalue$/i.test(line)) {
      lines.push("xpath\tvalue");
      continue;
    }

    const parsed = parseLineToMapping(line);
    if (parsed) lines.push(`${parsed.xpath}\t${parsed.value}`);
  }

  if (!lines.length) return "";
  if (!/^xpath\tvalue$/i.test(lines[0])) lines.unshift("xpath\tvalue");
  return lines.join("\n");
}


function maybeSubmitForm() {
  const submit =
    document.querySelector("button[type='submit']") ||
    document.querySelector("input[type='submit']") ||
    document.querySelector("button[id*='submit']");

  if (!submit) return false;
  submit.click();
  return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "CAPTURE_REQUIRED_FIELDS") {
      const requiredFields = serializeFields(Boolean(message.includeAllFields));
      sendResponse({
        url: location.href,
        requiredFields,
        prompt: buildPrompt(requiredFields, location.href)
      });
      return;
    }

    if (message?.type === "CHATGPT_SEND_AND_WAIT") {
      const editor = await waitForChatEditor(30000);
      if (!editor) throw new Error("ChatGPT input box not found.");

      setEditorText(editor, message.promptText || "");
      await sleep(250);

      const submit = await waitForSendButtonReady(25000);
      if (!submit) throw new Error("ChatGPT send button not ready.");
      submit.click();

      const done = await waitUntilNotStreaming(Number(message.timeoutMs || 120000));
      if (!done) throw new Error("Timed out waiting for ChatGPT response.");

      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "CHATGPT_EXTRACT_MAPPINGS") {
      const codeTsv = parseAssistantCodeBlockTsv();
      const tableTsv = codeTsv ? "" : parseAssistantTablesToTsv();
      const plainTsv = codeTsv || tableTsv ? "" : parseAssistantPlainTextTsv();
      const mappingText = codeTsv || tableTsv || plainTsv;
      sendResponse({ ok: true, mappingText });
      return;
    }

    if (message?.type === "FILL_FROM_MAPPING_TEXT") {
      const mappings = parseMappingText(message.mappingText);
      if (!mappings.length) throw new Error("No valid mapping rows found.");

      let filled = 0;
      for (const row of mappings) {
        const el = evaluateXPath(row.xpath);
        if (!el) continue;
        fillField(el, row.value);
        filled += 1;
      }

      const submitted = message.autoSubmit ? maybeSubmitForm() : false;
      sendResponse({ ok: true, filled, total: mappings.length, submitted });
      return;
    }

    if (message?.type === "PING_CONTENT") {
      sendResponse({ ok: true, href: location.href });
      return;
    }

    throw new Error("Unsupported message type");
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });

  return true;
});


function createManualControlPanel() {
  if (window.__aiFormButtonsInitialized) return;
  window.__aiFormButtonsInitialized = true;

  const isChatTab = /(^|\.)chatgpt\.com$/i.test(location.hostname);

  const panel = document.createElement("div");
  panel.id = "ai-form-helper-panel";
  panel.style.position = "fixed";
  panel.style.right = "14px";
  panel.style.bottom = "14px";
  panel.style.zIndex = "2147483647";
  panel.style.background = "#111827";
  panel.style.color = "#fff";
  panel.style.padding = "10px";
  panel.style.borderRadius = "10px";
  panel.style.fontFamily = "Arial, sans-serif";
  panel.style.boxShadow = "0 4px 14px rgba(0,0,0,0.25)";
  panel.style.minWidth = "220px";

  const title = document.createElement("div");
  title.textContent = "AI Form Helper";
  title.style.fontSize = "12px";
  title.style.fontWeight = "700";
  title.style.marginBottom = "8px";
  panel.appendChild(title);

  const btnStart = document.createElement("button");
  btnStart.type = "button";
  btnStart.textContent = "1) Capture + Ask ChatGPT";
  btnStart.style.width = "100%";
  btnStart.style.marginBottom = "6px";

  const btnFill = document.createElement("button");
  btnFill.type = "button";
  btnFill.textContent = "2) Fill From ChatGPT Output";
  btnFill.style.width = "100%";

  [btnStart, btnFill].forEach((btn) => {
    btn.style.border = "0";
    btn.style.borderRadius = "6px";
    btn.style.padding = "8px";
    btn.style.cursor = "pointer";
    btn.style.fontSize = "12px";
  });

  if (isChatTab) {
    btnStart.disabled = true;
    btnFill.disabled = true;
    btnStart.style.opacity = "0.6";
    btnFill.style.opacity = "0.6";
  }

  const status = document.createElement("div");
  status.style.fontSize = "11px";
  status.style.marginTop = "8px";
  status.style.opacity = "0.95";
  status.textContent = isChatTab
    ? "Open a form page to use these buttons."
    : "Use step 1, then step 2.";

  async function runAction(action, button) {
    try {
      button.disabled = true;
      status.textContent = "Processing...";
      const resp = await chrome.runtime.sendMessage(action);
      if (!resp?.ok) throw new Error(resp?.error || resp?.message || "Action failed");
      status.textContent = resp.message || "Done.";
    } catch (error) {
      status.textContent = `Error: ${error.message || String(error)}`;
    } finally {
      if (!isChatTab) {
        btnStart.disabled = false;
        btnFill.disabled = false;
      }
    }
  }

  btnStart.addEventListener("click", () => runAction({ type: "MANUAL_CAPTURE_AND_SEND" }, btnStart));
  btnFill.addEventListener("click", () => runAction({ type: "MANUAL_FILL_FROM_CHATGPT" }, btnFill));

  panel.appendChild(btnStart);
  panel.appendChild(btnFill);
  panel.appendChild(status);
  document.documentElement.appendChild(panel);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", createManualControlPanel, { once: true });
} else {
  createManualControlPanel();
}
