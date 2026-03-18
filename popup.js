const fetchBtn = document.getElementById("fetchBtn");
const processBtn = document.getElementById("processBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");
const resetSelectorsBtn = document.getElementById("resetSelectorsBtn");
const settingsToggleBtn = document.getElementById("settingsToggleBtn");
const settingsPanel = document.getElementById("settingsPanel");
const listingTargetEl = document.getElementById("listingTarget");
const urlsBox = document.getElementById("urlsBox");
const resultsBody = document.getElementById("resultsBody");
const statusEl = document.getElementById("status");
const selectorActionButtons = Array.from(document.querySelectorAll("[data-action][data-selector-key]"));

const selectorDefinitions = {
  jobCard: {
    label: "Listing card",
    input: document.getElementById("jobCardSelectorInput"),
    value: document.getElementById("jobCardSelectorValue")
  },
  jobCardClickable: {
    label: "Listing click target",
    input: document.getElementById("jobCardClickableSelectorInput"),
    value: document.getElementById("jobCardClickableSelectorValue")
  },
  jobDetailsPane: {
    label: "Job details pane",
    input: document.getElementById("jobDetailsPaneSelectorInput"),
    value: document.getElementById("jobDetailsPaneSelectorValue")
  },
  paginationNext: {
    label: "Next page button",
    input: document.getElementById("paginationNextSelectorInput"),
    value: document.getElementById("paginationNextSelectorValue")
  }
};

let latestCompanyUrls = [];
let latestRows = [];
let selectorConfig = {};
let settingsOpen = false;

function setStatus(message) {
  statusEl.textContent = message;
}

function setSettingsOpen(nextOpen) {
  settingsOpen = Boolean(nextOpen);
  settingsPanel.classList.toggle("is-hidden", !settingsOpen);
  settingsToggleBtn.textContent = settingsOpen ? "Hide settings" : "Settings";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getSelectorValue(selectorKey, { preferInput = true } = {}) {
  const definition = selectorDefinitions[selectorKey];
  if (!definition) return "";
  const inputValue = definition.input.value.trim();
  if (preferInput && inputValue) return inputValue;
  return String(selectorConfig[selectorKey] || "").trim();
}

function renderSelectorConfig() {
  for (const [key, definition] of Object.entries(selectorDefinitions)) {
    const savedValue = String(selectorConfig[key] || "").trim();
    definition.input.value = savedValue;
    definition.value.textContent = savedValue || "Using built-in defaults";
  }
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
    selectorConfig
  });
}

async function restoreState() {
  const state = await chrome.storage.local.get([
    "listingTarget",
    "latestCompanyUrls",
    "latestRows",
    "urlsBoxValue",
    "selectorConfig"
  ]);
  if (state.listingTarget) listingTargetEl.value = state.listingTarget;
  latestCompanyUrls = Array.isArray(state.latestCompanyUrls) ? state.latestCompanyUrls : [];
  latestRows = Array.isArray(state.latestRows) ? state.latestRows : [];
  selectorConfig = state.selectorConfig && typeof state.selectorConfig === "object" ? state.selectorConfig : {};
  if (typeof state.urlsBoxValue === "string") {
    urlsBox.value = state.urlsBoxValue;
  } else if (latestCompanyUrls.length) {
    urlsBox.value = latestCompanyUrls.join("\n");
  }
  renderSelectorConfig();
  renderTable(latestRows);
}

async function saveSelector(selectorKey) {
  const definition = selectorDefinitions[selectorKey];
  if (!definition) throw new Error("Unknown selector setting.");

  const selector = definition.input.value.trim();
  if (!selector) {
    delete selectorConfig[selectorKey];
  } else {
    selectorConfig = {
      ...selectorConfig,
      [selectorKey]: selector
    };
  }

  if (!selector) {
    const nextConfig = { ...selectorConfig };
    delete nextConfig[selectorKey];
    selectorConfig = nextConfig;
  }

  renderSelectorConfig();
  await persistState();
  setStatus(`${definition.label} ${selector ? "saved" : "cleared"}.`);
}

