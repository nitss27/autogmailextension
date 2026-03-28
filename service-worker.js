const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TAB_LOAD_TIMEOUT_MS = 15000;
const TAB_SETTLE_MS = 150;
const MAX_SECONDARY_PAGES = 3;
const RUN_STATE_KEY = 'latestRunState';

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

function filterExcludedEmails(emails, excludeEmails) {
  if (!excludeEmails?.length) return emails;

  const exactEmails = new Set();
  const domainRules = [];

  for (const ruleRaw of excludeEmails) {
    const rule = String(ruleRaw || '').trim().toLowerCase();
    if (!rule) continue;

    if (rule.startsWith('@')) {
      const domain = rule.slice(1).trim();
      if (domain) domainRules.push(domain);
      continue;
    }

    exactEmails.add(rule);
  }

  return emails.filter((emailRaw) => {
    const email = String(emailRaw || '').trim().toLowerCase();
    if (!email) return false;
    if (exactEmails.has(email)) return false;

    const domain = email.includes('@') ? email.split('@').pop() : '';
    if (!domain) return true;

    for (const blockedDomain of domainRules) {
      if (domain === blockedDomain || domain.endsWith(`.${blockedDomain}`)) {
        return false;
      }
    }

    return true;
  });
}

function isRobotVerificationContent(text) {
  const normalized = String(text || '').toLowerCase();
  return normalized.includes('verify your are human by completing the action below');
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

async function setRunState(state) {
  await chrome.storage.local.set({ [RUN_STATE_KEY]: state });
}

async function getRunState() {
  const data = await chrome.storage.local.get(RUN_STATE_KEY);
  return data[RUN_STATE_KEY] || null;
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
      const text = document.body?.innerText || '';
      const emails = [
        ...(html.match(emailRegex) || []),
        ...[...document.querySelectorAll('a[href^="mailto:"]')]
          .map((a) => (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0])
      ];

      const secondaryLinks = [...document.querySelectorAll('a[href]')]
        .map((a) => a.href)
        .filter((href) => href && /(contact|about)/i.test(href));

      const normalizedCombined = `${text}\n${html}`.toLowerCase();
      const robotVerificationDetected = normalizedCombined.includes('verify your are human by completing the action below');

      return {
        pageUrl: location.href,
        html,
        text,
        emails: [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))],
        secondaryLinks: [...new Set(secondaryLinks)],
        robotVerificationDetected
      };
    }
  });

  return injection?.result || { pageUrl: '', html: '', text: '', emails: [], secondaryLinks: [], robotVerificationDetected: false };
}

async function fetchSourcePage(url) {
  const response = await fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  return {
    html,
    emails: extractEmailsFromText(html),
    robotVerificationDetected: isRobotVerificationContent(html)
  };
}

async function processOneUrl(url, excludeEmails) {
  let tab = null;

  try {
    tab = await createTab(url);
    await activateAndWait(tab.id);

    const firstPass = await inspectTab(tab.id);
    const secondaryQueue = unique(firstPass.secondaryLinks).slice(0, MAX_SECONDARY_PAGES);
    const secondaryEmails = [];
    let verificationSeen = firstPass.robotVerificationDetected || isRobotVerificationContent(firstPass.text) || isRobotVerificationContent(firstPass.html);

    for (const link of secondaryQueue) {
      await chrome.tabs.update(tab.id, { url: link, active: true });
      await activateAndWait(tab.id);
      const secondaryPass = await inspectTab(tab.id);
      verificationSeen = verificationSeen || secondaryPass.robotVerificationDetected || isRobotVerificationContent(secondaryPass.text) || isRobotVerificationContent(secondaryPass.html);
      secondaryEmails.push(...secondaryPass.emails);
    }

    const sourceMainPromise = fetchSourcePage(url).catch(() => ({ html: '', emails: [], robotVerificationDetected: false }));
    const sourceSecondaryPromise = Promise.all(
      secondaryQueue.map((link) => fetchSourcePage(link).catch(() => ({ html: '', emails: [], robotVerificationDetected: false })))
    );

    const sourceMain = await sourceMainPromise;
    const sourceSecondary = await sourceSecondaryPromise;
    verificationSeen = verificationSeen || sourceMain.robotVerificationDetected || sourceSecondary.some((item) => item.robotVerificationDetected);

    const sourceEmailsMain = sourceMain.emails;
    const sourceEmailsSecondary = sourceSecondary.flatMap((item) => item.emails);

    const emails = filterExcludedEmails(unique([
      ...firstPass.emails,
      ...secondaryEmails,
      ...sourceEmailsMain,
      ...sourceEmailsSecondary
    ]), excludeEmails);

    if (!emails.length && verificationSeen) {
      throw new Error('Skipped due to robot verification message. Verify first human.');
    }

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
  }
}

async function runProcessing(urls, requestId, excludeEmails) {
  const results = [];

  await setRunState({ status: 'running', requestId, total: urls.length, current: 0, domain: '', results: [] });

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    const domain = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    })();

    await setRunState({ status: 'running', requestId, total: urls.length, current: i + 1, domain, results });

    chrome.runtime.sendMessage({
      type: 'PROCESS_PROGRESS',
      requestId,
      current: i + 1,
      total: urls.length,
      domain
    }).catch(() => {
      // popup may be closed
    });

    const result = await processOneUrl(url, excludeEmails);
    results.push(result);
  }

  await setRunState({ status: 'done', requestId, total: urls.length, current: urls.length, domain: '', results });
  return results;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_LATEST_RESULTS') {
    (async () => {
      const state = await getRunState();
      sendResponse({ ok: true, state });
    })();
    return true;
  }

  if (message?.type !== 'PROCESS_URLS') return false;

  const urls = unique((message.urls || []).map(normalizeUrl));
  const requestId = message.requestId || '';
  const excludeEmails = unique((message.excludeEmails || []).map((email) => String(email).toLowerCase().trim()).filter(Boolean));

  (async () => {
    const results = await runProcessing(urls, requestId, excludeEmails);
    sendResponse({ ok: true, results });
  })();

  return true;
});
