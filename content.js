const SELECTOR_CONFIG_STORAGE_KEY = "selectorConfig";
const selectorDefaults = {
  jobCard: [
    'div[data-display-contents="true"] > div[role="button"][componentkey^="job-card-component-ref-"]',
    '[role="button"][componentkey^="job-card-component-ref-"]',
    '[data-view-name="job-search-job-card"]',
    '.job-card-container[data-job-id]',
    'li[data-occludable-job-id] .job-card-container'
  ],
  jobCardClickable: [
    ':scope',
    '[role="button"][componentkey^="job-card-component-ref-"]',
    'div[role="button"][componentkey^="job-card-component-ref-"]',
    '[role="button"][componentkey^="job-card-component-ref-"]',
    'a.job-card-list__title--link',
    'a.job-card-container__link',
    '[role="button"]'
  ],
  paginationNext: [
    'button[data-testid="pagination-controls-next-button-visible"]',
    'button[data-testid="pagination-controls-next-button"]',
    'button.jobs-search-pagination__button--next[aria-label*="View next page"]',
    'button.jobs-search-pagination__button--next',
    'button[aria-label="View next page"]'
  ],
  jobDetailsPane: ['.jobs-search__job-details--container', '[data-view-name="job-details"]', 'main']
};

const selectorTestPreviewLength = 120;
let selectorConfigCache = {};
let pickerSession = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textOf(el) {
  return el?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function previewText(el) {
  return textOf(el).slice(0, selectorTestPreviewLength);
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

async function loadSelectorConfig(force = false) {
  if (!force && selectorConfigCache && Object.keys(selectorConfigCache).length) return selectorConfigCache;

  const stored = await chrome.storage.local.get([SELECTOR_CONFIG_STORAGE_KEY]);
  selectorConfigCache = stored[SELECTOR_CONFIG_STORAGE_KEY] && typeof stored[SELECTOR_CONFIG_STORAGE_KEY] === "object"
    ? stored[SELECTOR_CONFIG_STORAGE_KEY]
    : {};
  return selectorConfigCache;
}

function getSelectorList(key) {
  const custom = selectorConfigCache[key];
  if (typeof custom === "string" && custom.trim()) return [custom.trim()];
  return selectorDefaults[key] || [];
}

function queryFirst(selectors, root = document) {
  for (const selector of selectors) {
    try {
      const match = root.querySelector(selector);
      if (match) return match;
    } catch {
      // ignore invalid selector
    }
  }
  return null;
}

function queryAll(selectors, root = document) {
  for (const selector of selectors) {
    try {
      const matches = Array.from(root.querySelectorAll(selector));
      if (matches.length) return matches;
    } catch {
      // ignore invalid selector
    }
  }
  return [];
}

function getJobCards() {
  return queryAll(getSelectorList("jobCard"));
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

  if (typeof el.focus === "function") {
    el.focus({ preventScroll: true });
  }

  const events = ["pointerover", "mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"];
  for (const type of events) {
    const EventCtor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    el.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, composed: true }));
  }

  if (typeof el.click === "function") {
    el.click();
  }

  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
}

function getJobDetailsPane() {
  return queryFirst(getSelectorList("jobDetailsPane"));
}

function getDetailsSignature() {
  const pane = getJobDetailsPane();
  if (!pane) return "";

  const jobHref = pane.querySelector('a[href*="/jobs/view/"]')?.href || "";
  const companyHref = pane.querySelector('a[href*="/company/"]')?.href || "";
  return `${jobHref}|${companyHref}|${previewText(pane).slice(0, 180)}`;
}

function findCardActivationTarget(card) {
  const customTarget = queryFirst(getSelectorList("jobCardClickable"), card);
  if (customTarget) return customTarget;

  return (
    card.matches?.('[role="button"][componentkey^="job-card-component-ref-"]') ? card : null
  ) || (
    card.querySelector('[role="button"][componentkey^="job-card-component-ref-"]')
  ) || (
    card.matches?.('[role="button"]') ? card : null
  ) || (
    card.querySelector('[role="button"]')
  ) || (
    card.querySelector("a.job-card-list__title--link")
  ) || (
    card.querySelector("a.job-card-container__link")
  ) || card;
}

async function activateCard(card) {
  const target = findCardActivationTarget(card);
  const signatureBefore = getDetailsSignature();
  const beforeSelected = card.getAttribute("aria-current") || card.getAttribute("aria-selected") || card.className;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    clickElement(target);
    await sleep(275);

    const signatureAfter = getDetailsSignature();
    const afterSelected = card.getAttribute("aria-current") || card.getAttribute("aria-selected") || card.className;

    if (signatureAfter && signatureAfter !== signatureBefore) return true;
    if (afterSelected !== beforeSelected) return true;
  }

  return false;
}

