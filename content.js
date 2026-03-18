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
      '[role="button"][componentkey^="job-card-component-ref-"], [data-view-name="job-search-job-card"], .job-card-container[data-job-id], li[data-occludable-job-id] .job-card-container'
    )
  );
}

function getCardJobId(card) {
  return (
    card?.getAttribute("data-job-id") ||
    card?.closest("[data-job-id]")?.getAttribute("data-job-id") ||
    card?.closest("li[data-occludable-job-id]")?.getAttribute("data-occludable-job-id") ||
    card?.getAttribute("componentkey")?.match(/(\d{6,})$/)?.[1] ||
    card?.querySelector('[componentkey^="job-card-component-ref-"]')?.getAttribute("componentkey")?.match(/(\d{6,})$/)?.[1] ||
    ""
  );
}

function buildJobUrlFromId(jobId) {
  return jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : "";
}

function getCardKey(card, index) {
  const jobId =
    getCardJobId(card) ||
    card?.querySelector('[componentkey^="job-card-component-ref-"]')?.getAttribute("componentkey") ||
    "";

  if (jobId) return `job:${jobId}`;

  const title =
    card?.querySelector("a.job-card-list__title--link")?.textContent?.trim() ||
    card?.querySelector("p span.d5843e4c")?.textContent?.trim() ||
    card?.textContent?.trim()?.slice(0, 120) ||
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

  if (typeof el.focus === "function") {
    el.focus({ preventScroll: true });
  }

  const eventSpecs = [
    ["pointerover", PointerEvent],
    ["mouseover", MouseEvent],
    ["pointerenter", PointerEvent],
    ["mouseenter", MouseEvent],
    ["pointerdown", PointerEvent],
    ["mousedown", MouseEvent],
    ["pointerup", PointerEvent],
    ["mouseup", MouseEvent],
    ["click", MouseEvent]
  ];

  for (const [type, EventCtor] of eventSpecs) {
    el.dispatchEvent(
      new EventCtor(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        detail: 1,
        pointerType: "mouse"
      })
    );
  }

  if (typeof el.click === "function") {
    el.click();
  }

  el.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
  );
  el.dispatchEvent(
    new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })
  );
}

