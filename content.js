const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function dispatchInput(node, value) {
  node.focus();
  node.value = value;
  node.dispatchEvent(new Event("input", { bubbles: true }));
  node.dispatchEvent(new Event("change", { bubbles: true }));
}

function findComposeButton() {
  return document.querySelector("div.T-I.T-I-KE.L3[role='button'][jscontroller='eIu7Db']") ||
    document.querySelector("div[role='button'][gh='cm']") ||
    document.querySelector("div[role='button'][jscontroller='eIu7Db']");
}

function findActiveComposeRoot() {
  const dialogs = Array.from(document.querySelectorAll("div[role='dialog']"));
  return dialogs[dialogs.length - 1] || document;
}

function findToInput(root) {
  return root.querySelector("input[aria-label='To recipients']") ||
    root.querySelector("div.aoD.hl input") ||
    root.querySelector("textarea[name='to']") ||
    root.querySelector("input[peoplekit-id]");
}

function findSubjectInput(root) {
  return root.querySelector("input[name='subjectbox']");
}

function findBodyBox(root) {
  return root.querySelector("div[role='textbox'][aria-label='Message Body']") ||
    root.querySelector("div[aria-label='Message Body']");
}

function findAttachButton(root) {
  return root.querySelector("div.a1.aaA.aMZ") ||
    root.querySelector("div[command='Files']") ||
    root.querySelector("div[aria-label='Attach files']");
}

function findFileInput(root) {
  return root.querySelector("input[type='file'][name='Filedata']") ||
    root.querySelector("input[type='file']");
}

function findSendButton(root) {
  return root.querySelector("div.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3[role='button']") ||
    root.querySelector("div[role='button'][data-tooltip^='Send']") ||
    root.querySelector("div[aria-label^='Send']");
}

function formatBodyToHtml(text) {
  let escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  escaped = escaped.replace(/__(.+?)__/g, "<u>$1</u>");

  const lines = escaped.split(/\r?\n/);
  const output = [];
  let inList = false;

  for (const line of lines) {
    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (bullet) {
      if (!inList) {
        output.push("<ul>");
        inList = true;
      }
      output.push(`<li>${bullet[1]}</li>`);
    } else {
      if (inList) {
        output.push("</ul>");
        inList = false;
      }
      output.push(line ? `<div>${line}</div>` : "<div><br></div>");
    }
  }
  if (inList) output.push("</ul>");
  return output.join("");
}

function dataUrlToFile(dataUrl, fileName, mimeType) {
  const [meta, base64] = dataUrl.split(",");
  const mime = mimeType || meta.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], fileName, { type: mime });
}

async function attachFile(root, attachment) {
  const attachBtn = findAttachButton(root);
  if (!attachBtn) throw new Error("Attachment button not found");
  attachBtn.click();
  await sleep(300);

  let input = findFileInput(root);
  const start = Date.now();
  while (!input && Date.now() - start < 6000) {
    await sleep(200);
    input = findFileInput(root);
  }
  if (!input) throw new Error("File input not found");

  const file = dataUrlToFile(attachment.dataUrl, attachment.name, attachment.type);
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));

  await sleep(1200);
  const blocked = root.querySelector(".dN");
  if (blocked && /blocked/i.test(blocked.textContent || "")) {
    throw new Error("Gmail blocked the attachment for security reasons");
  }
}

async function sendSingle(row, attachment) {
  const composeBtn = findComposeButton();
  if (!composeBtn) throw new Error("Compose button not found");
  composeBtn.click();
  await sleep(1500);

  const root = findActiveComposeRoot();
  const toInput = findToInput(root);
  const subjectInput = findSubjectInput(root);
  const bodyBox = findBodyBox(root);

  if (!toInput || !subjectInput || !bodyBox) {
    throw new Error("Compose fields not found");
  }

  dispatchInput(toInput, row.to);
  toInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));

  dispatchInput(subjectInput, row.subject);

  bodyBox.focus();
  bodyBox.innerHTML = formatBodyToHtml(row.body);
  bodyBox.dispatchEvent(new Event("input", { bubbles: true }));

  await attachFile(root, attachment);

  const sendBtn = findSendButton(root);
  if (!sendBtn) throw new Error("Send button not found");
  sendBtn.click();

  await sleep(1800);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "RUN_BATCH_SEND") return;

  (async () => {
    const rows = message.payload?.rows || [];
    const attachment = message.payload?.attachment;

    if (!rows.length || !attachment?.dataUrl) {
      throw new Error("Missing rows or attachment");
    }

    const sentRows = [];
    for (const row of rows) {
      await sendSingle(row, attachment);
      sentRows.push(row);
      await sleep(800);
    }

    sendResponse({ ok: true, sentCount: sentRows.length, sentRows });
  })().catch((err) => {
    sendResponse({ ok: false, error: err.message || "Unknown error" });
  });

  return true;
});
