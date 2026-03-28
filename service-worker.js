const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TAB_LOAD_TIMEOUT_MS = 15000;
const TAB_SETTLE_MS = 120;
const MAX_SECONDARY_PAGES = 3;
const RUN_STATE_KEY = 'latestRunState';
const DEFAULT_TIMEOUT_SECONDS = 10;

let activeRun = null;

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
  return [...new Set((items || []).filter(Boolean))];
}

function normalizeWebsiteForOutput(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function extractEmailsFromText(text) {
  return unique((String(text || '').match(EMAIL_REGEX) || []).map((email) => email.toLowerCase()));
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

function waitForAbort(signal) {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function raceAbort(promise, signal) {
  if (!signal) return promise;
  return Promise.race([promise, waitForAbort(signal)]);
}

async function setRunState(state) {
  const fullState = {
    ...state,
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ [RUN_STATE_KEY]: fullState });

  chrome.runtime.sendMessage({ type: 'RUN_STATE_UPDATED', state: fullState }).catch(() => {
    // popup may be closed
  });

  return fullState;
}

async function getRunState() {
  const data = await chrome.storage.local.get(RUN_STATE_KEY);
  return data[RUN_STATE_KEY] || null;
}

function createDefaultState() {
  return {
    status: 'idle',
    requestId: '',
    queue: [],
    currentIndex: 0,
    currentWebsite: '',
    results: [],
    processedUrls: [],
    excludeEmails: [],
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS
  };
}

async function createTab(url, signal) {
  return raceAbort(chrome.tabs.create({ url, active: true }), signal);
}

async function closeTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // ignore
  }
}

function waitForTabComplete(tabId, signal, timeoutMs = TAB_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (callback) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };

    const onAbort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')));

    const timeout = setTimeout(() => finish(() => reject(new Error('Tab load timeout'))), timeoutMs);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish(resolve);
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    signal?.addEventListener('abort', onAbort, { once: true });

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') finish(resolve);
      })
      .catch(() => finish(() => reject(new Error('Tab unavailable'))));
  });
}

async function activateAndWait(tabId, signal) {
  const tab = await raceAbort(chrome.tabs.get(tabId), signal);
  await raceAbort(chrome.windows.update(tab.windowId, { focused: true }), signal);
  await raceAbort(chrome.tabs.update(tabId, { active: true }), signal);
  await waitForTabComplete(tabId, signal);
  await raceAbort(sleep(TAB_SETTLE_MS), signal);
}

async function inspectTab(tabId, signal) {
  const injection = await raceAbort(chrome.scripting.executeScript({
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
  }), signal);

  return injection?.[0]?.result || { pageUrl: '', html: '', text: '', emails: [], secondaryLinks: [], robotVerificationDetected: false };
}

async function fetchSourcePage(url, signal) {
  const response = await raceAbort(fetch(url, {
    method: 'GET',
    redirect: 'follow',
    credentials: 'omit',
    signal
  }), signal);

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await raceAbort(response.text(), signal);
  return {
    html,
    emails: extractEmailsFromText(html),
    robotVerificationDetected: isRobotVerificationContent(html)
  };
}

function timeoutSignal(timeoutMs, parentSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Website timeout exceeded')), timeoutMs);

  const onAbort = () => controller.abort(new DOMException('Aborted', 'AbortError'));
  if (parentSignal) {
    if (parentSignal.aborted) onAbort();
    parentSignal.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
    }
  };
}

