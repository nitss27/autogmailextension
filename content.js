function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLinkedInCompanyUrl(rawUrl) {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl, window.location.origin);
    if (url.hostname !== "www.linkedin.com") return null;
    if (!url.pathname.includes("/company/")) return null;

    const cleanPath = url.pathname.replace(/\/+$/, "");
    const parts = cleanPath.split("/").filter(Boolean);
    const idx = parts.indexOf("company");
    if (idx === -1 || !parts[idx + 1]) return null;

    return `https://www.linkedin.com/company/${parts[idx + 1]}`;
  } catch {
    return null;
  }
}

function getJobCards() {
  return Array.from(
    document.querySelectorAll('.job-card-container[data-job-id], .jobs-search-results-list__list-item .job-card-container')
  );
}

function clickCard(card) {
  const clickTarget = card.querySelector("a.job-card-list__title--link") || card;
  clickTarget.scrollIntoView({ behavior: "instant", block: "center" });
  clickTarget.click();
}

function collectCompanyAnchors() {
  const anchors = Array.from(
    document.querySelectorAll(
      'a[href*="/company/"] , .jobs-search__job-details--container a[href*="/company/"], .job-details-jobs-unified-top-card__company-name a'
    )
  );

  const urls = new Set();
  anchors.forEach((a) => {
    const normalized = normalizeLinkedInCompanyUrl(a.href);
    if (normalized) urls.add(normalized);
  });

  return urls;
}

async function fetchAllCompanyUrlsFromJobList() {
  const companyUrls = new Set();
  let stableRounds = 0;

  for (let round = 0; round < 20; round += 1) {
    const cards = getJobCards();

    for (let i = 0; i < cards.length; i += 1) {
      const card = cards[i];
      clickCard(card);
      await sleep(250);

      const inCardAnchor = card.querySelector('a[href*="/company/"]');
      const normalized = normalizeLinkedInCompanyUrl(inCardAnchor?.href);
      if (normalized) companyUrls.add(normalized);

      collectCompanyAnchors().forEach((url) => companyUrls.add(url));
    }

    const beforeScrollCount = cards.length;
    const listContainer =
      document.querySelector(".jobs-search-results-list") || document.querySelector(".scaffold-layout__list-container");

    if (listContainer) {
      listContainer.scrollTop = listContainer.scrollHeight;
    } else {
      window.scrollTo(0, document.body.scrollHeight);
    }

    await sleep(800);

    const afterScrollCount = getJobCards().length;
    if (afterScrollCount <= beforeScrollCount) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }

    if (stableRounds >= 2) break;
  }

  return Array.from(companyUrls);
}

function extractCompanyDataFromCurrentPage() {
  const getFieldByHeading = (headingText) => {
    const headings = Array.from(document.querySelectorAll("dt h3"));
    const match = headings.find((h) => h.textContent?.trim().toLowerCase() === headingText.toLowerCase());
    if (!match) return "";
    const dt = match.closest("dt");
    const dd = dt?.nextElementSibling;
    return dd?.textContent?.trim() || "";
  };

  const companyLinkedInUrl = normalizeLinkedInCompanyUrl(window.location.href) || window.location.href;

  const websiteAnchor = Array.from(document.querySelectorAll("dt + dd a[href]")).find((a) => {
    const dt = a.closest("dd")?.previousElementSibling;
    const heading = dt?.querySelector("h3")?.textContent?.trim().toLowerCase();
    return heading === "website";
  });

  const companyName =
    document.querySelector("h1")?.textContent?.trim() ||
    document.querySelector(".org-top-card-summary__title")?.textContent?.trim() ||
    document.title?.replace(" | LinkedIn", "").trim() ||
    "";

  return {
    companyName,
    companyLinkedInUrl,
    aboutUrl: companyLinkedInUrl.replace(/\/+$/, "") + "/about/",
    website: websiteAnchor?.href || getFieldByHeading("Website"),
    industry: getFieldByHeading("Industry"),
    companySize: getFieldByHeading("Company size"),
    headquarters: getFieldByHeading("Headquarters"),
    specialties: getFieldByHeading("Specialties"),
    verifiedPageDate: getFieldByHeading("Verified page"),
    status: "ok"
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === "FETCH_ALL_COMPANY_URLS") {
    (async () => {
      const companyUrls = await fetchAllCompanyUrlsFromJobList();
      sendResponse({ ok: true, companyUrls });
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message || "Failed to collect company URLs" });
    });
    return true;
  }

  if (message.type === "EXTRACT_COMPANY_DETAILS_FROM_PAGE") {
    try {
      const details = extractCompanyDataFromCurrentPage();
      sendResponse({ ok: true, details });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || "Failed to extract company details" });
    }
    return true;
  }
});
