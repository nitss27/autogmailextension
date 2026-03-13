function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textOf(el) {
  return el?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function normalizeLinkedInCompanyUrl(rawUrl) {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl, window.location.origin);
    if (url.hostname !== "www.linkedin.com") return null;
    if (!url.pathname.includes("/company/")) return null;

    const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
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
      '[data-view-name="job-search-job-card"], .job-card-container[data-job-id], li[data-occludable-job-id] .job-card-container'
    )
  );
}

function getCardKey(card, index) {
  const jobId =
    card?.getAttribute("data-job-id") ||
    card?.closest("[data-job-id]")?.getAttribute("data-job-id") ||
    card?.closest("li[data-occludable-job-id]")?.getAttribute("data-occludable-job-id") ||
    card?.querySelector('[componentkey^="job-card-component-ref-"]')?.getAttribute("componentkey") ||
    "";

  if (jobId) return `job:${jobId}`;

  const title =
    card?.querySelector("a.job-card-list__title--link")?.textContent?.trim() ||
    card?.querySelector("[role='button']")?.textContent?.trim()?.slice(0, 120) ||
    "untitled";

  return `fallback:${index}:${title}`;
}

function getListContainer() {
  return (
    document.querySelector('[data-testid="lazy-column"]') ||
    document.querySelector(".jobs-search-results-list") ||
    document.querySelector(".scaffold-layout__list-container") ||
    null
  );
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
  const target =
    card.querySelector('[role="button"][componentkey^="job-card-component-ref-"]') ||
    card.querySelector('[role="button"]') ||
    card.querySelector("a.job-card-list__title--link") ||
    card.querySelector("a.job-card-container__link") ||
    card;

  clickElement(target);
}

function extractJobDetails(card) {
  const pane = document.querySelector('.jobs-search__job-details--container, [data-view-name="job-details"], main');

  const jobTitle =
    textOf(pane?.querySelector('a[href*="/jobs/view/"]')) ||
    textOf(card.querySelector('a.job-card-list__title--link, a[href*="/jobs/view/"]'));

  const jobUrlRaw =
    pane?.querySelector('a[href*="/jobs/view/"]')?.href ||
    card.querySelector('a[href*="/jobs/view/"]')?.href ||
    "";
  const jobUrl = jobUrlRaw ? new URL(jobUrlRaw, window.location.origin).href : "";

  const companyAnchor =
    pane?.querySelector('a[href*="/company/"]') ||
    card.querySelector('a[href*="/company/"]');

  const companyProfileUrl = normalizeLinkedInCompanyUrl(companyAnchor?.href || "") || "";
  const companyDisplayName = textOf(companyAnchor) || textOf(card.querySelector('p a[href*="/company/"]'));

  const metaLine =
    textOf(pane?.querySelector("p.ba8b842d._6ae9bfc9")) ||
    textOf(card.querySelector(".job-card-container__metadata-wrapper"));

  const applicantsText =
    textOf(pane?.querySelector("p.ba8b842d._6ae9bfc9.d051f947")) ||
    (metaLine.includes("applicant") ? metaLine : "");

  const chips = Array.from(pane?.querySelectorAll('a[href*="jobs/search-results"], span') || []).map((el) => textOf(el));
  const workType = chips.find((v) => /on-site|remote|hybrid/i.test(v)) || "";
  const employmentType = chips.find((v) => /full-time|part-time|contract|internship|temporary/i.test(v)) || "";
  const postedTime = chips.find((v) => /hour|day|week|month|ago/i.test(v)) || "";
  const easyApply = chips.some((v) => /easy apply/i.test(v)) || !!pane?.querySelector('[aria-label*="Easy Apply"]');

  return {
    jobTitle,
    jobUrl,
    companyDisplayName,
    companyProfileUrl,
    location: metaLine,
    postedTime,
    applicants: applicantsText,
    workType,
    employmentType,
    easyApply: easyApply ? "Yes" : "No"
  };
}

async function collectAfterCardClick(card, rounds = 12) {
  let details = null;

  for (let i = 0; i < rounds; i += 1) {
    details = extractJobDetails(card);
    if (details.companyProfileUrl || details.jobTitle) break;
    await sleep(250);
  }

  return details || extractJobDetails(card);
}

async function scrollJobListToEnd() {
  const container = getListContainer();
  let stable = 0;
  let lastPos = -1;

  while (stable < 5) {
    if (container) {
      container.scrollTop = container.scrollHeight;
    } else {
      window.scrollTo(0, document.body.scrollHeight);
    }

    await sleep(700);

    const pos = container ? container.scrollTop : window.scrollY;
    if (pos === lastPos) {
      stable += 1;
    } else {
      stable = 0;
      lastPos = pos;
    }
  }
}

function findNextPaginationButton() {
  const selectors = [
    'button[data-testid="pagination-controls-next-button-visible"]',
    'button[data-testid="pagination-controls-next-button"]',
    'button.jobs-search-pagination__button--next[aria-label*="View next page"]',
    'button.jobs-search-pagination__button--next',
    'button[aria-label="View next page"]'
  ];

  for (const selector of selectors) {
    const button = document.querySelector(selector);
    if (button) return button;
  }

  return null;
}

