(() => {
  if (window.__niteshResumeDashBookmarklet) {
    window.__niteshResumeDashBookmarklet.toggle();
    return;
  }

  const STORAGE_KEY = 'nitesh_v31_bookmarklet_state';
  const state = {
    enabled: true,
    x: 80,
    y: 70,
    category: 'All',
    search: '',
    ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')),
  };
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  const data = [
    { l: 'Full Name', c: 'Nitesh Shekhawat', t: ['name', 'fullname', 'applicant'] },
    { l: 'First Name', c: 'Nitesh', t: ['name', 'first', 'given'] },
    { l: 'Last Name', c: 'Shekhawat', t: ['name', 'last', 'family', 'surname'] },
    { l: 'Email', c: 'mr.niteshshekhawat@gmail.com', t: ['email'] },
    { l: 'Phone', c: '+91 7073616862', t: ['phone', 'mobile', 'contact'] },
    { l: 'LinkedIn', c: 'https://www.linkedin.com/in/nitesh-shekhawat/', t: ['linkedin', 'profile'] },
    { l: 'Full Address', c: 'Vaishali Nagar, Jaipur, Rajasthan 302012, India', t: ['address', 'city', 'state', 'country', 'postal'] },
    { l: 'City', c: 'Jaipur', t: ['address', 'city'] },
    { l: 'State', c: 'Rajasthan', t: ['address', 'state'] },
    { l: 'Postal Code', c: '302012', t: ['address', 'zip', 'postal', 'pincode'] },
    { l: 'Country', c: 'India', t: ['address', 'country'] },
    { l: 'Notice Period', c: '2 Months (60 Days)', t: ['notice', 'availability'] },
    { l: 'Languages', c: 'English: Fluent, Hindi: Native', t: ['language', 'languages'] },
    { l: 'Professional Summary', c: `I am a growth-driven digital marketing specialist with 6+ years of hands-on experience in Advance Google Ads, Meta Ads, SEO, Paid media, marketing automation, eCommerce growth, high quality bulk lead generation and full-stack campaign execution. I’m known for building performance-focused strategies from scratch and transforming early-stage brands into high-revenue businesses. What sets me apart is my ability to own entire marketing ecosystems — from setting up ad platforms, automation tools, and analytics dashboards, to managing large-scale campaigns, product data, and client communications. I've successfully led marketing operations for both startups and global eCommerce companies, managing million-dollar ad budgets, and handling complex systems with complete accountability. I work at the intersection of strategy, execution, and tech — collaborating with cross functional teams, simplifying complex processes, and implementing automation to scale results efficiently. My deep understanding of tools, systems, and customer behaviour allows me to identify growth opportunities that others miss. I bring a builder's mindset, a data-first approach, and the ability to deliver measurable outcomes — whether it’s boosting conversions, increasing retention, or streamlining operations. My experience is not just about skills — it’s about ownership, reliability, and impact, making me a valuable asset for any organization looking to scale sustainably and intelligently.`, t: ['summary', 'profile', 'about', 'objective'] },

    { l: 'Core Skills: Google Ads & Meta Ads', c: 'Search Ads, Display Ads, Shopping Ads, Performance Max, Video Ads (YouTube), Audience Targeting, Remarketing, Marketing Funnel Designing (TOF/BOF/MOF), Conversion Tracking, Keyword Research, A/B Testing, Bid Management, Budget Optimization, Quality Score Improvement, Complete Ads Integration with Tracking, Product Feeds Optimization, ROI Optimization, Competitor Analysis, Ad Copywriting, Creative Design, Landing Page Optimization, Performance Reporting', t: ['skills', 'google ads', 'meta ads', 'ppc'] },
    { l: 'Core Skills: SEO', c: 'On-Page SEO, Off-Page SEO, Link Building, Local SEO, Site Health Optimization, Keyword Research, Site Audits, Technical SEO, Sitemap Creation, Google Search Console Optimization, Schema Markup (Product Price, Reviews, Images, All other types), Meta Title, Meta Descriptions, SEO Monitoring, SEO Content Writing (Blog Posts, Articles, Web Content), SEO Blogs & Articles, Google My Business Optimization (GMB)', t: ['skills', 'seo'] },
    { l: 'Core Skills: Social Media Marketing', c: 'Meta Ads (Facebook, Instagram), Linkedin Ads, Twitter Ads, Pinterest Ads, Snapchat Ads, YouTube Ads, Social Media Strategy, Brand Awareness, Community Engagement, Influencer Collaborations/Marketing, Viral Campaigns, Instagram Stories, Facebook Groups, TikTok Organic, Pinterest Organic, User Engagement Strategies, Social Media Content Creation, Reddit, Quora Traffic Generation, UGC Marketing', t: ['skills', 'social media'] },
    { l: 'Core Skills: Advance Email Marketing', c: 'Lead Scraping Automation, Lead Nurturing, Email Campaigns, AI-Powered Retargeting, Email Marketing Tools (Klaviyo, Mautic, Listmonk, Mailchimp, Sendy, Amazon SES, Attentive.io, Mailjet, HubSpot, Drip, ActiveCampaign), Email Campaign Automation, Bulk Email Server Setup, IP Rotation, A/B Testing Email Campaigns, Email Deliverability Setup (SPF, DKIM, MX Records), BIMI Setup, VMC setup, Blue Tick for Email Verification, Annotations for Email Features, Advance Excel & Data Management', t: ['skills', 'email'] },
    { l: 'Core Skills: Mobile Marketing & ASO', c: 'SMS Campaigns & Automation, Mobile Push Notifications (Firebase, Custom), Chatbot Integration, Push Notification Design & Integration (Android & iOS), Integrated Web & Mobile Push Notifications, Personalized Push Notifications, App Download Increase via Push & Email Campaigns, App Store Optimization (ASO)', t: ['skills', 'mobile', 'aso'] },
    { l: 'Core Skills: CRO', c: 'Conversion Rate Optimization (CRO), A/B Testing, Landing Page Design & Optimization, Funnel Analysis, User Experience Optimization, CTA Improvements, eCommerce Conversion Funnels, Product Page Optimization, Conversion-Focused Sales Funnels, Upsell & Cross-sell Strategies, CRO via Reviews', t: ['skills', 'cro'] },
    { l: 'Core Skills: Marketing Automation & Process Development', c: 'Workflow Automation, Process Automation, API Integration, Custom Software Systems for Digital Marketing, Automation Systems Development (Python), Remote Desktop Servers for 24/7 Marketing Automation, Process Streamlining for Digital Marketing Tasks, Marketing Automation using AI', t: ['skills', 'automation'] },
    { l: 'Core Skills: Data & Reporting', c: 'Reporting & Client Communication, Task Assignment, Reputation Management, Progress Tracking, Digital Task Streamlining, Timely Completion of Marketing Campaigns, Internal Process Streamlining, Jira & Asana', t: ['skills', 'reporting', 'analytics'] },
    { l: 'Core Skills: Content Marketing', c: 'Proofreading, Product Descriptions Optimization, Content Writing for Product Listings, Press Release (PR), Guest Posting & Outreach, Email Newsletters, Ad Copy for Various Platforms, Copywriting for Websites and Ads, Content Strategy, Brand Building via Organic Content, Product Listing Content', t: ['skills', 'content'] },
    { l: 'Core Skills: Analytics, Tracking & Keyword Research', c: 'Google Analytics 4 (GA4), Google Tag Manager, Data Studio, Heatmaps, User Tracking, Semrush, Ahrefs, Website Traffic and Conversion Tracking, Performance Analysis, Appsflyer, Microsoft Clarity', t: ['skills', 'analytics', 'tracking'] },
    { l: 'Core Skills: Ecommerce & Marketplaces', c: 'Shopify Optimization, Magento Development, WooCommerce, Amazon & Flipkart, Meesho, Myntra, Nyka Marketplace Account Management, Inventory Management, Product Optimization, Product Uploading, Sales Optimization, Shipping Management', t: ['skills', 'ecommerce', 'marketplace'] },
    { l: 'Core Skills: Web Development & Design', c: 'WordPress, Magento, Drupal, HTML, CSS, Python, Speed Optimization, Site Security, Improving User Engagement, Website Speed Optimization', t: ['skills', 'web', 'development', 'design'] },
    { l: 'Core Skills: Client Acquisition & Team Management', c: 'Team Collaboration, Internal Process Automation, Project Bidding, Proposal Writing, Campaign Lifecycle Management, Cold Calling, Linkedin Outreach, B2B Lead Generation, Client Relationship Management, Organic Outreach (Email, Calls, LinkedIn, Facebook, Instagram), Efficient Lead Nurturing', t: ['skills', 'management', 'acquisition'] },
    { l: 'Tools & Technologies', c: 'Google Ads, Meta Ads Manager, Google Analytics, Search Console, SEMrush, Ahrefs, Moz, Ubersuggest, Screaming Frog, GTmetrix, Grammarly, Jasper AI, Surfer SEO, Canva, Photoshop, Adobe Premiere Pro, Mailchimp, Sendinblue, Klaviyo, ActiveCampaign, HubSpot, ConvertKit, HubSpot CRM, Zoho CRM, Salesforce, LinkedIn Sales Navigator, Apollo.io, Hunter.io, Lemlist, Zapier, Trello, Notion, Google Workspace, Power Automate, Python, Selenium, MS Office (Excel, Word, PowerPoint, Outlook), Asana, Jira, Appsflyer, ChatGPT, Gemini, Sora, Midjourney.', t: ['skills', 'tools', 'technology'] },

    { l: 'Job 1 Title', c: 'Associate Business Manager (Google Ads)', t: ['experience', 'job', 'title'] },
    { l: 'Job 1 Company', c: 'VIRALMINT, Pune', t: ['experience', 'company'] },
    { l: 'Job 1 Duration', c: 'Present', t: ['experience', 'duration'] },
    { l: 'Job 1 Highlights', c: 'Managed end-to-end campaign execution across Search, Display, Shopping, Performance Max, and Video Ads. Implemented complete conversion tracking and media plans. Handled keyword research, audience targeting, remarketing, ad copywriting, creative design, A/B testing, bid management, budget optimization, competitor analysis, and reporting. Improved Quality Score, landing page experience, ROI, and campaign scaling. Managed client communication, strategy planning, and performance reviews. Brands handled include Avimee Herbal, Krishna Herbal, Neuberg Diagnostics, NourishYou, Nisarga Herbs and more.', t: ['experience', 'description'] },

    { l: 'Job 2 Title', c: 'Digital Marketing Manager / Chief Marketing Officer', t: ['experience', 'job', 'title'] },
    { l: 'Job 2 Company', c: 'EMICIN DIGITAL, USA (Digital Marketing Agency)', t: ['experience', 'company'] },
    { l: 'Job 2 Duration', c: 'Feb 2024 – Jun 2025', t: ['experience', 'duration'] },
    { l: 'Job 2 Highlights', c: 'Managed monthly ad budgets over $500K with 3–4x ROI and scaled to 7–8 figure revenues. Built company website end-to-end. Acquired US clients via cold calls, LinkedIn, email, and Facebook. Managed proposals and bidding. Led team workflows and delivery timelines. Automated outreach with Python. Built Shopify stores. Ran Meta, Google, Pinterest, and LinkedIn campaigns for B2B and B2C clients. Led 25 specialists across SEO, paid campaigns, CRM, and automation.', t: ['experience', 'description'] },

    { l: 'Job 3 Title', c: 'Senior Digital Marketing Executive & Marketing Automation Engineer', t: ['experience', 'job', 'title'] },
    { l: 'Job 3 Company', c: 'UBUY (E‑commerce MNC), Jaipur', t: ['experience', 'company'] },
    { l: 'Job 3 Duration', c: 'June 2022 – January 2024', t: ['experience', 'duration'] },
    { l: 'Job 3 Highlights', c: 'Managed Google Ads ($1M+) and Meta Ads ($500K+) with millions of products and 50+ Merchant Centers. Revamped SEO strategy for visibility and traffic growth. Built AI-powered push notifications. Managed omnichannel marketing: email, WhatsApp, SMS, push. Used Attentive.io, MailJet, HubSpot, Brevo, Drip, ActiveCampaign, Sendy, Amazon SES at large volume (8M emails). Configured MX/SPF/DKIM, improved deliverability, supported VMC/Blue Tick and email annotations. Collaborated with engineering to build automation systems.', t: ['experience', 'description'] },

    { l: 'Job 4 Title', c: 'Professional Freelancer', t: ['experience', 'job', 'title'] },
    { l: 'Job 4 Company', c: 'Upwork, Multiple Businesses & Agencies', t: ['experience', 'company'] },
    { l: 'Job 4 Duration', c: 'Jun 2020 – May 2022', t: ['experience', 'duration'] },
    { l: 'Job 4 Highlights', c: 'Delivered design and digital services globally with timely delivery. Designed logos, posts, and graphics (Photoshop/Canva). Built responsive WordPress websites and landing pages. Wrote 200,000+ words SEO content and 150+ optimized blogs. Performed off-page SEO and backlinks for travel, real estate, B2B. Worked with brands like Trucks.com, Apollo Hospitals Mumbai, Truelancer and SaaS providers.', t: ['experience', 'description'] },

    { l: 'Job 5 Title', c: 'Digital Marketing Internship', t: ['experience', 'job', 'title'] },
    { l: 'Job 5 Company', c: 'Technovation, Jaipur', t: ['experience', 'company'] },
    { l: 'Job 5 Duration', c: 'Dec 2019 - May 2020', t: ['experience', 'duration'] },
    { l: 'Job 5 Highlights', c: 'Contributed to SEO writing, proofreading, and keyword research. Executed off-page SEO activities (article submission, directory submission, bookmarking, citation building, Web 2.0, classifieds, profiles). Performed guest posting outreach and built quality backlinks. Coordinated with SEO/content teams and received 10/10 performance rating.', t: ['experience', 'description'] },

    { l: 'Education', c: 'Bachelor of Business Administration (BBA) in Entrepreneurship from Global Center for Entrepreneurship & Commerce (GCEC), 2022', t: ['education', 'degree'] },
    { l: 'Interests', c: 'Exploring cryptocurrency and future digital finance, analyzing stock market trends and investment strategies, and tracking startup ecosystem innovations and business scaling techniques.', t: ['interests', 'hobbies'] },
  ];

  const categoryOf = (item) => {
    if (item.t.includes('skills')) return 'Skills';
    if (item.t.includes('experience')) return 'Experience';
    if (item.t.includes('education')) return 'Education';
    if (item.t.includes('interests')) return 'Interests';
    if (item.t.includes('address')) return 'Address';
    if (item.t.includes('email') || item.t.includes('phone') || item.t.includes('linkedin')) return 'Contact';
    return 'Personal';
  };

  const normalize = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const indexed = data.map((item) => ({ ...item, category: categoryOf(item), idx: normalize(`${item.l} ${item.c} ${item.t.join(' ')} ${categoryOf(item)}`) }));
  const categories = ['All', ...new Set(indexed.map((x) => x.category))];

  const panel = document.createElement('div');
  panel.id = 'nitesh-resume-bookmarklet';
  panel.innerHTML = `
    <div class="hdr">
      <b>⚡ Resume Assistant</b>
      <div class="act">
        <button id="rbTab" title="Open tab mode (Alt+T)">🗂️ Tab</button>
        <button id="rbClose">✕</button>
      </div>
    </div>
    <input id="rbSearch" placeholder="Filter quickly... (Alt+Q)"/>
    <div id="rbCats" class="cats"></div>
    <div id="rbMeta" class="meta"></div>
    <div id="rbRows" class="rows"></div>
    <div class="ftr">Shortcuts: Alt+X toggle • Alt+Q focus filter • Alt+T open tab • ↑↓ move • Enter copy • Shift+Enter fill/unfill focused</div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #nitesh-resume-bookmarklet{position:fixed;top:${state.y}px;left:${state.x}px;width:560px;max-height:78vh;background:#111;color:#fff;z-index:2147483647;border:1px solid #333;border-radius:12px;padding:10px;font:13px sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.45)}
    #nitesh-resume-bookmarklet .hdr{display:flex;justify-content:space-between;align-items:center;cursor:move;margin-bottom:8px}
    #nitesh-resume-bookmarklet .act{display:flex;gap:6px}
    #nitesh-resume-bookmarklet input{width:100%;box-sizing:border-box;background:#1f1f1f;border:1px solid #444;color:#fff;padding:8px;border-radius:8px}
    #nitesh-resume-bookmarklet .cats{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
    #nitesh-resume-bookmarklet .cat{background:#222;border:1px solid #444;color:#eee;border-radius:999px;padding:3px 8px;cursor:pointer}
    #nitesh-resume-bookmarklet .cat.active{background:#2d5f3f;border-color:#4caf50}
    #nitesh-resume-bookmarklet .rows{max-height:52vh;overflow:auto;display:flex;flex-direction:column;gap:6px}
    #nitesh-resume-bookmarklet .row{display:grid;grid-template-columns:1fr auto auto;gap:8px;background:#1a1a1a;border:1px solid #2e2e2e;border-radius:8px;padding:8px}
    #nitesh-resume-bookmarklet .row.active{outline:2px solid #4caf50}
    #nitesh-resume-bookmarklet .lbl{font-weight:600;color:#88f5ad}
    #nitesh-resume-bookmarklet .val{font-size:11px;color:#b4b4b4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #nitesh-resume-bookmarklet button{background:#2b2b2b;border:1px solid #444;color:#fff;border-radius:6px;padding:4px 8px;cursor:pointer}
    #nitesh-resume-bookmarklet .meta{font-size:11px;color:#999;margin:5px 0}
    #nitesh-resume-bookmarklet .ftr{margin-top:8px;font-size:10px;color:#777;text-align:center}
  `;

  document.head.appendChild(style);
  document.body.appendChild(panel);

  const el = {
    search: panel.querySelector('#rbSearch'),
    cats: panel.querySelector('#rbCats'),
    meta: panel.querySelector('#rbMeta'),
    rows: panel.querySelector('#rbRows'),
    close: panel.querySelector('#rbClose'),
    tab: panel.querySelector('#rbTab'),
  };

  let filtered = [];
  let selected = 0;

  const toast = (txt) => {
    const n = document.createElement('div');
    n.textContent = txt;
    Object.assign(n.style, { position: 'fixed', right: '20px', bottom: '20px', background: '#2f7f4f', color: '#fff', padding: '8px 12px', borderRadius: '7px', zIndex: '2147483647' });
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 1300);
  };

  const copy = async (txt) => {
    try { await navigator.clipboard.writeText(txt); }
    catch {
      const t = document.createElement('textarea');
      t.value = txt;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    toast('Copied');
  };

  const fillFocused = (value) => {
    const active = document.activeElement;
    if (!active || !/INPUT|TEXTAREA|SELECT/.test(active.tagName)) return toast('Focus input first');
    const marker = '__resumeFillValue';
    if (active[marker] === String(value)) {
      if (active.tagName === 'SELECT') active.selectedIndex = 0;
      else active.value = '';
      active[marker] = '';
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return toast('Cleared on second click');
    }
    if (active.tagName === 'SELECT') {
      const m = [...active.options].find((o) => o.text.toLowerCase().includes(String(value).toLowerCase().slice(0, 32)) || o.value.toLowerCase().includes(String(value).toLowerCase().slice(0, 32)));
      if (m) active.value = m.value;
    } else {
      active.value = value;
    }
    active[marker] = String(value);
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    toast('Filled focused input');
  };

  const renderCats = () => {
    el.cats.innerHTML = '';
    categories.forEach((cat) => {
      const b = document.createElement('button');
      b.className = `cat ${state.category === cat ? 'active' : ''}`;
      b.textContent = cat;
      b.onclick = () => { state.category = cat; save(); apply(); };
      el.cats.appendChild(b);
    });
  };

  const renderRows = () => {
    el.rows.innerHTML = '';
    el.meta.textContent = `${filtered.length} / ${indexed.length} items`;
    filtered.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = `row ${selected === i ? 'active' : ''}`;
      row.innerHTML = `<div><div class="lbl">${item.l}</div><div class="val">${item.c}</div></div><button title="Copy">📋</button><button title="Fill focused">✏️</button>`;
      const [cBtn, fBtn] = row.querySelectorAll('button');
      cBtn.onclick = (e) => { e.stopPropagation(); copy(item.c); };
      fBtn.onclick = (e) => { e.stopPropagation(); fillFocused(item.c); };
      row.onclick = () => copy(item.c);
      row.onmouseenter = () => { selected = i; renderRows(); };
      el.rows.appendChild(row);
    });
  };

  const apply = () => {
    const q = normalize(state.search);
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    filtered = indexed.filter((x) => (state.category === 'All' || x.category === state.category) && (!tokens.length || tokens.every((t) => x.idx.includes(t))));
    selected = Math.min(selected, Math.max(0, filtered.length - 1));
    renderCats();
    renderRows();
  };

  const openTabView = () => {
    const newTab = window.open('', 'NiteshResumeAssistantTab');
    if (!newTab) {
      toast('Popup blocked. Allow popups for this site.');
      return;
    }
    const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const list = filtered.map((x) => `<tr><td>${esc(x.l)}</td><td>${esc(x.category)}</td><td>${esc(x.c)}</td></tr>`).join('');
    newTab.document.open();
    newTab.document.write(`<!doctype html><html><head><title>Resume Assistant Tab</title>
      <style>body{font:14px Arial;margin:20px;background:#0e0e0e;color:#fff}input{width:100%;padding:10px;border-radius:8px;border:1px solid #444;background:#1a1a1a;color:#fff}table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border:1px solid #333;padding:8px;vertical-align:top}th{background:#1d1d1d;position:sticky;top:0}tr:hover{background:#1a2a1f;cursor:pointer}.meta{color:#9a9a9a;margin:10px 0}.hint{font-size:12px;color:#9a9a9a;margin-top:8px}</style>
    </head><body>
    <h2>⚡ Resume Assistant - Tab Mode</h2>
    <input id="q" placeholder="Filter in tab... (Alt+/)" value="${esc(state.search)}" />
    <div class="meta" id="m"></div>
    <table><thead><tr><th>Field</th><th>Category</th><th>Value</th></tr></thead><tbody id="tb">${list}</tbody></table>
    <div class="hint">Click a row to copy value. Shortcut Ctrl/Cmd+K focuses filter.</div>
    <script>
      const all=${JSON.stringify(indexed)};
      const q=document.getElementById('q'); const tb=document.getElementById('tb'); const m=document.getElementById('m');
      const render=()=>{const s=q.value.toLowerCase().trim();const out=all.filter(x=>!s||x.idx.includes(s));m.textContent=out.length+' / '+all.length+' items';tb.innerHTML=out.map(x=>'<tr><td>'+x.l+'</td><td>'+x.category+'</td><td>'+x.c+'</td></tr>').join('');Array.from(tb.querySelectorAll('tr')).forEach((tr,i)=>tr.onclick=async()=>{try{await navigator.clipboard.writeText(out[i].c)}catch(e){const t=document.createElement('textarea');t.value=out[i].c;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();}})};
      q.addEventListener('input', render); render();
      window.addEventListener('keydown',(e)=>{if(e.altKey&&e.key==='/'){e.preventDefault();q.focus();q.select();}});
    </script></body></html>`);
    newTab.document.close();
  };

  el.search.value = state.search;
  el.search.oninput = () => { state.search = el.search.value; save(); apply(); };
  el.tab.onclick = openTabView;

  el.close.onclick = () => {
    panel.remove();
    style.remove();
    document.removeEventListener('keydown', keyHandler);
    delete window.__niteshResumeDashBookmarklet;
  };

  let drag = null;
  panel.querySelector('.hdr').addEventListener('mousedown', (e) => {
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
  document.addEventListener('mouseup', () => { if (drag) save(); drag = null; });

  const keyHandler = (e) => {
    if (e.altKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      state.enabled = !state.enabled;
      panel.style.display = state.enabled ? 'block' : 'none';
      save();
      return;
    }

    if (e.altKey && e.key.toLowerCase() === 'q') {
      e.preventDefault();
      state.enabled = true;
      panel.style.display = 'block';
      el.search.focus();
      el.search.select();
      save();
      return;
    }

    if (e.altKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      openTabView();
      return;
    }

    if (!state.enabled) return;

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

  window.__niteshResumeDashBookmarklet = {
    toggle: () => {
      state.enabled = !state.enabled;
      panel.style.display = state.enabled ? 'block' : 'none';
      save();
    },
  };

  apply();
  panel.style.display = state.enabled ? 'block' : 'none';
})();
