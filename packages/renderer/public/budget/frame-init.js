// אבחון: מה שקורה בתוך המסגרת נשלח למסגרת האם ונכתב ליומן התוכנה (קובץ האבחון)
(() => {
  const note = (stage, detail) => { try { parent.postMessage({ type: 'budget-diag', stage, detail: String(detail || '').slice(0, 400) }, '*'); } catch (e) { /* אין למי לדווח */ } };
  window.addEventListener('error', (e) => note('error', `${e.message} @${String(e.filename || '').slice(-40)}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => note('rejection', e.reason && (e.reason.message || e.reason)));
  window.addEventListener('load', () => {
    const app = document.getElementById('app');
    note('loaded', `app=${app ? app.children.length : 'none'} bg=${getComputedStyle(document.body).backgroundColor} url=${location.href.slice(-60)}`);
  });
  note('boot', navigator.userAgent.slice(-40));
})();
// הדף רץ בתוך מסגרת של התוכנה. קריאות לכתובת /__local/ עוברות בהודעות למסגרת האם, שעונה מהמסד המקומי.
window.BUDGET_API = '/__local/'; window.BUDGET_CSRF = 'local'; window.BUDGET_SUMIT = []; window.BUDGET_EXIT = '';
window.BUDGET_ROLE = 'admin'; window.BUDGET_PEOPLE = ''; window.BUDGET_CAN_WIPE = false;

// קריאת קובץ אקסל בתוך התוכנה (באתר זה נעשה בשרת). מחזיר טקסט עם טאבים, כמו הדבקה מהאקסל.
async function readXlsxText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('bad');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder(); const entries = {};
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    entries[dec.decode(buf.subarray(p + 46, p + 46 + nl))] = { method, csize, off };
    p += 46 + nl + el + cl;
  }
  const read = async (name) => {
    const e = entries[name]; if (!e) return null;
    const o = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
    const raw = buf.subarray(o, o + e.csize);
    if (e.method === 0) return dec.decode(raw);
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return dec.decode(await new Response(stream).arrayBuffer());
  };
  const xml = (t) => new DOMParser().parseFromString(t, 'application/xml');
  const wbXml = xml(await read('xl/workbook.xml'));
  const relXml = xml(await read('xl/_rels/workbook.xml.rels'));
  const first = wbXml.getElementsByTagName('sheet')[0];
  const rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
  let target = 'worksheets/sheet1.xml';
  for (const r of relXml.getElementsByTagName('Relationship')) if (r.getAttribute('Id') === rid) target = r.getAttribute('Target');
  target = target.replace(/^\//, ''); if (!target.startsWith('xl/')) target = 'xl/' + target;
  const shared = [];
  const ssT = await read('xl/sharedStrings.xml');
  if (ssT) for (const si of xml(ssT).getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
  const dateXf = new Set();
  const stT = await read('xl/styles.xml');
  if (stT) {
    const sd = xml(stT); const custom = {};
    for (const nf of sd.getElementsByTagName('numFmt')) custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode');
    const xfs = sd.getElementsByTagName('cellXfs')[0];
    if (xfs) [...xfs.getElementsByTagName('xf')].forEach((xf, i) => {
      const id = xf.getAttribute('numFmtId'), fc = custom[id];
      if ((+id >= 14 && +id <= 22) || (+id >= 45 && +id <= 47) || (fc && /[dmy]/i.test(fc.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')))) dateXf.add(i);
    });
  }
  const sheet = xml(await read(target));
  const col = (ref) => { let c = 0; for (const ch of ref.replace(/\d+/g, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  const lines = [];
  for (const row of sheet.getElementsByTagName('row')) {
    const cells = [];
    for (const c of row.getElementsByTagName('c')) {
      const t = c.getAttribute('t'), vEl = c.getElementsByTagName('v')[0];
      let v = vEl ? vEl.textContent : '';
      if (t === 's') v = shared[+v] || '';
      else if (t === 'inlineStr') v = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
      else if (v !== '' && t !== 'str' && t !== 'b' && t !== 'e' && !isNaN(+v)) {
        if (dateXf.has(+(c.getAttribute('s') || 0))) v = new Date(Math.round((+v - 25569) * 86400000)).toISOString().slice(0, 10);
        else v = String(+v);
      }
      cells[col(c.getAttribute('r') || 'A1')] = String(v).replace(/[\t\r\n]+/g, ' ').trim();
    }
    const arr = Array.from(cells, x => x || '');
    if (arr.some(Boolean)) lines.push(arr.join('\t').replace(/\t+$/, ''));
    if (lines.length >= 5000) break;
  }
  return lines.join('\n');
}

(() => {
  const realFetch = window.fetch.bind(window);
  const waiting = new Map();
  let seq = 0;
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'budget-api-reply' || !waiting.has(m.id)) return;
    waiting.get(m.id)(new Response(m.body, { status: m.status, headers: { 'Content-Type': 'application/json' } }));
    waiting.delete(m.id);
  });
  window.fetch = (url, init) => {
    if (!String(url).startsWith('/__local/')) return realFetch(url, init);
    if (String(url) === '/__local/xlsx') {
      const f = init && init.body && init.body.get && init.body.get('file');
      if (!f || f.size > 5e6) return Promise.resolve(new Response(JSON.stringify({ error: 'הקובץ גדול מדי' }), { status: 400 }));
      return readXlsxText(f).then(text => new Response(JSON.stringify({ text }), { status: 200 }), () => new Response(JSON.stringify({ error: 'קובץ האקסל לא תקין (אפשר לשמור אותו כ-CSV)' }), { status: 400 }));
    }
    return new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, resolve);
      setTimeout(() => { if (waiting.delete(id)) reject(new Error('אין תשובה מהתוכנה')); }, 20000);
      parent.postMessage({ type: 'budget-api', id, path: String(url).slice(9), body: init && init.body ? String(init.body) : '' }, '*');
    });
  };
})();

// לשונית "סנכרון" בתפריט הדפים של התקציב: נפתחת בתוך התוכנה (המסגרת האם), ולא קיימת באתר
(() => {
  let syncActive = false;
  const post = (m) => parent.postMessage(m, '*');
  const inject = () => {
    const nav = document.querySelector('.bud-nav');
    if (!nav) return;
    let tab = document.getElementById('sync-tab');
    if (!tab) {
      tab = document.createElement('a');
      tab.id = 'sync-tab';
      tab.setAttribute('role', 'button');
      tab.innerHTML = '<b>🔄</b>סנכרון';
      nav.appendChild(tab);
    }
    if (!document.getElementById('update-tab')) {
      const up = document.createElement('a');
      up.id = 'update-tab';
      up.setAttribute('role', 'button');
      up.innerHTML = '<b>⬆️</b>עדכון';
      nav.appendChild(up);
    }
    const note = document.querySelector('#sync-card p.mut');
    if (note && !note.dataset.local) {
      note.dataset.local = '1';
      note.textContent = 'הסנכרון רץ בתוך התוכנה הזאת. את הסנכרון האוטומטי מגדירים בלשונית "סנכרון".';
    }
    post({ type: 'budget-nav', height: Math.ceil(nav.getBoundingClientRect().height) });
  };
  new MutationObserver(inject).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', inject);
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('.bud-nav > *');
    if (!t) return;
    if (t.id === 'update-tab') { post({ type: 'budget-update' }); return; }
    post({ type: 'budget-tab', tab: t.id === 'sync-tab' ? 'sync' : 'budget' });
  }, true);
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'budget-sync-active') return;
    syncActive = !!e.data.active;
    document.body.classList.toggle('sync-on', syncActive);
  });
})();
