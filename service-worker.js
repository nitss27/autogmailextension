const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BAD_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'pdf', 'css', 'js', 'json', 'xml', 'zip']);
const PLACEHOLDER_PREFIXES = ['example@', 'test@', 'user@', 'email@', 'noreply@', 'no-reply@', 'donotreply@'];
const PLACEHOLDER_DOMAINS = ['example.com', 'test.com', 'localhost'];

let runInProgress = false;
let stopRequested = false;
let forceStopRequested = false;
let skipSignal = false;
let latestRunState = null;
let activeTabId = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'PROCESS_URLS': {
        if (runInProgress) return sendResponse({ ok: false, error: 'A run is already in progress.' });
        const urls = normalizeInputUrls(msg.urls || []);
        latestRunState = {
          status: 'running',
          requestId: msg.requestId,
          urls,
          nextIndex: 0,
          current: 0,
          total: urls.length,
          domain: '',
          results: [],
          excludeEmails: msg.excludeEmails || [],
          tabLoadTimeoutMs: msg.tabLoadTimeoutMs || 12000,
          forceSkipAfterMs: msg.forceSkipAfterMs ?? null,
          hardUrlTimeoutMs: msg.hardUrlTimeoutMs ?? 45000
        };
        await saveState();
        const results = await processQueue(latestRunState);
        sendResponse({ ok: true, results });
        break;
      }
      case 'PROCESS_REMAINING': {
        if (runInProgress) return sendResponse({ ok: false, error: 'A run is already in progress.' });
        const stored = await chrome.storage.local.get(['latestRunState']);
        latestRunState = stored.latestRunState || latestRunState;
        if (!latestRunState || latestRunState.requestId !== msg.requestId) {
          return sendResponse({ ok: false, error: 'No matching saved run state.' });
        }
        latestRunState.excludeEmails = msg.excludeEmails || latestRunState.excludeEmails || [];
        latestRunState.tabLoadTimeoutMs = msg.tabLoadTimeoutMs || latestRunState.tabLoadTimeoutMs || 12000;
        latestRunState.forceSkipAfterMs = msg.forceSkipAfterMs ?? latestRunState.forceSkipAfterMs ?? null;
        latestRunState.hardUrlTimeoutMs = msg.hardUrlTimeoutMs ?? latestRunState.hardUrlTimeoutMs ?? 45000;
        latestRunState.status = 'running';
        await saveState();
        const results = await processQueue(latestRunState);
        sendResponse({ ok: true, results });
        break;
      }
      case 'STOP_PROCESSING': {
        if (latestRunState?.requestId === msg.requestId) stopRequested = true;
        sendResponse({ ok: true });
        break;
      }
      case 'FORCE_STOP_PROCESSING': {
        if (latestRunState?.requestId === msg.requestId) {
          stopRequested = true;
          forceStopRequested = true;
          skipSignal = true;
          await closeActiveTab();
        }
        sendResponse({ ok: true });
        break;
      }
      case 'SKIP_CURRENT_URL': {
        skipSignal = true;
        await closeActiveTab();
        sendResponse({ ok: true });
        break;
      }
      case 'RESET_RUN_STATE': {
        runInProgress = false;
        stopRequested = false;
        forceStopRequested = false;
        skipSignal = false;
        latestRunState = null;
        await chrome.storage.local.remove(['latestRunState']);
        sendResponse({ ok: true });
        break;
      }
      case 'GET_LATEST_RESULTS': {
        const stored = await chrome.storage.local.get(['latestRunState']);
        sendResponse({ ok: true, state: stored.latestRunState || latestRunState || null });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type.' });
    }
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err?.message || err) });
  });

  return true;
});

