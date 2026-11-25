/**
 * Runs inside the MCA portal page (each frame), injected by the side panel. Finds the form's fields with their
 * labels, fills the ones the user approved, and highlights them; reads SRN rows for filing status. It never clicks
 * buttons, submits or signs.
 */
(() => {
  if (window.__cdx) return;
  const SKIP = 'input[type=hidden],input[type=button],input[type=submit],input[type=reset],input[type=checkbox],input[type=radio],input[type=file],input[type=image],input[type=password]';
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const text = (el) => (el?.innerText ?? el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const short = (s) => (s && s.length <= 200 ? s : '');

  /** The words a person sees next to the field. */
  function labelFor(el) {
    if (el.labels?.length) { const t = short(text(el.labels[0])); if (t) return t; }
    const al = el.getAttribute('aria-label'); if (al) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((id) => text(document.getElementById(id))).join(' ').trim(); if (t) return t; }
    const wrap = el.closest('label'); if (wrap) { const t = short(text(wrap).replace(el.value ?? '', '')); if (t) return t; }
    // Nearest text before the field: previous siblings, then the same for up to 5 ancestors (table cells, form rows).
    let node = el;
    for (let depth = 0; depth < 6 && node; depth++) {
      let sib = node.previousElementSibling;
      while (sib) {
        if (!sib.matches('input,select,textarea,button') && !sib.querySelector('input,select,textarea')) { const t = short(text(sib)); if (t) return t; }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '';
  }

  function scan() {
    const els = [...document.querySelectorAll('input,select,textarea')].filter((el) => !el.matches(SKIP) && visible(el));
    return els.map((el, i) => {
      const ref = el.dataset.cdx || `${location.pathname.length}-${i}-${Math.random().toString(36).slice(2, 7)}`;
      el.dataset.cdx = ref;
      return {
        ref, label: labelFor(el), tag: el.tagName.toLowerCase(), type: el.type || '', value: el.value ?? '',
        locked: !!(el.disabled || el.readOnly), options: el.tagName === 'SELECT' ? [...el.options].map((o) => o.text.trim()) : undefined,
      };
    });
  }

  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  /** Sets a value so Angular / React forms see it as typed. */
  function setValue(el, value) {
    if (el.tagName === 'SELECT') {
      const want = norm(value);
      const opt = [...el.options].find((o) => norm(o.text) === want || norm(o.value) === want) ?? [...el.options].find((o) => norm(o.text).includes(want) || (want.includes(norm(o.text)) && norm(o.text).length > 2));
      if (!opt) return `“${value}” isn’t one of the choices`;
      el.value = opt.value;
    } else {
      let v = String(value);
      if (/^[\d,]+(\.\d+)?$/.test(v)) v = v.replace(/,/g, '');
      if (el.type === 'date') { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v); if (m) v = `${m[3]}-${m[2]}-${m[1]}`; }
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    }
    for (const t of ['input', 'change', 'blur']) el.dispatchEvent(new Event(t, { bubbles: true }));
    return null;
  }

  function fill(items) {
    return items.map(({ ref, value }) => {
      const el = document.querySelector(`[data-cdx="${CSS.escape(ref)}"]`);
      if (!el) return { ref, ok: false, why: 'Field not on the page any more' };
      if (el.disabled || el.readOnly) return { ref, ok: false, why: 'Locked — the portal fills it' };
      const why = setValue(el, value);
      el.style.outline = why ? '2px solid #d92d20' : '2px solid #12a150';
      el.style.outlineOffset = '1px';
      return { ref, ok: !why, why };
    });
  }

  function fillFocused(value) {
    if (!document.hasFocus()) return null;
    const el = document.activeElement;
    if (!el || !el.matches('input,select,textarea') || el.matches(SKIP)) return null;
    if (el.disabled || el.readOnly) return { ok: false, why: 'That field is locked' };
    const why = setValue(el, value);
    el.style.outline = why ? '2px solid #d92d20' : '2px solid #12a150';
    return { ok: !why, why, label: labelFor(el) };
  }

  function flash(ref) {
    const el = document.querySelector(`[data-cdx="${CSS.escape(ref)}"]`);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const old = el.style.boxShadow; el.style.boxShadow = '0 0 0 4px rgba(47,111,222,.45)';
    setTimeout(() => { el.style.boxShadow = old; }, 1500);
    return true;
  }

  /** Rows of text that could hold an SRN and its status: table rows, grid rows, list items, small cards. Read only. */
  function rows() {
    const seen = new Set(); const out = [];
    const add = (el) => { const t = text(el); if (t && t.length <= 600 && !seen.has(t)) { seen.add(t); out.push({ text: t }); } };
    document.querySelectorAll('tr, [role=row], li, mat-row, .mat-row, .row, .card, dl').forEach((el) => { if (/[A-Z]{1,2}\d{7,8}/.test(text(el))) add(el); });
    // A details page (Track SRN): the whole visible text, in blocks.
    if (!out.length) { const t = text(document.body); if (/[A-Z]{1,2}\d{7,8}/.test(t)) out.push({ text: t.slice(0, 4000), whole: true }); }
    return out;
  }

  window.__cdx = { scan, fill, fillFocused, flash, labelFor, rows };
})();
