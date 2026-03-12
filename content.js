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
    document.querySelectorAll('.job-card-container[data-job-id], .jobs-search-results-list__list-item .job-card-container[data-job-id]')
  );
}

function getJobId(card) {
  return card?.getAttribute("data-job-id") || "";
}

function getListContainer() {
  return document.querySelector(".jobs-search-results-list") || document.querySelector(".scaffold-layout__list-container");
}

function clickCard(card) {
  const clickTarget = card.querySelector("a.job-card-list__title--link") || card;
  clickTarget.scrollIntoView({ behavior: "instant", block: "center" });
  clickTarget.click();
}

function collectCompanyAnchors(card) {
  const anchors = [
    ...(card ? Array.from(card.querySelectorAll('a[href*="/company/"]')) : []),
    ...Array.from(
      document.querySelectorAll(
        '.jobs-search__job-details--container a[href*="/company/"], .job-details-jobs-unified-top-card__company-name a, a[href*="/company/"]'
      )
    )
  ];

  const urls = new Set();
  anchors.forEach((a) => {
    const normalized = normalizeLinkedInCompanyUrl(a.href);
    if (normalized) urls.add(normalized);
  });

  return urls;
}

async function scrollJobListToEnd() {
  const container = getListContainer();
  if (!container) return;

  let lastTop = -1;
  let stable = 0;

  while (stable < 3) {
    container.scrollTop = container.scrollHeight;
    await sleep(700);

    if (container.scrollTop === lastTop) {
      stable += 1;
    } else {
      stable = 0;
      lastTop = container.scrollTop;
    }
  }
}

async function clickNextPageIfAvailable() {
  const nextBtn = document.querySelector(
    'button.jobs-search-pagination__button--next[aria-label*="View next page"], button.jobs-search-pagination__button--next'
  );

  if (!nextBtn || nextBtn.disabled || nextBtn.getAttribute("aria-disabled") === "true") {
    return false;
  }

  const firstCardIdBefore = getJobId(getJobCards()[0]);
  nextBtn.click();

  for (let i = 0; i < 20; i += 1) {
    await sleep(350);
    const firstCardIdAfter = getJobId(getJobCards()[0]);
    if (firstCardIdAfter && firstCardIdAfter !== firstCardIdBefore) {
      return true;
    }
  }

  return true;
}

async function fetchAllCompanyUrlsFromJobList(listingTarget = 25) {
  const companyUrls = new Set();
  const seenJobIds = new Set();
  let pagesVisited = 0;
  const maxPages = 40;

  while (seenJobIds.size < listingTarget && pagesVisited < maxPages) {
    pagesVisited += 1;

    await scrollJobListToEnd();
    const cards = getJobCards();

    for (const card of cards) {
      if (seenJobIds.size >= listingTarget) break;

      const jobId = getJobId(card);
      if (jobId && seenJobIds.has(jobId)) continue;

      clickCard(card);
      await sleep(250);

      if (jobId) seenJobIds.add(jobId);
      collectCompanyAnchors(card).forEach((url) => companyUrls.add(url));
    }

    if (seenJobIds.size >= listingTarget) break;

    const movedToNextPage = await clickNextPageIfAvailable();
    if (!movedToNextPage) break;

    await sleep(900);
  }

  return {
    companyUrls: Array.from(companyUrls),
    listingsProcessed: seenJobIds.size,
    pagesVisited
  };
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
      const listingTarget = Number.parseInt(message.payload?.listingTarget, 10) || 25;
      const data = await fetchAllCompanyUrlsFromJobList(listingTarget);
      sendResponse({ ok: true, ...data });
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
