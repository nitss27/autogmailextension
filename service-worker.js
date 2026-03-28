const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TAB_LOAD_TIMEOUT_MS = 15000;
const TAB_SETTLE_MS = 150;
const MAX_SECONDARY_PAGES = 3;
const RUN_STATE_KEY = 'latestRunState';

let controller = {
  running: false,
  stopRequested: false,
  skipRequested: false,
  currentTabId: null,
  runToken: 0
};

function normalizeUrl(input) {
  const raw = String(input || '').trim();
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
      if (domain === blockedDomain || domain.endsWith(`.${blockedDomain}`)) return false;
    }

    return true;
  });
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

function isInterrupted(runToken) {
  return controller.stopRequested || controller.skipRequested || runToken !== controller.runToken;
}

function interruptReason(runToken) {
  if (controller.stopRequested || runToken !== controller.runToken) return '__STOP__';
  if (controller.skipRequested) return '__SKIP__';
  return '__STOP__';
}

function waitForTabComplete(tabId, timeoutMs = TAB_LOAD_TIMEOUT_MS, runToken) {
  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (callback) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      clearInterval(interruptTimer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      callback();
    };

    const timeout = setTimeout(() => finish(() => reject(new Error('Tab load timeout'))), timeoutMs);

    const interruptTimer = setInterval(() => {
      if (isInterrupted(runToken)) {
        finish(() => reject(new Error(interruptReason(runToken))));
      }
    }, 60);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish(resolve);
    };

    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) finish(() => reject(new Error(interruptReason(runToken))));
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (isInterrupted(runToken)) {
          finish(() => reject(new Error(interruptReason(runToken))));
          return;
        }
        if (tab.status === 'complete') finish(resolve);
      })
      .catch(() => finish(() => reject(new Error('Tab unavailable'))));
  });
}

async function activateAndWait(tabId, tabLoadTimeoutMs = TAB_LOAD_TIMEOUT_MS, runToken) {
  if (isInterrupted(runToken)) throw new Error(interruptReason(runToken));
  const tab = await chrome.tabs.get(tabId);
  if (isInterrupted(runToken)) throw new Error(interruptReason(runToken));
  await chrome.windows.update(tab.windowId, { focused: true });
  if (isInterrupted(runToken)) throw new Error(interruptReason(runToken));
  await chrome.tabs.update(tabId, { active: true });
  await waitForTabComplete(tabId, tabLoadTimeoutMs, runToken);
  await sleep(TAB_SETTLE_MS);
  if (isInterrupted(runToken)) throw new Error(interruptReason(runToken));
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
        emails: [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))],
        secondaryLinks: [...new Set(secondaryLinks)]
      };
    }
  });

  return injection?.result || { pageUrl: '', emails: [], secondaryLinks: [] };
}

async function fetchSourceEmails(url) {
  const response = await fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return extractEmailsFromText(await response.text());
}

function buildDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function processOneUrl(url, excludeEmails, strictTimeoutMs, tabLoadTimeoutMs, runToken) {
  const domain = buildDomain(url);
  let tab = null;
  let timeoutId = null;

  const workPromise = (async () => {
    tab = await createTab(url);
    controller.currentTabId = tab.id;

    await activateAndWait(tab.id, tabLoadTimeoutMs, runToken);

    const firstPass = await inspectTab(tab.id);
    const secondaryQueue = unique(firstPass.secondaryLinks).slice(0, MAX_SECONDARY_PAGES);
    const secondaryEmails = [];

    for (const link of secondaryQueue) {
      if (isInterrupted(runToken)) throw new Error(interruptReason(runToken));
      await chrome.tabs.update(tab.id, { url: link, active: true });
      await activateAndWait(tab.id, tabLoadTimeoutMs, runToken);
      const secondaryPass = await inspectTab(tab.id);
      secondaryEmails.push(...secondaryPass.emails);
    }

    if (isInterrupted(runToken)) throw new Error(interruptReason(runToken));

    const sourceEmailsMainPromise = fetchSourceEmails(url).catch(() => []);
    const sourceEmailsSecondaryPromise = Promise.all(
      secondaryQueue.map((link) => fetchSourceEmails(link).catch(() => []))
    );

    const sourceEmailsMain = await sourceEmailsMainPromise;
    const sourceEmailsSecondary = (await sourceEmailsSecondaryPromise).flat();

    const emails = filterExcludedEmails(unique([
      ...firstPass.emails,
      ...secondaryEmails,
      ...sourceEmailsMain,
      ...sourceEmailsSecondary
    ]), excludeEmails);

    return {
      status: 'ok',
      result: { url, domain, emails, totalEmails: emails.length }
    };
  })();

  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        status: 'timeout',
        result: {
          url,
          domain,
          emails: [],
          totalEmails: 0,
          error: `Skipped due to strict timeout after ${Math.floor(strictTimeoutMs / 1000)} second(s).`
        }
      });
    }, strictTimeoutMs);
  });

  try {
    const outcome = await Promise.race([workPromise, timeoutPromise]);

    if (outcome.status === 'timeout') {
      await closeTab(controller.currentTabId);
      controller.currentTabId = null;
      return outcome;
    }

    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message === '__STOP__') {
      return { status: 'stopped' };
    }
    if (message === '__SKIP__') {
      return {
        status: 'skip',
        result: { url, domain, emails: [], totalEmails: 0, error: 'Skipped by user.' }
      };
    }

    return {
      status: 'error',
      result: { url, domain, emails: [], totalEmails: 0, error: message }
    };
  } finally {
    clearTimeout(timeoutId);
    await closeTab(tab?.id);
    if (controller.currentTabId === tab?.id) controller.currentTabId = null;
    controller.skipRequested = false;
  }
}

