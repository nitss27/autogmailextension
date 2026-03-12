function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLinkedInCompanyUrl(rawUrl) {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl, window.location.origin);
    if (url.hostname !== "www.linkedin.com") return null;
    if (!url.pathname.includes("/company/")) return null;

    const normalizedPath = url.pathname.replace(/\/+$/, "");
    return `https://www.linkedin.com${normalizedPath}`;
  } catch {
    return null;
  }
}

function clickVisibleJobCards() {
  const clickableCards = Array.from(
    document.querySelectorAll('[data-view-name="job-search-job-card"] [role="button"], [componentkey^="job-card-component-ref"]')
  );

  clickableCards.slice(0, 200).forEach((card) => {
    if (typeof card.click === "function") {
      card.click();
    }
  });
}

function collectCompanyUrlsFromJobListings() {
  clickVisibleJobCards();

  const selectors = [
    'a[href*="linkedin.com/company/"]',
    'a[href^="/company/"]',
    '[data-view-name="job-search-job-card"] a[href*="/company/"]'
  ];

  const urls = new Set();
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((anchor) => {
      const normalized = normalizeLinkedInCompanyUrl(anchor.href);
      if (normalized) urls.add(normalized);
    });
  });

  return Array.from(urls);
}

function extractCompanyDataFromHtml(doc, sourceUrl) {
  const getFieldByHeading = (headingText) => {
    const headings = Array.from(doc.querySelectorAll("dt h3"));
    const match = headings.find((h) => h.textContent?.trim().toLowerCase() === headingText.toLowerCase());
    if (!match) return "";
    const dt = match.closest("dt");
    const dd = dt?.nextElementSibling;
    return dd?.textContent?.trim() || "";
  };

  const companyName =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.querySelector("title")?.textContent?.replace(" | LinkedIn", "").trim() ||
    "";

  const websiteAnchor = Array.from(doc.querySelectorAll('dt + dd a[href]')).find((a) => {
    const dt = a.closest("dd")?.previousElementSibling;
    const heading = dt?.querySelector("h3")?.textContent?.trim().toLowerCase();
    return heading === "website";
  });

  return {
    companyName,
    companyLinkedInUrl: sourceUrl,
    aboutUrl: sourceUrl.includes("/about") ? sourceUrl : `${sourceUrl}/about/`,
    website: websiteAnchor?.href || getFieldByHeading("Website"),
    industry: getFieldByHeading("Industry"),
    companySize: getFieldByHeading("Company size"),
    headquarters: getFieldByHeading("Headquarters"),
    specialties: getFieldByHeading("Specialties"),
    verifiedPageDate: getFieldByHeading("Verified page")
  };
}

async function fetchAndParseCompanyAbout(companyUrl) {
  const aboutUrl = companyUrl.replace(/\/+$/, "") + "/about/";

  const response = await fetch(aboutUrl, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  return extractCompanyDataFromHtml(doc, companyUrl);
}

async function processCompanyProfiles(companyUrls) {
  const uniqueUrls = Array.from(new Set(companyUrls.map(normalizeLinkedInCompanyUrl).filter(Boolean)));

  const results = [];
  for (const url of uniqueUrls) {
    try {
      const data = await fetchAndParseCompanyAbout(url);
      results.push({ ...data, status: "ok" });
    } catch (error) {
      results.push({
        companyLinkedInUrl: url,
        aboutUrl: `${url.replace(/\/+$/, "")}/about/`,
        status: "error",
        error: error.message || "Unknown error"
      });
    }

    await sleep(300);
  }

  return {
    processedCount: results.length,
    companyProfiles: results
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === "FETCH_COMPANY_URLS") {
    (async () => {
      const companyUrls = collectCompanyUrlsFromJobListings();
      sendResponse({ ok: true, companyUrls });
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message || "Failed to collect URLs" });
    });

    return true;
  }

  if (message.type === "PROCESS_COMPANY_PROFILES") {
    (async () => {
      const companyUrls = message.payload?.companyUrls;
      if (!Array.isArray(companyUrls) || companyUrls.length === 0) {
        throw new Error("Missing company URL list");
      }

      const data = await processCompanyProfiles(companyUrls);
      sendResponse({ ok: true, ...data });
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message || "Failed to process companies" });
    });

    return true;
  }
});