function extractJobDetails(card) {
  const pane = getJobDetailsPane();
  const cardParagraphs = Array.from(card.querySelectorAll("p"))
    .map((el) => textOf(el))
    .filter(Boolean);
  const cardVisibleSpans = Array.from(card.querySelectorAll("span"))
    .map((el) => textOf(el))
    .filter(Boolean);

  const jobTitle =
    textOf(pane?.querySelector('a[href*="/jobs/view/"]')) ||
    textOf(card.querySelector('a.job-card-list__title--link, a[href*="/jobs/view/"]')) ||
    cardVisibleSpans.find((value) => /verified job/i.test(value))?.replace(/\s*\(verified job\)\s*/i, "").trim() ||
    cardVisibleSpans.find((value) => value && value.length > 5) ||
    cardParagraphs[0] ||
    "";

  const jobUrlRaw =
    pane?.querySelector('a[href*="/jobs/view/"]')?.href ||
    card.querySelector('a[href*="/jobs/view/"]')?.href ||
    "";
  const jobUrl = jobUrlRaw ? new URL(jobUrlRaw, window.location.origin).href : "";

  const companyAnchor = pane?.querySelector('a[href*="/company/"]') || card.querySelector('a[href*="/company/"]');
  const companyProfileUrl = normalizeLinkedInCompanyUrl(companyAnchor?.href || "") || "";
  const companyDisplayName =
    textOf(companyAnchor) ||
    textOf(card.querySelector('p a[href*="/company/"]')) ||
    cardParagraphs.find((value) => value && value !== jobTitle && !/remote|hybrid|on-site|ago|posted|viewed/i.test(value)) ||
    "";

  const metaLine =
    textOf(pane?.querySelector("p.ba8b842d._6ae9bfc9")) ||
    textOf(card.querySelector(".job-card-container__metadata-wrapper")) ||
    cardParagraphs.find((value) => /remote|hybrid|on-site|united states|posted|ago/i.test(value)) ||
    "";

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

async function collectAfterCardClick(card, previousSignature = "", rounds = 16) {
  let details = null;

  for (let i = 0; i < rounds; i += 1) {
    details = extractJobDetails(card);
    const currentSignature = `${details.jobTitle}|${details.jobUrl}|${details.companyProfileUrl}`;
    const hasUsefulData = details.companyProfileUrl || details.jobTitle || details.jobUrl;
    const changedListing = currentSignature && currentSignature !== previousSignature;
    if (hasUsefulData && (changedListing || !previousSignature || details.companyProfileUrl)) break;
    await sleep(300);
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
  return queryFirst(getSelectorList("paginationNext"));
}

async function clickNextPageIfAvailable() {
  const nextBtn = findNextPaginationButton();
  if (!nextBtn || nextBtn.disabled || nextBtn.getAttribute("aria-disabled") === "true") return false;

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
  await loadSelectorConfig(true);

  const companyUrls = new Set();
  const listings = [];
  const seenCardKeys = new Set();
  const warnings = [];
  let pagesVisited = 0;
  const maxPages = 50;

  while (listings.length < listingTarget && pagesVisited < maxPages) {
    pagesVisited += 1;
    await scrollJobListToEnd();

    const cards = getJobCards();
    if (!cards.length) {
      throw new Error("No job cards found on the current LinkedIn page. Save a custom Listing card selector in settings and test it.");
    }

    let pageSuccessfulOpenCount = 0;

    for (let i = 0; i < cards.length; i += 1) {
      if (listings.length >= listingTarget) break;

      const card = cards[i];
      const cardKey = getCardKey(card, i);
      if (seenCardKeys.has(cardKey)) continue;

      const previousRow = listings[listings.length - 1];
      const previousSignature = previousRow ? `${previousRow.jobTitle}|${previousRow.jobUrl}|${previousRow.companyProfileUrl}` : "";
      const clicked = await activateCard(card);
      await sleep(clicked ? 600 : 900);

      const details = await collectAfterCardClick(card, previousSignature);
      const companyProfileUrl = normalizeLinkedInCompanyUrl(details.companyProfileUrl || "") || "";
      if (companyProfileUrl) companyUrls.add(companyProfileUrl);

      const status = companyProfileUrl || details.jobTitle || details.jobUrl ? "fetched" : "missing-details";
      if (status === "fetched") pageSuccessfulOpenCount += 1;

      listings.push({
        ...details,
        companyProfileUrl,
        status,
        cardKey
      });
      seenCardKeys.add(cardKey);
    }

    if (!pageSuccessfulOpenCount) {
      throw new Error(
        `The scraper could not open any listings on page ${pagesVisited}. Save/test the Listing click target and Job details pane selectors in Settings before running again.`
      );
    }

    if (listings.length >= listingTarget) break;

    const movedToNextPage = await clickNextPageIfAvailable();
    if (!movedToNextPage) {
      warnings.push(`Stopped after page ${pagesVisited} because the next-page button was unavailable or did not change the results list.`);
      break;
    }

    await sleep(1200);
  }

  return {
    companyUrls: Array.from(companyUrls),
    listings,
    listingsProcessed: listings.length,
    pagesVisited,
    warnings
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

    if (url.hostname.includes("linkedin.com")) {
      const nested = url.searchParams.get("url") || url.searchParams.get("redirect") || url.searchParams.get("u");
      if (nested) {
        try {
          const decoded = decodeURIComponent(nested);
          const nestedUrl = new URL(decoded);
          if (nestedUrl.protocol === "http:" || nestedUrl.protocol === "https:") return nestedUrl.href;
        } catch {
          // keep falling through
        }
      }
      return "";
    }

    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    return "";
  } catch {
    return "";
  }
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

  const fallbackAnchors = Array.from(document.querySelectorAll("dl a[href]"));
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

function cssEscapeIdentifier(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function escapeAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function uniqueSelector(selector, root = document) {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function hasTargetMatch(selector, target, root = document) {
  try {
    const matches = Array.from(root.querySelectorAll(selector));
    return matches.includes(target);
  } catch {
    return false;
  }
}

function getStableClasses(el) {
  return Array.from(el.classList).filter((name) => {
    if (!name || /^ember/.test(name)) return false;
    if (/^[a-f0-9]{6,}$/i.test(name)) return false;
    if (/^[a-z0-9]{8,}$/i.test(name) && !name.includes("-") && !name.includes("_")) return false;
    return true;
  });
}

function buildRepeatedSelector(el) {
  if (!(el instanceof Element)) return "";

  const explicitCandidates = [];
  if (el.matches('[data-view-name="job-search-job-card"]')) {
    explicitCandidates.push('[data-view-name="job-search-job-card"]');
  }
  if (el.matches('.job-card-container[data-job-id]')) {
    explicitCandidates.push('.job-card-container[data-job-id]');
    explicitCandidates.push('[data-job-id]');
  }
  if (el.matches('li[data-occludable-job-id]')) {
    explicitCandidates.push('li[data-occludable-job-id]');
    explicitCandidates.push('[data-occludable-job-id]');
  }

  for (const candidate of explicitCandidates) {
    if (hasTargetMatch(candidate, el) && document.querySelectorAll(candidate).length > 1) return candidate;
  }

  const tagName = el.tagName.toLowerCase();
  const stableClasses = getStableClasses(el);
  const repeatedCandidates = [];

  if (stableClasses.length) {
    repeatedCandidates.push(`${tagName}.${stableClasses[0]}`);
    if (stableClasses.length > 1) {
      repeatedCandidates.push(`${tagName}.${stableClasses.slice(0, 2).join(".")}`);
    }
  }

  const preferredAttrs = ["data-view-name", "data-testid", "role"];
  for (const attr of preferredAttrs) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    repeatedCandidates.unshift(`${tagName}[${attr}="${escapeAttributeValue(value)}"]`);
  }

  for (const candidate of repeatedCandidates) {
    try {
      const count = document.querySelectorAll(candidate).length;
      if (count > 1 && hasTargetMatch(candidate, el)) return candidate;
    } catch {
      // ignore invalid candidate
    }
  }

  const parent = el.parentElement;
  if (parent) {
    const parentClasses = getStableClasses(parent);
    if (parentClasses.length && stableClasses.length) {
      const candidate = `${parent.tagName.toLowerCase()}.${parentClasses[0]} > ${tagName}.${stableClasses[0]}`;
      try {
        const count = document.querySelectorAll(candidate).length;
        if (count > 1 && hasTargetMatch(candidate, el)) return candidate;
      } catch {
        // ignore invalid candidate
      }
    }
  }

  return "";
}

function getGlobalSelectorCandidateForElement(el) {
  if (!(el instanceof Element)) return "";

  const id = el.getAttribute("id");
  if (id) {
    const selector = `#${cssEscapeIdentifier(id)}`;
    if (uniqueSelector(selector)) return selector;
  }

  const preferredAttrs = ["data-testid", "data-view-name", "data-job-id", "componentkey", "aria-label", "role"];
  for (const attr of preferredAttrs) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    const selector = `${el.tagName.toLowerCase()}[${attr}="${escapeAttributeValue(value)}"]`;
    if (uniqueSelector(selector)) return selector;
  }

  const classes = getStableClasses(el);
  if (classes.length) {
    const selector = `${el.tagName.toLowerCase()}.${classes.slice(0, 3).map(cssEscapeIdentifier).join(".")}`;
    if (uniqueSelector(selector)) return selector;
  }

  const segments = [];
  let node = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
    let segment = node.tagName.toLowerCase();
    const nodeId = node.getAttribute("id");
    if (nodeId) {
      segment = `#${cssEscapeIdentifier(nodeId)}`;
      segments.unshift(segment);
      break;
    }

    const nodeClasses = getStableClasses(node);
    if (nodeClasses.length) {
      segment += `.${nodeClasses.slice(0, 2).map(cssEscapeIdentifier).join(".")}`;
    }

    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }

    segments.unshift(segment);
    const candidate = segments.join(" > ");
    if (uniqueSelector(candidate)) return candidate;
    node = node.parentElement;
  }

  return segments.join(" > ");
}

function buildRelativeSelector(root, target) {
  if (!(root instanceof Element) || !(target instanceof Element)) return "";
  if (root === target) return ":scope";

  const exactRelativeCandidates = [
    'a.job-card-list__title--link',
    'a.job-card-container__link',
    '[role="button"][componentkey^="job-card-component-ref-"]',
    '[role="button"]'
  ];
  for (const candidate of exactRelativeCandidates) {
    if (target.matches(candidate) || target.closest(candidate) === target) return candidate;
  }

  const segments = [];
  let node = target;
  while (node && node !== root) {
    let segment = node.tagName.toLowerCase();
    const classes = getStableClasses(node);
    const preferredAttrs = ["data-testid", "data-view-name", "componentkey", "aria-label", "role", "href"];
    let usedAttribute = false;

    for (const attr of preferredAttrs) {
      const value = node.getAttribute(attr);
      if (!value) continue;
      segment += `[${attr}="${escapeAttributeValue(value)}"]`;
      usedAttribute = true;
      break;
    }

    if (!usedAttribute && classes.length) {
      segment += `.${classes.slice(0, 2).map(cssEscapeIdentifier).join(".")}`;
    }

    if (!usedAttribute && !classes.length && node.tagName.toLowerCase() === "a" && node.getAttribute("href")) {
      const href = node.getAttribute("href");
      if (href?.includes("/jobs/view/")) {
        segment += '[href*="/jobs/view/"]';
      }
    }

    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      const uniqueWithinParent = siblings.filter((child) => {
        if (child === node) return true;
        return child.matches(segment);
      }).length === 1;
      if (!uniqueWithinParent && siblings.length > 1) {
        const plainSegment = node.tagName.toLowerCase();
        if (siblings.filter((child) => child.matches(plainSegment)).length === 1) {
          segment = plainSegment;
        }
      }
    }

    segments.unshift(segment);
    const candidate = `:scope > ${segments.join(" > ")}`;
    if (uniqueSelector(candidate, root)) return candidate;
    node = node.parentElement;
  }

  return segments.length ? `:scope > ${segments.join(" > ")}` : ":scope";
}

