const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BAD_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'pdf', 'css', 'js', 'json', 'xml', 'zip']);
const PLACEHOLDER_PREFIXES = ['example@', 'test@', 'user@', 'email@', 'noreply@', 'no-reply@', 'donotreply@'];
const PLACEHOLDER_DOMAINS = ['example.com', 'test.com', 'localhost'];

let runInProgress = false;
let stopRequested = false;
let forceStopRequested = false;
let skipSignal = false;
let activeTabId = null;
let latestRunState = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'PROCESS_URLS':
        if (runInProgress) return sendResponse({ ok: false, error: 'A run is already in progress.' });
        latestRunState = {
          status: 'running',
          requestId: msg.requestId,
          urls: normalizeInputUrls(msg.urls || []),
          nextIndex: 0,
          current: 0,
          total: normalizeInputUrls(msg.urls || []).length,
          domain: '',
          results: [],
          excludeEmails: msg.excludeEmails || [],
          tabLoadTimeoutMs: msg.tabLoadTimeoutMs || 12000,
          forceSkipAfterMs: msg.forceSkipAfterMs ?? null,
          hardUrlTimeoutMs: msg.hardUrlTimeoutMs ?? 15000
        };
        await saveState();
        sendResponse({ ok: true, results: await processQueue(latestRunState) });
        break;
      case 'PROCESS_REMAINING': {
        if (runInProgress) return sendResponse({ ok: false, error: 'A run is already in progress.' });
        const stored = await chrome.storage.local.get(['latestRunState']);
        latestRunState = stored.latestRunState || latestRunState;
        if (!latestRunState || latestRunState.requestId !== msg.requestId) return sendResponse({ ok: false, error: 'No matching saved run state.' });
        latestRunState.excludeEmails = msg.excludeEmails || latestRunState.excludeEmails || [];
        latestRunState.tabLoadTimeoutMs = msg.tabLoadTimeoutMs || latestRunState.tabLoadTimeoutMs || 12000;
        latestRunState.forceSkipAfterMs = msg.forceSkipAfterMs ?? latestRunState.forceSkipAfterMs ?? null;
        latestRunState.hardUrlTimeoutMs = msg.hardUrlTimeoutMs ?? latestRunState.hardUrlTimeoutMs ?? 15000;
        latestRunState.status = 'running';
        await saveState();
        sendResponse({ ok: true, results: await processQueue(latestRunState) });
        break;
      }
      case 'STOP_PROCESSING':
        if (latestRunState?.requestId === msg.requestId) stopRequested = true;
        sendResponse({ ok: true });
        break;
      case 'FORCE_STOP_PROCESSING':
        if (latestRunState?.requestId === msg.requestId) {
          stopRequested = true;
          forceStopRequested = true;
          skipSignal = true;
          await closeActiveTab();
        }
        sendResponse({ ok: true });
        break;
      case 'SKIP_CURRENT_URL':
        skipSignal = true;
        await closeActiveTab();
        sendResponse({ ok: true });
        break;
      case 'RESET_RUN_STATE':
        runInProgress = false;
        stopRequested = false;
        forceStopRequested = false;
        skipSignal = false;
        latestRunState = null;
        await chrome.storage.local.remove(['latestRunState']);
        sendResponse({ ok: true });
        break;
      case 'GET_LATEST_RESULTS': {
        const stored = await chrome.storage.local.get(['latestRunState']);
        sendResponse({ ok: true, state: stored.latestRunState || latestRunState || null });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type.' });
    }
  })().catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));

  return true;
});

