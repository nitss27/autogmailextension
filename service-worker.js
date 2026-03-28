const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TAB_LOAD_TIMEOUT_MS = 15000;
const TAB_SETTLE_MS = 150;
const MAX_SECONDARY_PAGES = 3;
const RUN_STATE_KEY = 'latestRunState';

let controller = {
  running: false,
  stopRequested: false,
  skipRequested: false,
  currentTabId: null
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
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish(resolve);
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

async function processOneUrl(url, excludeEmails, strictTimeoutMs) {
  const domain = buildDomain(url);
  let tab = null;
  let timeoutId = null;

  const workPromise = (async () => {
    tab = await createTab(url);
    controller.currentTabId = tab.id;

    await activateAndWait(tab.id);
    if (controller.stopRequested) throw new Error('__STOP__');
    if (controller.skipRequested) throw new Error('__SKIP__');

    const firstPass = await inspectTab(tab.id);
    const secondaryQueue = unique(firstPass.secondaryLinks).slice(0, MAX_SECONDARY_PAGES);
    const secondaryEmails = [];

    for (const link of secondaryQueue) {
      if (controller.stopRequested) throw new Error('__STOP__');
      if (controller.skipRequested) throw new Error('__SKIP__');

      await chrome.tabs.update(tab.id, { url: link, active: true });
      await activateAndWait(tab.id);
      const secondaryPass = await inspectTab(tab.id);
      secondaryEmails.push(...secondaryPass.emails);
    }

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

async function runLoop() {
  const state = await getRunState();
  if (!state || !Array.isArray(state.urls)) return state;

  controller.running = true;
  controller.stopRequested = false;

  while (state.current < state.total) {
    if (controller.stopRequested) {
      state.status = 'paused';
      await setRunState(state);
      controller.running = false;
      return state;
    }

    const url = state.urls[state.current];
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
      Math.max(1000, Number(state.strictTimeoutSec || 10) * 1000)
    );

    if (outcome.status === 'stopped') {
      state.status = 'paused';
      await setRunState(state);
      controller.running = false;
      return state;
    }

    if (outcome.result) {
      state.results.push(outcome.result);
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

  if (message?.type !== 'START_OR_RESUME') return false;

  (async () => {
    let state = await getRunState();

    if (!state || state.status === 'done' || state.status === 'idle') {
      const urls = unique((message.urls || []).map(normalizeUrl));
      state = {
        status: 'running',
        requestId: message.requestId || crypto.randomUUID(),
        urls,
        total: urls.length,
        current: 0,
        domain: '',
        results: [],
        excludeEmails: unique((message.excludeEmails || []).map((email) => String(email).toLowerCase().trim()).filter(Boolean)),
        strictTimeoutSec: Math.max(1, Math.min(120, Number(message.strictTimeoutSec) || 10))
      };
      await setRunState(state);
    } else if (state.status === 'paused') {
      state.status = 'running';
      state.requestId = message.requestId || state.requestId;
      await setRunState(state);
    }

    const finalState = controller.running ? state : await runLoop();
    sendResponse({ ok: true, state: finalState });
  })();

  return true;
});
