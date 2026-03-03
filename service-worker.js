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
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const anchors = [...doc.querySelectorAll('a[href]')];
  const links = anchors
    .map((anchor) => {
      try {
        return new URL(anchor.getAttribute('href'), baseUrl).toString();
      } catch {
        return null;
      }
    })
    .filter((href) => href && href.toLowerCase().includes('contact'));

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

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete' && !done) {
        done = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }).catch(() => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('Tab not available'));
    });
  });
}

async function inspectTabContent(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const bodyHtml = document.documentElement?.outerHTML || document.body?.innerHTML || '';
      const bodyText = document.body?.innerText || '';
      const emails = [...new Set([...(bodyHtml.match(emailRegex) || []), ...(bodyText.match(emailRegex) || [])].map((e) => e.toLowerCase()))];
      const contactLinks = [...new Set(
        [...document.querySelectorAll('a[href]')]
          .map((a) => a.href)
          .filter((href) => href && href.toLowerCase().includes('contact'))
      )];

      return {
        pageUrl: location.href,
        html: bodyHtml,
        emails,
        contactLinks
      };
    }
  });

  return injection?.result || { pageUrl: '', html: '', emails: [], contactLinks: [] };
}

async function processSingleWebsiteWithTab(url) {
  let tab = null;

  try {
    tab = await createTab(url);
    await waitForTabComplete(tab.id);

    const inspected = await inspectTabContent(tab.id);

    let sourceHtml = '';
    try {
      sourceHtml = await fetchPage(url);
    } catch {
      sourceHtml = inspected.html;
    }

    const mainEmails = unique([
      ...inspected.emails,
      ...extractEmailsFromText(inspected.html),
      ...extractEmailsFromText(sourceHtml)
    ]);

    const contactLinks = unique([
      ...inspected.contactLinks,
      ...extractContactLinksFromHtml(inspected.html, inspected.pageUrl || url),
      ...extractContactLinksFromHtml(sourceHtml, url)
    ]);

    const contactEmailLists = await Promise.all(
      contactLinks.map(async (contactUrl) => {
        try {
          const html = await fetchPage(contactUrl);
          return extractEmailsFromText(html);
        } catch {
          return [];
        }
      })
    );

    const allEmails = unique([...mainEmails, ...contactEmailLists.flat()]);

    return {
      url,
      domain: new URL(url).hostname,
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
        // ignore tab close failures
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
