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

function serializeRequiredFields() {
  const fields = Array.from(document.querySelectorAll("input, textarea, select")).filter((el) => {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "file"].includes(type)) return false;
    return el.required || el.getAttribute("aria-required") === "true";
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

function buildPrompt(pageSource, requiredFields, url) {
  return [
    "Fill this web form using realistic sample candidate data.",
    `Form URL: ${url}`,
    "",
    "Return ONLY TSV with this exact header:",
    "xpath\tvalue",
    "",
    "Rules:",
    "1) Include one row for every required field.",
    "2) Keep xpath exactly unchanged.",
    "3) For dropdowns, use one of provided options.",
    "4) Use valid formats for email/phone/date.",
    "5) Do not include explanations or markdown.",
    "",
    "Required fields:",
    JSON.stringify(requiredFields, null, 2),
    "",
    "Page source (trimmed):",
    pageSource
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

function parseMappingText(mappingText) {
  const lines = String(mappingText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows = [];
  for (const line of lines) {
    if (/^xpath\tvalue$/i.test(line)) continue;
    const [xpath, ...rest] = line.split("\t");
    if (!xpath || !rest.length) continue;
    rows.push({ xpath: xpath.trim(), value: rest.join("\t").trim() });
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
      const requiredFields = serializeRequiredFields();
      const maxChars = Number(message.maxHtmlChars || 120000);
      const pageSource = document.documentElement.outerHTML.slice(0, maxChars);
      sendResponse({
        url: location.href,
        requiredFields,
        prompt: buildPrompt(pageSource, requiredFields, location.href)
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
      const mappingText = codeTsv || tableTsv;
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