async function processQueue(state) {
  runInProgress = true;
  stopRequested = false;
  forceStopRequested = false;

  for (let index = state.nextIndex; index < state.urls.length; index += 1) {
    await tick();
    if (stopRequested) {
      state.status = 'paused';
      state.nextIndex = index;
      await saveState();
      runInProgress = false;
      return state.results;
    }

    const url = state.urls[index];
    state.current = index + 1;
    state.total = state.urls.length;
    state.domain = getDomain(url);
    state.status = 'running';
    chrome.runtime.sendMessage({ type: 'PROCESS_PROGRESS', requestId: state.requestId, current: state.current, total: state.total, domain: state.domain });

    const result = await processWithRetry(url, {
      tabLoadTimeoutMs: state.tabLoadTimeoutMs || 12000,
      forceSkipAfterMs: state.forceSkipAfterMs,
      hardUrlTimeoutMs: state.hardUrlTimeoutMs || 15000,
      excludeEmails: state.excludeEmails || []
    });

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
  chrome.runtime.sendMessage({ type: 'PROCESS_COMPLETE', requestId: state.requestId });
  return state.results;
}

async function processWithRetry(url, opts) {
  const first = await processSingleUrl(url, opts);
  if (first.status === 'success' || first.status === 'skipped_timeout') return first;
  return processSingleUrl(url, { ...opts, tabLoadTimeoutMs: opts.tabLoadTimeoutMs + 3000, hardUrlTimeoutMs: opts.hardUrlTimeoutMs + 3000, retrying: true });
}

async function processSingleUrl(url, opts) {
  let tab = null;
  let forceTimer = null;
  let hardTimer = null;

  try {
    if (opts.forceSkipAfterMs) {
      forceTimer = setTimeout(async () => {
        skipSignal = true;
        await closeActiveTab();
      }, opts.forceSkipAfterMs);
    }

    const result = await Promise.race([
      (async () => {
        const sourcePromise = fetchSourcePage(url);
        tab = await safeCreateTab(url);
        if (!tab?.id) return baseResult(url, 'skipped_error', 'Failed to create tab.');
        activeTabId = tab.id;

        const initial = await inspectTabResilient(tab.id, opts.tabLoadTimeoutMs);
        if (skipSignal) return baseResult(url, 'skipped_error', 'Manual skip requested.');

        if (!initial || !hasContent(initial)) return baseResult(url, 'no_content', 'No meaningful content or blocked scripts.');

        const visited = new Set();
        const secondary = discoverSecondaryUrls(initial.links || [], url, visited);
        const secondaryInspects = [];
        for (const nextUrl of secondary) {
          await tick();
          if (skipSignal) break;
          try {
            visited.add(nextUrl);
            await safeUpdateTab(tab.id, nextUrl);
            secondaryInspects.push(await inspectTabResilient(tab.id, opts.tabLoadTimeoutMs));
          } catch {}
        }

        const source = await sourcePromise;
        const scored = scoreAndMergeEmails([
          ...collectCandidates(initial),
          ...secondaryInspects.flatMap(collectCandidates),
          ...source.emails.map((email) => ({ email, source: 'rawSource' }))
        ]);
        const cleaned = cleanAndFilterEmails(scored, opts.excludeEmails || []).slice(0, 20);
        let error = '';
        if (!cleaned.length && `${initial.bodyText || ''} ${source.rawText || ''}`.toLowerCase().includes('verify you are human')) error = '[CAPTCHA] verify you are human';
        return { domain: getDomain(url), url, emails: cleaned, error, status: cleaned.length ? 'success' : 'no_content' };
      })(),
      new Promise((resolve) => {
        hardTimer = setTimeout(async () => {
          skipSignal = true;
          await closeActiveTab();
          resolve(baseResult(url, 'skipped_timeout', `Hard timeout after ${opts.hardUrlTimeoutMs || 15000}ms`));
        }, opts.hardUrlTimeoutMs || 15000);
      })
    ]);

    return result;
  } catch (error) {
    return baseResult(url, 'skipped_error', String(error?.message || error));
  } finally {
    clearTimeout(forceTimer);
    clearTimeout(hardTimer);
    skipSignal = false;
    await closeTabById(tab?.id);
    if (activeTabId === tab?.id) activeTabId = null;
  }
}

async function inspectTabResilient(tabId, timeoutMs) {
  await waitForTabComplete(tabId, timeoutMs);
  const inspect = await inspectTab(tabId);
  if (hasContent(inspect)) return inspect;
  await delay(1500);
  const retry1 = await inspectTab(tabId);
  if (hasContent(retry1)) return retry1;
  await delay(1500);
  return inspectTab(tabId);
}

function hasContent(snapshot) {
  return (snapshot?.bodyTextLength || 0) > 200 || (snapshot?.interactiveCount || 0) > 0;
}

function baseResult(url, status, error = '') {
  return { domain: getDomain(url), url, emails: [], error, status };
}

function collectCandidates(snapshot = {}) {
  const out = [];
  for (const e of snapshot.htmlEmails || []) out.push({ email: e, source: 'html' });
  for (const e of snapshot.textEmails || []) out.push({ email: e, source: 'text' });
  for (const e of snapshot.mailtoEmails || []) out.push({ email: e, source: 'mailto' });
  for (const e of snapshot.jsonLdEmails || []) out.push({ email: e, source: 'jsonld' });
  for (const e of snapshot.metaEmails || []) out.push({ email: e, source: 'meta' });
  for (const e of snapshot.microdataEmails || []) out.push({ email: e, source: 'microdata' });
  for (const e of snapshot.dataAttrEmails || []) out.push({ email: e, source: 'dataAttr' });
  for (const e of snapshot.obfuscatedEmails || []) out.push({ email: e, source: 'obfuscated' });
  return out;
}

function scoreAndMergeEmails(entries) {
  const map = new Map();
  for (const entry of entries) {
    const key = String(entry.email || '').toLowerCase();
    if (!key) continue;
    const prev = map.get(key) || { email: key, sources: new Set() };
    prev.sources.add(entry.source);
    map.set(key, prev);
  }
  return [...map.values()].map((v) => {
    let confidence = 'low';
    if (v.sources.has('mailto') || v.sources.has('jsonld')) confidence = 'high';
    else if ((v.sources.has('html') && v.sources.has('rawSource')) || v.sources.has('text') || v.sources.has('meta')) confidence = 'medium';
    return { email: v.email, confidence };
  });
}

function cleanAndFilterEmails(scored, rules) {
  const exact = new Set();
  const domains = [];
  const tlds = new Set();
  const keywords = [];
  for (const rule of rules.map((r) => r.trim().toLowerCase()).filter(Boolean)) {
    if (rule.startsWith('@.')) tlds.add(rule.slice(2));
    else if (rule.startsWith('@')) domains.push(rule.slice(1));
    else if (rule.includes('@')) exact.add(rule);
    else keywords.push(rule);
  }

  const seen = new Set();
  const out = [];
  for (let i = 0; i < scored.length; i += 1) {
    const item = scored[i];
    const email = String(item.email || '').toLowerCase().trim().replace(/^["'`(\[{<\s]+|["'`)\]}>\s.,;:!?]+$/g, '');
    if (!EMAIL_REGEX.test(email)) { EMAIL_REGEX.lastIndex = 0; continue; }
    EMAIL_REGEX.lastIndex = 0;

    if (email.length > 254 || exact.has(email) || seen.has(email) || PLACEHOLDER_PREFIXES.some((p) => email.startsWith(p))) continue;
    const [local = '', domain = ''] = email.split('@');
    const tld = domain.split('.').pop() || '';
    if (!local || !domain || local.includes('..') || /[\\/]/.test(local + domain) || PLACEHOLDER_DOMAINS.some((d) => domain.endsWith(d))) continue;
    if (BAD_TLDS.has(tld) || tlds.has(tld)) continue;
    if (domains.some((d) => domain === d || domain.endsWith(`.${d}`))) continue;
    if (keywords.some((k) => local.includes(k))) continue;

    seen.add(email);
    out.push({ email, confidence: item.confidence || 'medium' });
  }
  return out;
}

function normalizeInputUrls(urls) {
  const out = [];
  const seen = new Set();
  for (const raw of urls) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const withScheme = /^https?:\/\//i.test(line) ? line : `https://${line}`;
    try {
      const parsed = new URL(withScheme);
      const normalized = `${parsed.protocol}//${parsed.host}`;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        out.push(normalized);
      }
    } catch {}
  }
  return out;
}

function discoverSecondaryUrls(links, baseUrl, visited) {
  const out = [];
  const pattern = /contact|about|support|help|team|staff|reach-us/i;
  for (const href of links || []) {
    if (out.length >= 3) break;
    try {
      const resolved = new URL(href, baseUrl).toString();
      if (!pattern.test(resolved) || visited.has(resolved)) continue;
      out.push(resolved);
    } catch {}
  }
  return out;
}

function getDomain(url) { try { return new URL(url).hostname; } catch { return url; } }
async function safeCreateTab(url) { try { return await chrome.tabs.create({ url, active: true }); } catch { return null; } }
async function safeUpdateTab(tabId, url) { try { await chrome.tabs.update(tabId, { url }); } catch {} }
async function closeActiveTab() { if (activeTabId) await closeTabById(activeTabId); activeTabId = null; }
async function closeTabById(tabId) { if (!tabId) return; try { await chrome.tabs.remove(tabId); } catch {} }
function tick() { return new Promise((resolve) => setTimeout(resolve, 0)); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function waitForTabComplete(tabId, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId !== tabId) return;
      if (info.status === 'complete') {
        cleanup();
        resolve(true);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
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
        const pick = (text) => String(text || '').match(EMAIL_REGEX) || [];
        const unique = (list) => [...new Set(list.map((x) => String(x).toLowerCase()))];
        const rawHtml = document.documentElement?.innerHTML || '';
        const bodyText = document.body?.innerText || '';

        const clickCookieBanner = () => {
          const terms = ['accept', 'agree', 'allow'];
          const all = [...document.querySelectorAll('button, [role="button"], a')];
          for (const node of all) {
            const txt = (node.textContent || '').trim().toLowerCase();
            if (!txt) continue;
            if (terms.some((term) => txt === term || txt.includes(`${term} all`) || txt.includes(`${term} cookies`))) {
              try { node.click(); return true; } catch {}
            }
          }
          return false;
        };

        const deobfuscateText = (input) => {
          const src = String(input || '');
          const transformed = src.replace(/\[\s*at\s*\]|\s+at\s+/gi, '@').replace(/\[\s*dot\s*\]|\s+dot\s+/gi, '.').replace(/&#64;/g, '@').replace(/[＠﹫]/g, '@').replace(/[。｡]/g, '.');
          const out = [...pick(transformed)];
          out.push(...src.split(/\s+/).filter((t) => t.includes('@')).map((t) => t.split('').reverse().join('')));
          const rot13 = src.replace(/[a-zA-Z]/g, (c) => String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
          out.push(...pick(rot13));
          const b64 = src.match(/[A-Za-z0-9+/=]{12,}/g) || [];
          for (const token of b64) {
            try {
              const decoded = atob(token);
              if (decoded.includes('@')) out.push(...pick(decoded));
            } catch {}
          }
          return unique(out);
        };

        const awaitStableContent = async () => {
          await new Promise((resolve) => {
            if (document.readyState === 'interactive' || document.readyState === 'complete') return resolve();
            document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
          });

          await new Promise((resolve) => setTimeout(resolve, 3500));

          const hasMeaningful = () => (document.body?.innerText || '').trim().length > 200 || document.querySelectorAll('form, button, input, textarea, select').length > 0;
          if (hasMeaningful()) return true;

          return new Promise((resolve) => {
            const observer = new MutationObserver(() => {
              if (hasMeaningful()) {
                observer.disconnect();
                resolve(true);
              }
            });
            observer.observe(document.documentElement || document.body, { childList: true, subtree: true, characterData: true });
            setTimeout(() => {
              observer.disconnect();
              resolve(hasMeaningful());
            }, 2500);
          });
        };

        const installSpaSignal = () => {
          if (window.__emailHarvesterSpaHookInstalled) return;
          window.__emailHarvesterSpaHookInstalled = true;
          window.__emailHarvesterRouteChanged = false;
          const mark = () => { window.__emailHarvesterRouteChanged = true; };
          const origPush = history.pushState;
          history.pushState = function (...args) {
            const ret = origPush.apply(this, args);
            mark();
            return ret;
          };
          window.addEventListener('popstate', mark);
        };

        return (async () => {
          installSpaSignal();
          clickCookieBanner();
          const contentReady = await awaitStableContent();
          const htmlEmails = unique(pick(rawHtml));
          const textEmails = unique(pick(bodyText));
          const mailtoEmails = unique([...document.querySelectorAll('a[href^="mailto:"]')].map((a) => (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0]));
          const jsonLdEmails = unique([...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => {
            try { return pick(JSON.stringify(JSON.parse(s.textContent || '{}'))); } catch { return pick(s.textContent || ''); }
          }));
          const metaEmails = unique([...document.querySelectorAll('meta[content]')].flatMap((m) => pick(m.getAttribute('content') || '')));
          const microdataEmails = unique([...document.querySelectorAll('[itemprop="email"]')].flatMap((n) => pick(n.textContent || n.getAttribute('content') || '')));
          const dataAttrEmails = unique([...document.querySelectorAll('*')].flatMap((node) => [node.getAttribute('data-email'), node.getAttribute('data-contact'), node.getAttribute('data-mail')].filter(Boolean).flatMap((v) => pick(v))));
          const pseudoEmails = unique([...document.querySelectorAll('*')].flatMap((node) => {
            const before = getComputedStyle(node, '::before').content || '';
            const after = getComputedStyle(node, '::after').content || '';
            return [...pick(before), ...pick(after), ...deobfuscateText(before), ...deobfuscateText(after)];
          }));
          const obfuscatedEmails = unique([...deobfuscateText(rawHtml), ...deobfuscateText(bodyText), ...pseudoEmails]);

          return {
            contentReady,
            htmlEmails,
            textEmails,
            mailtoEmails,
            jsonLdEmails,
            metaEmails,
            microdataEmails,
            dataAttrEmails,
            obfuscatedEmails,
            links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || ''),
            bodyText,
            bodyTextLength: bodyText.trim().length,
            interactiveCount: document.querySelectorAll('form, button, input, textarea, select').length,
            routeChanged: Boolean(window.__emailHarvesterRouteChanged)
          };
        })();
      }
    });

    const payload = res?.result || {};
    if (payload.routeChanged) {
      await delay(500);
      const [rerun] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          window.__emailHarvesterRouteChanged = false;
          return { ok: true };
        }
      });
      void rerun;
    }
    return payload;
  } catch {
    return {};
  }
}

async function fetchSourcePage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: controller.signal
    });
    const rawText = await response.text();
    return { emails: (rawText.match(EMAIL_REGEX) || []).map((e) => e.toLowerCase()), rawText };
  } catch {
    return { emails: [], rawText: '' };
  } finally {
    clearTimeout(timer);
  }
}

async function saveState() {
  if (latestRunState) await chrome.storage.local.set({ latestRunState });
}
