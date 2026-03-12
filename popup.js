const fetchBtn = document.getElementById("fetchBtn");
const processBtn = document.getElementById("processBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");
const outputEl = document.getElementById("output");
const statusEl = document.getElementById("status");

let latestCompanyUrls = [];

function setStatus(message) {
  statusEl.textContent = message;
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) {
    throw new Error("No active tab found.");
  }
  return tabs[0].id;
}

async function sendToContent(type, payload = {}) {
  const tabId = await getActiveTabId();
  const response = await chrome.tabs.sendMessage(tabId, { type, payload });

  if (!response?.ok) {
    throw new Error(response?.error || "Unknown content script error");
  }

  return response;
}

fetchBtn.addEventListener("click", async () => {
  try {
    fetchBtn.disabled = true;
    processBtn.disabled = true;
    setStatus("Collecting company links from current LinkedIn jobs page...");

    const response = await sendToContent("FETCH_COMPANY_URLS");
    latestCompanyUrls = response.companyUrls || [];

    outputEl.value = JSON.stringify(
      {
        totalCompanyUrls: latestCompanyUrls.length,
        companyUrls: latestCompanyUrls
      },
      null,
      2
    );

    setStatus(`Fetched ${latestCompanyUrls.length} company URLs.`);
  } catch (error) {
    setStatus(`Failed to fetch company URLs: ${error.message}`);
  } finally {
    fetchBtn.disabled = false;
    processBtn.disabled = false;
  }
});

processBtn.addEventListener("click", async () => {
  try {
    fetchBtn.disabled = true;
    processBtn.disabled = true;

    if (!latestCompanyUrls.length) {
      const parsed = JSON.parse(outputEl.value || "{}");
      if (Array.isArray(parsed.companyUrls) && parsed.companyUrls.length) {
        latestCompanyUrls = parsed.companyUrls;
      }
    }

    if (!latestCompanyUrls.length) {
      throw new Error("No company URLs loaded. Click 'Fetch Company URLs' first.");
    }

    setStatus(`Processing ${latestCompanyUrls.length} company profiles (About/Home data)...`);
    const response = await sendToContent("PROCESS_COMPANY_PROFILES", {
      companyUrls: latestCompanyUrls
    });

    outputEl.value = JSON.stringify(response, null, 2);
    setStatus(`Done. Processed ${response.processedCount} profiles.`);
  } catch (error) {
    setStatus(`Failed to process company profiles: ${error.message}`);
  } finally {
    fetchBtn.disabled = false;
    processBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    if (!outputEl.value.trim()) {
      throw new Error("Nothing to copy.");
    }
    await navigator.clipboard.writeText(outputEl.value);
    setStatus("Copied output to clipboard.");
  } catch (error) {
    setStatus(`Copy failed: ${error.message}`);
  }
});

clearBtn.addEventListener("click", () => {
  latestCompanyUrls = [];
  outputEl.value = "";
  setStatus("Cleared output.");
});
