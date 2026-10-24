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
