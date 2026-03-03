const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TAB_LOAD_TIMEOUT_MS = 25000;

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
      if (absolute.toLowerCase().includes('contact')) {
        links.push(absolute);
      }
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

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function createTab(url) {
  return chrome.tabs.create({ url, active: false });
}

function waitForTabComplete(tabId, timeoutMs = TAB_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let done = false;

    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete' || done) return;
      done = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete' && !done) {
          done = true;
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      })
      .catch(() => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error('Tab not available'));
      });
  });
}

async function inspectRegularPage(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const html = document.documentElement?.outerHTML || '';
      const text = document.body?.innerText || '';
      const emails = [...new Set([...(html.match(emailRegex) || []), ...(text.match(emailRegex) || [])].map((email) => email.toLowerCase()))];
      const contactLinks = [...new Set(
        [...document.querySelectorAll('a[href]')]
          .map((anchor) => anchor.href)
          .filter((href) => href && href.toLowerCase().includes('contact'))
      )];

      return {
        pageUrl: location.href,
        html,
        emails,
        contactLinks
      };
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
    if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        // ignore
      }
    }
  }
}

async function processSingleWebsiteWithTab(url) {
  let tab = null;

  try {
    tab = await createTab(url);
    await waitForTabComplete(tab.id);

    const inspected = await inspectRegularPage(tab.id);

    let fetchedHtml = '';
    try {
      fetchedHtml = await fetchPage(url);
    } catch {
      fetchedHtml = inspected.html;
    }

    const renderedEmails = unique([
      ...inspected.emails,
      ...extractEmailsFromText(inspected.html)
    ]);

    const homeSourceEmails = unique([
      ...extractEmailsFromText(fetchedHtml),
      ...(await extractEmailsFromViewSource(url))
    ]);

    const contactLinks = unique([
      ...inspected.contactLinks,
      ...extractContactLinksFromHtml(inspected.html, inspected.pageUrl || url),
      ...extractContactLinksFromHtml(fetchedHtml, url)
    ]);

    const contactSourceEmailLists = await Promise.all(
      contactLinks.map(async (contactUrl) => {
        const fromFetch = await (async () => {
          try {
            const html = await fetchPage(contactUrl);
            return extractEmailsFromText(html);
          } catch {
            return [];
          }
        })();

        const fromViewSource = await extractEmailsFromViewSource(contactUrl);
        return unique([...fromFetch, ...fromViewSource]);
      })
    );

    const sourceEmails = unique([...homeSourceEmails, ...contactSourceEmailLists.flat()]);
    const allEmails = unique([...renderedEmails, ...sourceEmails]);

    return {
      url,
      domain: new URL(url).hostname,
      renderedEmails,
      sourceEmails,
      emails: allEmails,
      contactLinks,
      totalEmails: allEmails.length
    };
  } catch (error) {
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
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  } finally {
    if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        // ignore
      }
    }
  }
}

async function processInBatches(urls, batchSize) {
  const results = [];

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((url) => processSingleWebsiteWithTab(url)));
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
