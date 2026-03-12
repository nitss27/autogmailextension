// ==UserScript==
// @name         Smart Resume Assistant V30 - Dashboard
// @namespace    http://tampermonkey.net/
// @version      30.0
// @description  Fast searchable dashboard for resume data with quick copy and form fill
// @author       Nitesh Shekhawat
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'nitesh_v30_state';
  const state = {
    enabled: false,
    x: 80,
    y: 80,
    compact: false,
    category: 'All',
    search: '',
    ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')),
  };

  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  const data = [
    { l: 'Full Name', c: 'Nitesh Shekhawat', t: ['name', 'fullname', 'applicant'] },
    { l: 'Legal Name', c: 'Nitesh Shekhawat', t: ['name', 'legal', 'legal name'] },
    { l: 'Given Name(s)', c: 'Nitesh', t: ['name', 'given', 'first name', 'given name'] },
    { l: 'Family Name', c: 'Shekhawat', t: ['name', 'family', 'last name', 'surname', 'family name'] },
    { l: 'Local Given Name(s)', c: 'Nitesh', t: ['name', 'local', 'local given'] },
    { l: 'Local Family Name', c: 'Shekhawat', t: ['name', 'local', 'local family'] },
    { l: 'Preferred Name', c: 'Nitesh', t: ['name', 'preferred', 'preferred name'] },
    { l: 'First Name', c: 'Nitesh', t: ['name', 'first', 'first name'] },
    { l: 'Last Name', c: 'Shekhawat', t: ['name', 'last', 'last name'] },
    { l: 'Surname', c: 'Shekhawat', t: ['name', 'surname'] },
    { l: 'Email', c: 'mr.niteshshekhawat@gmail.com', t: ['email'] },
    { l: 'Phone', c: '+91 7073616862', t: ['phone', 'mobile', 'contact'] },
    { l: 'LinkedIn', c: 'https://www.linkedin.com/in/nitesh-shekhawat/', t: ['linkedin', 'social', 'profile'] },
    { l: 'Full Address', c: 'Vaishali Nagar, Jaipur, Rajasthan 302012', t: ['address', 'full address'] },
    { l: 'Address Line 1', c: 'Vaishali Nagar', t: ['address', 'address line', 'street'] },
    { l: 'Address Line 2', c: '', t: ['address', 'address line 2'] },
    { l: 'City', c: 'Jaipur', t: ['city', 'town'] },
    { l: 'State', c: 'Rajasthan', t: ['state', 'province', 'region'] },
    { l: 'Postal Code', c: '302012', t: ['zip', 'pincode', 'postal', 'postal code'] },
    { l: 'Zip Code', c: '302012', t: ['zip', 'pincode', 'postal', 'zip code'] },
    { l: 'Pincode', c: '302012', t: ['zip', 'pincode', 'postal'] },
    { l: 'Country', c: 'India', t: ['country'] },
    { l: 'Address (Old)', c: 'Plot no 90, Ganesh nagar vistar', t: ['address', 'old address'] },
    { l: 'Area', c: 'Bindayka', t: ['area', 'locality'] },
    { l: 'City/State', c: 'Jaipur, Rajasthan', t: ['city', 'state', 'location'] },
    { l: 'Notice Period', c: '2 Months', t: ['notice', 'notice period'] },
    { l: 'Notice Period (Days)', c: '60', t: ['notice', 'notice period', 'days'] },
    { l: 'Notice Period (Weeks)', c: '8', t: ['notice', 'notice period', 'weeks'] },
    { l: 'Languages', c: 'English: Fluent, Hindi: Native', t: ['language', 'languages'] },
    { l: 'Professional Summary', c: "I am a growth-driven digital marketing specialist with 6+ years of hands-on experience in Advance Google Ads, Meta Ads, SEO, Paid media, marketing automation, eCommerce growth, high quality bulk lead generation and full-stack campaign execution.", t: ['summary', 'objective', 'profile', 'about'] },
    { l: 'Google Ads Skills', c: 'Search Ads, Display Ads, Shopping Ads, Performance Max, Video Ads (YouTube), Audience Targeting, Remarketing, Conversion Tracking, Keyword Research, A/B Testing, Bid Management, Budget Optimization, ROI Optimization', t: ['skills', 'google ads', 'ppc'] },
    { l: 'Meta Ads Skills', c: 'Facebook Ads, Instagram Ads, Catalog Ads, Audience Targeting, Retargeting, Funnel Strategy, Pixel Setup, Conversion API, Campaign Scaling, ROAS Optimization', t: ['skills', 'meta ads', 'facebook', 'instagram'] },
    { l: 'Search Engine Optimization (SEO)', c: 'On-Page SEO, Off-Page SEO, Link Building, Local SEO, Site Health Optimization, Keyword Research, Technical SEO, Schema Markup, GMB', t: ['skills', 'seo'] },
    { l: 'Social Media Marketing', c: 'Meta Ads, Linkedin Ads, Twitter Ads, Pinterest Ads, Snapchat Ads, YouTube Ads, Community Engagement, UGC Marketing', t: ['skills', 'social media', 'smm'] },
    { l: 'Advance Email Marketing', c: 'Lead Scraping Automation, Lead Nurturing, Email Campaign Automation, SPF, DKIM, MX, BIMI, VMC, IP Rotation', t: ['skills', 'email', 'email marketing'] },
    { l: 'Mobile Marketing & App Store Optimization', c: 'SMS campaigns, push notifications, chatbot integration, app engagement, ASO (Playstore & App Store)', t: ['skills', 'mobile', 'aso', 'app'] },
    { l: 'Conversion Rate Optimization (CRO)', c: 'A/B testing, funnel analysis, CTA improvements, product page optimization, upsell and cross-sell', t: ['skills', 'cro', 'conversion'] },
    { l: 'Marketing Automation & Process Development', c: 'Workflow automation, API integration, Python automation, remote servers for 24/7 operations', t: ['skills', 'automation', 'process'] },
    { l: 'Data & Reporting', c: 'Reporting, client communication, progress tracking, Jira, Asana', t: ['skills', 'reporting', 'analytics', 'data'] },
    { l: 'Content Marketing', c: 'Proofreading, product descriptions, PR, guest posting, ad copywriting, content strategy', t: ['skills', 'content', 'copywriting'] },
    { l: 'Analytics, Tracking & Keyword Research', c: 'GA4, GTM, Data Studio, Heatmaps, Appsflyer, Microsoft Clarity, Semrush, Ahrefs', t: ['skills', 'analytics', 'tracking', 'ga4', 'gtm'] },
    { l: 'Ecommerce & Marketplaces Sale Growth', c: 'Shopify, Magento, WooCommerce, Amazon, Flipkart, Meesho, Myntra, Nyka', t: ['skills', 'ecommerce', 'marketplace'] },
    { l: 'Web Development & Design', c: 'WordPress, Magento, Drupal, HTML, CSS, Python, speed optimization, site security', t: ['skills', 'web', 'development', 'design'] },
    { l: 'Client Acquisition & Team Management', c: 'Team collaboration, project bidding, proposal writing, cold calling, Linkedin outreach, B2B lead generation', t: ['skills', 'management', 'leadership', 'acquisition'] },
    { l: 'Tools & Technologies', c: 'Google Ads, Meta Ads, GA, Search Console, SEMrush, Ahrefs, Canva, Photoshop, HubSpot, Zapier, Python, Jira, Asana, ChatGPT', t: ['skills', 'tools', 'software', 'tech'] },
    { l: 'Social Proof & Review Management', c: 'Review monitoring, brand reputation management, response strategy, review growth strategy', t: ['skills', 'reviews', 'reputation'] },
    { l: 'Job 1: Title', c: 'Associate Business Manager (Google Ads)', t: ['title', 'job title', 'position'], n: 1 },
    { l: 'Job 1: Company', c: 'VIRALMINT', t: ['company', 'employer'], n: 1 },
    { l: 'Job 1: Location', c: 'Pune, Maharashtra, India', t: ['location'], n: 1 },
    { l: 'Job 1: Duration', c: 'Present', t: ['duration', 'date'], n: 1 },
    { l: 'Job 2: Title', c: 'Digital Marketing Manager / Chief Marketing Officer', t: ['title', 'job title', 'position'], n: 2 },
    { l: 'Job 2: Company', c: 'EMICIN DIGITAL', t: ['company', 'employer'], n: 2 },
    { l: 'Job 2: Location', c: 'USA (Remote)', t: ['location'], n: 2 },
    { l: 'Job 2: Duration', c: 'Feb 2024 – Jun 2025', t: ['duration', 'date'], n: 2 },
    { l: 'Job 3: Title', c: 'Senior Digital Marketing Executive & Marketing Automation Engineer', t: ['title', 'job title', 'position'], n: 3 },
    { l: 'Job 3: Company', c: 'UBUY (E-commerce MNC)', t: ['company', 'employer'], n: 3 },
    { l: 'Job 3: Location', c: 'Jaipur, Rajasthan', t: ['location'], n: 3 },
    { l: 'Job 3: Duration', c: 'June 2022 – January 2024', t: ['duration', 'date'], n: 3 },
    { l: 'Job 4: Title', c: 'Professional Freelancer', t: ['title', 'job title', 'position'], n: 4 },
    { l: 'Job 4: Platform', c: 'Upwork, Multiple Businesses & Agencies', t: ['company', 'platform'], n: 4 },
    { l: 'Job 4: Duration', c: 'Jun 2020 – May 2022', t: ['duration', 'date'], n: 4 },
    { l: 'Job 5: Title', c: 'Digital Marketing Intern', t: ['title', 'job title', 'position'], n: 5 },
    { l: 'Job 5: Company', c: 'Technovation', t: ['company', 'employer'], n: 5 },
    { l: 'Job 5: Location', c: 'Jaipur', t: ['location'], n: 5 },
    { l: 'Job 5: Duration', c: 'Dec 2019 - May 2020', t: ['duration', 'date'], n: 5 },
    { l: 'Education', c: 'Bachelor of Business Administration (BBA) in Entrepreneurship from GCEC (2022)', t: ['education', 'degree', 'school'] },
    { l: 'Interests', c: 'Cryptocurrency, stock markets, startup ecosystem, and business scaling', t: ['interests', 'hobbies'] },
  ];

  function getCategory(item) {
    if (item.l.startsWith('Job ')) return 'Experience';
    if (item.t.includes('skills')) return 'Skills';
    if (item.t.includes('education')) return 'Education';
    if (item.t.includes('interests')) return 'Interests';
    if (item.t.includes('address')) return 'Address';
    if (item.t.includes('email') || item.t.includes('phone') || item.t.includes('linkedin')) return 'Contact';
    return 'Personal';
  }

  const normalize = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const indexed = data.map((item, idx) => ({
    ...item,
    idx,
    category: getCategory(item),
    indexText: normalize(`${item.l} ${item.c} ${(item.t || []).join(' ')} ${getCategory(item)}`),
  }));

  const categories = ['All', ...new Set(indexed.map((x) => x.category))];
  let selectedIdx = 0;
  let filtered = [];

  const panel = document.createElement('section');
  panel.id = 'nitesh-resume-dashboard-v30';
  panel.innerHTML = `
    <header class="hd">
      <strong>⚡ Resume Dashboard</strong>
      <div class="actions">
        <button id="nitesh-compact">◱</button>
        <button id="nitesh-close">✕</button>
      </div>
    </header>
    <div class="tools">
      <input id="nitesh-search" placeholder="Type to filter label, value, tag... (Alt+Q)" />
      <button id="nitesh-copy-filtered">Copy filtered</button>
      <button id="nitesh-fill-focused">Fill focused</button>
    </div>
    <div class="chips" id="nitesh-chips"></div>
    <div class="meta" id="nitesh-meta"></div>
    <div class="rows" id="nitesh-rows"></div>
    <footer>Hotkeys: Alt+X toggle • Alt+Q focus filter • ↑↓ select • Enter copy • Shift+Enter fill/unfill</footer>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #nitesh-resume-dashboard-v30{position:fixed;top:${state.y}px;left:${state.x}px;width:520px;max-height:78vh;background:#111;color:#fff;z-index:2147483647;border:1px solid #333;border-radius:14px;padding:12px;font:13px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.4);display:none}
    #nitesh-resume-dashboard-v30.compact{width:420px}
    #nitesh-resume-dashboard-v30 .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;cursor:move}
    #nitesh-resume-dashboard-v30 .actions button{background:#222;border:1px solid #444;color:#ddd;border-radius:6px;padding:3px 7px;cursor:pointer}
    #nitesh-resume-dashboard-v30 .tools{display:grid;grid-template-columns:1fr auto auto;gap:8px;margin-bottom:8px}
    #nitesh-resume-dashboard-v30 input{background:#1c1c1c;color:#fff;border:1px solid #444;border-radius:8px;padding:9px 10px}
    #nitesh-resume-dashboard-v30 .tools button{background:#194d2f;color:#d8ffd8;border:1px solid #2f8151;border-radius:8px;padding:8px 10px;cursor:pointer}
    #nitesh-resume-dashboard-v30 .chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
    #nitesh-resume-dashboard-v30 .chip{background:#202020;border:1px solid #444;border-radius:999px;padding:4px 9px;cursor:pointer}
    #nitesh-resume-dashboard-v30 .chip.active{background:#2b5f3e;border-color:#4caf50;color:#d5ffd9}
    #nitesh-resume-dashboard-v30 .meta{font-size:11px;color:#aaa;margin-bottom:8px}
    #nitesh-resume-dashboard-v30 .rows{max-height:52vh;overflow:auto;display:flex;flex-direction:column;gap:6px}
    #nitesh-resume-dashboard-v30 .row{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;background:#181818;border:1px solid #2e2e2e;border-radius:9px;padding:8px}
    #nitesh-resume-dashboard-v30 .row.active{outline:2px solid #4caf50}
    #nitesh-resume-dashboard-v30 .lbl{font-weight:700;color:#87f5aa}
    #nitesh-resume-dashboard-v30 .val{font-size:11px;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}
    #nitesh-resume-dashboard-v30 .row button{background:#2b2b2b;border:1px solid #4b4b4b;color:#fff;border-radius:7px;padding:5px 8px;cursor:pointer}
    #nitesh-resume-dashboard-v30 footer{margin-top:8px;font-size:10px;color:#666;text-align:center}
  `;

  document.head.appendChild(style);
  document.body.appendChild(panel);

  const el = {
    search: panel.querySelector('#nitesh-search'),
    chips: panel.querySelector('#nitesh-chips'),
    rows: panel.querySelector('#nitesh-rows'),
    meta: panel.querySelector('#nitesh-meta'),
    close: panel.querySelector('#nitesh-close'),
    compact: panel.querySelector('#nitesh-compact'),
    copyFiltered: panel.querySelector('#nitesh-copy-filtered'),
    fillFocused: panel.querySelector('#nitesh-fill-focused'),
  };

  function toast(text, bg = '#2f7f4f') {
    const t = document.createElement('div');
    t.textContent = text;
    Object.assign(t.style, { position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647', background: bg, color: '#fff', padding: '9px 14px', borderRadius: '8px', fontSize: '12px' });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1400);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Copied');
  }

  function fillFocused(value) {
    const active = document.activeElement;
    if (!active || !/INPUT|TEXTAREA|SELECT/.test(active.tagName)) {
      toast('Focus a field first', '#a95a2e');
      return;
    }
    const marker = '__resumeFillValue';
    if (active[marker] === String(value)) {
      if (active.tagName === 'SELECT') active.selectedIndex = 0;
      else active.value = '';
      active[marker] = '';
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      toast('Cleared on second fill');
      return;
    }
    if (active.tagName === 'SELECT') {
      const opt = [...active.options].find((o) => o.text.toLowerCase().includes(String(value).toLowerCase()) || o.value.toLowerCase().includes(String(value).toLowerCase()));
      if (opt) active.value = opt.value;
    } else {
      active.value = value;
    }
    active[marker] = String(value);
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    toast('Filled focused field');
  }

  function applyFilter() {
    const q = normalize(state.search);
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    filtered = indexed.filter((item) => {
      const catOk = state.category === 'All' || item.category === state.category;
      const textOk = !tokens.length || tokens.every((t) => item.indexText.includes(t));
      return catOk && textOk;
    });
    selectedIdx = Math.min(selectedIdx, Math.max(filtered.length - 1, 0));
    renderRows();
  }

  function renderChips() {
    el.chips.innerHTML = '';
    categories.forEach((cat) => {
      const b = document.createElement('button');
      b.className = `chip ${cat === state.category ? 'active' : ''}`;
      b.textContent = cat;
      b.onclick = () => {
        state.category = cat;
        save();
        renderChips();
        applyFilter();
      };
      el.chips.appendChild(b);
    });
  }

  function renderRows() {
    el.rows.innerHTML = '';
    el.meta.textContent = `${filtered.length} of ${indexed.length} items`;
    filtered.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = `row ${i === selectedIdx ? 'active' : ''}`;
      row.innerHTML = `
        <div>
          <div class="lbl">${item.l}</div>
          <div class="val">${item.c || '-'}</div>
        </div>
        <button>📋</button>
        <button>✏️</button>
      `;
      const [copyBtn, fillBtn] = row.querySelectorAll('button');
      copyBtn.onclick = (e) => { e.stopPropagation(); copy(item.c); };
      fillBtn.onclick = (e) => { e.stopPropagation(); fillFocused(item.c); };
      row.onclick = () => copy(item.c);
      row.onmouseenter = () => { selectedIdx = i; renderRows(); };
      el.rows.appendChild(row);
    });
  }

  el.search.value = state.search;
  el.search.addEventListener('input', () => {
    state.search = el.search.value;
    save();
    applyFilter();
  });

  el.copyFiltered.onclick = () => copy(filtered.map((x) => `${x.l}: ${x.c}`).join('\n'));
  el.fillFocused.onclick = () => {
    const item = filtered[selectedIdx];
    if (item) fillFocused(item.c);
  };

  el.close.onclick = () => {
    panel.style.display = 'none';
    state.enabled = false;
    save();
  };

  el.compact.onclick = () => {
    state.compact = !state.compact;
    panel.classList.toggle('compact', state.compact);
    save();
  };

  let drag = null;
  panel.querySelector('.hd').addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    drag = { dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop };
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    state.x = e.clientX - drag.dx;
    state.y = e.clientY - drag.dy;
    panel.style.left = `${state.x}px`;
    panel.style.top = `${state.y}px`;
  });
  document.addEventListener('mouseup', () => {
    if (drag) save();
    drag = null;
  });

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      state.enabled = !state.enabled;
      panel.style.display = state.enabled ? 'block' : 'none';
      if (state.enabled) el.search.focus();
      save();
      return;
    }
    if ((e.altKey) && e.key.toLowerCase() === 'q') {
      e.preventDefault();
      state.enabled = true;
      panel.style.display = 'block';
      el.search.focus();
      el.search.select();
      save();
      return;
    }
    if (!state.enabled) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1); renderRows(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); renderRows(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selectedIdx];
      if (!item) return;
      if (e.shiftKey) fillFocused(item.c); else copy(item.c);
    }
    if (e.key === 'Escape') {
      state.enabled = false;
      panel.style.display = 'none';
      save();
    }
  });

  panel.style.left = `${state.x}px`;
  panel.style.top = `${state.y}px`;
  panel.classList.toggle('compact', state.compact);
  panel.style.display = state.enabled ? 'block' : 'none';

  renderChips();
  applyFilter();
})();
