const $ = (id) => document.getElementById(id);
const rowsEl = $('rows');

const readRules = () => $('exclude').value.split('\n').map(x=>x.trim()).filter(x=>x && !x.startsWith('#')).length;
$('exclude').addEventListener('input', () => $('ruleLabel').textContent = `Exclude (${readRules()} rules)`);

async function api(path, method='GET', body=null){
  const res = await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):null});
  return res.json();
}

function render(state){
  $('status').textContent = `${state.status || 'idle'} ${state.current||0}/${state.total||0} ${state.domain||''}`;
  $('summary').textContent = state.summary || 'Running...';
  rowsEl.innerHTML = '';
  (state.results || []).forEach((r) => {
    if(!r) return;
    const tr = document.createElement('tr');
    const ehtml = (r.emails||[]).map(e=>`<div class='email'>${e.email}<span class='badge ${e.confidence}'>${e.confidence}</span></div>`).join('') || '<i>No emails found</i>';
    const status = r.status ? `[${r.status}]` : '';
    const err = r.error ? ` ${r.error}` : '';
    tr.innerHTML = `<td><div>${r.domain||''}</div><div class='error'>${status}${err}</div></td><td>${ehtml}</td>`;
    rowsEl.appendChild(tr);
  });
}

async function refresh(){ render(await api('/api/state')); }
setInterval(refresh, 1200); refresh();

$('start').onclick = async () => {
  await api('/api/start','POST',{
    urls: $('urls').value.split('\n'),
    excludeRaw: $('exclude').value,
    tabLoadTimeoutMs: Number($('tabTimeout').value||12000),
    forceSkipAfterMs: Number($('forceSkip').value||0),
    hardUrlTimeoutMs: Number($('hardTimeout').value||45000)
  });
  refresh();
};
$('cont').onclick = async () => { await api('/api/continue','POST'); refresh(); };
$('stop').onclick = async () => { await api('/api/stop','POST'); refresh(); };
$('force').onclick = async () => { await api('/api/force-stop','POST'); refresh(); };
$('skip').onclick = async () => { await api('/api/skip','POST'); refresh(); };
$('reset').onclick = async () => { await api('/api/reset','POST'); refresh(); };
$('copyTable').onclick = async () => {
  const s = await api('/api/state');
  const lines = ['Domain\tEmails\tError'];
  (s.results||[]).forEach(r => { if(!r) return; lines.push(`${r.domain}\t${(r.emails||[]).map(e=>e.email).join('\n')}\t${r.error||''}`); });
  await navigator.clipboard.writeText(lines.join('\n'));
};
$('copyEmails').onclick = async () => {
  const s = await api('/api/state');
  const set = new Set();
  (s.results||[]).forEach(r => (r?.emails||[]).forEach(e => set.add(e.email)));
  await navigator.clipboard.writeText([...set].join('\n'));
};
