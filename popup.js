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
const resumeEl = document.getElementById("resumeFile");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

function setStatus(msg) {
  statusEl.textContent = msg;
}

function toggleMode() {
  const mode = modeEl.value;
  singleFields.classList.toggle("hidden", mode !== "single");
  pasteFields.classList.toggle("hidden", mode !== "paste");
  sheetFields.classList.toggle("hidden", mode !== "sheet");
}

function parseRowsWithMeta(inputText) {
  const lines = inputText.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { rows: [], meta: null };

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());
  const idx = {
    to: headers.indexOf("to"),
    subject: headers.indexOf("subject"),
    body: headers.indexOf("body"),
    sent: headers.indexOf("sent")
  };

  if (idx.to < 0 || idx.subject < 0 || idx.body < 0) {
    throw new Error("Headers must include to, subject, body");
  }

  const rows = lines
    .slice(1)
    .map((line, i) => {
      const cols = line.split(delimiter);
      const sentVal = idx.sent >= 0 ? (cols[idx.sent] || "").trim().toLowerCase() : "";
      return {
        rowNumber: i + 2,
        to: (cols[idx.to] || "").trim(),
        subject: (cols[idx.subject] || "").trim(),
        body: (cols[idx.body] || "").trim(),
        sent: ["yes", "true", "sent", "1", "done"].includes(sentVal)
      };
    })
    .filter((r) => r.to && r.subject && r.body);

  return {
    rows,
    meta: {
      delimiter,
      sentColumnIndex: idx.sent,
      sentColumnLetter: idx.sent >= 0 ? String.fromCharCode(65 + idx.sent) : null
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

function rowKey(row) {
  return `${row.to}||${row.subject}||${row.body}`;
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
      warning:
        "Could not write YES back to sheet sent column via gviz endpoint. Local sent tracking is still saved."
    };
  }

  return {
    updated,
    warning: updateWarnings.length
      ? `Some sent marks failed for rows: ${updateWarnings.join(", ")}. Local sent tracking still applied.`
      : null
  };
}

async function run() {
  setStatus("Preparing data...");
  const mode = modeEl.value;
  const sendLimit = Number(sendLimitEl.value) || null;

  await setStorage({
    savedSheetUrl: sheetUrlEl.value.trim(),
    savedSendLimit: sendLimitEl.value.trim(),
    savedMode: mode
  });

  const attachment = resumeEl.files[0];
  if (!attachment) throw new Error("Attachment is required");
  const attachmentDataUrl = await fileToDataUrl(attachment);

  let rows = [];
  const sheetUrl = sheetUrlEl.value.trim();
  let sourceInfo = null;

  if (mode === "single") {
    rows = [
      {
        rowNumber: 1,
        to: toEl.value.trim(),
        subject: subjectEl.value.trim(),
        body: bodyEl.value.trim(),
        sent: false
      }
    ];
  } else if (mode === "paste") {
    rows = parseRowsWithMeta(rowsEl.value).rows;
  } else {
    if (!sheetUrl) throw new Error("Sheet URL is required");
    const sheetData = await fetchSheetRows(sheetUrl);
    rows = sheetData.rows;
    sourceInfo = {
      type: "sheet",
      sheetUrl,
      sheetId: sheetData.sheetId,
      gid: sheetData.gid,
      sentColumnLetter: sheetData.meta?.sentColumnLetter
    };
  }

  if (!rows.length) throw new Error("No rows found to send");

  const storage = await getStorage(["sheetSentRowsByUrl"]);
  const sentMap = storage.sheetSentRowsByUrl || {};
  const localSent = sourceInfo ? new Set(sentMap[sheetUrl] || []) : new Set();

  let pending = rows.filter((row) => !row.sent && !localSent.has(rowKey(row)));
  if (sendLimit) {
    pending = pending.slice(0, sendLimit);
  }

  if (!pending.length) throw new Error("Nothing to send (all rows already marked sent)");

  const tab = await getActiveGmailTab();
  setStatus(`Sending ${pending.length} email(s)...`);

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "RUN_BATCH_SEND",
    payload: {
      rows: pending,
      attachment: {
        name: attachment.name,
        type: attachment.type || "application/octet-stream",
        dataUrl: attachmentDataUrl
      }
    }
  });

  if (!response || !response.ok) {
    throw new Error(response?.error || "Send failed");
  }

  if (sourceInfo) {
    const updated = new Set(sentMap[sheetUrl] || []);
    for (const sentRow of response.sentRows || []) {
      updated.add(rowKey(sentRow));
    }
    sentMap[sheetUrl] = Array.from(updated);
    await setStorage({ sheetSentRowsByUrl: sentMap });

    const writeback = await writeYesToSheetSentColumn(sourceInfo, response.sentRows || []);
    const base = `Done. Sent ${response.sentCount} email(s).`;
    const wb = writeback.updated
      ? ` Sheet writeback YES updated: ${writeback.updated}.`
      : "";
    const warn = writeback.warning ? ` Warning: ${writeback.warning}` : "";
    setStatus(`${base}${wb}${warn}`);
    return;
  }

  setStatus(`Done. Sent ${response.sentCount} email(s).`);
}

modeEl.addEventListener("change", () => {
  toggleMode();
});

clearBtn.addEventListener("click", async () => {
  await setStorage({
    savedSheetUrl: "",
    savedSendLimit: "",
    sheetSentRowsByUrl: {},
    savedMode: "single"
  });
  sheetUrlEl.value = "";
  sendLimitEl.value = "";
  modeEl.value = "single";
  toggleMode();
  setStatus("Saved settings cleared.");
});

runBtn.addEventListener("click", async () => {
  try {
    await run();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});

(async function init() {
  const data = await getStorage(["savedSheetUrl", "savedSendLimit", "savedMode"]);
  if (data.savedSheetUrl) sheetUrlEl.value = data.savedSheetUrl;
  if (data.savedSendLimit) sendLimitEl.value = data.savedSendLimit;
  if (data.savedMode) modeEl.value = data.savedMode;
  toggleMode();
})();
