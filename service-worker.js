const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TAB_LOAD_TIMEOUT_MS = 25000;
const TAB_ACTIVATION_SETTLE_MS = 700;

function normalizeUrl(input) {
  const raw = input.trim();
  if (!raw) return null;

  try {
    return new URL(raw).toString();
  } catch {
    try {
      return new URL(`https://${raw}`).toString();
    } catch {
      return null;
    }
  }
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractEmailsFromText(text) {
  return unique((text.match(EMAIL_REGEX) || []).map((email) => email.toLowerCase()));
}

function extractContactLinksFromHtml(html, baseUrl) {
  const hrefRegex = /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  const links = [];
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    const hrefRaw = match[1] || match[2] || match[3] || '';
    if (!hrefRaw) continue;

    try {
      const absolute = new URL(hrefRaw, baseUrl).toString();
      if (absolute.toLowerCase().includes('contact')) links.push(absolute);
    } catch {
      // ignore invalid hrefs
    }
  }

  return unique(links);
}

async function fetchPage(url) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    credentials: 'omit'
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function createTab(url) {
  return chrome.tabs.create({ url, active: false });
}

async function closeTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // ignore close failures
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function activateTab(tabId) {
  if (!tabId) return;
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  await sleep(TAB_ACTIVATION_SETTLE_MS);
}

function waitForTabComplete(tabId, timeoutMs = TAB_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (callback) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      callback();
    };

    const timeout = setTimeout(() => finish(() => reject(new Error('Tab load timeout'))), timeoutMs);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish(resolve);
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') finish(resolve);
      })
      .catch(() => finish(() => reject(new Error('Tab not available'))));
  });
}

async function inspectRegularPage(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const html = document.documentElement?.outerHTML || '';
      const text = document.body?.innerText || '';
      const mailtoEmails = [...document.querySelectorAll('a[href^="mailto:"]')]
        .map((a) => a.getAttribute('href') || '')
        .map((href) => href.replace(/^mailto:/i, '').split('?')[0].trim())
        .filter(Boolean);

      const emails = [...new Set([
        ...(html.match(emailRegex) || []),
        ...(text.match(emailRegex) || []),
        ...mailtoEmails
      ].map((email) => email.toLowerCase()))];

      const contactLinks = [...new Set(
        [...document.querySelectorAll('a[href]')]
          .map((anchor) => anchor.href)
          .filter((href) => href && href.toLowerCase().includes('contact'))
      )];

      return { pageUrl: location.href, html, emails, contactLinks };
    }
  });

  return injection?.result || { pageUrl: '', html: '', emails: [], contactLinks: [] };
}

async function extractEmailsFromViewSource(url) {
  const viewSourceUrl = `view-source:${url}`;
  let tab = null;

  try {
    tab = await createTab(viewSourceUrl);
    await waitForTabComplete(tab.id);

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body?.innerText || document.documentElement?.innerText || ''
    });

    return extractEmailsFromText(injection?.result || '');
  } catch {
    return [];
  } finally {
    await closeTab(tab?.id);
  }
}

async function buildResultFromInspected(url, inspected) {
  const fetchedHomeHtml = await fetchPage(url).catch(() => inspected.html);

  const renderedEmails = unique([...inspected.emails, ...extractEmailsFromText(inspected.html)]);

  const contactLinks = unique([
    ...inspected.contactLinks,
    ...extractContactLinksFromHtml(inspected.html, inspected.pageUrl || url),
    ...extractContactLinksFromHtml(fetchedHomeHtml, url)
  ]);

  const homeSourceFromView = await extractEmailsFromViewSource(url);

  const contactSourceNested = [];
  for (const contactUrl of contactLinks) {
    const fromFetch = await fetchPage(contactUrl).then(extractEmailsFromText).catch(() => []);
    const fromViewSource = await extractEmailsFromViewSource(contactUrl);
    contactSourceNested.push(unique([...fromFetch, ...fromViewSource]));
  }

  const sourceEmails = unique([
    ...extractEmailsFromText(fetchedHomeHtml),
    ...homeSourceFromView,
    ...contactSourceNested.flat()
  ]);

  const emails = unique([...renderedEmails, ...sourceEmails]);

  return {
    url,
    domain: new URL(url).hostname,
    renderedEmails,
    sourceEmails,
    emails,
    contactLinks,
    totalEmails: emails.length
  };
}

async function processBatch(batchUrls) {
  const tabStates = await Promise.all(
    batchUrls.map(async (url) => {
      try {
        const tab = await createTab(url);
        return { url, tabId: tab.id };
      } catch (error) {
        return { url, createError: error instanceof Error ? error.message : 'Tab create failed' };
      }
    })
  );

  const inspectionResults = [];

  for (const state of tabStates) {
    if (state.createError || !state.tabId) {
      inspectionResults.push({
        url: state.url,
        error: state.createError || 'Tab not created',
        inspected: { pageUrl: state.url, html: '', emails: [], contactLinks: [] },
        tabId: null
      });
      continue;
    }

    try {
      await waitForTabComplete(state.tabId);
      await activateTab(state.tabId);
      const inspected = await inspectRegularPage(state.tabId);
      inspectionResults.push({ url: state.url, inspected, tabId: state.tabId });
    } catch (error) {
      inspectionResults.push({
        url: state.url,
        error: error instanceof Error ? error.message : 'Inspection failed',
        inspected: { pageUrl: state.url, html: '', emails: [], contactLinks: [] },
        tabId: state.tabId
      });
    }
  }

  await Promise.all(inspectionResults.map((item) => closeTab(item.tabId)));

  return Promise.all(
    inspectionResults.map(async ({ url, inspected, error }) => {
      try {
        const result = await buildResultFromInspected(url, inspected);
        return error ? { ...result, error } : result;
      } catch (processError) {
        return {
          url,
          domain: (() => {
            try {
              return new URL(url).hostname;
            } catch {
              return url;
            }
          })(),
          renderedEmails: [],
          sourceEmails: [],
          emails: [],
          contactLinks: [],
          totalEmails: 0,
          error: processError instanceof Error ? processError.message : (error || 'Unknown error')
        };
      }
    })
  );
}

async function processInBatches(urls, batchSize) {
  const results = [];

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchResults = await processBatch(batch);
    results.push(...batchResults);
  }

  return results;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'PROCESS_URLS') return false;

  const urls = unique((message.urls || []).map(normalizeUrl));
  const batchSize = Math.max(1, Number(message.maxTabsAtTime) || 5);

  (async () => {
    const results = await processInBatches(urls, batchSize);
    sendResponse({ ok: true, results });
  })();

  return true;
});
