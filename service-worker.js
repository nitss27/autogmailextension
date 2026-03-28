const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const DEFAULT_STRICT_TIMEOUT_SECONDS = 10;
const TAB_SETTLE_MS = 50;
const MAX_SECONDARY_PAGES = 3;
const RUN_STATE_KEY = 'latestRunState';

let runInProgress = false;
const runControl = {
  action: 'none',
  currentTabId: null,
  currentAbortController: null
};

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

async function closeTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // ignore
  }
}

function interruptCurrentWebsite() {
  const { currentTabId, currentAbortController } = runControl;
  if (currentAbortController) {
    currentAbortController.abort();
  }
  if (currentTabId) {
    closeTab(currentTabId);
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

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (callback) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      callback();
    };

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

function withTimeout(promise, timeoutMs, timeoutErrorMessage, onTimeout) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout?.();
      reject(new Error(timeoutErrorMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

async function activateAndWait(tabId, perSiteTimeoutMs) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  await withTimeout(waitForTabComplete(tabId), perSiteTimeoutMs, 'Website timed out', interruptCurrentWebsite);
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
        html,
        text,
        emails: [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))],
        secondaryLinks: [...new Set(secondaryLinks)],
        robotVerificationDetected
      };
    }
  });

  return injection?.result || { html: '', text: '', emails: [], secondaryLinks: [], robotVerificationDetected: false };
}

async function fetchSourcePage(url, signal) {
  const response = await fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit', signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  return {
    emails: extractEmailsFromText(html),
    robotVerificationDetected: isRobotVerificationContent(html)
  };
}

function resolveStrictTimeoutSeconds(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_STRICT_TIMEOUT_SECONDS;
  return Math.round(value);
}

function websiteFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function processOneUrl(url, excludeEmails, options) {
  const website = websiteFromUrl(url);
  const abortController = new AbortController();
  runControl.currentAbortController = abortController;
  runControl.currentTabId = null;

  const execute = async () => {
    let tab = null;

    try {
      tab = await chrome.tabs.create({ url, active: true });
      runControl.currentTabId = tab.id;
      await activateAndWait(tab.id, options.strictTimeoutMs);

      const firstPass = await inspectTab(tab.id);
      const secondaryQueue = unique(firstPass.secondaryLinks).slice(0, MAX_SECONDARY_PAGES);
      const secondaryEmails = [];
      let verificationSeen = firstPass.robotVerificationDetected || isRobotVerificationContent(firstPass.text) || isRobotVerificationContent(firstPass.html);

      for (const link of secondaryQueue) {
        if (runControl.action === 'stop') throw new Error('__STOP__');
        if (runControl.action === 'skip') throw new Error('__SKIP__');

        await chrome.tabs.update(tab.id, { url: link, active: true });
        await activateAndWait(tab.id, options.strictTimeoutMs);
        const secondaryPass = await inspectTab(tab.id);
        verificationSeen = verificationSeen || secondaryPass.robotVerificationDetected || isRobotVerificationContent(secondaryPass.text) || isRobotVerificationContent(secondaryPass.html);
        secondaryEmails.push(...secondaryPass.emails);
      }

      const sourceMainPromise = fetchSourcePage(url, abortController.signal).catch(() => ({ emails: [], robotVerificationDetected: false }));
      const sourceSecondaryPromise = Promise.all(
        secondaryQueue.map((link) => fetchSourcePage(link, abortController.signal).catch(() => ({ emails: [], robotVerificationDetected: false })))
      );

      const [sourceMain, sourceSecondary] = await Promise.all([sourceMainPromise, sourceSecondaryPromise]);
      verificationSeen = verificationSeen || sourceMain.robotVerificationDetected || sourceSecondary.some((item) => item.robotVerificationDetected);

      const sourceEmailsSecondary = sourceSecondary.flatMap((item) => item.emails);
      const emails = filterExcludedEmails(unique([
        ...firstPass.emails,
        ...secondaryEmails,
        ...sourceMain.emails,
        ...sourceEmailsSecondary
      ]), excludeEmails);

      if (!emails.length && verificationSeen) {
        return { website, emails: [], error: 'Skipped due to robot verification message. Verify first human.' };
      }

      return { website, emails };
    } finally {
      await closeTab(tab?.id);
    }
  };

  try {
    const result = await withTimeout(execute(), options.strictTimeoutMs, 'Website timed out', interruptCurrentWebsite);
    return { type: 'result', result };
  } catch (error) {
    if (runControl.action === 'stop' || error?.message === '__STOP__') {
      return { type: 'stopped' };
    }
    if (runControl.action === 'skip' || error?.message === '__SKIP__') {
      return { type: 'result', result: { website, emails: [], error: 'Skipped manually.' } };
    }
    if (String(error?.message || '').includes('timed out')) {
      return { type: 'result', result: { website, emails: [], error: `Skipped after ${options.strictTimeoutSeconds}s timeout.` } };
    }

    return {
      type: 'result',
      result: { website, emails: [], error: error instanceof Error ? error.message : 'Unknown error' }
    };
  } finally {
    runControl.currentAbortController = null;
    runControl.currentTabId = null;
    if (runControl.action === 'skip') {
      runControl.action = 'none';
    }
  }
}