async function clearSelector(selectorKey) {
  const definition = selectorDefinitions[selectorKey];
  if (!definition) return;
  definition.input.value = "";
  await saveSelector(selectorKey);
}

async function startSelectorPicker(selectorKey) {
  const tabId = await getActiveTabId();
  const definition = selectorDefinitions[selectorKey];
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "START_SELECTOR_PICK",
    payload: { selectorKey }
  });

  if (!response?.ok) {
    throw new Error(response?.error || `Failed to start picker for ${definition?.label || selectorKey}`);
  }

  setStatus(`Picker started for ${definition?.label || selectorKey}. Hover LinkedIn to see the highlighted boundary, click the target element to save it, or press Esc to cancel.`);
}

async function testSelector(selectorKey) {
  const selector = getSelectorValue(selectorKey);
  const definition = selectorDefinitions[selectorKey];
  if (!selector) {
    setStatus(`${definition?.label || selectorKey}: using built-in defaults, so there is no custom selector to test.`);
    return;
  }

  const tabId = await getActiveTabId();
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "TEST_SELECTOR",
    payload: { selectorKey, selector }
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Selector test failed.");
  }

  setStatus(
    `${definition?.label || selectorKey} test: matched ${response.count} element(s). ${response.preview ? `First match: ${response.preview}` : ""}`.trim()
  );
}

async function resetSelectorConfig() {
  selectorConfig = {};
  renderSelectorConfig();
  await persistState();
  setStatus("Selector settings reset. The extension will use built-in defaults on the next run.");
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
      status: listing.status || "fetched"
    }));
    renderTable(latestRows);

    const warning = response.warnings?.length ? ` Warnings: ${response.warnings.join(" | ")}` : "";
    setStatus(
      `Fetched ${response.listingsProcessed || 0} listings / ${latestCompanyUrls.length} company URLs across ${response.pagesVisited || 1} pages.${warning}`
    );
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
        status: company?.status || row.status || "fetched"
      };
    });

    if (!latestRows.length) {
      latestRows = (response.companyProfiles || []).map((p) => ({ ...p, status: p.status || "ok" }));
    }

    renderTable(latestRows);
    setStatus(`Done. Processed ${response.processedCount} company profiles.`);
    await persistState();
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

clearBtn.addEventListener("click", async () => {
  latestCompanyUrls = [];
  latestRows = [];
  urlsBox.value = "";
  selectorConfig = {};
  renderTable([]);
  renderSelectorConfig();
  await chrome.storage.local.clear();
  setStatus("Cleared links, table, selector settings, and saved data.");
});

resetSelectorsBtn.addEventListener("click", () => {
  resetSelectorConfig().catch((error) => {
    setStatus(`Could not reset selectors: ${error.message}`);
  });
});

settingsToggleBtn.addEventListener("click", () => {
  setSettingsOpen(!settingsOpen);
});

selectorActionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    const selectorKey = button.dataset.selectorKey;

    const actionMap = {
      pick: () => startSelectorPicker(selectorKey),
      test: () => testSelector(selectorKey),
      save: () => saveSelector(selectorKey),
      clear: () => clearSelector(selectorKey)
    };

    const handler = actionMap[action];
    if (!handler) return;

    handler().catch((error) => {
      setStatus(`${selectorDefinitions[selectorKey]?.label || selectorKey} ${action} failed: ${error.message}`);
    });
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SELECTOR_PICKED") {
    const { selectorKey, selector } = message.payload || {};
    const definition = selectorDefinitions[selectorKey];
    if (!selectorKey || !definition) return;
    selectorConfig = { ...selectorConfig, [selectorKey]: selector };
    renderSelectorConfig();
    persistState().catch(() => {});
    setStatus(`${definition.label} saved from picker: ${selector}`);
  }

  if (message?.type === "SELECTOR_PICK_CANCELLED") {
    const definition = selectorDefinitions[message.payload?.selectorKey];
    setStatus(`${definition?.label || message.payload?.selectorKey || "Selector"} picker cancelled.`);
  }
});

restoreState().catch(() => {});