async function processOneUrl(url, options) {
  const { excludeEmails, timeoutSeconds, runSignal, skipSignal, onTabId } = options;
  let tab = null;
  const { signal: siteSignal, cleanup } = timeoutSignal(Math.max(1, timeoutSeconds) * 1000, runSignal);

  const mergedSignal = new AbortController();
  const relayAbort = () => mergedSignal.abort(new DOMException('Aborted', 'AbortError'));
  siteSignal.addEventListener('abort', relayAbort, { once: true });
  skipSignal?.addEventListener('abort', relayAbort, { once: true });

  try {
    tab = await createTab(url, mergedSignal.signal);
    onTabId(tab.id);

    await activateAndWait(tab.id, mergedSignal.signal);

    const firstPass = await inspectTab(tab.id, mergedSignal.signal);
    const secondaryQueue = unique(firstPass.secondaryLinks).slice(0, MAX_SECONDARY_PAGES);
    const secondaryEmails = [];
    let verificationSeen = firstPass.robotVerificationDetected || isRobotVerificationContent(firstPass.text) || isRobotVerificationContent(firstPass.html);

    for (const link of secondaryQueue) {
      await raceAbort(chrome.tabs.update(tab.id, { url: link, active: true }), mergedSignal.signal);
      await activateAndWait(tab.id, mergedSignal.signal);
      const secondaryPass = await inspectTab(tab.id, mergedSignal.signal);
      verificationSeen = verificationSeen || secondaryPass.robotVerificationDetected || isRobotVerificationContent(secondaryPass.text) || isRobotVerificationContent(secondaryPass.html);
      secondaryEmails.push(...secondaryPass.emails);
    }

    const sourceMainPromise = fetchSourcePage(url, mergedSignal.signal).catch(() => ({ html: '', emails: [], robotVerificationDetected: false }));
    const sourceSecondaryPromise = Promise.all(
      secondaryQueue.map((link) => fetchSourcePage(link, mergedSignal.signal).catch(() => ({ html: '', emails: [], robotVerificationDetected: false })))
    );

    const sourceMain = await raceAbort(sourceMainPromise, mergedSignal.signal);
    const sourceSecondary = await raceAbort(sourceSecondaryPromise, mergedSignal.signal);
    verificationSeen = verificationSeen || sourceMain.robotVerificationDetected || sourceSecondary.some((item) => item.robotVerificationDetected);

    const emails = filterExcludedEmails(unique([
      ...firstPass.emails,
      ...secondaryEmails,
      ...sourceMain.emails,
      ...sourceSecondary.flatMap((item) => item.emails)
    ]), excludeEmails);

    if (!emails.length && verificationSeen) {
      return {
        status: 'skipped',
        website: normalizeWebsiteForOutput(url),
        emails: [],
        reason: 'Blocked by verification gate'
      };
    }

    return {
      status: 'done',
      website: normalizeWebsiteForOutput(url),
      emails
    };
  } catch (error) {
    if (skipSignal?.aborted) {
      return {
        status: 'skipped',
        website: normalizeWebsiteForOutput(url),
        emails: [],
        reason: 'Skipped by user'
      };
    }

    if (runSignal?.aborted) {
      throw new DOMException('Stopped', 'AbortError');
    }

    if (siteSignal.aborted) {
      return {
        status: 'skipped',
        website: normalizeWebsiteForOutput(url),
        emails: [],
        reason: 'Timed out'
      };
    }

    return {
      status: 'failed',
      website: normalizeWebsiteForOutput(url),
      emails: []
    };
  } finally {
    cleanup();
    siteSignal.removeEventListener('abort', relayAbort);
    skipSignal?.removeEventListener('abort', relayAbort);
    await closeTab(tab?.id);
    onTabId(null);
  }
}

function shouldResumeFromState(state) {
  return state
    && Array.isArray(state.queue)
    && state.queue.length > 0
    && state.currentIndex < state.queue.length
    && (state.status === 'paused' || state.status === 'running');
}

async function startOrResumeRun({ urls, excludeEmails, timeoutSeconds }) {
  const normalizedUrls = unique((urls || []).map(normalizeUrl).filter(Boolean));
  const normalizedExclude = unique((excludeEmails || []).map((email) => String(email).toLowerCase().trim()).filter(Boolean));
  const strictTimeoutSeconds = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? Math.floor(timeoutSeconds) : DEFAULT_TIMEOUT_SECONDS;

  const existingState = (await getRunState()) || createDefaultState();

  let nextState;
  if (shouldResumeFromState(existingState) && normalizedUrls.length === 0) {
    nextState = {
      ...existingState,
      status: 'running',
      excludeEmails: normalizedExclude.length ? normalizedExclude : (existingState.excludeEmails || []),
      timeoutSeconds: strictTimeoutSeconds || existingState.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS
    };
  } else if (shouldResumeFromState(existingState) && normalizedUrls.length > 0) {
    const requestedSet = new Set(normalizedUrls);
    const existingSet = new Set(existingState.queue || []);
    const sameQueue = requestedSet.size === existingSet.size && [...requestedSet].every((url) => existingSet.has(url));

    if (sameQueue) {
      nextState = {
        ...existingState,
        status: 'running',
        excludeEmails: normalizedExclude,
        timeoutSeconds: strictTimeoutSeconds
      };
    }
  }

  if (!nextState) {
    if (!normalizedUrls.length) {
      throw new Error('Please enter at least one website to start.');
    }

    const processedSet = new Set((existingState.processedUrls || []).filter((url) => normalizedUrls.includes(url)));
    nextState = {
      status: 'running',
      requestId: crypto.randomUUID(),
      queue: normalizedUrls,
      currentIndex: 0,
      currentWebsite: '',
      results: (existingState.results || []).filter((item) => processedSet.has(normalizeUrl(item.website) || '')),
      processedUrls: [...processedSet],
      excludeEmails: normalizedExclude,
      timeoutSeconds: strictTimeoutSeconds
    };
  }

  if (activeRun?.running) {
    return nextState;
  }

  activeRun = {
    running: true,
    runController: new AbortController(),
    currentSiteController: null,
    currentTabId: null
  };

  await setRunState(nextState);

  runQueueLoop(activeRun).catch(() => {
    // state already handled in loop
  });

  return nextState;
}