async function runProcessing({ urls, requestId, excludeEmails, options, startIndex, initialResults }) {
  let results = [...initialResults];
  const completedWebsites = new Set(results.map((item) => item.website));

  runInProgress = true;
  runControl.action = 'none';

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
      strictTimeoutSeconds: options.strictTimeoutSeconds
    });

    for (let i = startIndex; i < urls.length; i += 1) {
      if (runControl.action === 'stop') {
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
          strictTimeoutSeconds: options.strictTimeoutSeconds
        });
        return { results, status: 'paused' };
      }

      const url = urls[i];
      const website = websiteFromUrl(url);
      if (completedWebsites.has(website)) {
        await setRunState({
          status: 'running',
          requestId,
          total: urls.length,
          current: i + 1,
          domain: website,
          results,
          urls,
          nextIndex: i + 1,
          excludeEmails,
          strictTimeoutSeconds: options.strictTimeoutSeconds
        });
        continue;
      }

      chrome.runtime.sendMessage({
        type: 'PROCESS_PROGRESS',
        requestId,
        current: i + 1,
        total: urls.length,
        domain: website
      }).catch(() => {
        // popup may be closed
      });

      const outcome = await processOneUrl(url, excludeEmails, options);

      if (outcome.type === 'stopped') {
        await setRunState({
          status: 'paused',
          requestId,
          total: urls.length,
          current: i,
          domain: website,
          results,
          urls,
          nextIndex: i,
          excludeEmails,
          strictTimeoutSeconds: options.strictTimeoutSeconds
        });
        return { results, status: 'paused' };
      }

      results = [...results, outcome.result];
      completedWebsites.add(outcome.result.website);

      chrome.runtime.sendMessage({
        type: 'PROCESS_RESULT',
        requestId,
        result: outcome.result
      }).catch(() => {
        // popup may be closed
      });

      await setRunState({
        status: 'running',
        requestId,
        total: urls.length,
        current: i + 1,
        domain: website,
        results,
        urls,
        nextIndex: i + 1,
        excludeEmails,
        strictTimeoutSeconds: options.strictTimeoutSeconds
      });
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
      strictTimeoutSeconds: options.strictTimeoutSeconds
    });

    return { results, status: 'done' };
  } finally {
    runInProgress = false;
    runControl.action = 'none';
    runControl.currentAbortController = null;
    runControl.currentTabId = null;
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
    runControl.action = 'stop';
    interruptCurrentWebsite();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'SKIP_CURRENT') {
    runControl.action = 'skip';
    interruptCurrentWebsite();
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

  if (message?.type === 'PROCESS_START') {
    if (runInProgress) {
      sendResponse({ ok: false, error: 'A run is already in progress.' });
      return false;
    }

    (async () => {
      try {
        const requestId = message.requestId || '';
        const inputUrls = (message.urls || []).map((item) => normalizeUrl(String(item || ''))).filter(Boolean);
        const excludeEmails = unique((message.excludeEmails || []).map((email) => String(email).toLowerCase().trim()).filter(Boolean));
        const strictTimeoutSeconds = resolveStrictTimeoutSeconds(message.strictTimeoutSeconds);

        const existingState = await getRunState();
        const shouldResume = existingState?.status === 'paused' && Array.isArray(existingState.urls) && existingState.urls.length > 0;

        const urls = shouldResume ? existingState.urls : inputUrls;
        if (!urls.length) {
          sendResponse({ ok: false, error: 'No valid websites were provided.' });
          return;
        }

        const startIndex = shouldResume
          ? Math.max(0, Math.min(Number(existingState.nextIndex || 0), urls.length))
          : 0;

        const baseResults = shouldResume && Array.isArray(existingState.results)
          ? existingState.results.slice()
          : [];

        const finalExcludeEmails = shouldResume && !excludeEmails.length
          ? unique((existingState.excludeEmails || []).map((email) => String(email).toLowerCase().trim()).filter(Boolean))
          : excludeEmails;

        const response = await runProcessing({
          urls,
          requestId,
          excludeEmails: finalExcludeEmails,
          options: {
            strictTimeoutSeconds,
            strictTimeoutMs: strictTimeoutSeconds * 1000
          },
          startIndex,
          initialResults: baseResults
        });

        sendResponse({ ok: true, results: response.results, status: response.status });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    })();

    return true;
  }

  return false;
});