function findClosestClickableAncestor(node, root) {
  let current = node;
  while (current && current !== root && current !== document.body) {
    if (
      current.matches?.('[role="button"]') ||
      current.matches?.('a[href*="/jobs/view/"]') ||
      current.matches?.('button:not([aria-label*="Dismiss"])') ||
      current.hasAttribute?.("componentkey")
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function findCardActivationTarget(card) {
  const directCandidates = [
    card.matches?.('[role="button"][componentkey^="job-card-component-ref-"]') ? card : null,
    card.matches?.('[role="button"]') ? card : null,
    card.querySelector('[role="button"][componentkey^="job-card-component-ref-"]'),
    card.querySelector("a.job-card-list__title--link"),
    card.querySelector("a.job-card-container__link"),
    card.querySelector("p span.d5843e4c"),
    card.querySelector("p._270d69ec span"),
    card.querySelector("figure"),
    card.querySelector("img")
  ].filter(Boolean);

  for (const candidate of directCandidates) {
    const clickableAncestor = findClosestClickableAncestor(candidate, card.parentElement || card);
    if (clickableAncestor) return clickableAncestor;
    if (candidate.matches?.('[role="button"], a[href*="/jobs/view/"]')) return candidate;
  }

  const genericRoleButton = Array.from(card.querySelectorAll('[role="button"]')).find(
    (el) => !/dismiss/i.test(el.getAttribute('aria-label') || '')
  );
  if (genericRoleButton) return genericRoleButton;

  return card;
}

function getCardActivationCandidates(card) {
  const contentBlock = card.querySelector("figure")?.closest("div");
  const candidates = [
    findCardActivationTarget(card),
    contentBlock,
    card.querySelector("figure"),
    card.querySelector("img"),
    card.querySelector("p span.d5843e4c"),
    card.querySelector("p._270d69ec"),
    card,
    card.parentElement
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}

function activateCard(card) {
  const candidates = getCardActivationCandidates(card);
  for (const candidate of candidates) {
    clickElement(candidate);
  }
}


function getCurrentDetailsFingerprint(card) {
  const details = extractJobDetails(card);
  return JSON.stringify([
    details.jobTitle || "",
    details.jobUrl || "",
    details.companyProfileUrl || "",
    details.companyDisplayName || ""
  ]);
}

async function activateCardAndWait(card, previousFingerprint = "") {
  const candidates = getCardActivationCandidates(card);

  for (const candidate of candidates) {
    clickElement(candidate);

    for (let i = 0; i < 8; i += 1) {
      await sleep(250);
      const nextFingerprint = getCurrentDetailsFingerprint(card);
      const details = extractJobDetails(card);
      const hasUsefulData = Boolean(details.jobTitle || details.companyProfileUrl || details.jobUrl);
      const changed = nextFingerprint && nextFingerprint !== previousFingerprint;
      if (hasUsefulData && (changed || !previousFingerprint)) {
        return { clicked: true, details, fingerprint: nextFingerprint };
      }
    }
  }

  return {
    clicked: false,
    details: extractJobDetails(card),
    fingerprint: getCurrentDetailsFingerprint(card)
  };
}

function extractCardLocalDetails(card) {
  const textNodes = Array.from(card.querySelectorAll("p, span")).map((el) => textOf(el)).filter(Boolean);
  const postedTime = textNodes.find((v) => /hour|day|week|month|ago/i.test(v)) || "";
  const location =
    textOf(card.querySelector("p._270d69ec._2c2c3dd4._6c91228e")) ||
    textNodes.find((v) => /\(|remote|hybrid|on-site|united states|india|ca|ny|tx/i.test(v)) ||
    "";
  const companyDisplayName =
    textOf(card.querySelector("div._6c91228e p")) ||
    textOf(card.querySelector("p._270d69ec._2c2c3dd4")) ||
    "";
  const applicants = textNodes.find((v) => /applicant/i.test(v)) || "";
  const workType = textNodes.find((v) => /on-site|remote|hybrid/i.test(v)) || "";
  const employmentType = textNodes.find((v) => /full-time|part-time|contract|internship|temporary/i.test(v)) || "";
  const easyApply = textNodes.some((v) => /easy apply|apply/i.test(v)) ? "Yes" : "No";

  return {
    companyDisplayName,
    location,
    postedTime,
    applicants,
    workType,
    employmentType,
    easyApply
  };
}

function extractJobDetails(card) {
  const pane = document.querySelector('.jobs-search__job-details--container, [data-view-name="job-details"], main');
  const local = extractCardLocalDetails(card);

  const jobTitle =
    textOf(pane?.querySelector('a[href*="/jobs/view/"]')) ||
    textOf(card.querySelector('a.job-card-list__title--link, a[href*="/jobs/view/"]')) ||
    textOf(card.querySelector("p span.d5843e4c")) ||
    textOf(card.querySelector("p._270d69ec"));

  const jobId = getCardJobId(card);
  const jobUrlRaw =
    pane?.querySelector('a[href*="/jobs/view/"]')?.href ||
    card.querySelector('a[href*="/jobs/view/"]')?.href ||
    buildJobUrlFromId(jobId) ||
    "";
  const jobUrl = jobUrlRaw ? new URL(jobUrlRaw, window.location.origin).href : "";

  const companyAnchor =
    pane?.querySelector('a[href*="/company/"]') ||
    card.querySelector('a[href*="/company/"]');

  const companyProfileUrl = normalizeLinkedInCompanyUrl(companyAnchor?.href || "") || "";
  const companyDisplayName = textOf(companyAnchor) || textOf(card.querySelector('p a[href*="/company/"]')) || local.companyDisplayName;

  const paneMeta = textOf(pane?.querySelector("p.ba8b842d._6ae9bfc9"));
  const location = local.location || paneMeta || textOf(card.querySelector(".job-card-container__metadata-wrapper"));

  const paneApplicants = textOf(pane?.querySelector("p.ba8b842d._6ae9bfc9.d051f947"));
  const chips = Array.from(pane?.querySelectorAll('a[href*="jobs/search-results"], span') || []).map((el) => textOf(el));
  const paneWorkType = chips.find((v) => /on-site|remote|hybrid/i.test(v)) || "";
  const paneEmploymentType = chips.find((v) => /full-time|part-time|contract|internship|temporary/i.test(v)) || "";
  const panePostedTime = chips.find((v) => /hour|day|week|month|ago/i.test(v)) || "";
  const paneEasyApply = chips.some((v) => /easy apply/i.test(v)) || !!pane?.querySelector('[aria-label*="Easy Apply"]');

  return {
    jobTitle,
    jobUrl,
    companyDisplayName,
    companyProfileUrl,
    location,
    postedTime: local.postedTime || panePostedTime,
    applicants: local.applicants || paneApplicants || (location.includes("applicant") ? location : ""),
    workType: local.workType || paneWorkType,
    employmentType: local.employmentType || paneEmploymentType,
    easyApply: local.easyApply === "Yes" || paneEasyApply ? "Yes" : "No"
  };
}

async function collectAfterCardClick(card, previousJobTitle = "", rounds = 12) {
  let details = null;

  for (let i = 0; i < rounds; i += 1) {
    details = extractJobDetails(card);
    const hasUsefulData = details.companyProfileUrl || details.jobTitle || details.jobUrl;
    const changedListing = details.jobTitle && details.jobTitle !== previousJobTitle;
    const completeEnough = Boolean(details.jobTitle && details.jobUrl);
    if ((completeEnough || hasUsefulData) && (changedListing || !previousJobTitle)) break;
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

      const previousFingerprint = listings[listings.length - 1]?.detailsFingerprint || "";
      const activation = await activateCardAndWait(card, previousFingerprint);
      if (!activation.clicked) {
        continue;
      }

      const previousJobTitle = listings[listings.length - 1]?.jobTitle || "";
      const details = activation.details?.jobTitle || activation.details?.companyProfileUrl
        ? activation.details
        : await collectAfterCardClick(card, previousJobTitle);
      const companyProfileUrl = normalizeLinkedInCompanyUrl(details.companyProfileUrl || "") || "";
      const jobUrl = details.jobUrl || buildJobUrlFromId(getCardJobId(card));
      if (companyProfileUrl) companyUrls.add(companyProfileUrl);

      if (!details.jobTitle && !jobUrl && !companyProfileUrl) {
        continue;
      }

      listings.push({
        ...details,
        jobUrl,
        companyProfileUrl,
        cardKey,
        detailsFingerprint: activation.fingerprint
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

function normalizeWebsiteHref(rawHref) {
  if (!rawHref) return "";

  try {
    const url = new URL(rawHref, window.location.origin);
    const lower = url.href.toLowerCase();

    if (lower.startsWith("tel:") || lower.startsWith("mailto:") || lower.startsWith("javascript:")) return "";

    // Handle LinkedIn redirect wrappers that carry real external URL in query params.
    if (url.hostname.includes("linkedin.com")) {
      const nested = url.searchParams.get("url") || url.searchParams.get("redirect") || url.searchParams.get("u");
      if (nested) {
        try {
          const decoded = decodeURIComponent(nested);
          const nestedUrl = new URL(decoded);
          if (nestedUrl.protocol === "http:" || nestedUrl.protocol === "https:") {
            return nestedUrl.href;
          }
        } catch {
          // keep falling through
        }
      }

      // direct LinkedIn URLs are not company websites
      return "";
    }

    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    return "";
  } catch {
    return "";
  }
}

function isLikelyWebsiteUrl(href) {
  return Boolean(normalizeWebsiteHref(href));
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
      const existing = fieldMap.get(label) || [];
      fieldMap.set(label, [...existing, ...values]);
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
      const normalized = normalizeWebsiteHref(href);
      if (normalized) return normalized;
    }

    const txt = cleanFieldText(dd.textContent);
    if (/^https?:\/\//i.test(txt)) return txt;
  }

  const fallbackAnchors = Array.from(document.querySelectorAll('dl a[href]'));
  for (const a of fallbackAnchors) {
    const href = a.getAttribute("href") || "";
    const normalized = normalizeWebsiteHref(href);
    if (normalized) return normalized;
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