async function processQueue(state) {
  runInProgress = true;
  stopRequested = false;
  forceStopRequested = false;
  skipSignal = false;

  for (let index = state.nextIndex; index < state.urls.length; index += 1) {
    if (stopRequested) {
      state.status = 'paused';
      state.nextIndex = index;
      await saveState();
      runInProgress = false;
      return state.results;
    }

    const url = state.urls[index];
    state.current = index + 1;
    state.domain = getDomain(url);
    state.total = state.urls.length;
    state.status = 'running';

    chrome.runtime.sendMessage({ type: 'PROCESS_PROGRESS', requestId: state.requestId, current: state.current, total: state.total, domain: state.domain });

    const hardTimeout = state.hardUrlTimeoutMs || 45000;
    const watchdog = new Promise((resolve) => {
      setTimeout(async () => {
        skipSignal = true;
        await closeActiveTab();
        resolve({
          domain: state.domain,
          url,
          emails: [],
          error: `[SKIPPED] hard timeout after ${hardTimeout}ms`
        });
      }, hardTimeout);
    });

    const result = await Promise.race([
      processSingleUrl(url, {
        excludeEmails: state.excludeEmails || [],
        tabLoadTimeoutMs: state.tabLoadTimeoutMs || 12000,
        forceSkipAfterMs: state.forceSkipAfterMs
      }),
      watchdog
    ]);

    state.results[index] = result;
    state.nextIndex = index + 1;
    await saveState();
    chrome.runtime.sendMessage({ type: 'PROCESS_RESULT', requestId: state.requestId, index, result });

    if (forceStopRequested) {
      state.status = 'paused';
      await saveState();
      runInProgress = false;
      return state.results;
    }
  }

  state.status = 'done';
  await saveState();
  runInProgress = false;
  return state.results;
}

async function processSingleUrl(url, opts) {
  let tab = null;
  let forceSkipTimer = null;
  const visitedSecondary = new Set();

  try {
    if (opts.forceSkipAfterMs) {
      forceSkipTimer = setTimeout(async () => {
        skipSignal = true;
        await closeActiveTab();
      }, opts.forceSkipAfterMs);
    }

    const sourcePromise = fetchSourcePage(url);
    tab = await safeCreateTab(url);
    if (!tab?.id) {
      return { domain: getDomain(url), url, emails: [], error: 'Failed to create tab.' };
    }
    activeTabId = tab.id;

    await waitForTabComplete(tab.id, opts.tabLoadTimeoutMs);
    await delay(2000);

    let inspect = await inspectTab(tab.id);
    if ((inspect.bodyTextLength || 0) < 200) {
      await delay(2500);
      inspect = await inspectTab(tab.id);
    }

    if (!inspect.bodyTextLength) {
      await delay(1500);
      inspect = await inspectTab(tab.id);
      if (!inspect.bodyTextLength) {
        await delay(1500);
        inspect = await inspectTab(tab.id);
      }
    }

    const secondary = discoverSecondaryUrls(inspect.links || [], url, visitedSecondary);
    const secondaryResults = [];
    for (const nextUrl of secondary) {
      if (skipSignal) break;
      try {
        visitedSecondary.add(nextUrl);
        await safeUpdateTab(tab.id, nextUrl);
        await waitForTabComplete(tab.id, opts.tabLoadTimeoutMs);
        await delay(1200);
        secondaryResults.push(await inspectTab(tab.id));
      } catch {
        // silently skip
      }
    }

    const source = await sourcePromise;

    const merged = scoreAndMergeEmails([
      ...collectCandidates(inspect),
      ...secondaryResults.flatMap(collectCandidates),
      ...source.emails.map((email) => ({ email, source: 'rawSource' }))
    ]);

    const cleaned = cleanAndFilterEmails(merged, opts.excludeEmails || [], getDomain(url)).slice(0, 20);

    let error = '';
    if (!cleaned.length) {
      const pageText = `${inspect.bodyText || ''} ${(source.rawText || '').slice(0, 5000)}`.toLowerCase();
      if (pageText.includes('verify you are human')) error = '[CAPTCHA] verify you are human';
    }

    return {
      domain: getDomain(url),
      url,
      emails: cleaned,
      error
    };
  } catch (err) {
    return {
      domain: getDomain(url),
      url,
      emails: [],
      error: String(err?.message || err)
    };
  } finally {
    if (forceSkipTimer) clearTimeout(forceSkipTimer);
    skipSignal = false;
    await closeTabById(tab?.id);
    if (activeTabId === tab?.id) activeTabId = null;
  }
}