function normalizePickedElement(selectorKey, target) {
  if (!(target instanceof Element)) return target;

  if (selectorKey === "jobCard") {
    return (
      target.closest('[data-view-name="job-search-job-card"]') ||
      target.closest(".job-card-container[data-job-id]") ||
      target.closest("li[data-occludable-job-id]") ||
      target.closest("li") ||
      target
    );
  }

  if (selectorKey === "jobCardClickable") {
    return target;
  }

  if (selectorKey === "jobDetailsPane") {
    return (
      target.closest('.jobs-search__job-details--container') ||
      target.closest('[data-view-name="job-details"]') ||
      target.closest("main") ||
      target
    );
  }

  return target;
}

function getSelectorCandidateForElement(selectorKey, el) {
  const normalizedTarget = normalizePickedElement(selectorKey, el);

  if (selectorKey === "jobCard") {
    return buildRepeatedSelector(normalizedTarget) || getGlobalSelectorCandidateForElement(normalizedTarget);
  }

  if (selectorKey === "jobCardClickable") {
    const cardRoot =
      normalizedTarget.closest('[data-view-name="job-search-job-card"]') ||
      normalizedTarget.closest(".job-card-container[data-job-id]") ||
      normalizedTarget.closest("li[data-occludable-job-id]") ||
      normalizedTarget.closest("li");

    if (cardRoot && cardRoot !== normalizedTarget) {
      return buildRelativeSelector(cardRoot, normalizedTarget);
    }
  }

  return getGlobalSelectorCandidateForElement(normalizedTarget);
}