async function clickNextPageIfAvailable() {
  const nextBtn = findNextPaginationButton();

  if (!nextBtn || nextBtn.disabled || nextBtn.getAttribute("aria-disabled") === "true") {
    return false;
  }

  const firstBefore = getCardKey(getJobCards()[0], 0);
  clickElement(nextBtn);

  for (let i = 0; i < 40; i += 1) {
    await sleep(300);
    const firstAfter = getCardKey(getJobCards()[0], 0);
    if (firstAfter && firstAfter !== firstBefore) return true;
  }

  return false;
}

async function fetchAllCompanyUrlsFromJobList(listingTarget = 25) {
  const companyUrls = new Set();
  const listings = [];
  const seenCardKeys = new Set();
  let pagesVisited = 0;
  const maxPages = 50;

  while (listings.length < listingTarget && pagesVisited < maxPages) {
    pagesVisited += 1;
    await scrollJobListToEnd();

    const cards = getJobCards();
    for (let i = 0; i < cards.length; i += 1) {
      if (listings.length >= listingTarget) break;

      const card = cards[i];
      const cardKey = getCardKey(card, i);
      if (seenCardKeys.has(cardKey)) continue;

      activateCard(card);
      await sleep(320);

      const details = await collectAfterCardClick(card);
      const companyProfileUrl = normalizeLinkedInCompanyUrl(details.companyProfileUrl || "") || "";
      if (companyProfileUrl) companyUrls.add(companyProfileUrl);

      listings.push({
        ...details,
        companyProfileUrl,
        cardKey
      });
      seenCardKeys.add(cardKey);
    }

    if (listings.length >= listingTarget) break;

    const movedToNextPage = await clickNextPageIfAvailable();
    if (!movedToNextPage) break;

    await sleep(1200);
  }

  return {
    companyUrls: Array.from(companyUrls),
    listings,
    listingsProcessed: listings.length,
    pagesVisited
  };
}

function cleanFieldText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isLikelyWebsiteUrl(href) {
  if (!href) return false;
  const lower = href.toLowerCase();
  if (lower.startsWith("tel:") || lower.startsWith("mailto:") || lower.startsWith("javascript:")) return false;
  if (lower.includes("linkedin.com")) return false;
  return lower.startsWith("http://") || lower.startsWith("https://");
}

function readAboutDefinitionList() {
  const fieldMap = new Map();
  const dls = Array.from(document.querySelectorAll("dl.overflow-hidden, dl"));

  for (const dl of dls) {
    const dts = Array.from(dl.querySelectorAll(":scope > dt"));
    for (const dt of dts) {
      const headingEl = dt.querySelector("h3");
      const label = cleanFieldText(headingEl?.textContent).toLowerCase();
      if (!label) continue;

      const values = [];
      let dd = dt.nextElementSibling;
      while (dd && dd.tagName === "DD") {
        values.push(dd);
        dd = dd.nextElementSibling;
      }

      if (!values.length) continue;
      fieldMap.set(label, values);
    }
  }

  return fieldMap;
}

function pickWebsiteFromFieldMap(fieldMap) {
  const websiteDDs = fieldMap.get("website") || [];
  for (const dd of websiteDDs) {
    const anchors = Array.from(dd.querySelectorAll("a[href]"));
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      if (isLikelyWebsiteUrl(href)) return href.trim();
    }

    const txt = cleanFieldText(dd.textContent);
    if (/^https?:\/\//i.test(txt)) return txt;
  }

  const fallbackAnchors = Array.from(document.querySelectorAll('dl a[href]'));
  for (const a of fallbackAnchors) {
    const href = a.getAttribute("href") || "";
    if (isLikelyWebsiteUrl(href)) return href.trim();
  }

  return "";
}

function pickFieldText(fieldMap, label) {
  const values = fieldMap.get(label.toLowerCase()) || [];
  if (!values.length) return "";
  return cleanFieldText(values[0].textContent);
}

async function waitForAboutFields(timeoutMs = 9000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const hasDL = document.querySelector("dl.overflow-hidden, dl");
    const hasHeadings = document.querySelector("dt h3");
    if (hasDL && hasHeadings) return;
    await sleep(250);
  }
}

async function extractCompanyDataFromCurrentPage() {
  await waitForAboutFields();

  const fieldMap = readAboutDefinitionList();
  const companyLinkedInUrl = normalizeLinkedInCompanyUrl(window.location.href) || window.location.href;

  const companyName =
    cleanFieldText(document.querySelector("h1")?.textContent) ||
    cleanFieldText(document.querySelector(".org-top-card-summary__title")?.textContent) ||
    cleanFieldText(document.title?.replace(" | LinkedIn", "")) ||
    "";

  return {
    companyName,
    companyLinkedInUrl,
    aboutUrl: companyLinkedInUrl.replace(/\/+$/, "") + "/about/",
    website: pickWebsiteFromFieldMap(fieldMap),
    phone: pickFieldText(fieldMap, "Phone"),
    industry: pickFieldText(fieldMap, "Industry"),
    companySize: pickFieldText(fieldMap, "Company size"),
    headquarters: pickFieldText(fieldMap, "Headquarters"),
    founded: pickFieldText(fieldMap, "Founded"),
    specialties: pickFieldText(fieldMap, "Specialties"),
    verifiedPageDate: pickFieldText(fieldMap, "Verified page"),
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
    (async () => {
      const details = await extractCompanyDataFromCurrentPage();
      sendResponse({ ok: true, details });
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message || "Failed to extract company details" });
    });
    return true;
  }
});
