const fetchBtn = document.getElementById("fetchBtn");
const processBtn = document.getElementById("processBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");
const urlsBox = document.getElementById("urlsBox");
const resultsBody = document.getElementById("resultsBody");
const statusEl = document.getElementById("status");

let latestCompanyUrls = [];
let latestRows = [];

function setStatus(message) {
  statusEl.textContent = message;
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) throw new Error("No active tab found.");
  return tabs[0].id;
}

function parseUrlsFromBox() {
  return urlsBox.value
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderTable(rows) {
  if (!rows.length) {
    resultsBody.innerHTML = "";
    return;
  }

  resultsBody.innerHTML = rows
    .map((row, index) => {
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.companyName)}</td>
        <td><a href="${escapeHtml(row.companyLinkedInUrl)}" target="_blank">${escapeHtml(row.companyLinkedInUrl)}</a></td>
        <td>${escapeHtml(row.website)}</td>
        <td>${escapeHtml(row.industry)}</td>
        <td>${escapeHtml(row.companySize)}</td>
        <td>${escapeHtml(row.headquarters)}</td>
        <td>${escapeHtml(row.specialties)}</td>
        <td>${escapeHtml(row.verifiedPageDate)}</td>
        <td>${escapeHtml(row.status)}</td>
      </tr>`;
    })
    .join("");
}

function rowsToTsv(rows) {
  const headers = [
    "Company",
    "LinkedIn URL",
    "Website",
    "Industry",
    "Company Size",
    "Headquarters",
    "Specialties",
    "Verified Page",
    "Status"
  ];

  const lines = rows.map((row) =>
    [
      row.companyName,
      row.companyLinkedInUrl,
      row.website,
      row.industry,
      row.companySize,
      row.headquarters,
      row.specialties,
      row.verifiedPageDate,
      row.status
    ]
      .map((v) => String(v || "").replace(/\t/g, " ").replace(/\r?\n/g, " "))
      .join("\t")
  );

  return [headers.join("\t"), ...lines].join("\n");
}

fetchBtn.addEventListener("click", async () => {
  try {
    fetchBtn.disabled = true;
    processBtn.disabled = true;
    setStatus("Scanning job list and clicking each card to collect all company links...");

    const tabId = await getActiveTabId();
    const response = await chrome.tabs.sendMessage(tabId, { type: "FETCH_ALL_COMPANY_URLS" });
    if (!response?.ok) throw new Error(response?.error || "Failed to fetch links");

    latestCompanyUrls = response.companyUrls || [];
    urlsBox.value = latestCompanyUrls.join("\n");
    setStatus(`Fetched ${latestCompanyUrls.length} unique company URLs from the list.`);
  } catch (error) {
    setStatus(`Fetch failed: ${error.message}`);
  } finally {
    fetchBtn.disabled = false;
    processBtn.disabled = false;
  }
});

processBtn.addEventListener("click", async () => {
  try {
    fetchBtn.disabled = true;
    processBtn.disabled = true;

    const inputUrls = parseUrlsFromBox();
    latestCompanyUrls = inputUrls.length ? inputUrls : latestCompanyUrls;

    if (!latestCompanyUrls.length) {
      throw new Error("No company URLs found. Run Fetch All Companies first.");
    }

    setStatus(`Opening ${latestCompanyUrls.length} company tabs and extracting About info...`);
    const response = await chrome.runtime.sendMessage({
      type: "PROCESS_COMPANY_URLS",
      payload: { companyUrls: latestCompanyUrls }
    });

    if (!response?.ok) throw new Error(response?.error || "Failed to process company profiles");

    latestRows = response.companyProfiles || [];
    renderTable(latestRows);
    setStatus(`Done. Processed ${response.processedCount} company profiles.`);
  } catch (error) {
    setStatus(`Process failed: ${error.message}`);
  } finally {
    fetchBtn.disabled = false;
    processBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    if (!latestRows.length) throw new Error("No table data to copy.");
    await navigator.clipboard.writeText(rowsToTsv(latestRows));
    setStatus("Copied table as TSV.");
  } catch (error) {
    setStatus(`Copy failed: ${error.message}`);
  }
});

clearBtn.addEventListener("click", () => {
  latestCompanyUrls = [];
  latestRows = [];
  urlsBox.value = "";
  renderTable([]);
  setStatus("Cleared links and table.");
});
