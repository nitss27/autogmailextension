const modeEl = document.getElementById("mode");
const singleFields = document.getElementById("singleFields");
const pasteFields = document.getElementById("pasteFields");
const sheetFields = document.getElementById("sheetFields");
const toEl = document.getElementById("to");
const subjectEl = document.getElementById("subject");
const bodyEl = document.getElementById("body");
const rowsEl = document.getElementById("rows");
const sheetUrlEl = document.getElementById("sheetUrl");
const sendLimitEl = document.getElementById("sendLimit");
const enableAttachmentEl = document.getElementById("enableAttachment");
const sheetAttachRuleEl = document.getElementById("sheetAttachRule");
const resumeEl = document.getElementById("resumeFile");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const sentListEl = document.getElementById("sentList");
const copySentBtn = document.getElementById("copySentBtn");

const SENT_VALUES = new Set(["yes", "true", "sent", "1", "done"]);
const ATTACH_VALUES = new Set(["yes", "true", "attach", "1", "y"]);

function setStatus(msg) {
  statusEl.textContent = msg;
}

function formatSentList(rows) {
  if (!rows.length) return "";
  return rows
    .map((row) => {
      const to = String(row.to || "").trim();
      const subject = String(row.subject || "").trim();
      return `${to}${subject ? ` | ${subject}` : ""}`;
    })
    .join("\n");
}

function setSentList(rows) {
  sentListEl.value = formatSentList(rows);
}

async function copySentListToClipboard() {
  const value = sentListEl.value || "";
  if (!value.trim()) {
    setStatus("Nothing to copy yet. Send emails first.");
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    setStatus("Sent list copied to clipboard.");
    return;
  } catch (_) {
    sentListEl.focus();
    sentListEl.select();
    const ok = document.execCommand("copy");
    setStatus(ok ? "Sent list copied to clipboard." : "Copy failed. Please select and copy manually.");
  }
}

function toggleMode() {
  const mode = modeEl.value;
  singleFields.classList.toggle("hidden", mode !== "single");
  pasteFields.classList.toggle("hidden", mode !== "paste");
  sheetFields.classList.toggle("hidden", mode !== "sheet");
}

function toggleAttachmentUi() {
  const enabled = enableAttachmentEl.checked;
  resumeEl.disabled = !enabled;
  sheetAttachRuleEl.disabled = !enabled;
}

