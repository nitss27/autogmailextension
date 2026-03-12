const CATEGORIES = ['All', 'Personal', 'Contact', 'Address', 'Skills', 'Experience', 'Education', 'Interests'];
const STORAGE_KEY = 'resumeAssistantItemsV1';

const BASE_DATA = [
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
];

const state = {
  category: 'All',
  query: '',
  selected: 0,
  filtered: [],
  targetTabId: null,
  data: [],
  editId: null,
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
  itemLabel: document.getElementById('itemLabel'),
  itemValue: document.getElementById('itemValue'),
  itemCategory: document.getElementById('itemCategory'),
  itemTags: document.getElementById('itemTags'),
  addUpdateBtn: document.getElementById('addUpdateBtn'),
  clearEditBtn: document.getElementById('clearEditBtn'),
  csvFile: document.getElementById('csvFile'),
  importCsvBtn: document.getElementById('importCsvBtn'),
};

function normalize(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function withIndex(item) {
  return {
    ...item,
    id: item.id || crypto.randomUUID(),
    t: Array.isArray(item.t) ? item.t : [],
    idx: normalize(`${item.l} ${item.c} ${item.category} ${(item.t || []).join(' ')}`),
  };
}

function showToast(message, err = false) {
  const toast = document.createElement('div');
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed', top: '14px', right: '14px', background: err ? '#9b2c2c' : '#2f7f4f', color: '#fff',
    padding: '8px 12px', borderRadius: '8px', zIndex: 99999,
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1400);
}

async function saveItems() {
  await chrome.storage.local.set({ [STORAGE_KEY]: state.data.map(({ l, c, category, t, id }) => ({ l, c, category, t, id })) });
}

async function loadItems() {
  const stored = await chrome.storage.local.get([STORAGE_KEY]);
  const source = Array.isArray(stored[STORAGE_KEY]) && stored[STORAGE_KEY].length ? stored[STORAGE_KEY] : BASE_DATA;
  state.data = source.map(withIndex);
}

function resetEditor() {
  state.editId = null;
  el.itemLabel.value = '';
  el.itemValue.value = '';
  el.itemCategory.value = 'Personal';
  el.itemTags.value = '';
  el.addUpdateBtn.textContent = 'Add Item';
}

function getEditorItem() {
  const l = el.itemLabel.value.trim();
  const c = el.itemValue.value.trim();
  const category = el.itemCategory.value;
  const t = el.itemTags.value.split(',').map((x) => x.trim()).filter(Boolean);
  if (!l || !c || !category) return null;
  return { l, c, category, t };
}

function startEdit(item) {
  state.editId = item.id;
  el.itemLabel.value = item.l;
  el.itemValue.value = item.c;
  el.itemCategory.value = item.category;
  el.itemTags.value = (item.t || []).join(', ');
  el.addUpdateBtn.textContent = 'Update Item';
  el.itemLabel.focus();
}

async function upsertItem() {
  const next = getEditorItem();
  if (!next) {
    showToast('Label, Value and Category are required', true);
    return;
  }

  if (state.editId) {
    state.data = state.data.map((item) => (item.id === state.editId ? withIndex({ ...item, ...next }) : item));
    showToast('Item updated');
  } else {
    state.data.unshift(withIndex(next));
    showToast('Item added');
  }

  await saveItems();
  resetEditor();
  state.selected = 0;
  applyFilters();
}

async function deleteItem(id) {
  const before = state.data.length;
  state.data = state.data.filter((item) => item.id !== id);
  if (state.data.length === before) return;
  await saveItems();
  if (state.editId === id) resetEditor();
  state.selected = 0;
  applyFilters();
  showToast('Item deleted');
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values;
}

function importItemsFromCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map((h) => normalize(h));
  const idxLabel = headers.indexOf('label');
  const idxValue = headers.indexOf('value');
  const idxCategory = headers.indexOf('category');
  const idxTags = headers.indexOf('tags');

  if (idxLabel < 0 || idxValue < 0 || idxCategory < 0) {
    throw new Error('CSV must have headers: label,value,category[,tags]');
  }

  const out = [];
  lines.slice(1).forEach((line) => {
    const cols = parseCsvLine(line);
    const l = String(cols[idxLabel] || '').trim();
    const c = String(cols[idxValue] || '').trim();
    const category = String(cols[idxCategory] || '').trim();
    const tags = String(cols[idxTags] || '').split(',').map((t) => t.trim()).filter(Boolean);

    if (!l || !c || !CATEGORIES.includes(category) || category === 'All') return;
    out.push(withIndex({ l, c, category, t: tags }));
  });

  return out;
}

