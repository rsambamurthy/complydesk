/**
 * ComplyDesk side panel: connect to ComplyDesk, pick a filing, find its fields on the MCA page, fill the ones you tick;
 * read filing status (SRNs) from the portal's Application History and update ComplyDesk after you confirm;
 * or read MCA master data (company / director) and check it against ComplyDesk (you save it in ComplyDesk).
 * Talks to the page only through content.js (injected on demand). Never clicks, submits or signs on the portal.
 */
import { matchFields } from './lib/match.js';
import { readStatuses } from './lib/srn.js';
import { readMasterData } from './lib/master.js';

const $app = document.getElementById('app');
const $who = document.getElementById('who');
const state = { conn: null, filings: [], q: '', pack: null, page: [], matches: {}, tick: {}, results: {}, msg: null, busy: false, srn: null, master: null };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

// ---- ComplyDesk API (Bearer token from "Connect the browser extension" in ComplyDesk) --------------------------
async function api(path, body) {
  const r = await fetch(`${state.conn.base}/api/ext${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${state.conn.token}`, ...(body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { await disconnect(); throw new Error(j.error ?? 'Connect again'); }
  if (!r.ok) throw new Error(j.error ?? `ComplyDesk said ${r.status}`);
  return j;
}
async function connect(base, token) {
  base = base.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) base = `https://${base}`;
  const origin = new URL(base).origin;
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
  if (!granted) throw new Error('Allow the extension to reach your ComplyDesk address');
  state.conn = { base: origin, token: token.trim() };
  try {
    const me = await api('/me');
    state.conn.who = `${me.user.name} · ${me.workspace}`;
  } catch (e) { state.conn = null; throw e; }
  await chrome.storage.local.set({ conn: state.conn });
}
async function disconnect() { state.conn = null; state.pack = null; await chrome.storage.local.remove('conn'); }

// ---- The MCA tab --------------------------------------------------------------------------------------------
async function mcaTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url && !active.url.startsWith('chrome')) return active;
  const tabs = await chrome.tabs.query({ url: 'https://*.mca.gov.in/*' });
  if (!tabs.length) throw new Error('Open the form on the MCA portal in this window first');
  return tabs[0];
}
async function inPage(func, args = [], frameIds) {
  const tab = await mcaTab();
  const target = frameIds ? { tabId: tab.id, frameIds } : { tabId: tab.id, allFrames: true };
  await chrome.scripting.executeScript({ target, files: ['content.js'] });
  return chrome.scripting.executeScript({ target, func, args });
}

// ---- Steps --------------------------------------------------------------------------------------------------
const packFields = () => state.pack.parts.flatMap((p) => p.fields);
async function findFields() {
  const res = await inPage(() => window.__cdx.scan());
  state.page = res.flatMap((r) => (r.result ?? []).map((f) => ({ ...f, frameId: r.frameId })));
  const m = matchFields(packFields(), state.page.filter((p) => !p.locked));
  state.matches = Object.fromEntries(m.map((x) => [x.key, x.ref]));
  state.tick = Object.fromEntries(m.map((x) => [x.key, true]));
  state.results = {};
  state.msg = state.page.length
    ? { kind: 'ok', text: `Found ${state.page.length} fields on this page; matched ${m.length}. Check the matches, then fill.` }
    : { kind: 'warn', text: 'No form fields on this page. Open the MCA form (after entering the CIN) and try again.' };
}
async function fillTicked() {
  const byFrame = {};
  for (const f of packFields()) {
    const ref = state.matches[f.key];
    if (!ref || !state.tick[f.key] || !f.value) continue;
    const p = state.page.find((x) => x.ref === ref);
    (byFrame[p.frameId] ??= []).push({ ref, value: f.value, key: f.key });
  }
  let ok = 0; let bad = 0;
  for (const [frameId, items] of Object.entries(byFrame)) {
    const [r] = await inPage((it) => window.__cdx.fill(it), [items.map(({ ref, value }) => ({ ref, value }))], [Number(frameId)]);
    (r.result ?? []).forEach((x, i) => { state.results[items[i].key] = x; x.ok ? ok++ : bad++; });
  }
  state.msg = { kind: bad ? 'warn' : 'ok', text: `Filled ${ok} field${ok === 1 ? '' : 's'}${bad ? `; ${bad} couldn’t be filled (see below)` : ''}. Check them on the page — the green outline shows what was filled. Then save / sign on the portal as usual.` };
}
async function putInFocused(key) {
  const f = packFields().find((x) => x.key === key);
  const res = await inPage((v) => window.__cdx.fillFocused(v), [f.value]);
  const hit = res.map((r) => r.result).find(Boolean);
  state.results[key] = hit ?? { ok: false, why: 'Click into a field on the MCA page first, then press “Put in selected field”.' };
}
const flash = (ref) => { const p = state.page.find((x) => x.ref === ref); if (p) inPage((r) => window.__cdx.flash(r), [ref], [p.frameId]).catch(() => {}); };

