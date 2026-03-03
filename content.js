const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let batchInProgress = false;

async function waitFor(getter, timeoutMs = 5000, pollMs = 80) {
  const start = Date.now();
  let value = getter();
  while (!value && Date.now() - start < timeoutMs) {
    await sleep(pollMs);
    value = getter();
  }
  return value;
}

function getComposeDialogs() {
  return Array.from(document.querySelectorAll("div[role='dialog']")).filter((el) => document.contains(el));
}

async function waitForNoComposeDialog(timeoutMs = 5000, pollMs = 80) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getComposeDialogs().length === 0) return true;
    await sleep(pollMs);
  }
  return getComposeDialogs().length === 0;
}

function dispatchInput(node, value) {
  node.focus();
  node.value = value;
  node.dispatchEvent(new Event("input", { bubbles: true }));
  node.dispatchEvent(new Event("change", { bubbles: true }));
}

function findComposeButton() {
  return (
    document.querySelector("div.T-I.T-I-KE.L3[role='button'][jscontroller='eIu7Db']") ||
    document.querySelector("div[role='button'][gh='cm']") ||
    document.querySelector("div[role='button'][jscontroller='eIu7Db']")
  );
}

function findActiveComposeRoot() {
  const dialogs = getComposeDialogs();
  return dialogs[dialogs.length - 1] || null;
}

function findToInput(root) {
  return (
    root.querySelector("input[aria-label='To recipients']") ||
    root.querySelector("div.aoD.hl input") ||
    root.querySelector("textarea[name='to']") ||
    root.querySelector("input[peoplekit-id]")
  );
}

function findSubjectInput(root) {
  return root.querySelector("input[name='subjectbox']");
}

function findBodyBox(root) {
  return (
    root.querySelector("div[role='textbox'][aria-label='Message Body']") ||
    root.querySelector("div[aria-label='Message Body']")
  );
}

function findAttachButton(root) {
  return (
    root.querySelector("div.a1.aaA.aMZ") ||
    root.querySelector("div[command='Files']") ||
    root.querySelector("div[aria-label='Attach files']")
  );
}

function findFileInput(root) {
  return root.querySelector("input[type='file'][name='Filedata']") || root.querySelector("input[type='file']");
}

function findSendButton(root) {
  return (
    root.querySelector("div.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3[role='button']") ||
    root.querySelector("div[role='button'][data-tooltip^='Send']") ||
    root.querySelector("div[aria-label^='Send']")
  );
}

function formatBodyToHtml(text) {
  let escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  let input = await waitFor(() => findFileInput(root), 1200, 70);

  // Prefer direct file-input injection so the OS file picker does not open.
  // Gmail usually keeps Filedata input in the compose DOM even when hidden.
  if (!input) {
    const attachBtn = findAttachButton(root);
    if (!attachBtn) throw new Error("Attachment button not found");
    attachBtn.click();
    input = await waitFor(() => findFileInput(root), 3500, 70);
  }

  if (!input) throw new Error("File input not found");

  const file = dataUrlToFile(attachment.dataUrl, attachment.name, attachment.type);
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));

  await sleep(500);
  const blocked = root.querySelector(".dN");
  if (blocked && /blocked/i.test(blocked.textContent || "")) {
    throw new Error("Gmail blocked the attachment for security reasons");
  }
}

async function sendSingle(row, attachment) {
  await waitForNoComposeDialog(5000, 80);

  const composeBtn = await waitFor(() => findComposeButton(), 5000, 70);
  if (!composeBtn) throw new Error("Compose button not found");
  composeBtn.click();

  const root = await waitFor(() => findActiveComposeRoot(), 5000, 80);
  if (!root) throw new Error("Compose window did not open");

  const toInput = await waitFor(() => findToInput(root), 5000, 80);
  const subjectInput = await waitFor(() => findSubjectInput(root), 5000, 80);
  const bodyBox = await waitFor(() => findBodyBox(root), 5000, 80);

  if (!toInput || !subjectInput || !bodyBox) {
    throw new Error("Compose fields not found");
  }

  dispatchInput(toInput, row.to);
  toInput.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
  );

  dispatchInput(subjectInput, row.subject);

  bodyBox.focus();
  bodyBox.innerHTML = formatBodyToHtml(row.body);
  bodyBox.dispatchEvent(new Event("input", { bubbles: true }));

  await attachFile(root, attachment);

  const sendBtn = await waitFor(() => findSendButton(root), 5000, 70);
  if (!sendBtn) throw new Error("Send button not found");
  sendBtn.click();

  const closed = await waitForNoComposeDialog(5000, 90);
  if (!closed) {
    await waitFor(
      () => {
        const messageSentToast = document.querySelector("span.bAq");
        return messageSentToast && /message sent/i.test(messageSentToast.textContent || "");
      },
      2500,
      90
    );
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "RUN_BATCH_SEND") return;

  if (batchInProgress) {
    sendResponse({ ok: false, error: "A batch is already running. Please wait for it to finish." });
    return false;
  }

  batchInProgress = true;

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
      await sleep(250);
    }

    sendResponse({ ok: true, sentCount: sentRows.length, sentRows });
  })()
    .catch((err) => {
      sendResponse({ ok: false, error: err.message || "Unknown error" });
    })
    .finally(() => {
      batchInProgress = false;
    });

  return true;
});
