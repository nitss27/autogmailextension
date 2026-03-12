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
    document.querySelectorAll(
      '.job-card-container[data-job-id], li[data-occludable-job-id] .job-card-container, .jobs-search-results-list__list-item [data-job-id]'
    )
  );
}

function getCardKey(card, index) {
  const fromCard = card?.getAttribute("data-job-id");
  const fromParent = card?.closest("li[data-occludable-job-id]")?.getAttribute("data-occludable-job-id");
  const jobId = fromCard || fromParent;
  if (jobId) return `job:${jobId}`;

  const title = card?.querySelector("a.job-card-list__title--link")?.textContent?.trim() || "untitled";
  return `fallback:${index}:${title}`;
}

function getListContainer() {
  const explicit = document.querySelector(".jobs-search-results-list") || document.querySelector(".scaffold-layout__list-container");
  if (explicit) return explicit;

  const firstCard = getJobCards()[0];
  let parent = firstCard?.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight + 40) {
      return parent;
    }
    parent = parent.parentElement;
  }

  return null;
}

function clickElement(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: "instant", block: "center" });
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function activateCard(card) {
  const targetSelectors = [
    "a.job-card-list__title--link",
    "a.job-card-container__link",
    '[role="button"]',
    ".job-card-container__link"
  ];

  for (const selector of targetSelectors) {
    const el = card.querySelector(selector);
    if (el) {
      clickElement(el);
      return;
    }
  }

  clickElement(card);
}

function collectCompanyAnchors(card) {
  const anchors = [
    ...(card ? Array.from(card.querySelectorAll('a[href*="/company/"]')) : []),
    ...Array.from(
      document.querySelectorAll(
        '.jobs-search__job-details--container a[href*="/company/"], .job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a, a[href*="/company/"]'
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

async function collectAfterCardClick(card, rounds = 10) {
  const urls = new Set();

  for (let i = 0; i < rounds; i += 1) {
    collectCompanyAnchors(card).forEach((url) => urls.add(url));
    if (urls.size > 0) break;
    await sleep(250);
  }

  return urls;
}

async function scrollJobListToEnd() {
  const container = getListContainer();
  let stable = 0;
  let lastPos = -1;

  while (stable < 5) {
    if (container) {
      const current = container.scrollTop;
      const next = Math.min(container.scrollHeight, current + Math.max(500, container.clientHeight || 600));
      container.scrollTop = next;
    } else {
      const y = window.scrollY;
      window.scrollTo(0, y + Math.max(700, window.innerHeight * 0.8));
    }

    await sleep(450);

    const pos = container ? container.scrollTop : window.scrollY;
    if (pos === lastPos) {
      stable += 1;
    } else {
      stable = 0;
      lastPos = pos;
    }
  }
}

async function clickNextPageIfAvailable() {
  const nextBtn = document.querySelector(
    'button.jobs-search-pagination__button--next[aria-label*="View next page"], button.jobs-search-pagination__button--next, button[aria-label="View next page"]'
  );

  if (!nextBtn || nextBtn.disabled || nextBtn.getAttribute("aria-disabled") === "true") {
    return false;
  }

  const firstBefore = getCardKey(getJobCards()[0], 0);
  clickElement(nextBtn);

  for (let i = 0; i < 35; i += 1) {
    await sleep(300);
    const firstAfter = getCardKey(getJobCards()[0], 0);
    if (firstAfter && firstAfter !== firstBefore) return true;
  }

  return false;
}

async function fetchAllCompanyUrlsFromJobList(listingTarget = 25) {
  const companyUrls = new Set();
  const seenCardKeys = new Set();
  let pagesVisited = 0;
  const maxPages = 50;

  while (seenCardKeys.size < listingTarget && pagesVisited < maxPages) {
    pagesVisited += 1;
    await scrollJobListToEnd();

    const cards = getJobCards();
    for (let i = 0; i < cards.length; i += 1) {
      if (seenCardKeys.size >= listingTarget) break;

      const card = cards[i];
      const cardKey = getCardKey(card, i);
      if (seenCardKeys.has(cardKey)) continue;

      activateCard(card);
      await sleep(320);

      const foundUrls = await collectAfterCardClick(card);
      foundUrls.forEach((url) => companyUrls.add(url));
      seenCardKeys.add(cardKey);
    }

    if (seenCardKeys.size >= listingTarget) break;

    const movedToNextPage = await clickNextPageIfAvailable();
    if (!movedToNextPage) break;

    await sleep(1200);
  }

  return {
    companyUrls: Array.from(companyUrls),
    listingsProcessed: seenCardKeys.size,
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