function parseCsvMatrix(input) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (ch === '"') {
      if (inQuotes && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((v) => String(v).trim().length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  if (row.some((v) => String(v).trim().length > 0)) rows.push(row);
  return rows;
}

function parseDelimitedRows(inputText) {
  const clean = inputText.replace(/^\uFEFF/, "");
  if (!clean.trim()) return { delimiter: ",", matrix: [] };

  const firstLine = clean.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.includes("\t") ? "\t" : ",";

  const matrix =
    delimiter === "\t"
      ? clean
          .split(/\r?\n/)
          .filter((line) => line.trim().length > 0)
          .map((line) => line.split("\t"))
      : parseCsvMatrix(clean);

  return { delimiter, matrix };
}

function columnLetterFromIndex(idx) {
  if (idx < 0) return null;
  let n = idx + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function parseRowsWithMeta(inputText) {
  const { delimiter, matrix } = parseDelimitedRows(inputText);
  if (!matrix.length) return { rows: [], meta: null };

  const headers = matrix[0].map((h) => h.trim().toLowerCase());
  const idx = {
    to: headers.indexOf("to"),
    subject: headers.indexOf("subject"),
    body: headers.indexOf("body"),
    sent: headers.indexOf("sent"),
    attach: ["attach", "attachment", "send_attachment", "with_attachment"]
      .map((h) => headers.indexOf(h))
      .find((v) => v >= 0) ?? -1
  };

  if (idx.to < 0 || idx.subject < 0 || idx.body < 0) {
    throw new Error("Headers must include to, subject, body");
  }

  const rows = matrix
    .slice(1)
    .map((cols, i) => {
      const sentVal = idx.sent >= 0 ? String(cols[idx.sent] || "").trim().toLowerCase() : "";
      const attachVal = idx.attach >= 0 ? String(cols[idx.attach] || "").trim().toLowerCase() : "";
      return {
        rowNumber: i + 2,
        to: String(cols[idx.to] || "").trim(),
        subject: String(cols[idx.subject] || "").trim(),
        body: String(cols[idx.body] || ""),
        sent: SENT_VALUES.has(sentVal),
        attachAllowed: ATTACH_VALUES.has(attachVal)
      };
    })
    .filter((r) => r.to && r.subject && String(r.body).trim().length > 0);

  return {
    rows,
    meta: {
      delimiter,
      sentColumnIndex: idx.sent,
      sentColumnLetter: columnLetterFromIndex(idx.sent),
      attachColumnIndex: idx.attach
    }
  };
}

function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

function extractGid(url) {
  const match = url.match(/[?&#]gid=(\d+)/);
  return match ? match[1] : "0";
}

function buildCsvCandidates(sheetUrl, sheetId, gid) {
  const urls = new Set();
  urls.add(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`);
  urls.add(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`);

  const cleaned = sheetUrl.trim();
  if (cleaned.includes("output=csv")) {
    urls.add(cleaned);
  } else if (cleaned.includes("/pub?")) {
    urls.add(cleaned.replace("/pub?", "/pub?output=csv&"));
  }

  return Array.from(urls);
}

async function fetchSheetRows(sheetUrl) {
  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) throw new Error("Invalid Google Sheet URL");
  const gid = extractGid(sheetUrl);
  const csvCandidates = buildCsvCandidates(sheetUrl, sheetId, gid);

  let text = null;
  const attempts = [];
  for (const csvUrl of csvCandidates) {
    try {
      const resp = await fetch(csvUrl, { credentials: "include" });
      const body = await resp.text();
      if (!resp.ok) {
        attempts.push(`${resp.status} @ ${csvUrl}`);
        continue;
      }
      if (body.includes("<!DOCTYPE html") || body.includes("<html")) {
        attempts.push(`non-CSV response @ ${csvUrl}`);
        continue;
      }
      text = body;
      break;
    } catch (err) {
      attempts.push(`${err.message} @ ${csvUrl}`);
    }
  }

  if (!text) {
    throw new Error(
      `Failed to fetch sheet CSV. Make sure the sheet is shared/published and try a URL with gid. Details: ${attempts.slice(
        0,
        2
      ).join(" | ")}`
    );
  }

  const parsed = parseRowsWithMeta(text);
  return { ...parsed, sheetId, gid };
}

async function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

async function setStorage(data) {
  return chrome.storage.local.set(data);
}

async function fileToDataUrl(file) {
  if (!file) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed reading attachment"));
    reader.readAsDataURL(file);
  });
}

async function getActiveGmailTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id || !tab.url || !tab.url.startsWith("https://mail.google.com/")) {
    throw new Error("Open Gmail in the active tab before sending");
  }
  return tab;
}

async function writeYesToSheetSentColumn(sheetSource, sentRows) {
  if (!sheetSource?.sheetId || !sheetSource?.gid || !sheetSource?.sentColumnLetter || !sentRows.length) {
    return { updated: 0, warning: null };
  }

  const updateWarnings = [];
  let updated = 0;

  for (const row of sentRows) {
    if (!row.rowNumber) continue;
    const cell = `${sheetSource.sentColumnLetter}${row.rowNumber}`;
    const tq = encodeURIComponent(`update ${cell} set '${"YES"}'`);
    const url = `https://docs.google.com/spreadsheets/d/${sheetSource.sheetId}/gviz/tq?gid=${sheetSource.gid}&tq=${tq}`;

    try {
      const resp = await fetch(url, { method: "GET", credentials: "include" });
      const text = await resp.text();
      if (resp.ok && !/error/i.test(text)) {
        updated += 1;
      } else {
        updateWarnings.push(`Row ${row.rowNumber}`);
      }
    } catch (_) {
      updateWarnings.push(`Row ${row.rowNumber}`);
    }
  }

  if (!updated) {
    return {
      updated,
      warning: "Could not write YES back to sheet sent column via gviz endpoint."
    };
  }

  return {
    updated,
    warning: updateWarnings.length ? `Some sent marks failed for rows: ${updateWarnings.join(", ")}.` : null
  };
}

