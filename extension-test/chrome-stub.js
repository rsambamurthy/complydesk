// Minimal chrome.* for running panel.html outside Chrome, against mock-mca.html in the left frame (tests / screenshots).
(() => {
  const left = () => window.parent.frames['mca'];
  const store = JSON.parse(localStorage.getItem('cdx-test') || '{}');
  window.chrome = {
    storage: { local: {
      get: async (k) => ({ [k]: store[k] }),
      set: async (o) => { Object.assign(store, o); localStorage.setItem('cdx-test', JSON.stringify(store)); },
      remove: async (k) => { delete store[k]; localStorage.setItem('cdx-test', JSON.stringify(store)); },
    } },
    permissions: { request: async () => true },
    tabs: { query: async () => [{ id: 1, url: 'https://www.mca.gov.in/mca/form/MGT-7' }], create: async ({ url }) => { window.__opened = url; return { id: 2 }; } },
    scripting: { executeScript: async ({ files, func, args = [] }) => {
      const w = left();
      if (files) { if (!w.__cdx) { const s = w.document.createElement('script'); s.src = '/extension/content.js'; await new Promise((r) => { s.onload = r; w.document.head.appendChild(s); }); } return [{ frameId: 0 }]; }
      return [{ frameId: 0, result: w.eval(`(${func.toString()})`)(...args) }];
    } },
  };
})();
