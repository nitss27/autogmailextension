const fetchBtn = document.getElementById("fetchBtn");
const processBtn = document.getElementById("processBtn");
const addFetchedBtn = document.getElementById("addFetchedBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");
const listingTargetEl = document.getElementById("listingTarget");
const urlsBox = document.getElementById("urlsBox");
const excludeBox = document.getElementById("excludeBox");
const resultsBody = document.getElementById("resultsBody");
const statusEl = document.getElementById("status");

let latestCompanyUrls = [];
let latestRows = [];

function setStatus(message) {
  statusEl.textContent = message;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getListingTarget() {
  const parsed = Number.parseInt(listingTargetEl.value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Enter a valid listing count greater than 0.");
  return parsed;
}

function parseUrlsFromBox() {
  return urlsBox.value
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseExcludeSet() {
  return new Set(
    excludeBox.value
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

function buildRowExclusionKeys(row) {
  return [row.jobUrl, row.jobTitle, `${row.jobTitle}||${row.companyDisplayName || row.companyName || ""}`]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function getRowsForCopy() {
  const excludes = parseExcludeSet();
  return latestRows.filter((row) => !buildRowExclusionKeys(row).some((key) => excludes.has(key)));
}

function toCellLink(url) {
  if (!url) return "";
  const clean = escapeHtml(url);
  return `<a href="${clean}" target="_blank">${clean}</a>`;
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
        <td>${escapeHtml(row.jobTitle)}</td>
        <td>${toCellLink(row.jobUrl)}</td>
        <td>${escapeHtml(row.companyDisplayName || row.companyName)}</td>
        <td>${toCellLink(row.companyProfileUrl || row.companyLinkedInUrl)}</td>
        <td>${escapeHtml(row.location)}</td>
        <td>${escapeHtml(row.postedTime)}</td>
        <td>${escapeHtml(row.applicants)}</td>
        <td>${escapeHtml(row.workType)}</td>
        <td>${escapeHtml(row.employmentType)}</td>
        <td>${escapeHtml(row.easyApply)}</td>
        <td>${escapeHtml(row.website)}</td>
        <td>${escapeHtml(row.industry)}</td>
        <td>${escapeHtml(row.companySize)}</td>
        <td>${escapeHtml(row.headquarters)}</td>
        <td>${escapeHtml(row.specialties)}</td>
        <td>${escapeHtml(row.status)}</td>
      </tr>`;
    })
    .join("");
}

function rowsToTsv(rows) {
  const headers = [
    "Job Title",
    "Job URL",
    "Company (listing)",
    "Company Profile URL",
    "Location/Meta",
    "Posted",
    "Applicants",
    "Work Type",
    "Employment Type",
    "Easy Apply",
    "Website",
    "Industry",
    "Company Size",
    "Headquarters",
    "Specialties",
    "Status"
  ];

  const lines = rows.map((row) =>
    [
      row.jobTitle,
      row.jobUrl,
      row.companyDisplayName || row.companyName,
      row.companyProfileUrl || row.companyLinkedInUrl,
      row.location,
      row.postedTime,
      row.applicants,
      row.workType,
      row.employmentType,
      row.easyApply,
      row.website,
      row.industry,
      row.companySize,
      row.headquarters,
      row.specialties,
      row.status
    ]
      .map((v) => String(v || "").replace(/\t/g, " ").replace(/\r?\n/g, " "))
      .join("\t")
  );

  return [headers.join("\t"), ...lines].join("\n");
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) throw new Error("No active tab found.");
  return tabs[0].id;
}

async function persistState() {
  await chrome.storage.local.set({
    listingTarget: listingTargetEl.value,
    latestCompanyUrls,
    latestRows,
    urlsBoxValue: urlsBox.value,
    excludeBoxValue: excludeBox.value
  });
}

async function processCompanyProfiles() {
  const inputUrls = parseUrlsFromBox();
  latestCompanyUrls = inputUrls.length ? inputUrls : latestCompanyUrls;
  if (!latestCompanyUrls.length) throw new Error("No company URLs found. Run Fetch Listings first.");

  setStatus(`Processing ${latestCompanyUrls.length} company profiles...`);
  const response = await chrome.runtime.sendMessage({
    type: "PROCESS_COMPANY_URLS",
    payload: { companyUrls: latestCompanyUrls }
  });

  if (!response?.ok) throw new Error(response?.error || "Failed to process company profiles");

  const companyMap = new Map();
  for (const p of response.companyProfiles || []) {
    const key = (p.companyLinkedInUrl || "").replace(/\/+$/, "");
    if (key) companyMap.set(key, p);
  }

  latestRows = latestRows.map((row) => {
    const key = (row.companyProfileUrl || row.companyLinkedInUrl || "").replace(/\/+$/, "");
    const company = companyMap.get(key);
    return {
      ...row,
      companyName: company?.companyName || row.companyName || "",
      companyLinkedInUrl: company?.companyLinkedInUrl || row.companyProfileUrl || row.companyLinkedInUrl || "",
      website: company?.website || "",
      industry: company?.industry || "",
      companySize: company?.companySize || "",
      headquarters: company?.headquarters || "",
      specialties: company?.specialties || "",
      verifiedPageDate: company?.verifiedPageDate || "",
      status: company?.status || "fetched"
    };
  });

  if (!latestRows.length) {
    latestRows = (response.companyProfiles || []).map((p) => ({ ...p, status: p.status || "ok" }));
  }

  renderTable(latestRows);
  setStatus(`Done. Processed ${response.processedCount} company profiles.`);
  await persistState();
}

async function restoreState() {
  const state = await chrome.storage.local.get([
    "listingTarget",
    "latestCompanyUrls",
    "latestRows",
    "urlsBoxValue",
    "excludeBoxValue"
  ]);
  if (state.listingTarget) listingTargetEl.value = state.listingTarget;
  latestCompanyUrls = Array.isArray(state.latestCompanyUrls) ? state.latestCompanyUrls : [];
  latestRows = Array.isArray(state.latestRows) ? state.latestRows : [];
  if (typeof state.urlsBoxValue === "string") {
    urlsBox.value = state.urlsBoxValue;
  } else if (latestCompanyUrls.length) {
    urlsBox.value = latestCompanyUrls.join("\n");
  }
  if (typeof state.excludeBoxValue === "string") {
    excludeBox.value = state.excludeBoxValue;
  }
  renderTable(latestRows);
}

fetchBtn.addEventListener("click", async () => {
  try {
    fetchBtn.disabled = true;
    processBtn.disabled = true;

    const listingTarget = getListingTarget();
    setStatus(`Fetching ${listingTarget} listings across pages...`);

    const tabId = await getActiveTabId();
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "FETCH_ALL_COMPANY_URLS",
      payload: { listingTarget }
    });

    if (!response?.ok) throw new Error(response?.error || "Failed to fetch listings");

    latestCompanyUrls = response.companyUrls || [];
    urlsBox.value = latestCompanyUrls.join("\n");

    latestRows = (response.listings || []).map((listing) => ({
      ...listing,
      status: "fetched"
    }));
    renderTable(latestRows);

    setStatus(`Fetched ${response.listingsProcessed || 0} listings / ${latestCompanyUrls.length} company URLs across ${response.pagesVisited || 1} pages.`);
    await persistState();
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
    await processCompanyProfiles();
  } catch (error) {
    setStatus(`Process failed: ${error.message}`);
  } finally {
    fetchBtn.disabled = false;
    processBtn.disabled = false;
  }
});

addFetchedBtn.addEventListener("click", async () => {
  const existing = parseExcludeSet();
  for (const row of latestRows) {
    for (const key of buildRowExclusionKeys(row)) {
      existing.add(key);
    }
  }
  excludeBox.value = Array.from(existing).join("\n");
  await persistState();
  setStatus(`Added ${latestRows.length} fetched listings to exclusion list.`);
});

copyBtn.addEventListener("click", async () => {
  try {
    if (!latestRows.length) throw new Error("No table data to copy.");
    const rowsForCopy = getRowsForCopy();
    await navigator.clipboard.writeText(rowsToTsv(rowsForCopy));
    setStatus(`Copied ${rowsForCopy.length} rows as TSV (${latestRows.length - rowsForCopy.length} excluded).`);
  } catch (error) {
    setStatus(`Copy failed: ${error.message}`);
  }
});

clearBtn.addEventListener("click", async () => {
  latestCompanyUrls = [];
  latestRows = [];
  urlsBox.value = "";
  excludeBox.value = "";
  renderTable([]);
  await chrome.storage.local.clear();
  setStatus("Cleared links, table, exclusions, and saved data.");
});

restoreState().catch(() => {});
