const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const DEFAULT_TAB_LOAD_TIMEOUT_MS = 15000;
const TAB_SETTLE_MS = 50;
const MAX_SECONDARY_PAGES = 3;
const RUN_STATE_KEY = 'latestRunState';

let runInProgress = false;
let stopRequested = false;

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

async function clearRunState() {
  await chrome.storage.local.remove(RUN_STATE_KEY);
}

function waitForTabComplete(tabId, timeoutMs = DEFAULT_TAB_LOAD_TIMEOUT_MS) {
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

async function activateAndWait(tabId, tabLoadTimeoutMs) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  await waitForTabComplete(tabId, tabLoadTimeoutMs);
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

async function processOneUrl(url, excludeEmails, options) {
  let tab = null;
  const tabLoadTimeoutMs = options.tabLoadTimeoutMs;

  try {
    if (stopRequested) {
      return null;
    }

    tab = await createTab(url);
    await activateAndWait(tab.id, tabLoadTimeoutMs);

    const firstPass = await inspectTab(tab.id);
    const secondaryQueue = unique(firstPass.secondaryLinks).slice(0, MAX_SECONDARY_PAGES);
    const secondaryEmails = [];
    let verificationSeen = firstPass.robotVerificationDetected || isRobotVerificationContent(firstPass.text) || isRobotVerificationContent(firstPass.html);

    for (const link of secondaryQueue) {
      if (stopRequested) break;
      await chrome.tabs.update(tab.id, { url: link, active: true });
      await activateAndWait(tab.id, tabLoadTimeoutMs);
      const secondaryPass = await inspectTab(tab.id);
      verificationSeen = verificationSeen || secondaryPass.robotVerificationDetected || isRobotVerificationContent(secondaryPass.text) || isRobotVerificationContent(secondaryPass.html);
      secondaryEmails.push(...secondaryPass.emails);
    }

    if (stopRequested) {
      return null;
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

function resolveTimeoutMs(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1000) return DEFAULT_TAB_LOAD_TIMEOUT_MS;
  return Math.round(value);
}

async function runProcessing(urls, requestId, excludeEmails, options, startIndex = 0, initialResults = []) {
  const results = [...initialResults];
  runInProgress = true;
  stopRequested = false;

  try {
    await setRunState({
      status: 'running',
      requestId,
      total: urls.length,
      current: startIndex,
      domain: '',
      results,
      urls,
      nextIndex: startIndex,
      excludeEmails,
      tabLoadTimeoutMs: options.tabLoadTimeoutMs
    });

    for (let i = startIndex; i < urls.length; i += 1) {
      if (stopRequested) {
        await setRunState({
          status: 'paused',
          requestId,
          total: urls.length,
          current: i,
          domain: '',
          results,
          urls,
          nextIndex: i,
          excludeEmails,
          tabLoadTimeoutMs: options.tabLoadTimeoutMs
        });
        return results;
      }

      const url = urls[i];
      const domain = (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return url;
        }
      })();

      await setRunState({
        status: 'running',
        requestId,
        total: urls.length,
        current: i + 1,
        domain,
        results,
        urls,
        nextIndex: i,
        excludeEmails,
        tabLoadTimeoutMs: options.tabLoadTimeoutMs
      });

      chrome.runtime.sendMessage({
        type: 'PROCESS_PROGRESS',
        requestId,
        current: i + 1,
        total: urls.length,
        domain
      }).catch(() => {
        // popup may be closed
      });

      const result = await processOneUrl(url, excludeEmails, options);
      if (result) {
        results.push(result);
      }

      await setRunState({
        status: stopRequested ? 'paused' : 'running',
        requestId,
        total: urls.length,
        current: i + 1,
        domain,
        results,
        urls,
        nextIndex: i + 1,
        excludeEmails,
        tabLoadTimeoutMs: options.tabLoadTimeoutMs
      });

      if (stopRequested) {
        return results;
      }
    }

    await setRunState({
      status: 'done',
      requestId,
      total: urls.length,
      current: urls.length,
      domain: '',
      results,
      urls,
      nextIndex: urls.length,
      excludeEmails,
      tabLoadTimeoutMs: options.tabLoadTimeoutMs
    });

    return results;
  } catch (error) {
    const nextIndex = Math.min(results.length, urls.length);
    await setRunState({
      status: 'paused',
      requestId,
      total: urls.length,
      current: nextIndex,
      domain: '',
      results,
      urls,
      nextIndex,
      excludeEmails,
      tabLoadTimeoutMs: options.tabLoadTimeoutMs
    });
    throw error;
  } finally {
    runInProgress = false;
    stopRequested = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_LATEST_RESULTS') {
    (async () => {
      const state = await getRunState();
      sendResponse({ ok: true, state });
    })();
    return true;
  }

  if (message?.type === 'STOP_PROCESSING') {
    stopRequested = true;
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'RESET_RUN_STATE') {
    (async () => {
      await clearRunState();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === 'PROCESS_URLS') {
    if (runInProgress) {
      sendResponse({ ok: false, error: 'A run is already in progress.' });
      return false;
    }

    const urls = (message.urls || []).map((item) => normalizeUrl(String(item || ''))).filter(Boolean);
    const requestId = message.requestId || '';
    const excludeEmails = unique((message.excludeEmails || []).map((email) => String(email).toLowerCase().trim()).filter(Boolean));
    const options = {
      tabLoadTimeoutMs: resolveTimeoutMs(message.tabLoadTimeoutMs)
    };

    (async () => {
      try {
        if (message.reset) await clearRunState();
        const results = await runProcessing(urls, requestId, excludeEmails, options, 0, []);
        sendResponse({ ok: true, results });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    })();

    return true;
  }

  if (message?.type === 'PROCESS_REMAINING') {
    if (runInProgress) {
      sendResponse({ ok: false, error: 'A run is already in progress.' });
      return false;
    }

    (async () => {
      try {
        const state = await getRunState();
        if (!state?.urls?.length) {
          sendResponse({ ok: false, error: 'No previous list found to continue.' });
          return;
        }

        const startIndex = Math.max(0, Math.min(Number(state.nextIndex || state.results?.length || 0), state.urls.length));
        const baseResults = Array.isArray(state.results) ? state.results.slice(0, startIndex) : [];
        const excludeEmails = unique((message.excludeEmails || state.excludeEmails || []).map((email) => String(email).toLowerCase().trim()).filter(Boolean));
        const requestId = message.requestId || '';
        const options = {
          tabLoadTimeoutMs: resolveTimeoutMs(message.tabLoadTimeoutMs || state.tabLoadTimeoutMs)
        };

        if (startIndex >= state.urls.length) {
          sendResponse({ ok: true, results: state.results || [] });
          return;
        }

        const results = await runProcessing(state.urls, requestId, excludeEmails, options, startIndex, baseResults);
        sendResponse({ ok: true, results });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    })();

    return true;
  }

  return false;
});
