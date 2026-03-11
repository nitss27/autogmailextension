const CATEGORIES = ['All', 'Personal', 'Contact', 'Address', 'Skills', 'Experience', 'Education', 'Interests'];

const DATA = [
  { l: 'Full Name', c: 'Nitesh Shekhawat', category: 'Personal', t: ['name', 'applicant'] },
  { l: 'First Name', c: 'Nitesh', category: 'Personal', t: ['first name'] },
  { l: 'Last Name', c: 'Shekhawat', category: 'Personal', t: ['last name', 'surname'] },
  { l: 'Languages', c: 'English: Fluent, Hindi: Native', category: 'Personal', t: ['languages'] },
  { l: 'Email', c: 'mr.niteshshekhawat@gmail.com', category: 'Contact', t: ['email'] },
  { l: 'Phone', c: '+91 7073616862', category: 'Contact', t: ['phone', 'mobile'] },
  { l: 'LinkedIn', c: 'https://www.linkedin.com/in/nitesh-shekhawat/', category: 'Contact', t: ['linkedin'] },
  { l: 'Address Line 1', c: 'Vaishali Nagar', category: 'Address', t: ['address', 'street'] },
  { l: 'City', c: 'Jaipur', category: 'Address', t: ['city'] },
  { l: 'State', c: 'Rajasthan', category: 'Address', t: ['state'] },
  { l: 'Postal Code', c: '302012', category: 'Address', t: ['zip', 'postal'] },
  { l: 'Country', c: 'India', category: 'Address', t: ['country'] },
  { l: 'Professional Summary', c: 'I am a growth-driven digital marketing specialist with 6+ years of hands-on experience in Advance Google Ads, Meta Ads, SEO, Paid media, marketing automation, eCommerce growth, high quality bulk lead generation and full-stack campaign execution.', category: 'Skills', t: ['summary', 'profile'] },
  { l: 'Core Skills', c: 'Google Ads, Meta Ads, SEO, Social Media, Email Marketing, CRO, Automation, Reporting, Analytics, eCommerce, Web Development, Client Acquisition', category: 'Skills', t: ['skills'] },
  { l: 'Job 1', c: 'Associate Business Manager (Google Ads) — VIRALMINT, Pune', category: 'Experience', t: ['job'] },
  { l: 'Job 2', c: 'Digital Marketing Manager / Chief Marketing Officer — EMICIN DIGITAL, USA', category: 'Experience', t: ['job'] },
  { l: 'Job 3', c: 'Senior Digital Marketing Executive & Marketing Automation Engineer — UBUY, Jaipur', category: 'Experience', t: ['job'] },
  { l: 'Education', c: 'BBA in Entrepreneurship from GCEC (2022)', category: 'Education', t: ['degree'] },
  { l: 'Interests', c: 'Cryptocurrency, stock trends, startup ecosystem, business scaling', category: 'Interests', t: ['hobbies'] },
].map((item) => ({ ...item, idx: normalize(`${item.l} ${item.c} ${item.category} ${(item.t || []).join(' ')}`) }));

const state = {
  category: 'All',
  query: '',
  selected: 0,
  filtered: [],
  targetTabId: null,
};

const el = {
  catBar: document.getElementById('catBar'),
  prevCat: document.getElementById('prevCat'),
  nextCat: document.getElementById('nextCat'),
  search: document.getElementById('search'),
  meta: document.getElementById('meta'),
  list: document.getElementById('list'),
  targetInfo: document.getElementById('targetInfo'),
  selectTargetBtn: document.getElementById('selectTargetBtn'),
};

function normalize(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '14px',
    right: '14px',
    background: '#2f7f4f',
    color: '#fff',
    padding: '8px 12px',
    borderRadius: '8px',
    zIndex: 99999,
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1200);
}

async function copyValue(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = value;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  showToast('Copied');
}

async function fillValue(value) {
  const resp = await chrome.runtime.sendMessage({ type: 'resume-assistant/fill-target', value });
  if (resp?.ok) showToast('Fill sent to target tab');
  else showToast(resp?.error || 'Fill failed');
}

function renderCategories() {
  el.catBar.innerHTML = '';
  CATEGORIES.forEach((name) => {
    const btn = document.createElement('button');
    btn.textContent = name;
    if (name === state.category) btn.classList.add('active');
    btn.onclick = () => {
      state.category = name;
      state.selected = 0;
      applyFilters();
    };
    el.catBar.appendChild(btn);
  });
}

function renderList() {
  el.list.innerHTML = '';
  el.meta.textContent = `${state.filtered.length} / ${DATA.length} results • Category: ${state.category}`;

  state.filtered.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = `item ${index === state.selected ? 'active' : ''}`;
    row.innerHTML = `
      <div>
        <div class="label">${item.l}</div>
        <div class="value">${item.c}</div>
      </div>
      <button data-action="copy">📋</button>
      <button data-action="fill">↩</button>
    `;

    row.onclick = (event) => {
      const action = event.target?.dataset?.action;
      if (action === 'copy') return copyValue(item.c);
      if (action === 'fill') return fillValue(item.c);
      copyValue(item.c);
    };

    row.onmouseenter = () => {
      state.selected = index;
      renderList();
    };

    el.list.appendChild(row);
  });
}

function applyFilters() {
  const tokens = normalize(state.query).split(/\s+/).filter(Boolean);
  state.filtered = DATA.filter((item) => {
    const categoryOk = state.category === 'All' || item.category === state.category;
    const queryOk = !tokens.length || tokens.every((token) => item.idx.includes(token));
    return categoryOk && queryOk;
  });

  state.selected = Math.min(state.selected, Math.max(0, state.filtered.length - 1));
  renderCategories();
  renderList();
}

function cycleCategory(dir) {
  const idx = CATEGORIES.indexOf(state.category);
  const nextIdx = (idx + dir + CATEGORIES.length) % CATEGORIES.length;
  state.category = CATEGORIES[nextIdx];
  state.selected = 0;
  applyFilters();
}

function handleKeys(event) {
  if (event.altKey && event.key.toLowerCase() === 'q') {
    event.preventDefault();
    el.search.focus();
    el.search.select();
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    cycleCategory(-1);
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    cycleCategory(1);
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    state.selected = Math.min(state.selected + 1, state.filtered.length - 1);
    renderList();
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    state.selected = Math.max(state.selected - 1, 0);
    renderList();
    return;
  }

  if (event.key === 'Enter') {
    const item = state.filtered[state.selected];
    if (!item) return;
    event.preventDefault();
    if (event.shiftKey) fillValue(item.c);
    else copyValue(item.c);
  }
}

el.prevCat.onclick = () => cycleCategory(-1);
el.nextCat.onclick = () => cycleCategory(1);
el.search.addEventListener('input', () => {
  state.query = el.search.value;
  state.selected = 0;
  applyFilters();
});

document.addEventListener('keydown', handleKeys);

el.selectTargetBtn.onclick = async () => {
  const { targetTabId } = await chrome.runtime.sendMessage({ type: 'resume-assistant/get-target-tab' });
  state.targetTabId = targetTabId;
  el.targetInfo.textContent = targetTabId ? `Target tab id: ${targetTabId}` : 'No target tab selected';
  showToast(targetTabId ? 'Target refreshed' : 'No target tab selected');
};

(async function init() {
  const { targetTabId } = await chrome.runtime.sendMessage({ type: 'resume-assistant/get-target-tab' });
  state.targetTabId = targetTabId;
  el.targetInfo.textContent = targetTabId ? `Target tab id: ${targetTabId}` : 'No target tab selected';
  applyFilters();
})();