function removePickerSession(notifyCancelled = false) {
  if (!pickerSession) return;

  document.removeEventListener("mousemove", pickerSession.onMouseMove, true);
  document.removeEventListener("click", pickerSession.onClick, true);
  document.removeEventListener("keydown", pickerSession.onKeyDown, true);
  window.removeEventListener("scroll", pickerSession.onScroll, true);
  pickerSession.overlay?.remove();

  const cancelledKey = pickerSession.selectorKey;
  pickerSession = null;

  if (notifyCancelled) {
    chrome.runtime.sendMessage({
      type: "SELECTOR_PICK_CANCELLED",
      payload: { selectorKey: cancelledKey }
    }).catch(() => {});
  }
}

function updatePickerOverlay(target) {
  if (!pickerSession?.overlay || !(target instanceof Element)) return;
  const rect = target.getBoundingClientRect();
  const overlay = pickerSession.overlay;
  overlay.style.display = "block";
  overlay.style.position = "fixed";
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.textContent = pickerSession.label;
}

async function savePickedSelector(selectorKey, selector) {
  await loadSelectorConfig(true);
  selectorConfigCache = { ...selectorConfigCache, [selectorKey]: selector };
  await chrome.storage.local.set({ [SELECTOR_CONFIG_STORAGE_KEY]: selectorConfigCache });
  chrome.runtime.sendMessage({ type: "SELECTOR_PICKED", payload: { selectorKey, selector } }).catch(() => {});
}