function collectCandidates(inspectResult = {}) {
  const list = [];
  for (const email of inspectResult.htmlEmails || []) list.push({ email, source: 'html' });
  for (const email of inspectResult.textEmails || []) list.push({ email, source: 'text' });
  for (const email of inspectResult.mailtoEmails || []) list.push({ email, source: 'mailto' });
  for (const email of inspectResult.jsonLdEmails || []) list.push({ email, source: 'jsonld' });
  for (const email of inspectResult.metaEmails || []) list.push({ email, source: 'meta' });
  for (const email of inspectResult.microdataEmails || []) list.push({ email, source: 'microdata' });
  for (const email of inspectResult.dataAttrEmails || []) list.push({ email, source: 'dataAttr' });
  for (const email of inspectResult.obfuscatedEmails || []) list.push({ email, source: 'obfuscated' });
  return list;
}

function scoreAndMergeEmails(items) {
  const map = new Map();
  for (const item of items) {
    const key = String(item.email || '').toLowerCase();
    if (!key) continue;
    const prev = map.get(key) || { email: key, seen: new Set() };
    prev.seen.add(item.source);
    map.set(key, prev);
  }

  return [...map.values()].map((entry) => {
    const seen = entry.seen;
    let confidence = 'low';
    if (seen.has('mailto') || seen.has('jsonld')) confidence = 'high';
    else if ((seen.has('html') && seen.has('rawSource')) || seen.has('text') || seen.has('meta')) confidence = 'medium';
    return { email: entry.email, confidence, seen: [...seen] };
  });
}

function cleanAndFilterEmails(scoredEmails, excludeRules, domain) {
  const exactExcludes = new Set();
  const domainExcludes = [];
  const tldExcludes = new Set();
  const keywordExcludes = [];

  for (const rule of excludeRules.map((r) => r.trim().toLowerCase()).filter(Boolean)) {
    if (rule.startsWith('@.')) {
      tldExcludes.add(rule.slice(2));
    } else if (rule.startsWith('@')) {
      domainExcludes.push(rule.slice(1));
    } else if (rule.includes('@')) {
      exactExcludes.add(rule);
    } else {
      keywordExcludes.push(rule);
    }
  }

  const seen = new Set();
  const out = [];

  for (const item of scoredEmails) {
    const e = (item.email || '').toLowerCase().trim().replace(/^["'`(\[{<\s]+|["'`)\]}>\s.,;:!?]+$/g, '');
    if (!EMAIL_REGEX.test(e)) {
      EMAIL_REGEX.lastIndex = 0;
      continue;
    }
    EMAIL_REGEX.lastIndex = 0;

    if (e.length > 254) continue;
    if (exactExcludes.has(e)) continue;
    if (PLACEHOLDER_PREFIXES.some((p) => e.startsWith(p))) continue;

    const [local = '', d = ''] = e.split('@');
    if (!local || !d) continue;
    if (local.includes('..')) continue;
    if (/[\\/]/.test(local) || /[\\/]/.test(d)) continue;
    if (PLACEHOLDER_DOMAINS.some((pd) => d.endsWith(pd))) continue;

    const tld = d.split('.').pop() || '';
    if (BAD_TLDS.has(tld)) continue;
    if (tldExcludes.has(tld)) continue;

    if (domainExcludes.some((ex) => d === ex || d.endsWith(`.${ex}`))) continue;
    if (keywordExcludes.some((k) => local.includes(k))) continue;

    if (domain && !d.includes('.')) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push({ email: e, confidence: item.confidence || 'medium' });
  }

  return out;
}

function normalizeInputUrls(urls) {
  const out = [];
  const seen = new Set();
  for (const u of urls) {
    if (!u) continue;
    const trimmed = String(u).trim();
    if (!trimmed) continue;
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(withScheme);
      const normalized = `${parsed.protocol}//${parsed.host}`;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        out.push(normalized);
      }
    } catch {
      // ignore
    }
  }
  return out;
}

function getDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function discoverSecondaryUrls(links, baseUrl, visited) {
  const out = [];
  const pattern = /contact|about|support|help|team|staff|reach-us/i;
  for (const href of links || []) {
    if (out.length >= 3) break;
    try {
      const resolved = new URL(href, baseUrl).toString();
      if (!pattern.test(resolved)) continue;
      if (visited.has(resolved)) continue;
      out.push(resolved);
    } catch {
      // ignore
    }
  }
  return out;
}

async function safeCreateTab(url) {
  try { return await chrome.tabs.create({ url, active: true }); } catch { return null; }
}

async function safeUpdateTab(tabId, url) {
  try { await chrome.tabs.update(tabId, { url }); } catch {}
}

