const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const DEFAULT_TAB_LOAD_TIMEOUT_MS = 15000;
const TAB_SETTLE_MS = 50;
const MAX_SECONDARY_PAGES = 5;
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
  return unique((String(text || '').match(EMAIL_REGEX) || []).map((email) => email.toLowerCase()));
}

function decodeCloudflareEmail(hexString) {
  const value = String(hexString || '').trim();
  if (!value || value.length < 4 || value.length % 2 !== 0) return '';

  try {
    const key = parseInt(value.slice(0, 2), 16);
    let decoded = '';
    for (let i = 2; i < value.length; i += 2) {
      const byte = parseInt(value.slice(i, i + 2), 16);
      decoded += String.fromCharCode(byte ^ key);
    }
    return decoded;
  } catch {
    return '';
  }
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

function resolveTimeoutMs(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1000) return DEFAULT_TAB_LOAD_TIMEOUT_MS;
  return Math.round(value);
}

function isInterrupted(runToken) {
  return controller.stopRequested || controller.skipRequested || runToken !== controller.runToken;
}

function interruptionError(runToken) {
  if (controller.skipRequested) return '__SKIP__';
  if (controller.stopRequested || runToken !== controller.runToken) return '__STOP__';
  return '__STOP__';
}

function waitForTabComplete(tabId, timeoutMs = DEFAULT_TAB_LOAD_TIMEOUT_MS, runToken) {
  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (callback) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      clearInterval(interruptPoll);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      callback();
    };

    const timeout = setTimeout(() => finish(() => reject(new Error('Tab load timeout'))), timeoutMs);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish(resolve);
      }
    };

    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) {
        finish(() => reject(new Error(interruptionError(runToken))));
      }
    };

    const interruptPoll = setInterval(() => {
      if (isInterrupted(runToken)) {
        finish(() => reject(new Error(interruptionError(runToken))));
      }
    }, 60);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (isInterrupted(runToken)) {
          finish(() => reject(new Error(interruptionError(runToken))));
          return;
        }
        if (tab.status === 'complete') finish(resolve);
      })
      .catch(() => finish(() => reject(new Error('Tab unavailable'))));
  });
}

async function activateAndWait(tabId, tabLoadTimeoutMs, runToken) {
  if (isInterrupted(runToken)) throw new Error(interruptionError(runToken));

  const tab = await chrome.tabs.get(tabId);
  if (isInterrupted(runToken)) throw new Error(interruptionError(runToken));

  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  await waitForTabComplete(tabId, tabLoadTimeoutMs, runToken);
  await sleep(TAB_SETTLE_MS);
}