// ---- Filing status from the MCA portal ------------------------------------------------------------------------
const STATUS_TEXT = { APPROVED: 'Approved → mark “Approved by MCA”', RESUBMIT: 'Resubmission → mark “MCA asked for resubmission”', REJECTED: 'Rejected → back to you to file again', PENDING: 'Still pending at MCA — no change' };
async function readSrnStatuses() {
  const filed = await api('/filed');
  if (!filed.length) { state.srn = { items: [], filed: 0 }; state.msg = { kind: 'warn', text: 'No filings in ComplyDesk are waiting for MCA (stage “Filed” with an SRN).' }; return; }
  const res = await inPage(() => window.__cdx.rows());
  const rows = res.flatMap((r) => r.result ?? []);
  const found = readStatuses(rows, filed.map((f) => f.srn));
  const items = filed.filter((f) => found[f.srn]).map((f) => ({ ...f, read: found[f.srn] }));
  state.srn = { items, filed: filed.length, tick: Object.fromEntries(items.map((i) => [i.id, ['APPROVED', 'RESUBMIT', 'REJECTED'].includes(i.read.status) && i.read.sure])), results: {} };
  state.msg = items.length
    ? { kind: 'ok', text: `Found ${items.length} of your ${filed.length} filings awaiting MCA on this page. Tick the ones to update.` }
    : { kind: 'warn', text: `None of your ${filed.length} SRNs awaiting MCA are on this page. Open Application History (or Track SRN status) on the portal, then read again.` };
}
async function applyStatuses() {
  const updates = state.srn.items.filter((i) => state.srn.tick[i.id] && i.read.status !== 'PENDING' && i.read.status)
    .map((i) => ({ obligationId: i.id, srn: i.srn, status: i.read.status, phrase: i.read.phrase, date: i.read.date }));
  const r = await api('/srn-status', { updates });
  for (const x of r.results) state.srn.results[x.obligationId] = x;
  state.msg = { kind: r.updated === updates.length ? 'ok' : 'warn', text: `Updated ${r.updated} filing${r.updated === 1 ? '' : 's'} in ComplyDesk${r.updated < updates.length ? `; ${updates.length - r.updated} couldn’t be updated (see below)` : ''}.` };
}
function srnCard() {
  const s = state.srn;
  const head = `<div class="card"><div class="row"><h2 class="grow">MCA filing status</h2><button id="srnread" ${state.busy ? 'disabled' : ''}>Read this page</button></div>
    <p class="muted small" style="margin:0">On the portal, open <b>Application History</b> (or <b>Track SRN status</b>), then press <b>Read this page</b>. ComplyDesk looks for the SRNs of your filings awaiting MCA and the status beside them.</p>`;
  if (!s) return `${head}</div>`;
  const n = s.items.filter((i) => s.tick[i.id] && i.read.status && i.read.status !== 'PENDING' && !s.results[i.id]?.ok).length;
  return `${head}
    ${s.items.map((i) => { const r = s.results[i.id]; const can = i.read.status && i.read.status !== 'PENDING'; return `<div class="fld">
      <div class="top">${can && !r?.ok ? `<input type="checkbox" data-srn="${i.id}" ${s.tick[i.id] ? 'checked' : ''} style="width:auto">` : ''}<span class="lab"><b>${esc(i.form)}</b> · ${esc(i.clientName)}</span></div>
      <div class="small mono">SRN ${esc(i.srn)} · filed ${fmtDate(i.filedOn)}</div>
      <div class="small ${i.read.status === 'APPROVED' ? 'ok' : i.read.status === 'PENDING' || !i.read.status ? 'muted' : 'bad'}">${i.read.status ? `Portal: “${esc(i.read.phrase)}”${i.read.date ? ` · ${fmtDate(i.read.date)}` : ''} — ${STATUS_TEXT[i.read.status]}` : 'No status found next to this SRN'}</div>
      ${!i.read.sure && can ? '<div class="small muted">Read from the whole page, not a row — check before ticking.</div>' : ''}
      ${r ? `<div class="small ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓ Updated in ComplyDesk' : `✗ ${esc(r.error)}`}</div>` : ''}
    </div>`; }).join('')}
    ${s.items.length ? `<button class="primary" id="srnapply" ${!n || state.busy ? 'disabled' : ''}>Update ${n} filing${n === 1 ? '' : 's'} in ComplyDesk</button>` : ''}
  </div>`;
}
function bindSrn() {
  on('#srnread', 'click', () => run(readSrnStatuses));
  on('#srnapply', 'click', () => run(applyStatuses));
  document.querySelectorAll('[data-srn]').forEach((el) => el.addEventListener('change', () => { state.srn.tick[el.dataset.srn] = el.checked; render(); }));
}