async function closeActiveTab() {
  if (!activeTabId) return;
  await closeTabById(activeTabId);
  activeTabId = null;
}

async function closeTabById(tabId) {
  if (!tabId) return;
  try { await chrome.tabs.remove(tabId); } catch {}
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function waitForTabComplete(tabId, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let done = false;
    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId !== tabId) return;
      if (info.status === 'complete') {
        cleanup();
        resolve(true);
      }
    };
    const timer = setTimeout(() => {
      if (done) return;
      cleanup();
      resolve(false);
    }, timeoutMs);

    const cleanup = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function inspectTab(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const pick = (text) => (String(text || '').match(EMAIL_REGEX) || []);
        const unique = (arr) => [...new Set(arr.map((x) => String(x).toLowerCase()))];
        const deobfuscateText = (input) => {
          const out = [];
          const s = String(input || '');
          const normalized = s
            .replace(/\[\s*at\s*\]|\s+at\s+/gi, '@')
            .replace(/\[\s*dot\s*\]|\s+dot\s+/gi, '.')
            .replace(/&#64;/g, '@')
            .replace(/[＠﹫]/g, '@')
            .replace(/[。｡]/g, '.');
          out.push(...pick(normalized));

          const reversedTokens = s.split(/\s+/).filter((t) => t.includes('@')).map((t) => t.split('').reverse().join(''));
          out.push(...reversedTokens);

          const rot13 = s.replace(/[a-zA-Z]/g, (c) => String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
          out.push(...pick(rot13));

          const b64 = s.match(/[A-Za-z0-9+/=]{12,}/g) || [];
          for (const token of b64) {
            try {
              const decoded = atob(token);
              if (decoded.includes('@')) out.push(...pick(decoded));
            } catch {}
          }
          return unique(out);
        };

        const html = document.documentElement?.innerHTML || '';
        const bodyText = document.body?.innerText || '';

        const mailtoEmails = unique(
          [...document.querySelectorAll('a[href^="mailto:"]')]
            .map((a) => a.getAttribute('href') || '')
            .map((h) => h.replace(/^mailto:/i, '').split('?')[0])
        );

        const jsonLdEmails = unique(
          [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => {
            try {
              const parsed = JSON.parse(s.textContent || '{}');
              return pick(JSON.stringify(parsed));
            } catch {
              return pick(s.textContent || '');
            }
          })
        );

        const metaEmails = unique([...document.querySelectorAll('meta[content]')].flatMap((m) => pick(m.getAttribute('content') || '')));
        const microdataEmails = unique([...document.querySelectorAll('[itemprop="email"]')].flatMap((n) => pick(n.textContent || n.getAttribute('content') || '')));

        const dataAttrEmails = unique(
          [...document.querySelectorAll('*')].flatMap((node) => {
            const values = [node.getAttribute('data-email'), node.getAttribute('data-contact'), node.getAttribute('data-mail')].filter(Boolean);
            return values.flatMap((v) => pick(v));
          })
        );

        const pseudoEmails = unique(
          [...document.querySelectorAll('*')].flatMap((node) => {
            const before = getComputedStyle(node, '::before').content || '';
            const after = getComputedStyle(node, '::after').content || '';
            return [...pick(before), ...pick(after), ...deobfuscateText(before), ...deobfuscateText(after)];
          })
        );

        const obfuscatedEmails = unique([...deobfuscateText(html), ...deobfuscateText(bodyText), ...pseudoEmails]);

        return {
          htmlEmails: unique(pick(html)),
          textEmails: unique(pick(bodyText)),
          mailtoEmails,
          jsonLdEmails,
          metaEmails,
          microdataEmails,
          dataAttrEmails,
          obfuscatedEmails,
          links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || ''),
          bodyText,
          bodyTextLength: bodyText.trim().length
        };
      }
    });
    return res?.result || {};
  } catch {
    return {};
  }
}

async function fetchSourcePage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });
    const text = await resp.text();
    return { emails: (text.match(EMAIL_REGEX) || []).map((e) => e.toLowerCase()), rawText: text };
  } catch {
    return { emails: [], rawText: '' };
  } finally {
    clearTimeout(timer);
  }
}

async function saveState() {
  if (latestRunState) await chrome.storage.local.set({ latestRunState });
}