function getCompletedUrlSet(state) {
  const completed = new Set();
  for (const item of state.results || []) {
    if (item?.url) completed.add(item.url);
  }
  return completed;
}

async function runLoop() {
  const state = await getRunState();
  if (!state || !Array.isArray(state.urls)) return state;

  controller.running = true;
  controller.stopRequested = false;
  const runToken = ++controller.runToken;

  const completedUrls = getCompletedUrlSet(state);

  while (state.current < state.total) {
    if (controller.stopRequested || runToken !== controller.runToken) {
      state.status = 'paused';
      await setRunState(state);
      controller.running = false;
      return state;
    }

    const url = state.urls[state.current];

    if (completedUrls.has(url)) {
      state.current += 1;
      await setRunState(state);
      continue;
    }

    const domain = buildDomain(url);

    state.domain = domain;
    state.status = 'running';
    await setRunState(state);

    chrome.runtime.sendMessage({
      type: 'PROCESS_PROGRESS',
      requestId: state.requestId,
      current: state.current + 1,
      total: state.total,
      domain
    }).catch(() => {});

    const outcome = await processOneUrl(
      url,
      state.excludeEmails || [],
      Math.max(1000, Number(state.strictSkipTimeoutSec || 10) * 1000),
      Math.max(1000, Number(state.tabLoadTimeoutMs || TAB_LOAD_TIMEOUT_MS)),
      runToken
    );

    if (outcome.status === 'stopped') {
      state.status = 'paused';
      await setRunState(state);
      controller.running = false;
      return state;
    }

    if (outcome.result) {
      state.results.push(outcome.result);
      completedUrls.add(url);
      state.current += 1;
      await setRunState(state);
    }
  }

  state.status = 'done';
  state.domain = '';
  await setRunState(state);
  controller.running = false;
  return state;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_LATEST_RESULTS') {
    (async () => sendResponse({ ok: true, state: await getRunState() }))();
    return true;
  }

  if (message?.type === 'STOP_PROCESS') {
    controller.stopRequested = true;
    controller.runToken += 1;
    closeTab(controller.currentTabId).catch(() => {});
    (async () => {
      const state = await getRunState();
      if (state?.status === 'running') {
        state.status = 'paused';
        await setRunState(state);
      }
      sendResponse({ ok: true, state: await getRunState() });
    })();
    return true;
  }

  if (message?.type === 'SKIP_CURRENT') {
    controller.skipRequested = true;
    closeTab(controller.currentTabId).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type !== 'START_PROCESS') return false;

  (async () => {
    let state = await getRunState();
    const incomingUrls = unique((message.urls || []).map(normalizeUrl));

    const canResume = state
      && Array.isArray(state.urls)
      && state.status === 'paused'
      && state.current < state.total;

    if (canResume) {
      state.status = 'running';
      state.requestId = message.requestId || state.requestId;
      if (Number(message.tabLoadTimeoutMs)) {
        state.tabLoadTimeoutMs = Math.max(1000, Math.min(120000, Number(message.tabLoadTimeoutMs)));
      }
      if (Number(message.strictSkipTimeoutSec)) {
        state.strictSkipTimeoutSec = Math.max(1, Math.min(300, Number(message.strictSkipTimeoutSec)));
      }
      if (Array.isArray(message.excludeEmails)) {
        state.excludeEmails = unique((message.excludeEmails || []).map((email) => String(email).toLowerCase().trim()).filter(Boolean));
      }
      await setRunState(state);
    } else {
      state = {
        status: 'running',
        requestId: message.requestId || crypto.randomUUID(),
        urls: incomingUrls,
        total: incomingUrls.length,
        current: 0,
        domain: '',
        results: [],
        excludeEmails: unique((message.excludeEmails || []).map((email) => String(email).toLowerCase().trim()).filter(Boolean)),
        tabLoadTimeoutMs: Math.max(1000, Math.min(120000, Number(message.tabLoadTimeoutMs) || 20000)),
        strictSkipTimeoutSec: Math.max(1, Math.min(300, Number(message.strictSkipTimeoutSec) || 10))
      };
      await setRunState(state);
    }

    const finalState = controller.running ? state : await runLoop();
    sendResponse({ ok: true, state: finalState });
  })();

  return true;
});