function startSelectorPicker(selectorKey) {
  removePickerSession(false);

  const overlay = document.createElement("div");
  overlay.setAttribute("data-linkedin-extractor-picker", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    zIndex: "2147483647",
    pointerEvents: "none",
    border: "2px solid #0a66c2",
    background: "rgba(10, 102, 194, 0.12)",
    boxSizing: "border-box",
    display: "none",
    color: "#0a66c2",
    fontSize: "12px",
    fontWeight: "700",
    padding: "2px 4px"
  });
  document.documentElement.appendChild(overlay);

  const session = {
    selectorKey,
    label: selectorKey,
    overlay,
    currentTarget: null,
    onMouseMove(event) {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || target === overlay) return;
      session.currentTarget = normalizePickedElement(selectorKey, target);
      updatePickerOverlay(session.currentTarget);
    },
    onClick(event) {
      if (!(session.currentTarget instanceof Element)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const selector = getSelectorCandidateForElement(selectorKey, session.currentTarget);
      removePickerSession(false);
      savePickedSelector(selectorKey, selector).catch(() => {});
    },
    onKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      removePickerSession(true);
    },
    onScroll() {
      if (session.currentTarget) updatePickerOverlay(session.currentTarget);
    }
  };

  pickerSession = session;
  document.addEventListener("mousemove", session.onMouseMove, true);
  document.addEventListener("click", session.onClick, true);
  document.addEventListener("keydown", session.onKeyDown, true);
  window.addEventListener("scroll", session.onScroll, true);
}

function testSelector(selector) {
  try {
    const matches = Array.from(document.querySelectorAll(selector));
    return {
      ok: true,
      count: matches.length,
      preview: matches[0] ? previewText(matches[0]) : ""
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "Invalid selector"
    };
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[SELECTOR_CONFIG_STORAGE_KEY]) return;
  selectorConfigCache = changes[SELECTOR_CONFIG_STORAGE_KEY].newValue || {};
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === "START_SELECTOR_PICK") {
    const selectorKey = message.payload?.selectorKey;
    if (!selectorKey || !selectorDefaults[selectorKey]) {
      sendResponse({ ok: false, error: "Unknown selector key" });
      return true;
    }

    startSelectorPicker(selectorKey);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "TEST_SELECTOR") {
    const selector = String(message.payload?.selector || "").trim();
    if (!selector) {
      sendResponse({ ok: false, error: "Missing selector to test" });
      return true;
    }

    const result = testSelector(selector);
    sendResponse(result);
    return true;
  }

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
