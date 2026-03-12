(() => {
  if (window.__resumeAssistantTopBar) return;

  const STORAGE_KEY = 'resume_assistant_topbar_v2';
  const state = {
    visible: true,
    category: 'All',
    height: 240,
    query: '',
    ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')),
  };
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  const data = [
    { l: 'Full Name', c: 'Nitesh Shekhawat', t: ['name', 'personal'] },
    { l: 'First Name', c: 'Nitesh', t: ['name', 'personal'] },
    { l: 'Last Name', c: 'Shekhawat', t: ['name', 'personal'] },
    { l: 'Email', c: 'mr.niteshshekhawat@gmail.com', t: ['contact', 'email'] },
    { l: 'Phone', c: '+91 7073616862', t: ['contact', 'phone'] },
    { l: 'LinkedIn', c: 'https://www.linkedin.com/in/nitesh-shekhawat/', t: ['contact', 'social'] },
    { l: 'Address', c: 'Vaishali Nagar, Jaipur, Rajasthan 302012, India', t: ['contact', 'address'] },
    { l: 'Notice Period', c: '2 Months (60 Days)', t: ['personal', 'availability'] },
    { l: 'Languages', c: 'English: Fluent, Hindi: Native', t: ['personal', 'languages'] },
    { l: 'Professional Summary', c: 'I am a growth-driven digital marketing specialist with 6+ years of hands-on experience in Advance Google Ads, Meta Ads, SEO, Paid media, marketing automation, eCommerce growth, high quality bulk lead generation and full-stack campaign execution. I am known for building performance-focused strategies and scaling brands with measurable results.', t: ['summary', 'profile'] },
    { l: 'Core Skills: Google Ads & Meta Ads', c: 'Search Ads, Display Ads, Shopping Ads, PMax, YouTube, Audience Targeting, Remarketing, Funnel Design, Conversion Tracking, A/B Testing, Bid Management, Budget Optimization, ROI Optimization', t: ['skills', 'ads'] },
    { l: 'Core Skills: SEO', c: 'On-Page SEO, Off-Page SEO, Link Building, Local SEO, Technical SEO, Schema Markup, Search Console, SEO content writing', t: ['skills', 'seo'] },
    { l: 'Core Skills: Social Media', c: 'Meta, LinkedIn, Twitter, Pinterest, Snapchat, YouTube, community engagement, influencer campaigns, UGC', t: ['skills', 'social'] },
    { l: 'Core Skills: Automation', c: 'Workflow automation, API integrations, Python automation, process streamlining', t: ['skills', 'automation'] },
    { l: 'Tools & Technologies', c: 'Google Ads, Meta Ads Manager, GA4, GTM, Search Console, SEMrush, Ahrefs, Canva, Photoshop, HubSpot, Zapier, Python, Selenium, Jira, Asana, ChatGPT', t: ['skills', 'tools'] },
    { l: 'Job 1 Title', c: 'Associate Business Manager (Google Ads)', t: ['experience', 'title'] },
    { l: 'Job 1 Company', c: 'VIRALMINT, Pune', t: ['experience', 'company'] },
    { l: 'Job 2 Title', c: 'Digital Marketing Manager / Chief Marketing Officer', t: ['experience', 'title'] },
    { l: 'Job 2 Company', c: 'EMICIN DIGITAL, USA', t: ['experience', 'company'] },
    { l: 'Job 3 Title', c: 'Senior Digital Marketing Executive & Marketing Automation Engineer', t: ['experience', 'title'] },
    { l: 'Job 3 Company', c: 'UBUY (E‑commerce MNC), Jaipur', t: ['experience', 'company'] },
    { l: 'Education', c: 'BBA in Entrepreneurship, GCEC (2022)', t: ['education'] },
    { l: 'Interests', c: 'Crypto, stock trends, startup ecosystem, business scaling', t: ['interests'] },
  ];

  const categoryOf = (x) => {
    if (x.t.includes('contact')) return 'Contact';
    if (x.t.includes('skills')) return 'Skills';
    if (x.t.includes('experience')) return 'Experience';
    if (x.t.includes('education')) return 'Education';
    if (x.t.includes('summary')) return 'Summary';
    if (x.t.includes('interests')) return 'Interests';
    return 'Personal';
  };

  const normalize = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const indexed = data.map((x) => ({ ...x, category: categoryOf(x), idx: normalize(`${x.l} ${x.c} ${(x.t || []).join(' ')} ${categoryOf(x)}`) }));
  const categories = ['All', ...new Set(indexed.map((x) => x.category))];

  const wrap = document.createElement('div');
  wrap.id = 'resume-assistant-topbar';
  wrap.innerHTML = `
    <div class="ra-head">
      <div class="ra-title">⚡ Resume Assistant</div>
      <div class="ra-controls">
        <button id="ra-size-down" title="Decrease size">A-</button>
        <button id="ra-size-up" title="Increase size">A+</button>
        <button id="ra-hide" title="Hide (Alt+X)">✕</button>
      </div>
    </div>
    <div class="ra-tools">
      <button id="ra-prev" title="Previous category (Alt+ArrowLeft)">◀</button>
      <div id="ra-cats" class="ra-cats"></div>
      <button id="ra-next" title="Next category (Alt+ArrowRight)">▶</button>
    </div>
    <input id="ra-search" readonly placeholder="Quick filter mode: Alt+Q, then type. Esc exits" />
    <div id="ra-meta" class="ra-meta"></div>
    <div id="ra-list" class="ra-list"></div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #resume-assistant-topbar{position:fixed;top:0;left:0;right:0;height:${state.height}px;background:#101010;color:#fff;z-index:2147483647;border-bottom:1px solid #333;padding:8px 10px;font:12px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.35)}
    #resume-assistant-topbar .ra-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
    #resume-assistant-topbar .ra-title{font-weight:700;color:#85f5ad}
    #resume-assistant-topbar button{background:#222;color:#fff;border:1px solid #444;border-radius:6px;padding:4px 8px;cursor:pointer}
    #resume-assistant-topbar .ra-tools{display:grid;grid-template-columns:auto 1fr auto;gap:6px;align-items:center;margin-bottom:6px}
    #resume-assistant-topbar .ra-cats{display:flex;gap:5px;overflow:auto}
    #resume-assistant-topbar .ra-cat.active{background:#275b3c;border-color:#4caf50}
    #resume-assistant-topbar #ra-search{width:100%;box-sizing:border-box;background:#1b1b1b;color:#9fe5b6;border:1px solid #444;border-radius:8px;padding:7px 9px}
    #resume-assistant-topbar .ra-meta{margin:4px 0;color:#aaa;font-size:11px}
    #resume-assistant-topbar .ra-list{height:calc(100% - 92px);overflow:auto;display:flex;flex-direction:column;gap:6px}
    #resume-assistant-topbar .ra-item{display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;background:#181818;border:1px solid #2c2c2c;border-radius:8px;padding:6px}
    #resume-assistant-topbar .ra-item.active{outline:2px solid #4caf50}
    #resume-assistant-topbar .lbl{color:#87f5aa;font-weight:600}
    #resume-assistant-topbar .val{color:#bcbcbc;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:68vw}
  `;

  document.documentElement.appendChild(style);
  document.body.appendChild(wrap);

  const el = {
    cats: wrap.querySelector('#ra-cats'),
    search: wrap.querySelector('#ra-search'),
    list: wrap.querySelector('#ra-list'),
    meta: wrap.querySelector('#ra-meta'),
    prev: wrap.querySelector('#ra-prev'),
    next: wrap.querySelector('#ra-next'),
    hide: wrap.querySelector('#ra-hide'),
    sizeUp: wrap.querySelector('#ra-size-up'),
    sizeDown: wrap.querySelector('#ra-size-down'),
  };

  let filtered = [];
  let selected = 0;
  let catIdx = Math.max(0, categories.indexOf(state.category));
  let quickFilterMode = false;
  let lastFormField = null;

  const toast = (txt) => {
    const t = document.createElement('div');
    t.textContent = txt;
    Object.assign(t.style, { position: 'fixed', top: '10px', right: '10px', zIndex: '2147483647', background: '#2f7f4f', color: '#fff', padding: '7px 10px', borderRadius: '6px' });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1200);
  };

  const rememberLastFormField = (target) => {
    if (target && !wrap.contains(target) && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) {
      lastFormField = target;
    }
  };

  const restoreFormFocus = () => {
    if (lastFormField && document.contains(lastFormField)) {
      lastFormField.focus({ preventScroll: true });
    }
  };

  document.addEventListener('focusin', (e) => rememberLastFormField(e.target));

  const copy = async (txt) => {
    try { await navigator.clipboard.writeText(txt); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    restoreFormFocus();
    toast('Copied');
  };

  const fillFocused = (value) => {
    const active = (document.activeElement && !wrap.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))
      ? document.activeElement
      : lastFormField;

    if (!active || !document.contains(active)) return toast('Focus a form field once');

    const mark = '__resumeTopFill';
    if (active[mark] === String(value)) {
      if (active.tagName === 'SELECT') active.selectedIndex = 0;
      else active.value = '';
      active[mark] = '';
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      active.focus({ preventScroll: true });
      return toast('Cleared on second fill');
    }

    if (active.tagName === 'SELECT') {
      const opt = [...active.options].find((o) => o.text.toLowerCase().includes(String(value).toLowerCase().slice(0, 40)) || o.value.toLowerCase().includes(String(value).toLowerCase().slice(0, 40)));
      if (opt) active.value = opt.value;
    } else {
      active.value = value;
    }

    active[mark] = String(value);
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    active.focus({ preventScroll: true });
    toast('Filled');
  };

  const renderCats = () => {
    el.cats.innerHTML = '';
    categories.forEach((c) => {
      const b = document.createElement('button');
      b.className = `ra-cat ${state.category === c ? 'active' : ''}`;
      b.textContent = c;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.onclick = () => { state.category = c; catIdx = categories.indexOf(c); save(); apply(); restoreFormFocus(); };
      el.cats.appendChild(b);
    });
  };

  const renderRows = () => {
    el.list.innerHTML = '';
    el.meta.textContent = `${filtered.length} / ${indexed.length} items • Category: ${state.category} • ${quickFilterMode ? 'Quick filter ON' : 'Quick filter OFF'}`;
    el.search.value = state.query;

    filtered.forEach((x, i) => {
      const row = document.createElement('div');
      row.className = `ra-item ${i === selected ? 'active' : ''}`;
      row.innerHTML = `<div><div class="lbl">${x.l}</div><div class="val">${x.c}</div></div><button title="Copy">📋</button><button title="Fill/Clear">↩</button>`;
      row.addEventListener('mousedown', (e) => e.preventDefault());
      const [copyBtn, fillBtn] = row.querySelectorAll('button');
      copyBtn.addEventListener('mousedown', (e) => e.preventDefault());
      fillBtn.addEventListener('mousedown', (e) => e.preventDefault());
      copyBtn.onclick = (e) => { e.stopPropagation(); copy(x.c); };
      fillBtn.onclick = (e) => { e.stopPropagation(); fillFocused(x.c); };
      row.onmouseenter = () => { selected = i; renderRows(); };
      row.onclick = () => copy(x.c);
      el.list.appendChild(row);
    });
  };

  const apply = () => {
    const q = normalize(state.query);
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    filtered = indexed.filter((x) => {
      const catMatch = state.category === 'All' || x.category === state.category;
      const queryMatch = !tokens.length || tokens.every((t) => x.idx.includes(t));
      return catMatch && queryMatch;
    });
    selected = Math.min(selected, Math.max(0, filtered.length - 1));
    renderCats();
    renderRows();
  };

  const cycleCategory = (dir) => {
    catIdx = (catIdx + dir + categories.length) % categories.length;
    state.category = categories[catIdx];
    save();
    apply();
  };

  const setHeight = (h) => {
    state.height = Math.max(170, Math.min(520, h));
    wrap.style.height = `${state.height}px`;
    save();
  };

  [el.prev, el.next, el.hide, el.sizeUp, el.sizeDown, el.search].forEach((node) => {
    node.addEventListener('mousedown', (e) => e.preventDefault());
  });

  el.prev.onclick = () => { cycleCategory(-1); restoreFormFocus(); };
  el.next.onclick = () => { cycleCategory(1); restoreFormFocus(); };
  el.sizeUp.onclick = () => { setHeight(state.height + 40); restoreFormFocus(); };
  el.sizeDown.onclick = () => { setHeight(state.height - 40); restoreFormFocus(); };
  el.hide.onclick = () => { state.visible = false; wrap.style.display = 'none'; save(); restoreFormFocus(); };

  const keyHandler = (e) => {
    if (e.altKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      state.visible = !state.visible;
      wrap.style.display = state.visible ? 'block' : 'none';
      save();
      restoreFormFocus();
      return;
    }

    if (e.altKey && e.key.toLowerCase() === 'q') {
      e.preventDefault();
      state.visible = true;
      wrap.style.display = 'block';
      quickFilterMode = !quickFilterMode;
      renderRows();
      toast(quickFilterMode ? 'Quick filter ON (type to search, Esc to stop)' : 'Quick filter OFF');
      restoreFormFocus();
      return;
    }

    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); cycleCategory(-1); restoreFormFocus(); return; }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); cycleCategory(1); restoreFormFocus(); return; }

    if (quickFilterMode) {
      if (e.key === 'Escape') {
        e.preventDefault();
        quickFilterMode = false;
        renderRows();
        toast('Quick filter OFF');
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        state.query = state.query.slice(0, -1);
        save();
        apply();
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        state.query += e.key;
        save();
        apply();
        return;
      }
    }

    if (!state.visible) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, filtered.length - 1); renderRows(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(0, selected - 1); renderRows(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selected];
      if (!item) return;
      if (e.shiftKey) fillFocused(item.c); else copy(item.c);
    }
  };
  document.addEventListener('keydown', keyHandler);

  window.__resumeAssistantTopBar = {
    toggle: () => {
      state.visible = !state.visible;
      wrap.style.display = state.visible ? 'block' : 'none';
      save();
      restoreFormFocus();
    },
  };

  wrap.style.display = state.visible ? 'block' : 'none';
  apply();
})();