async function run() {
  setStatus("Preparing data...");
  setSentList([]);
  const mode = modeEl.value;
  const sendLimit = Number(sendLimitEl.value) || null;
  const enableAttachment = enableAttachmentEl.checked;
  const sheetAttachRule = sheetAttachRuleEl.checked;

  await setStorage({
    savedSheetUrl: sheetUrlEl.value.trim(),
    savedSendLimit: sendLimitEl.value.trim(),
    savedMode: mode,
    savedEnableAttachment: enableAttachment,
    savedSheetAttachRule: sheetAttachRule
  });

  let rows = [];
  const sheetUrl = sheetUrlEl.value.trim();
  let sourceInfo = null;

  if (mode === "single") {
    rows = [
      {
        rowNumber: 1,
        to: toEl.value.trim(),
        subject: subjectEl.value.trim(),
        body: bodyEl.value,
        sent: false,
        shouldAttach: enableAttachment
      }
    ];
  } else if (mode === "paste") {
    const parsed = parseRowsWithMeta(rowsEl.value);
    rows = parsed.rows.map((row) => ({
      ...row,
      shouldAttach: enableAttachment && (!sheetAttachRule || row.attachAllowed)
    }));
  } else {
    if (!sheetUrl) throw new Error("Sheet URL is required");
    const sheetData = await fetchSheetRows(sheetUrl);
    rows = sheetData.rows.map((row) => ({
      ...row,
      shouldAttach: enableAttachment && (!sheetAttachRule || row.attachAllowed)
    }));
    sourceInfo = {
      type: "sheet",
      sheetId: sheetData.sheetId,
      gid: sheetData.gid,
      sentColumnLetter: sheetData.meta?.sentColumnLetter,
      hasAttachColumn: sheetData.meta?.attachColumnIndex >= 0
    };
  }

  if (!rows.length) throw new Error("No rows found to send");

  let pending = rows.filter((row) => !row.sent);

  if (sendLimit) pending = pending.slice(0, sendLimit);

  if (!pending.length) {
    throw new Error(
      `Nothing to send (all ${rows.length} rows already marked sent in sheet/data).`
    );
  }

  const needsAttachment = pending.some((row) => row.shouldAttach);
  let attachmentPayload = null;

  if (needsAttachment) {
    const attachment = resumeEl.files[0];
    if (!attachment) throw new Error("Attachment is enabled and required by row rules, but no file selected");
    attachmentPayload = {
      name: attachment.name,
      type: attachment.type || "application/octet-stream",
      dataUrl: await fileToDataUrl(attachment)
    };
  }

  const tab = await getActiveGmailTab();
  const attachInfo = enableAttachment
    ? sourceInfo && sheetAttachRule
      ? sourceInfo.hasAttachColumn
        ? "sheet attach rule enabled"
        : "sheet attach rule enabled but no attach column found (no rows will attach)"
      : "attachment enabled"
    : "attachment disabled";
  setStatus(`Parsed ${rows.length} row(s). Sending ${pending.length} email(s)... (${attachInfo})`);

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "RUN_BATCH_SEND",
    payload: {
      rows: pending,
      attachment: attachmentPayload
    }
  });

  if (!response || !response.ok) {
    throw new Error(response?.error || "Send failed");
  }

  const sentRows = response.sentRows || [];
  setSentList(sentRows);

  if (sourceInfo) {
    const writeback = await writeYesToSheetSentColumn(sourceInfo, sentRows);
    const base = `Done. Sent ${response.sentCount} email(s).`;
    const wb = writeback.updated ? ` Sheet writeback YES updated: ${writeback.updated}.` : "";
    const warn = writeback.warning ? ` Warning: ${writeback.warning}` : "";
    setStatus(`${base}${wb}${warn}`);
    return;
  }

  setStatus(`Done. Sent ${response.sentCount} email(s).`);
}

modeEl.addEventListener("change", toggleMode);
enableAttachmentEl.addEventListener("change", toggleAttachmentUi);

clearBtn.addEventListener("click", async () => {
  await setStorage({
    savedSheetUrl: "",
    savedSendLimit: "",
    savedMode: "single",
    savedEnableAttachment: true,
    savedSheetAttachRule: true
  });
  sheetUrlEl.value = "";
  sendLimitEl.value = "";
  modeEl.value = "single";
  enableAttachmentEl.checked = true;
  sheetAttachRuleEl.checked = true;
  toggleMode();
  toggleAttachmentUi();
  setSentList([]);
  setStatus("Saved settings cleared.");
});

copySentBtn.addEventListener("click", async () => {
  await copySentListToClipboard();
});

runBtn.addEventListener("click", async () => {
  try {
    await run();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});

(async function init() {
  const data = await getStorage([
    "savedSheetUrl",
    "savedSendLimit",
    "savedMode",
    "savedEnableAttachment",
    "savedSheetAttachRule"
  ]);
  if (data.savedSheetUrl) sheetUrlEl.value = data.savedSheetUrl;
  if (data.savedSendLimit) sendLimitEl.value = data.savedSendLimit;
  if (data.savedMode) modeEl.value = data.savedMode;
  if (typeof data.savedEnableAttachment === "boolean") enableAttachmentEl.checked = data.savedEnableAttachment;
  if (typeof data.savedSheetAttachRule === "boolean") sheetAttachRuleEl.checked = data.savedSheetAttachRule;
  toggleMode();
  toggleAttachmentUi();
  setSentList([]);
})();