// ---- MCA master data (company or director) -------------------------------------------------------------------
async function readMaster() {
  const res = await inPage(() => window.__cdx.page());
  // The page and its frames: the master data may sit in a frame.
  let data = null;
  for (const r of res) { data = r.result ? readMasterData(r.result) : null; if (data) break; }
  if (!data) {
    state.master = null;
    state.msg = { kind: 'warn', text: 'No master data on this page. On the portal open View Company/LLP Master Data (or View Director Master Data), enter the CIN or DIN and the captcha, then read again.' };
    return;
  }
  const out = await api('/mca-master', data);
  state.master = { data, out };
  state.msg = null;
}
const openInComplyDesk = (path) => chrome.tabs.create({ url: `${state.conn.base}${path}` });
function masterCard() {
  const m = state.master;
  const head = `<div class="card"><div class="row"><h2 class="grow">MCA master data</h2><button id="mdread" ${state.busy ? 'disabled' : ''}>Read this page</button></div>
    <p class="muted small" style="margin:0">On the portal, open <b>View Company/LLP Master Data</b> or <b>View Director Master Data</b>, enter the CIN or DIN and the captcha, then press <b>Read this page</b>. You check and save the details in ComplyDesk.</p>`;
  if (!m) return `${head}</div>`;
  if (m.data.kind === 'COMPANY') {
    const o = m.out;
    return `${head}<div class="fld"><div class="lab"><b>${esc(o.name)}</b></div><div class="small mono">${esc(o.cin)}</div>
      <div class="small">${o.directors} director${o.directors === 1 ? '' : 's'} / signatories · ${o.charges} charge${o.charges === 1 ? '' : 's'} on MCA</div>
      ${o.notes.length ? `<ul class="small" style="margin:6px 0 0;padding-left:18px">${o.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<div class="small ok">Nothing unusual against your records.</div>'}
      <button class="primary" id="mdopen" style="margin-top:8px">${o.clientId ? `Review changes for ${esc(o.clientName)} in ComplyDesk` : 'Not a client yet — add it in ComplyDesk'}</button></div></div>`;
  }
  const o = m.out;
  const issues = o.rows.filter((r) => r.issues.length).length + o.missingOnMca.length;
  return `${head}<div class="fld"><div class="lab"><b>${esc(o.name ?? '')}</b> · DIN ${esc(o.din)}${o.dinStatus ? ` · ${esc(o.dinStatus)}` : ''}</div>
    <div class="small ${issues ? 'bad' : 'ok'}">${issues ? `${issues} difference${issues === 1 ? '' : 's'} with your records` : 'Matches your records'}</div></div>
    ${o.rows.map((r) => `<div class="fld"><div class="lab">${esc(r.name ?? r.cin)}</div><div class="small mono">${esc(r.cin)}</div>
      <div class="small muted">${r.beginOn ? `From ${fmtDate(r.beginOn)}` : ''}${r.endOn ? ` to ${fmtDate(r.endOn)}` : ''}${r.clientId ? ' · your client' : ' · not your client'}</div>
      ${r.issues.map((i) => `<div class="small bad">${esc(i)}</div>`).join('')}
      ${r.clientId && r.issues.length ? `<button class="link" data-client="${r.clientId}">Open ${esc(r.clientName)}</button>` : ''}</div>`).join('')}
    ${o.missingOnMca.map((x) => `<div class="fld"><div class="lab">${esc(x.clientName)}</div><div class="small bad">${esc(x.issue)}</div><button class="link" data-client="${x.clientId}">Open</button></div>`).join('')}
  </div>`;
}
function bindMaster() {
  on('#mdread', 'click', () => run(readMaster));
  on('#mdopen', 'click', () => { const o = state.master.out; openInComplyDesk(o.clientId ? `/clients/${o.clientId}?mca=${o.id}` : `/clients?mca=${o.id}`); });
  document.querySelectorAll('[data-client]').forEach((el) => el.addEventListener('click', () => openInComplyDesk(`/clients/${el.dataset.client}`)));
}

// ---- Rendering ----------------------------------------------------------------------------------------------
function render() {
  $who.textContent = state.conn?.who ?? '';
  const msg = state.msg ? `<div class="${state.msg.kind === 'err' ? 'err' : state.msg.kind === 'warn' ? 'note' : 'card small ok'}">${esc(state.msg.text)}</div>` : '';
  if (!state.conn) {
    $app.innerHTML = `${msg}<div class="card">
      <h2>Connect to ComplyDesk</h2>
      <p class="muted small">In ComplyDesk, open <b>MCA form filler</b> in the left menu → <b>Create a connection code</b>, and paste it here with the ComplyDesk address shown there.</p>
      <label class="f">ComplyDesk address<input id="base" placeholder="https://complydesk.integratatech.ai" value="${esc(state.lastBase ?? '')}"></label>
      <label class="f">Connection code<input id="token" placeholder="cdx_…"></label>
      <button class="primary" id="connect" ${state.busy ? 'disabled' : ''}>Connect</button></div>`;
    on('#connect', 'click', () => { const base = val('#base'); const token = val('#token'); state.lastBase = base; run(async () => { await connect(base, token); await loadFilings(); }); });
    return;
  }
  if (!state.pack) {
    $app.innerHTML = `${msg}<div class="card">
      <h2>Which filing are you entering?</h2>
      <div class="row"><input id="q" placeholder="Search company, CIN or form" value="${esc(state.q)}"><button id="go">Search</button></div>
      <div class="list" style="margin-top:8px">${state.filings.length ? state.filings.map((f) => `<button class="filing" data-id="${f.id}"><span><b>${esc(f.form)}</b> · ${esc(f.clientName)}</span><span class="muted small">${esc(f.periodLabel || `FY ${f.fy}-${String((f.fy + 1) % 100).padStart(2, '0')}`)} · due ${fmtDate(f.dueDate)}</span></button>`).join('') : '<p class="muted small">No open filings with MCA form data.</p>'}</div>
      </div>${srnCard()}${masterCard()}<p class="small"><button class="link" id="disc">Disconnect</button></p>`;
    bindSrn(); bindMaster();
    const search = () => { state.q = val('#q'); run(loadFilings); };
    on('#go', 'click', search);
    on('#q', 'keydown', (e) => e.key === 'Enter' && search());
    document.querySelectorAll('.filing').forEach((b) => b.addEventListener('click', () => run(async () => { state.pack = await api(`/filings/${b.dataset.id}/form`); state.page = []; state.matches = {}; state.results = {}; state.msg = null; })));
    on('#disc', 'click', () => run(disconnect));
    return;
  }
  const p = state.pack; const ob = p.obligation;
  const pct = p.progress.total ? Math.round((p.progress.filled / p.progress.total) * 100) : 100;
  const ticked = packFields().filter((f) => state.matches[f.key] && state.tick[f.key] && f.value).length;
  const pageOpts = (key) => `<option value="">— not on this page —</option>${state.page.filter((x) => !x.locked).map((x) => `<option value="${esc(x.ref)}" ${state.matches[key] === x.ref ? 'selected' : ''}>${esc(x.label || '(no label)')}</option>`).join('')}`;
  $app.innerHTML = `${msg}<div class="card">
      <div class="row"><h2 class="grow">${esc(p.form)} · ${esc(ob.clientName)}</h2><button class="link" id="back">Change</button></div>
      <p class="muted small" style="margin:0 0 6px">${esc(ob.fyLabel)}${ob.periodLabel ? ` · ${esc(ob.periodLabel)}` : ''} · due ${fmtDate(ob.dueDate)} · ${p.progress.filled}/${p.progress.total} values ready</p>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <p class="small" style="margin:10px 0 6px">1. On the MCA portal, open ${esc(p.form)} and enter the CIN. 2. Press <b>Find fields</b>. 3. Check the matches. 4. <b>Fill</b>. You save, sign and submit on the portal.</p>
      <div class="row"><button id="find" ${state.busy ? 'disabled' : ''}>Find fields on this page</button><button class="primary" id="fill" ${!ticked || state.busy ? 'disabled' : ''}>Fill ${ticked} field${ticked === 1 ? '' : 's'}</button></div>
    </div>
    ${p.parts.map((part) => `<div class="card"><h3 style="margin-top:0">${esc(part.title)}</h3>
      ${part.fields.map((f) => {
        const r = state.results[f.key];
        return `<div class="fld ${f.missing ? 'missing' : ''}">
          <div class="top">${state.page.length && f.value ? `<input type="checkbox" data-tick="${f.key}" ${state.tick[f.key] && state.matches[f.key] ? 'checked' : ''} ${state.matches[f.key] ? '' : 'disabled'} style="width:auto">` : ''}<span class="lab">${esc(f.label)}</span></div>
          <div class="val">${f.value ? esc(f.value) : f.optional ? '<span class="muted">—</span>' : 'Missing — add it in ComplyDesk'}</div>
          ${state.page.length && f.value ? `<div class="row to"><span class="muted">→</span><select data-map="${f.key}">${pageOpts(f.key)}</select>${state.matches[f.key] ? `<button class="link" data-show="${esc(state.matches[f.key])}">show</button>` : ''}</div>` : ''}
          ${f.value ? `<div class="row small"><button class="link" data-copy="${f.key}">Copy</button><button class="link" data-put="${f.key}">Put in selected field</button></div>` : ''}
          ${r ? `<span class="small ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓ Filled' : `✗ ${esc(r.why)}`}</span>` : ''}
        </div>`;
      }).join('')}
      ${part.tables.map((t) => `<div class="fld"><div class="top"><span class="lab">${esc(t.title)}</span>${t.rows.length ? `<button class="link" data-table="${esc(t.key)}">Copy for Excel</button>` : ''}</div><span class="muted small">${t.rows.length ? `${t.rows.length} row${t.rows.length === 1 ? '' : 's'} — paste into MCA’s Excel template` : esc(t.empty)}</span></div>`).join('')}
    </div>`).join('')}
    <div class="card"><h3 style="margin-top:0">Attachments to upload</h3><ul class="small" style="margin:0;padding-left:18px">${p.attachments.map((a) => `<li>${esc(a.name)}${a.why ? ` <span class="muted">— ${esc(a.why)}</span>` : ''}</li>`).join('')}</ul></div>`;
  on('#back', 'click', () => { state.pack = null; state.msg = null; render(); });
  on('#find', 'click', () => run(findFields));
  on('#fill', 'click', () => run(fillTicked));
  document.querySelectorAll('[data-tick]').forEach((el) => el.addEventListener('change', () => { state.tick[el.dataset.tick] = el.checked; render(); }));
  document.querySelectorAll('[data-map]').forEach((el) => el.addEventListener('change', () => { if (el.value) { state.matches[el.dataset.map] = el.value; state.tick[el.dataset.map] = true; flash(el.value); } else delete state.matches[el.dataset.map]; render(); }));
  document.querySelectorAll('[data-show]').forEach((el) => el.addEventListener('click', () => flash(el.dataset.show)));
  document.querySelectorAll('[data-copy]').forEach((el) => el.addEventListener('click', () => { navigator.clipboard.writeText(packFields().find((f) => f.key === el.dataset.copy).value); el.textContent = 'Copied'; }));
  document.querySelectorAll('[data-put]').forEach((el) => el.addEventListener('click', () => run(() => putInFocused(el.dataset.put))));
  document.querySelectorAll('[data-table]').forEach((el) => el.addEventListener('click', () => {
    const t = p.parts.flatMap((x) => x.tables).find((x) => x.key === el.dataset.table);
    navigator.clipboard.writeText([t.columns, ...t.rows].map((r) => r.map((v) => v ?? '').join('\t')).join('\n')); el.textContent = 'Copied';
  }));
}
const on = (sel, ev, fn) => document.querySelector(sel)?.addEventListener(ev, fn);
const val = (sel) => document.querySelector(sel)?.value ?? '';
async function run(fn) {
  state.busy = true; render();
  try { await fn(); } catch (e) { state.msg = { kind: 'err', text: e.message ?? String(e) }; }
  state.busy = false; render();
}
async function loadFilings() { state.filings = await api(`/filings?q=${encodeURIComponent(state.q)}`); state.msg = null; }

(async () => {
  const { conn } = await chrome.storage.local.get('conn');
  state.conn = conn ?? null;
  if (state.conn) await run(loadFilings); else render();
})();
