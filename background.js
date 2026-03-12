chrome.runtime.onInstalled.addListener(() => {
  console.log('Resume Assistant Pro installed');
});

const ASSISTANT_TAB_URL = chrome.runtime.getURL('assistant.html');

const RESUME_DATA = [
  { l: 'Full Name', c: 'Nitesh Shekhawat', t: ['name', 'personal'] },
  { l: 'Email', c: 'mr.niteshshekhawat@gmail.com', t: ['email', 'contact'] },
  { l: 'Phone', c: '+91 7073616862', t: ['phone', 'contact'] },
  { l: 'LinkedIn', c: 'https://www.linkedin.com/in/nitesh-shekhawat/', t: ['linkedin', 'contact'] },
  { l: 'Address', c: 'Vaishali Nagar, Jaipur, Rajasthan 302012, India', t: ['address'] },
  { l: 'Professional Summary', c: 'I am a growth-driven digital marketing specialist with 6+ years of hands-on experience in Advance Google Ads, Meta Ads, SEO, Paid media, marketing automation, eCommerce growth, high quality bulk lead generation and full-stack campaign execution.', t: ['summary', 'skills'] },
  { l: 'Core Skills', c: 'Google Ads, Meta Ads, SEO, Social Media Marketing, Email Marketing, CRO, Automation, Reporting, Analytics, eCommerce, Web Development, Client Acquisition', t: ['skills'] },
  { l: 'Job 1', c: 'Associate Business Manager (Google Ads) at VIRALMINT, Pune', t: ['experience'] },
  { l: 'Job 2', c: 'Digital Marketing Manager / Chief Marketing Officer at EMICIN DIGITAL, USA', t: ['experience'] },
  { l: 'Job 3', c: 'Senior Digital Marketing Executive & Marketing Automation Engineer at UBUY, Jaipur', t: ['experience'] },
  { l: 'Education', c: 'BBA in Entrepreneurship from GCEC (2022)', t: ['education'] },
  { l: 'Interests', c: 'Cryptocurrency, stock market trends, startup ecosystem, and business scaling', t: ['interests'] },
];

const normalize = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const INDEXED = RESUME_DATA.map((x, i) => ({ ...x, i, s: normalize(`${x.l} ${x.c} ${(x.t || []).join(' ')}`) }));

async function openAssistantTab(targetTabId) {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url && tab.url.startsWith(ASSISTANT_TAB_URL));

  await chrome.storage.local.set({ resumeAssistantTargetTabId: targetTabId });

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    return;
  }

  await chrome.tabs.create({ url: ASSISTANT_TAB_URL });
}

function isAssistantUrl(url) {
  return Boolean(url && url.startsWith(ASSISTANT_TAB_URL));
}

async function updateTargetFromTab(tabId) {
  if (!tabId) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || isAssistantUrl(tab.url)) return;
  await chrome.storage.local.set({ resumeAssistantTargetTabId: tabId });
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updateTargetFromTab(tabId);
});

chrome.action.onClicked.addListener(async (tab) => {
  const targetTabId = tab?.id || null;
  if (targetTabId) await openAssistantTab(targetTabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'resume-assistant/get-target-tab') {
    chrome.storage.local.get(['resumeAssistantTargetTabId']).then(({ resumeAssistantTargetTabId }) => {
      sendResponse({ targetTabId: resumeAssistantTargetTabId || null });
    });
    return true;
  }

  if (message?.type === 'resume-assistant/fill-target') {
    const value = String(message.value || '');
    chrome.storage.local.get(['resumeAssistantTargetTabId']).then(async ({ resumeAssistantTargetTabId }) => {
      const tabId = resumeAssistantTargetTabId;
      if (!tabId) return sendResponse({ ok: false, error: 'No target tab selected' });
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (fillValue) => {
            const active = document.activeElement;
            if (!active || !/INPUT|TEXTAREA|SELECT/.test(active.tagName)) return { ok: false, error: 'Focus a field in the job form tab first' };
            const marker = '__resumeAssistantTabFill';
            if (active[marker] === String(fillValue)) {
              if (active.tagName === 'SELECT') active.selectedIndex = 0;
              else active.value = '';
              active[marker] = '';
            } else {
              active.value = fillValue;
              active[marker] = String(fillValue);
            }
            active.dispatchEvent(new Event('input', { bubbles: true }));
            active.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true };
          },
          args: [value],
        });
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    });
    return true;
  }
});

chrome.omnibox.setDefaultSuggestion({
  description: 'Resume Assistant: type to search. Enter copies value or choose fill option.',
});

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  const q = normalize(text);
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const matched = INDEXED.filter((x) => !tokens.length || tokens.every((t) => x.s.includes(t))).slice(0, 6);

  const out = matched.map((x) => ({
    content: `copy::${x.i}`,
    description: `<match>${x.l}</match> — ${x.c.slice(0, 110)}`,
  }));

  if (matched.length) {
    out.push({
      content: `fill::${matched[0].i}`,
      description: `Fill focused field in target tab with <match>${matched[0].l}</match>`,
    });
  }

  suggest(out);
});

chrome.omnibox.onInputEntered.addListener(async (text) => {
  const [mode, idxRaw] = String(text).split('::');
  const idx = Number(idxRaw);
  const target = Number.isInteger(idx) ? INDEXED[idx] : null;
  if (!target) return;

  if (mode === 'copy') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) return;
    await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: async (value) => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          const t = document.createElement('textarea');
          t.value = value;
          document.body.appendChild(t);
          t.select();
          document.execCommand('copy');
          t.remove();
        }
      },
      args: [target.c],
    });
  }

  if (mode === 'fill') {
    const { resumeAssistantTargetTabId } = await chrome.storage.local.get(['resumeAssistantTargetTabId']);
    if (!resumeAssistantTargetTabId) return;
    await chrome.scripting.executeScript({
      target: { tabId: resumeAssistantTargetTabId },
      func: (value) => {
        const active = document.activeElement;
        if (!active || !/INPUT|TEXTAREA|SELECT/.test(active.tagName)) return;
        active.value = value;
        active.dispatchEvent(new Event('input', { bubbles: true }));
        active.dispatchEvent(new Event('change', { bubbles: true }));
      },
      args: [target.c],
    });
  }
});