async function importCsvItems() {
  const file = el.csvFile.files?.[0];
  if (!file) {
    showToast('Choose a CSV file first', true);
    return;
  }

  const text = await file.text();
  let imported = [];
  try {
    imported = importItemsFromCsv(text);
  } catch (error) {
    showToast(error.message, true);
    return;
  }

  if (!imported.length) {
    showToast('No valid rows in CSV', true);
    return;
  }

  state.data = [...imported, ...state.data];
  await saveItems();
  applyFilters();
  el.csvFile.value = '';
  showToast(`Imported ${imported.length} items`);
}

async function copyValue(value) {
  try { await navigator.clipboard.writeText(value); }
  catch {
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
  else showToast(resp?.error || 'Fill failed', true);
}

function renderCategories() {
  el.catBar.innerHTML = '';
  CATEGORIES.forEach((name) => {
    const btn = document.createElement('button');
    btn.textContent = name;
    if (name === state.category) btn.classList.add('active');
    btn.addEventListener('click', () => {
      state.category = name;
      state.selected = 0;
      applyFilters();
    });
    el.catBar.appendChild(btn);
  });
}

function renderList() {
  el.list.innerHTML = '';
  el.meta.textContent = `${state.filtered.length} / ${state.data.length} results • Category: ${state.category}`;

  state.filtered.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = `item ${index === state.selected ? 'active' : ''}`;

    const info = document.createElement('div');
    info.innerHTML = `<div class="label"></div><div class="value"></div>`;
    info.querySelector('.label').textContent = item.l;
    info.querySelector('.value').textContent = item.c;

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.title = 'Copy';
    copyBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      copyValue(item.c);
    });

    const fillBtn = document.createElement('button');
    fillBtn.textContent = '↩';
    fillBtn.title = 'Fill';
    fillBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      fillValue(item.c);
    });

    const editBtn = document.createElement('button');
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit';
    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      startEdit(item);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteItem(item.id);
    });

    row.append(info, copyBtn, fillBtn, editBtn, deleteBtn);

    row.addEventListener('mouseenter', () => {
      state.selected = index;
      renderList();
    });
    row.addEventListener('click', () => copyValue(item.c));

    el.list.appendChild(row);
  });
}

function applyFilters() {
  const tokens = normalize(state.query).split(/\s+/).filter(Boolean);
  state.filtered = state.data.filter((item) => {
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

function isEditorFocused() {
  return [el.itemLabel, el.itemValue, el.itemCategory, el.itemTags].includes(document.activeElement);
}

function handleKeys(event) {
  if (event.altKey && event.key.toLowerCase() === 'q') {
    event.preventDefault();
    el.search.focus();
    el.search.select();
    return;
  }

  if (event.altKey && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    el.itemLabel.focus();
    return;
  }

  if (event.key === 'ArrowLeft') { event.preventDefault(); cycleCategory(-1); return; }
  if (event.key === 'ArrowRight') { event.preventDefault(); cycleCategory(1); return; }

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
    if (isEditorFocused()) return;
    const item = state.filtered[state.selected];
    if (!item) return;
    event.preventDefault();
    if (event.shiftKey) fillValue(item.c);
    else copyValue(item.c);
  }
}

el.prevCat.addEventListener('click', () => cycleCategory(-1));
el.nextCat.addEventListener('click', () => cycleCategory(1));
el.search.addEventListener('input', () => {
  state.query = el.search.value;
  state.selected = 0;
  applyFilters();
});
el.addUpdateBtn.addEventListener('click', upsertItem);
el.clearEditBtn.addEventListener('click', resetEditor);
el.importCsvBtn.addEventListener('click', importCsvItems);

document.addEventListener('keydown', handleKeys);

el.selectTargetBtn.addEventListener('click', async () => {
  const { targetTabId } = await chrome.runtime.sendMessage({ type: 'resume-assistant/get-target-tab' });
  state.targetTabId = targetTabId;
  el.targetInfo.textContent = targetTabId ? `Target tab id: ${targetTabId}` : 'No target tab selected';
  showToast(targetTabId ? 'Target refreshed' : 'No target tab selected', !targetTabId);
});

(async function init() {
  const { targetTabId } = await chrome.runtime.sendMessage({ type: 'resume-assistant/get-target-tab' });
  state.targetTabId = targetTabId;
  el.targetInfo.textContent = targetTabId ? `Target tab id: ${targetTabId}` : 'No target tab selected';
  await loadItems();
  resetEditor();
  applyFilters();
})();
