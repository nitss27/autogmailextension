function normalizeCompanyAboutUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("company");
    const slug = idx >= 0 ? parts[idx + 1] : null;
    if (!slug) return null;
    return `https://www.linkedin.com/company/${slug}/about/`;
  } catch {
    return null;
  }
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Tab load timed out"));
    }, timeoutMs);

    function onUpdated(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function sendMessageWithRetry(tabId, message, retries = 10) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response) return response;
    } catch {
      // retry while content script initializes
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Could not communicate with company tab content script");
}

async function processCompanyUrl(url) {
  const aboutUrl = normalizeCompanyAboutUrl(url);
  if (!aboutUrl) {
    return {
      companyName: "",
      companyLinkedInUrl: url,
      aboutUrl: "",
      website: "",
      industry: "",
      companySize: "",
      headquarters: "",
      specialties: "",
      verifiedPageDate: "",
      status: "error",
      error: "Invalid company URL"
    };
  }

  const tab = await chrome.tabs.create({ url: aboutUrl, active: false });

  try {
    await waitForTabComplete(tab.id);
    const response = await sendMessageWithRetry(tab.id, { type: "EXTRACT_COMPANY_DETAILS_FROM_PAGE" });

    if (!response?.ok) {
      throw new Error(response?.error || "Unknown extraction error");
    }

    return response.details;
  } catch (error) {
    return {
      companyName: "",
      companyLinkedInUrl: url,
      aboutUrl,
      website: "",
      industry: "",
      companySize: "",
      headquarters: "",
      specialties: "",
      verifiedPageDate: "",
      status: "error",
      error: error.message || "Unknown processing error"
    };
  } finally {
    if (tab.id) {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("LinkedIn Company Extractor installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "PROCESS_COMPANY_URLS") return;

  (async () => {
    const companyUrls = message.payload?.companyUrls;
    if (!Array.isArray(companyUrls) || !companyUrls.length) {
      throw new Error("Missing company URL list");
    }

    const uniqueUrls = Array.from(new Set(companyUrls));
    const companyProfiles = [];

    for (const url of uniqueUrls) {
      const details = await processCompanyUrl(url);
      companyProfiles.push(details);
    }

    sendResponse({ ok: true, processedCount: companyProfiles.length, companyProfiles });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message || "Failed to process URLs" });
  });

  return true;
});
