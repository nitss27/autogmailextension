function getLabelForField(field) {
  if (field.id) {
    const label = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    if (label) return label.textContent?.trim() || "";
  }

  const wrappedLabel = field.closest("label");
  if (wrappedLabel) return wrappedLabel.textContent?.trim() || "";

  const aria = field.getAttribute("aria-label") || field.getAttribute("placeholder");
  return aria || "";
}

function getXPath(el) {
  if (el.id) return `//*[@id="${el.id}"]`;
  if (el.name) return `//*[@name="${el.name}"]`;

  const parts = [];
  let current = el;
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    let ix = 1;
    let sib = current.previousElementSibling;
    while (sib) {
      if (sib.tagName === current.tagName) ix += 1;
      sib = sib.previousElementSibling;
    }
    parts.unshift(`${current.tagName.toLowerCase()}[${ix}]`);
    current = current.parentElement;
  }
  return `/${parts.join("/")}`;
}

function serializeRequiredFields() {
  const fields = Array.from(
    document.querySelectorAll("input, textarea, select")
  ).filter((el) => {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type)) return false;
    return el.required || el.getAttribute("aria-required") === "true";
  });

  return fields.map((field) => ({
    tag: field.tagName.toLowerCase(),
    type: (field.getAttribute("type") || "").toLowerCase(),
    id: field.id || "",
    name: field.name || "",
    label: getLabelForField(field),
    xpath: getXPath(field)
  }));
}

function buildPrompt(pageSource, requiredFields, url) {
  return [
    "You are assisting with form filling.",
    `Page URL: ${url}`,
    "",
    "Required fields are listed below.",
    "Return ONLY TSV with this exact header:",
    "xpath\tvalue",
    "",
    "Rules:",
    "1) One row per required field.",
    "2) Keep xpath exactly as provided.",
    "3) Provide realistic values where possible.",
    "4) If unknown, provide a safe placeholder.",
    "",
    "Required fields:",
    JSON.stringify(requiredFields, null, 2),
    "",
    "Page source:",
    pageSource
  ].join("\n");
}

function getEditor() {
  return (
    document.querySelector("#prompt-textarea") ||
    document.querySelector("textarea[data-testid='prompt-textarea']") ||
    document.querySelector("[contenteditable='true']")
  );
}

function getSubmitButton() {
  return (
    document.querySelector("button#composer-submit-button") ||
    document.querySelector("button[data-testid='send-button']") ||
    document.querySelector("button[aria-label*='Send']")
  );
}

function setEditorText(editor, text) {
  editor.focus();
  if (editor.tagName.toLowerCase() === "textarea") {
    editor.value = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  editor.textContent = "";
  document.execCommand("insertText", false, text);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

function fillField(el, value) {
  const tag = el.tagName.toLowerCase();
  if (tag === "select") {
    const byValue = Array.from(el.options).find((opt) => opt.value.toLowerCase() === value.toLowerCase());
    const byText = Array.from(el.options).find((opt) => opt.textContent.trim().toLowerCase() === value.toLowerCase());
    const option = byValue || byText || el.options[0];
    if (option) el.value = option.value;
  } else if (el.type === "checkbox" || el.type === "radio") {
    const checked = ["true", "yes", "1", "checked"].includes(value.toLowerCase());
    el.checked = checked;
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function evaluateXPath(xpath) {
  try {
    return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  } catch (_err) {
    return null;
  }
}

function parseMappingText(mappingText) {
  const lines = String(mappingText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) throw new Error("No mapping rows provided.");

  const rows = [];
  for (const line of lines) {
    if (/^xpath\tvalue$/i.test(line)) continue;
    const [xpath, ...rest] = line.split("\t");
    if (!xpath || !rest.length) continue;
    rows.push({ xpath: xpath.trim(), value: rest.join("\t").trim() });
  }

  if (!rows.length) throw new Error("Could not parse TSV mapping rows (xpath<TAB>value).");
  return rows;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CAPTURE_REQUIRED_FIELDS") {
    const requiredFields = serializeRequiredFields();
    const maxChars = Number(message.maxHtmlChars || 120000);
    const pageSource = document.documentElement.outerHTML.slice(0, maxChars);
    const prompt = buildPrompt(pageSource, requiredFields, location.href);
    sendResponse({
      url: location.href,
      requiredFields,
      prompt
    });
    return true;
  }

  if (message?.type === "INSERT_PROMPT_IN_CHATGPT") {
    const editor = getEditor();
    if (!editor) {
      sendResponse({ ok: false, error: "ChatGPT input box not found." });
      return true;
    }

    setEditorText(editor, message.promptText || "");

    setTimeout(() => {
      const submit = getSubmitButton();
      if (submit && !submit.disabled) submit.click();
      sendResponse({ ok: true });
    }, 600);

    return true;
  }

  if (message?.type === "FILL_FROM_MAPPING_TEXT") {
    const mappings = parseMappingText(message.mappingText);
    let filled = 0;

    for (const row of mappings) {
      const el = evaluateXPath(row.xpath);
      if (!el) continue;
      fillField(el, row.value);
      filled += 1;
    }

    sendResponse({ ok: true, filled, total: mappings.length });
    return true;
  }

  return false;
});