async function runQueueLoop(runRef) {
  while (runRef.running) {
    const state = (await getRunState()) || createDefaultState();

    if (state.status !== 'running') {
      runRef.running = false;
      break;
    }

    if (state.currentIndex >= state.queue.length) {
      await setRunState({
        ...state,
        status: 'done',
        currentWebsite: ''
      });
      runRef.running = false;
      break;
    }

    const url = state.queue[state.currentIndex];
    const processedSet = new Set(state.processedUrls || []);

    if (processedSet.has(url)) {
      await setRunState({
        ...state,
        currentIndex: state.currentIndex + 1,
        currentWebsite: ''
      });
      continue;
    }

    runRef.currentSiteController = new AbortController();

    await setRunState({
      ...state,
      currentWebsite: normalizeWebsiteForOutput(url)
    });

    let outcome;
    try {
      outcome = await processOneUrl(url, {
        excludeEmails: state.excludeEmails || [],
        timeoutSeconds: state.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS,
        runSignal: runRef.runController.signal,
        skipSignal: runRef.currentSiteController.signal,
        onTabId: (tabId) => {
          runRef.currentTabId = tabId;
        }
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        const pausedState = (await getRunState()) || state;
        await setRunState({
          ...pausedState,
          status: 'paused',
          currentWebsite: ''
        });
      }
      runRef.running = false;
      break;
    }

    const latest = (await getRunState()) || state;
    const nextProcessed = unique([...(latest.processedUrls || []), url]);
    const nextResults = [...(latest.results || []), {
      website: outcome.website || normalizeWebsiteForOutput(url),
      emails: outcome.emails || []
    }];

    await setRunState({
      ...latest,
      results: nextResults,
      processedUrls: nextProcessed,
      currentIndex: latest.currentIndex + 1,
      currentWebsite: ''
    });
  }

  if (runRef.currentTabId) {
    await closeTab(runRef.currentTabId);
    runRef.currentTabId = null;
  }

  if (activeRun === runRef) {
    activeRun = null;
  }
}

async function forceStopRun() {
  const state = (await getRunState()) || createDefaultState();

  if (activeRun?.currentSiteController) {
    activeRun.currentSiteController.abort();
  }

  if (activeRun?.runController) {
    activeRun.runController.abort();
  }

  if (activeRun?.currentTabId) {
    await closeTab(activeRun.currentTabId);
    activeRun.currentTabId = null;
  }

  await setRunState({
    ...state,
    status: 'paused',
    currentWebsite: ''
  });
}

async function skipCurrentWebsite() {
  const state = (await getRunState()) || createDefaultState();
  if (state.status !== 'running') {
    throw new Error('Run is not active.');
  }

  if (activeRun?.currentSiteController) {
    activeRun.currentSiteController.abort();
  }

  if (activeRun?.currentTabId) {
    await closeTab(activeRun.currentTabId);
    activeRun.currentTabId = null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_LATEST_RESULTS') {
    (async () => {
      const state = await getRunState();
      sendResponse({ ok: true, state: state || createDefaultState() });
    })();
    return true;
  }

  if (message?.type === 'START_PROCESSING') {
    (async () => {
      try {
        const state = await startOrResumeRun({
          urls: message.urls || [],
          excludeEmails: message.excludeEmails || [],
          timeoutSeconds: message.timeoutSeconds
        });
        sendResponse({ ok: true, state });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Failed to start processing' });
      }
    })();
    return true;
  }

  if (message?.type === 'STOP_PROCESSING') {
    (async () => {
      try {
        await forceStopRun();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Failed to stop processing' });
      }
    })();
    return true;
  }

  if (message?.type === 'SKIP_CURRENT_WEBSITE') {
    (async () => {
      try {
        await skipCurrentWebsite();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Failed to skip website' });
      }
    })();
    return true;
  }

  return false;
});
