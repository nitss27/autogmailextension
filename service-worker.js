const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TAB_LOAD_TIMEOUT_MS = 25000;
const TAB_SETTLE_MS = 500;
const MAX_SECONDARY_PAGES = 3;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTab(url) {
  return chrome.tabs.create({ url, active: true });
}

async function closeTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // ignore
  }
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

    chrome.tabs.get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') finish(resolve);
      })
      .catch(() => finish(() => reject(new Error('Tab unavailable'))));
  });
}

async function activateAndWait(tabId) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  await waitForTabComplete(tabId);
  await sleep(TAB_SETTLE_MS);
}

async function inspectTab(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const html = document.documentElement?.innerHTML || '';
      const emails = [
        ...(html.match(emailRegex) || []),
        ...[...document.querySelectorAll('a[href^="mailto:"]')]
          .map((a) => (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0])
      ];

      const secondaryLinks = [...document.querySelectorAll('a[href]')]
        .map((a) => a.href)
        .filter((href) => href && /(contact|about)/i.test(href));

      return {
        pageUrl: location.href,
        html,
        emails: [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))],
        secondaryLinks: [...new Set(secondaryLinks)]
      };
    }
  });

  return injection?.result || { pageUrl: '', html: '', emails: [], secondaryLinks: [] };
}

async function fetchSourceEmails(url) {
  const response = await fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  return extractEmailsFromText(html);
}

async function processOneUrl(url, progress) {
  let tab = null;

  try {
    tab = await createTab(url);
    await activateAndWait(tab.id);

    const firstPass = await inspectTab(tab.id);
    const secondaryQueue = unique(firstPass.secondaryLinks).slice(0, MAX_SECONDARY_PAGES);
    const secondaryEmails = [];

    for (const link of secondaryQueue) {
      await chrome.tabs.update(tab.id, { url: link, active: true });
      await activateAndWait(tab.id);
      const secondaryPass = await inspectTab(tab.id);
      secondaryEmails.push(...secondaryPass.emails, ...extractEmailsFromText(secondaryPass.html));
    }

    const sourceEmailsMain = await fetchSourceEmails(url).catch(() => []);
    const sourceEmailsSecondary = [];

    for (const link of secondaryQueue) {
      const emails = await fetchSourceEmails(link).catch(() => []);
      sourceEmailsSecondary.push(...emails);
    }

    const emails = unique([
      ...firstPass.emails,
      ...extractEmailsFromText(firstPass.html),
      ...secondaryEmails,
      ...sourceEmailsMain,
      ...sourceEmailsSecondary
    ]);

    return {
      url,
      domain: new URL(url).hostname,
      emails,
      totalEmails: emails.length
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
      totalEmails: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  } finally {
    await closeTab(tab?.id);
    if (progress?.requestId) {
      chrome.runtime.sendMessage({
        type: 'PROCESS_PROGRESS',
        requestId: progress.requestId,
        current: progress.current,
        total: progress.total,
        domain: progress.domain
      }).catch(() => {
        // popup may be closed
      });
    }
  }
}

async function processSequential(urls, requestId) {
  const results = [];

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    const domain = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    })();

    chrome.runtime.sendMessage({
      type: 'PROCESS_PROGRESS',
      requestId,
      current: i + 1,
      total: urls.length,
      domain
    }).catch(() => {
      // popup may be closed
    });

    const result = await processOneUrl(url, { requestId, current: i + 1, total: urls.length, domain });
    results.push(result);
  }

  return results;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'PROCESS_URLS') return false;

  const urls = unique((message.urls || []).map(normalizeUrl));
  const requestId = message.requestId || '';

  (async () => {
    const results = await processSequential(urls, requestId);
    sendResponse({ ok: true, results });
  })();

  return true;
});