async function inspectTab(tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const html = document.documentElement?.innerHTML || '';
      const text = document.body?.innerText || '';

      const mailtoEmails = [...document.querySelectorAll('a[href^="mailto:"]')]
        .map((a) => (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0]);

      const dataAttrEmails = [...document.querySelectorAll('[data-email], [data-mail], [data-contact]')]
        .flatMap((node) => [
          node.getAttribute('data-email') || '',
          node.getAttribute('data-mail') || '',
          node.getAttribute('data-contact') || ''
        ]);

      const cloudflareEmails = [...document.querySelectorAll('[data-cfemail]')]
        .map((el) => {
          const value = String(el.getAttribute('data-cfemail') || '').trim();
          if (!value || value.length < 4 || value.length % 2 !== 0) return '';
          try {
            const key = parseInt(value.slice(0, 2), 16);
            let decoded = '';
            for (let i = 2; i < value.length; i += 2) {
              const byte = parseInt(value.slice(i, i + 2), 16);
              decoded += String.fromCharCode(byte ^ key);
            }
            return decoded;
          } catch {
            return '';
          }
        });

      const scriptText = [...document.querySelectorAll('script[type="application/ld+json"], script:not([src])')]
        .map((script) => script.textContent || '')
        .join('\n');

      const emails = [
        ...(html.match(emailRegex) || []),
        ...(text.match(emailRegex) || []),
        ...(scriptText.match(emailRegex) || []),
        ...mailtoEmails,
        ...dataAttrEmails,
        ...cloudflareEmails
      ];

      const secondaryPattern = /(contact|about|support|team|impressum|legal|company|get[-_]?in[-_]?touch)/i;
      const secondaryLinks = [...document.querySelectorAll('a[href]')]
        .map((a) => a.href)
        .filter((href) => href && secondaryPattern.test(href));

      const normalizedCombined = `${text}\n${html}`.toLowerCase();
      const robotVerificationDetected = normalizedCombined.includes('verify your are human by completing the action below');

      return {
        pageUrl: location.href,
        html,
        text,
        emails: [...new Set(emails.map((email) => String(email).trim().toLowerCase()).filter(Boolean))],
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

  const cloudflareMatches = [...html.matchAll(/data-cfemail=["']([a-fA-F0-9]+)["']/g)]
    .map((match) => decodeCloudflareEmail(match[1]));

  return {
    html,
    emails: unique([...extractEmailsFromText(html), ...cloudflareMatches].map((item) => String(item || '').toLowerCase())),
    robotVerificationDetected: isRobotVerificationContent(html)
  };
}

function buildDomain(urlOrInput) {
  try {
    return new URL(urlOrInput).hostname;
  } catch {
    return String(urlOrInput || '');
  }
}

async function processOneEntry(entry, excludeEmails, options, runToken) {
  const rawInput = String(entry?.raw || '').trim();
  const normalizedUrl = normalizeUrl(rawInput);

  if (!normalizedUrl) {
    return {
      status: 'ok',
      result: {
        raw: rawInput,
        url: '',
        domain: rawInput,
        emails: [],
        totalEmails: 0,
        error: 'Invalid URL format.'
      }
    };
  }

  let tab = null;
  let strictTimeoutId = null;
  const domain = buildDomain(normalizedUrl);

  const workPromise = (async () => {
    if (isInterrupted(runToken)) throw new Error(interruptionError(runToken));

    tab = await createTab(normalizedUrl);
    controller.currentTabId = tab.id;

    await activateAndWait(tab.id, options.tabLoadTimeoutMs, runToken);

    const firstPass = await inspectTab(tab.id);
    const secondaryQueue = unique(firstPass.secondaryLinks).slice(0, MAX_SECONDARY_PAGES);
    const secondaryEmails = [];
    let verificationSeen = firstPass.robotVerificationDetected || isRobotVerificationContent(firstPass.text) || isRobotVerificationContent(firstPass.html);

    for (const link of secondaryQueue) {
      if (isInterrupted(runToken)) throw new Error(interruptionError(runToken));
      await chrome.tabs.update(tab.id, { url: link, active: true });
      await activateAndWait(tab.id, options.tabLoadTimeoutMs, runToken);
      const secondaryPass = await inspectTab(tab.id);
      verificationSeen = verificationSeen || secondaryPass.robotVerificationDetected || isRobotVerificationContent(secondaryPass.text) || isRobotVerificationContent(secondaryPass.html);
      secondaryEmails.push(...secondaryPass.emails);
    }

    const sourceMainPromise = fetchSourcePage(normalizedUrl).catch(() => ({ html: '', emails: [], robotVerificationDetected: false }));
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
      return {
        raw: rawInput,
        url: normalizedUrl,
        domain,
        emails: [],
        totalEmails: 0,
        error: 'Skipped due to robot verification message. Verify first human.'
      };
    }

    return {
      raw: rawInput,
      url: normalizedUrl,
      domain,
      emails,
      totalEmails: emails.length
    };
  })();

  const timeoutPromise = new Promise((resolve) => {
    strictTimeoutId = setTimeout(() => {
      resolve({
        raw: rawInput,
        url: normalizedUrl,
        domain,
        emails: [],
        totalEmails: 0,
        error: `Skipped due to strict timeout after ${options.strictSkipTimeoutSec} second(s).`
      });
    }, options.strictSkipTimeoutSec * 1000);
  });

  try {
    const result = await Promise.race([workPromise, timeoutPromise]);
    return { status: 'ok', result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message === '__STOP__') return { status: 'stopped' };
    if (message === '__SKIP__') {
      return {
        status: 'ok',
        result: { raw: rawInput, url: normalizedUrl, domain, emails: [], totalEmails: 0, error: 'Skipped by user.' }
      };
    }

    return {
      status: 'ok',
      result: { raw: rawInput, url: normalizedUrl, domain, emails: [], totalEmails: 0, error: message }
    };
  } finally {
    clearTimeout(strictTimeoutId);
    await closeTab(tab?.id);
    if (controller.currentTabId === tab?.id) controller.currentTabId = null;
    controller.skipRequested = false;
  }
}

async function runLoop() {
  const state = await getRunState();
  if (!state || !Array.isArray(state.entries)) return state;

  controller.running = true;
  controller.stopRequested = false;
  const runToken = ++controller.runToken;

  while (state.current < state.total) {
    if (controller.stopRequested || runToken !== controller.runToken) {
      state.status = 'paused';
      await setRunState(state);
      controller.running = false;
      return state;
    }

    const entry = state.entries[state.current];
    const displayDomain = buildDomain(entry?.raw || '');

    state.status = 'running';
    state.domain = displayDomain;
    await setRunState(state);

    chrome.runtime.sendMessage({
      type: 'PROCESS_PROGRESS',
      requestId: state.requestId,
      current: state.current + 1,
      total: state.total,
      domain: displayDomain
    }).catch(() => {});

    const outcome = await processOneEntry(entry, state.excludeEmails || [], {
      tabLoadTimeoutMs: resolveTimeoutMs(state.tabLoadTimeoutMs),
      strictSkipTimeoutSec: Math.max(1, Math.min(300, Number(state.strictSkipTimeoutSec || 10)))
    }, runToken);

    if (outcome.status === 'stopped') {
      state.status = 'paused';
      await setRunState(state);
      controller.running = false;
      return state;
    }

    if (outcome.result) {
      state.results.push(outcome.result);
      chrome.runtime.sendMessage({
        type: 'PROCESS_RESULT',
        requestId: state.requestId,
        index: state.current,
        result: outcome.result
      }).catch(() => {});
    }

    state.current += 1;
    state.nextIndex = state.current;
    await setRunState(state);
  }

  state.status = 'done';
  state.domain = '';
  state.nextIndex = state.total;
  await setRunState(state);
  controller.running = false;
  return state;
}

async function startOrResume(message) {
  let state = await getRunState();

  const rawEntries = (message.urls || [])
    .map((item) => String(item || ''))
    .map((item) => item.trim())
    .filter(Boolean)
    .map((raw) => ({ raw }));

  const canResume = state
    && Array.isArray(state.entries)
    && state.status === 'paused'
    && state.current < state.total;

  if (canResume) {
    state.status = 'running';
    state.requestId = message.requestId || state.requestId;
    if (Array.isArray(message.excludeEmails)) {
      state.excludeEmails = unique((message.excludeEmails || []).map((email) => String(email).toLowerCase().trim()).filter(Boolean));
    }
    state.tabLoadTimeoutMs = resolveTimeoutMs(message.tabLoadTimeoutMs || state.tabLoadTimeoutMs);
    state.strictSkipTimeoutSec = Math.max(1, Math.min(300, Number(message.strictSkipTimeoutSec || state.strictSkipTimeoutSec || 10)));
    await setRunState(state);
  } else {
    state = {
      status: 'running',
      requestId: message.requestId || crypto.randomUUID(),
      entries: rawEntries,
      urls: rawEntries.map((item) => item.raw),
      total: rawEntries.length,
      current: 0,
      nextIndex: 0,
      domain: '',
      results: [],
      excludeEmails: unique((message.excludeEmails || []).map((email) => String(email).toLowerCase().trim()).filter(Boolean)),
      tabLoadTimeoutMs: resolveTimeoutMs(message.tabLoadTimeoutMs),
      strictSkipTimeoutSec: Math.max(1, Math.min(300, Number(message.strictSkipTimeoutSec || 10)))
    };
    await setRunState(state);
  }

  return controller.running ? state : runLoop();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_LATEST_RESULTS') {
    (async () => sendResponse({ ok: true, state: await getRunState() }))();
    return true;
  }

  if (message?.type === 'STOP_PROCESS' || message?.type === 'STOP_PROCESSING') {
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

  if (message?.type === 'RESET_RUN_STATE') {
    (async () => {
      controller.stopRequested = true;
      controller.runToken += 1;
      await clearRunState();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === 'START_PROCESS' || message?.type === 'PROCESS_URLS' || message?.type === 'PROCESS_REMAINING') {
    (async () => {
      try {
        const payload = {
          ...message,
          urls: message.type === 'PROCESS_REMAINING' ? ((await getRunState())?.urls || []) : (message.urls || []),
          strictSkipTimeoutSec: message.strictSkipTimeoutSec || 10
        };
        const state = await startOrResume(payload);
        sendResponse({ ok: true, state, results: state?.results || [] });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    })();
    return true;
  }

  return false;
});
