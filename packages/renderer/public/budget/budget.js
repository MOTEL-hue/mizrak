'use strict';
(function () {
/* תקציב המשפחה — אפליקציה אחת, עובדת גם בלי אינטרנט. הנתונים נשמרים במכשיר ומסתנכרנים לשרת (אם הוגדר). */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// פרטיות: כשהסכומים מוסתרים כל סכום מוצג כ-••••. הסתרה קבועה (privAlways) חוסמת הצגה, וברירת מחדל (privDefault) קובעת רק את המצב ההתחלתי
// ההסתרה היא CSS בלבד (מחלקה על ה-body), בלי ציור מחדש ובלי שינוי גודל: כל סכום נעטף ב-span.amt בעת הציור, וכשהסכומים מוסתרים הטקסט שקוף ונקודות מצוירות במקומו
let amtHidden = null;
const fmt = n => (Math.round((+n || 0) * 100) / 100).toLocaleString('he-IL') + ' ₪';
const applyPriv = () => document.body.classList.toggle('priv-on', !!amtHidden);
(() => {
  const AMT = /[\u200e\u200f]?-?\d[\d,]*(?:\.\d+)?\s?₪/g;
  const wrap = root => {
    if (!root || !root.isConnected) return;
    const w = document.createTreeWalker(root.nodeType === 3 ? root.parentNode : root, NodeFilter.SHOW_TEXT, { acceptNode: n => /^(SCRIPT|STYLE|TEXTAREA|OPTION)$/.test(n.parentNode.nodeName) || n.parentNode.closest('.amt') || !n.nodeValue.includes('₪') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
    nodes.forEach(n => {
      const text = n.nodeValue; AMT.lastIndex = 0; if (!AMT.test(text)) return; AMT.lastIndex = 0;
      const frag = document.createDocumentFragment(); let last = 0, m;
      while ((m = AMT.exec(text))) { if (m.index > last) frag.append(text.slice(last, m.index)); const sp = document.createElement('span'); sp.className = 'amt'; sp.textContent = m[0]; frag.append(sp); last = m.index + m[0].length; }
      if (last < text.length) frag.append(text.slice(last)); n.replaceWith(frag);
    });
  };
  let queue = new Set(), raf = 0, obs;
  const flush = () => { raf = 0; obs.disconnect(); queue.forEach(wrap); queue = new Set(); obs.observe(document.body, { childList: true, subtree: true }); };
  const go = () => { obs = new MutationObserver(ms => { ms.forEach(m => m.addedNodes.forEach(n => queue.add(n))); if (!raf) raf = requestAnimationFrame(flush); }); obs.observe(document.body, { childList: true, subtree: true }); wrap(document.body); };
  document.body ? go() : document.addEventListener('DOMContentLoaded', go);
})();
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- שנים: עברית / לועזית ---------- */
const GEM = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
function hebLabel(y) { // 5787 -> תשפ"ז
  let n = y % 1000, s = '';
  for (const [v, l] of GEM) while (n >= v && !(n === 15 || n === 16)) { s += l; n -= v; }
  if (n === 15) s += 'טו'; if (n === 16) s += 'טז';
  return s.length > 1 ? s.slice(0, -1) + '"' + s.slice(-1) : s + "'";
}
function hebNum(label) { // תשפ"ה -> 5785
  const L = String(label).trim(); if (!/^ת[א-ת"'״׳]*$/.test(L)) return 0;
  let t = 0; for (const ch of L) { const g = GEM.find(x => x[1] === ch); if (g) t += g[0]; }
  return 5000 + t;
}
const hebYearOf = d => +new Intl.DateTimeFormat('en-u-ca-hebrew', { year: 'numeric' }).formatToParts(new Date(d + 'T12:00:00')).find(p => p.type === 'year').value;
const hebMonthOf = d => new Intl.DateTimeFormat('he-u-ca-hebrew', { month: 'long' }).format(new Date(d + 'T12:00:00'));
const hebDateStr = d => new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long' }).format(new Date(d + 'T12:00:00'));
const yearOf = d => S.settings.calendar === 'heb' ? hebYearOf(d) : +d.slice(0, 4);
const yearLabel = y => S.settings.calendar === 'heb' ? hebLabel(y) : String(y);
const HEB_MONTHS = ['תשרי', 'חשון', 'כסלו', 'טבת', 'שבט', 'אדר', 'ניסן', 'אייר', 'סיון', 'תמוז', 'אב', 'אלול'];

/* ---------- מצב ושמירה (השרת של האתר הראשי) ---------- */
const COLL = ['plan', 'yearly', 'debts', 'accounts', 'tx', 'bizs', 'orders', 'bizExp', 'invoices', 'reminders', 'goals', 'assets', 'snaps', 'policies', 'rules', 'tithes', 'titheRec'];
const S = { settings: { family: '', calendar: 'heb', tithe: 10 }, data: Object.fromEntries(COLL.map(c => [c, []])) };
let ready = false, pending = [], flushT = 0, flushing = false;
const API = window.BUDGET_API;
const csrf = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || window.BUDGET_CSRF || '';
// חיוב בנק על כרטיס אשראי / הוראת קבע לכרטיס הוא סיכום של הקניות שכבר נקלטו מהכרטיס עצמו. כשפירוט הכרטיס קיים (קניות בחודש שלפני החיוב), שורת הבנק לא נספרת כדי שלא יהיו כפילויות
const CARD_COS = ['isracard', 'amex', 'visaCal', 'max', 'leumiCard'];
const CARD_WORDS = [[/ישראכרט|ISRACARD/i, 'isracard'], [/אמריקן|אמקס|AMEX/i, 'amex'], [/כאל|ויזה|CAL\b/i, 'visaCal'], [/מקס|MAX\b|לאומי\s*קארד|דיינרס/i, 'max'], [/כרטיס(י)?\s*אשראי|אשראי|כרט\.?\s*אשר|דיי?רקט.{0,3}מצטבר|מצטבר/, '*']];
const coOf = t => t.co || (String(t.id || '').startsWith('bk-') ? String(t.id).slice(3).split('_').slice(-2)[0] : '');
let dupCache = { key: '', set: new Set() };
function dupIds() {
  const tx = S.data.tx, key = tx.length + ':' + tx.filter(x => x.del).length + ':' + tx.filter(x => x.keep).length + ':' + tx.filter(x => x.pd).length;
  if (dupCache.key === key) return dupCache.set;
  // התאמה מדויקת: חיוב הבנק שווה (עד אגורה) לסכום קניות הכרטיס שתאריך החיוב שלהן קרוב לתאריך שורת הבנק. בלי התאמה מדויקת שורת הבנק נשארת
  const sums = {}, add = (k, v) => { sums[k] = (sums[k] || 0) + v; };
  tx.forEach(t => {
    const co = coOf(t); if (t.del || !t.pd || !CARD_COS.includes(co)) return;
    const v = t.type === 'income' ? -t.amount : +t.amount; add(co + '|' + t.pd, v); if (t.ac) add(co + '|' + t.ac + '|' + t.pd, v);
  });
  const day = 864e5, set = new Set(), keys = Object.keys(sums);
  tx.forEach(t => {
    const co = coOf(t); if (t.del || t.keep || t.type === 'income' || !co || CARD_COS.includes(co)) return;
    const hit = CARD_WORDS.find(([re]) => re.test(t.note || '')); if (!hit) return;
    const d = Date.parse(t.date), want = +t.amount;
    if (keys.some(k => { const p = k.split('|'), x = Date.parse(p[p.length - 1]); return (hit[1] === '*' || p[0] === hit[1]) && Math.abs(x - d) <= 4 * day && Math.abs(sums[k] - want) < 0.015; })) set.add(t.id);
  });
  dupCache = { key, set }; return set;
}
// תנועה שמסומנת כהעברה בין חשבונות (tr) לא נספרת, כמו חיוב בנק שמכוסה בפירוט הכרטיס
// חודש התקציב של תנועה: החודש שנבחר ידנית (bm), ואחרת חודש התאריך
// התאריך שלפיו תנועה נספרת: חודש שנבחר ידנית, אחרת תאריך הערך/החיוב (אם הוגדר), אחרת תאריך התנועה. כל הסיכומים (חודשי, שנתי, תחזית) משתמשים בו
const effDate = t => t.bm ? t.bm + '-15' : String((S.settings.dateBy === 'value' && (t.vd || t.pd)) || t.date);
const ymOf = t => effDate(t).slice(0, 7);
// חיובי משכנתא שירדו בפועל מהחשבון לפי חודש, להשוואה להחזר החודשי שחושב
function mortgagePaid() {
  const by = {};
  live('tx').filter(t => t.type !== 'income' && /משכנת/.test(t.note || '')).forEach(t => { by[ymOf(t)] = (by[ymOf(t)] || 0) + +t.amount; });
  return Object.keys(by).sort().slice(-3).map(ym => [ym, Math.round(by[ym] * 100) / 100]);
}
const mortgagePaidHtml = x => {
  const p = mortgagePaid(); if (!p.length) return '';
  const last = p[p.length - 1][1], diff = x.monthly && Math.abs(last - x.monthly) / x.monthly > 0.03;
  return `<br>בפועל ירד מהחשבון: ${p.map(([ym, v]) => ym.slice(5) + '/' + ym.slice(0, 4) + ' ' + fmt(v)).join(' · ')}` + (diff ? ` <b style="color:#b42318">— שונה מההחזר שחושב (${fmt(x.monthly)}), ייתכן שהחישוב לא מדויק</b>` : ' <b style="color:#067647">— תואם להחזר שחושב</b>');
};
const hiddenBanks = () => S.settings.hiddenBanks || [];
// קטגוריות מיוחדות: "שונות" נספרות כרגיל; "לא קשור" לא נספרות בהכנסות והוצאות (העברות בין חשבונות, הלוואה לחבר והחזרה)
const nbCats = () => S.settings.nbCats || [], miscCats = () => S.settings.miscCats || ['שונות'];
const EXTRA_G = ['שונות', 'לא קשור (לא נספר)'];
const withCat = (t, cat) => ({ ...t, cat, ...(nbCats().includes(cat) ? { nb: true } : nbCats().includes(t.cat) && t.nb ? { nb: false } : {}) });
const isDup = t => !!t.tr || !!t.sp || !!t.nb || !!t.dupOf || !!t.arch || dupIds().has(t.id) || (hiddenBanks().length > 0 && hiddenBanks().includes(bankOf(t)));
const live = c => c === 'tx' ? S.data.tx.filter(x => !x.del && !isDup(x)) : S.data[c].filter(x => !x.del);
function dbErr(e) { toast(e && (e.code === 403 || e.code === 401) ? 'אין הרשאה לשמור. התחבר מחדש.' : 'השמירה נכשלה, נסה שוב'); }
async function flush() {
  if (flushing || !pending.length) return; flushing = true;
  const ops = pending.splice(0, 400);
  try {
    const r = await fetch(API + 'batch', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }, body: JSON.stringify({ ops }) });
    if (!r.ok) throw { code: r.status };
  } catch (e) { pending.unshift(...ops); dbErr(e); flushing = false; return; }
  flushing = false; if (pending.length) flush();
}
function queue(op) { pending.push(op); clearTimeout(flushT); flushT = setTimeout(flush, 200); }
function put(c, item) {
  item = { ...item, u: Date.now() }; const a = S.data[c], i = a.findIndex(x => x.id === item.id); if (i < 0) a.push(item); else a[i] = item;
  queue({ c, id: item.id, data: item });
}
function remove(c, id) { S.data[c] = S.data[c].filter(x => x.id !== id); queue({ c, id, del: true }); }
function save() { queue({ c: 'settings', id: 'main', data: { ...S.settings } }); }
const dataKey = a => JSON.stringify([...(a || [])].sort((x, y) => String(x.id).localeCompare(String(y.id))));
// quiet: רענון ברקע. לא מציירים מחדש אם כלום לא השתנה או אם המשתמש באמצע הקלדה/בחירה, כדי שהדף לא יקפוץ
async function pull(quiet) {
  const r = await fetch(API + 'all', { credentials: 'same-origin' });
  if (r.status === 401 || r.status === 403) { location.reload(); return; }
  if (!r.ok) throw { code: r.status }; const j = await r.json();
  if (quiet && ready && (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '') || COLL.every(c => dataKey(S.data[c]) === dataKey(j[c])))) return;
  COLL.forEach(c => S.data[c] = j[c] || []); S.data.debts.filter(x => !x.del && !x.start).forEach(x => put('debts', { ...x, start: today().slice(0, 7) })); if (j.settings && j.settings.main) Object.assign(S.settings, j.settings.main);
  ready = true; mzProcess(); mzSnap(); render(); loadPrime();
}
async function loadPrime() {
  try {
    const j = await (await fetch(API + 'rates', { credentials: 'same-origin' })).json();
    S.primeInfo = j; S.autoPrime = (j.prime || []).map(x => x[0] + ' ' + x[1]).join('\n') || '';
    if (S.autoPrime) render();
  } catch (e) { S.primeInfo = { error: 'אין חיבור' }; }
}
let ME = { name: '', role: window.BUDGET_ROLE || 'admin' };
const canEdit = () => ME.role !== 'view';
function ask(msg, yes) { const m = modal(`<h2>${esc(msg)}</h2><div class="row"><button class="b red" id="y">כן</button><button class="b sec" id="n">לא</button></div>`); m.querySelector('#n').onclick = () => m.remove(); m.querySelector('#y').onclick = () => { m.remove(); yes(); }; }

/* ---------- הגדרת שדות לכל טבלה ---------- */
const PLAN_KINDS = { income: 'הכנסה קבועה', incomeVar: 'הכנסה משתנה', fixed: 'הוצאה קבועה', variable: 'הוצאה משתנה', consumption: 'צריכה שוטפת', charity: 'מעשרות וצדקה' };
const CAL_FIELD = { k: 'cal', l: 'היום בחודש לפי לוח', t: 'select', o: { greg: 'לועזי', heb: 'עברי' } };
const ASSET_KINDS = { real: 'נדל"ן', invest: 'השקעות וני"ע', pension: 'פנסיה וקרנות', deposit: 'פיקדון וחיסכון', crypto: 'קריפטו', cash: 'מזומן', lent: 'כסף שהלוויתי (חייבים לי)', borrowed: 'כסף שלקחתי (חוב זמני)', other: 'אחר' };
const SCHEMA = {
  plan: [{ k: 'kind', l: 'סוג', t: 'select', o: PLAN_KINDS }, { k: 'name', l: 'שם', t: 'text' }, { k: 'amount', l: 'סכום חודשי', t: 'number' }, { k: 'day', l: 'יום בחודש (לא חובה)', t: 'number' }, CAL_FIELD, { k: 'tith', l: 'חייב במעשר (להכנסה)', t: 'check' }, { k: 'mode', l: 'מעשרות וצדקה בלבד: להתנהג כמו', t: 'select', o: { variable: 'הוצאה משתנה (לפי מה שמוזן)', fixed: 'הוצאה קבועה (נספרת אוטומטית)' } }, { k: 'autoFrom', l: 'נספר אוטומטית מחודש (ריק = מתחילת השנה הנוכחית)', t: 'month' }, { k: 'active', l: 'פעיל', t: 'check', d: true }],
  yearly: [{ k: 'month', l: 'חודש עברי', t: 'select', o: Object.fromEntries([...HEB_MONTHS, 'כללי'].map(m => [m, m])) }, { k: 'name', l: 'שם', t: 'text' }, { k: 'amount', l: 'סכום', t: 'number' }, { k: 'kind', l: 'סוג', t: 'select', o: { expense: 'הוצאה', income: 'הכנסה' } }, { k: 'year', l: 'שנה (ריק = כל השנים)', t: 'text' }],
  debts: [{ k: 'name', l: 'שם המלווה', t: 'text' }, { k: 'kind', l: 'סוג', t: 'text' }, { k: 'balance', l: 'סכום החוב בתחילת ההחזרים', t: 'number' }, { k: 'monthly', l: 'החזר חודשי (נכלל אוטומטית בהוצאות)', t: 'number' }, { k: 'day', l: 'יום החזר בחודש (1-31)', t: 'number' }, CAL_FIELD, { k: 'start', l: 'תחילת ההחזרים (חודש)', t: 'month' }, { k: 'urgency', l: 'דחיפות (1 הכי דחוף)', t: 'number' }],
  tx: [{ k: 'date', l: 'תאריך', t: 'date' }, { k: 'type', l: 'סוג', t: 'select', o: { expense: 'הוצאה', income: 'הכנסה' } }, { k: 'amount', l: 'סכום', t: 'number' }, { k: 'note', l: 'תיאור', t: 'text' }, { k: 'bank', l: 'חשבון או כרטיס', t: 'text' }, { k: 'tags', l: 'תגיות (מופרדות בפסיק)', t: 'text' }, { k: 'vd', l: 'תאריך ערך או חיוב (לא חובה)', t: 'date' }, { k: 'bm', l: 'חודש תקציב אחר (אם התנועה שייכת לחודש אחר)', t: 'month' }, { k: 'nb', l: 'לא נספרת בתקציב', t: 'check' }],
  accounts: [{ k: 'name', l: 'שם החשבון', t: 'text' }, { k: 'balance', l: 'יתרה נוכחית', t: 'number' }, { k: 'min', l: 'התראה אם יורד מתחת ל', t: 'number' }, { k: 'max', l: 'התראה אם עולה מעל', t: 'number' }],
  assets: [{ k: 'name', l: 'שם', t: 'text' }, { k: 'kind', l: 'סוג', t: 'select', o: ASSET_KINDS }, { k: 'value', l: 'שווי נוכחי', t: 'number' }, { k: 'due', l: 'תאריך החזר (לכסף שהלוויתי או לקחתי, לא חובה)', t: 'date' }, { k: 'note', l: 'הערה', t: 'text' }],
  policies: [{ k: 'name', l: 'שם הפוליסה', t: 'text' }, { k: 'company', l: 'חברה', t: 'text' }, { k: 'premium', l: 'פרמיה', t: 'number' }, { k: 'per', l: 'תשלום', t: 'select', o: { month: 'חודשי', year: 'שנתי' } }, { k: 'renew', l: 'תאריך חידוש', t: 'date' }, { k: 'prev', l: 'פרמיה קודמת (לא חובה)', t: 'number' }],
  goals: [{ k: 'name', l: 'שם היעד', t: 'text' }, { k: 'target', l: 'סכום היעד', t: 'number' }, { k: 'saved', l: 'כבר נחסך', t: 'number' }, { k: 'date', l: 'תאריך יעד', t: 'date' }, { k: 'rate', l: 'ריבית שנתית באחוזים (לא חובה)', t: 'number' }],
  reminders: [{ k: 'title', l: 'תזכורת', t: 'text' }, { k: 'date', l: 'תאריך', t: 'date' }, { k: 'repeat', l: 'חזרה', t: 'select', o: { none: 'פעם אחת', monthly: 'כל חודש', yearly: 'כל שנה' } }, { k: 'amount', l: 'סכום (לא חובה)', t: 'number' }],
  bizs: [{ k: 'name', l: 'שם העסק', t: 'text' }, { k: 'taxid', l: 'מספר עוסק', t: 'text' }, { k: 'phone', l: 'טלפון', t: 'text' }, { k: 'address', l: 'כתובת', t: 'text' }],
  orders: [{ k: 'client', l: 'לקוח / אירוע', t: 'text' }, { k: 'date', l: 'תאריך', t: 'date' }, { k: 'when', l: 'מועד (טקסט חופשי)', t: 'text' }, { k: 'year', l: 'שנה', t: 'text' }, { k: 'amount', l: 'תשלום מהלקוח', t: 'number' }, { k: 'cost', l: 'הוצאות על ההזמנה', t: 'number' }, { k: 'paid', l: 'שולם', t: 'check' }, { k: 'note', l: 'הערות', t: 'text' }],
  bizExp: [{ k: 'item', l: 'מוצר / הוצאה', t: 'text' }, { k: 'date', l: 'תאריך', t: 'date' }, { k: 'when', l: 'מועד (טקסט חופשי)', t: 'text' }, { k: 'year', l: 'שנה', t: 'text' }, { k: 'amount', l: 'סכום', t: 'number' }],
  invoices: [{ k: 'kind', l: 'סוג מסמך', t: 'select', o: { 'חשבון עסקה': 'חשבון עסקה', 'חשבונית': 'חשבונית', 'קבלה': 'קבלה', 'חשבונית-קבלה': 'חשבונית-קבלה' } }, { k: 'client', l: 'לקוח', t: 'text' }, { k: 'date', l: 'תאריך', t: 'date' }, { k: 'desc', l: 'תיאור', t: 'text' }, { k: 'amount', l: 'סכום', t: 'number' }],
};

/* ---------- ממשק עזר ---------- */
let tab = 'home', curBiz = null, curYear = null, curMonth = today().slice(0, 7), subTab = {};
// שאלת כן/לא בחלון של האתר (confirm של הדפדפן נחסם בחלק מהמכשירים ואז השינוי מתבטל בשקט)
function ask(msg) {
  return new Promise(res => {
    const m = document.createElement('div'); m.className = 'modal'; m.style.zIndex = 90;
    m.innerHTML = `<div><p style="font-size:1.05rem;white-space:pre-line"></p><div class="row" style="margin-top:12px"><button class="b" id="ask-y">כן</button><button class="b sec" id="ask-n">לא</button></div></div>`;
    m.querySelector('p').textContent = msg;
    const end = v => { m.remove(); res(v); };
    m.querySelector('#ask-y').onclick = () => end(true); m.querySelector('#ask-n').onclick = () => end(false);
    m.onclick = e => { if (e.target === m) end(false); };
    document.body.append(m);
  });
}
// ההודעה מופיעה צמוד לכפתור שנלחץ (ואם לא נלחץ כפתור: בראש המסך)
let lastBtn = null;
const markNear = el => { lastBtn = { r: el.getBoundingClientRect(), t: Date.now() }; };
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); lastBtn = b ? { r: b.getBoundingClientRect(), t: Date.now() } : null; }, true);
function toast(t) {
  const d = document.createElement('div'); d.className = 'alert'; d.textContent = t;
  const near = lastBtn && Date.now() - lastBtn.t < 3000 && lastBtn.r.width > 0 ? lastBtn.r : null, w = Math.min(340, innerWidth - 24);
  d.style.cssText = 'position:fixed;z-index:100;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.25);width:' + w + 'px;' + (near
    ? 'left:' + Math.max(12, Math.min(innerWidth - w - 12, near.left + near.width / 2 - w / 2)) + 'px;' + (near.bottom + 90 > innerHeight ? 'bottom:' + (innerHeight - near.top + 8) + 'px' : 'top:' + (near.bottom + 8) + 'px')
    : 'top:60px;inset-inline:16px;width:auto');
  document.body.append(d); setTimeout(() => d.remove(), 3500);
}
function modal(html, onMount) { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div>${html}</div>`; m.onclick = e => { if (e.target === m) m.remove(); }; document.body.append(m); onMount?.(m); return m; }
function form(coll, item, after, extra = {}) {
  const f = SCHEMA[coll], it = item || { id: uid(), ...extra };
  const m = modal(`<h2>${item ? 'עריכה' : 'הוספה'}</h2>` + f.map(x => {
    const v = it[x.k] ?? (x.d === true ? true : '');
    if (x.t === 'select') return `<label>${x.l}</label><select data-k="${x.k}">${Object.entries(x.o).map(([a, b]) => `<option value="${esc(a)}" ${a == v ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
    if (x.t === 'check') return `<label><input type="checkbox" data-k="${x.k}" ${v ? 'checked' : ''}> ${x.l}</label>`;
    return `<label>${x.l}</label><input data-k="${x.k}" type="${x.t === 'number' ? 'number' : x.t}" step="any" value="${esc(v)}">`;
  }).join('') + `<div class="row" style="margin-top:14px"><button class="b" id="ok">שמירה</button><button class="b sec" id="no">ביטול</button>${item ? '<button class="b red sp" id="del" style="flex:0!important;margin-inline-start:auto">מחיקה</button>' : ''}</div>`);
  m.querySelector('#no').onclick = () => m.remove();
  if (item) m.querySelector('#del').onclick = () => ask('למחוק?', () => { remove(coll, it.id); m.remove(); render(); });
  m.querySelector('#ok').onclick = () => {
    f.forEach(x => { const e = m.querySelector(`[data-k="${x.k}"]`); it[x.k] = x.t === 'check' ? e.checked : x.t === 'number' ? (e.value === '' ? '' : +e.value) : e.value.trim(); });
    if (coll === 'debts' && !it.start) it.start = today().slice(0, 7);
    put(coll, it); m.remove(); after?.(it); render();
  };
}
const delBtn = (coll, id) => `<button class="ic" data-del="${coll}:${id}" title="מחיקה">🗑️</button>`;
function table(coll, cols, rows, o = {}) {
  const sum = o.sum; const total = sum ? rows.reduce((a, r) => a + (+r[sum] || 0), 0) : null;
  return `<div class="scroll"><table><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th></th></tr>` + rows.map(r =>
    `<tr>${cols.map(c => `<td class="${c[2] || ''}">${c[3] ? c[3](r) : esc(r[c[0]] ?? '')}${c[2] === 'n' && !c[3] && r[c[0]] !== '' && r[c[0]] != null ? ' ₪' : ''}</td>`).join('')}<td>${canEdit() ? `<button class="ic" data-edit="${coll}:${r.id}">✏️</button>${delBtn(coll, r.id)}` : ''}</td></tr>`).join('') +
    (sum ? `<tr class="tot"><td colspan="${cols.length}">סה"כ</td><td class="n">${fmt(total)}</td></tr>` : '') + `</table></div>`;
}
const addBtn = (coll, label = 'הוספה', extra = '') => canEdit() ? `<button class="b" data-add="${coll}" ${extra}>＋ ${label}</button>` : '';

/* ---------- חישובים ---------- */
function years() {
  const s = new Set([yearOf(today())]);
  live('tx').forEach(t => s.add(yearOf(effDate(t))));
  [...live('orders'), ...live('bizExp'), ...live('yearly')].forEach(x => { const y = bizYear(x); if (y) s.add(y); });
  return [...s].filter(Boolean).sort((a, b) => b - a);
}
function yrNum(t) { const h = hebNum(t); return !h ? 0 : S.settings.calendar === 'heb' ? h : h - 3760; }
function bizYear(x) { return x.date ? yearOf(x.date) : yrNum(x.year); } // שנה של הזמנה/הוצאה: לפי תאריך, אחרת לפי הטקסט (למשל תשפ"ה)
const isFixedPlan = p => p.kind === 'income' || p.kind === 'fixed' || (p.kind === 'charity' && p.mode === 'fixed');
const monthlyPlan = () => live('plan').filter(p => p.active !== false);
const planSum = k => monthlyPlan().filter(p => p.kind === k).reduce((a, p) => a + (+p.amount || 0), 0);
const hebDayOf = d => +new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric' }).format(new Date(d + 'T12:00:00'));
const pad2 = n => String(n).padStart(2, '0');
// תאריך (בלוח לועזי) של "יום בחודש" לפי הלוח שנבחר לפריט, בתוך חודש לועזי ym
function payDate(it, ym) {
  const last = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(), day = Math.max(1, Math.min(31, +it.day || 1));
  if (it.cal === 'heb') for (let n = 1; n <= last; n++) { const d = `${ym}-${pad2(n)}`; if (hebDayOf(d) === day) return d; }
  return `${ym}-${pad2(Math.min(it.cal === 'heb' ? 28 : day, last))}`;
}
const addMonth = (ym, k) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + k, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
// חוב: ההחזרים שכבר הגיע מועדם, מה נשאר, וכמה תשלומים
// ריבית לפי רשימת שינויים ("2025-03 4.5" בכל שורה): האחרונה שהגיע מועדה עד החודש, אחרת base
function rateAt(text, ym, base) {
  let r = base; (String(text || '').split('\n').map(l => l.trim().match(/^(\d{4}-\d{2})\s+(-?[\d.]+)/)).filter(Boolean).map(m => [m[1], +m[2]]).sort((a, b) => a[0].localeCompare(b[0]))).forEach(([m, v]) => { if (m <= ym) r = v; });
  return r;
}
// ריבית פריים: מבנק ישראל (נמשכת מהשרת) כשהאפשרות פעילה ויש נתונים, אחרת מה שהוזן ידנית
const primeText = () => S.settings.primeAuto !== false && S.autoPrime ? S.autoPrime : (S.settings.primeHist || '');
const primeNow = () => rateAt(primeText(), today().slice(0, 7), 6);
// מסלול ריבית אחד: לוח סילוקין (שפיצר) חודש אחר חודש. פריים: ריבית הפריים בחודש + מרווח; משתנה: לפי השינויים שהוזנו; קבועה: ריבית אחת
function trackRows(t, start) {
  const n = Math.min(600, Math.max(1, +t.months || 0)), rows = []; let bal = +t.principal || 0;
  for (let i = 0; i < n && bal > 0.005; i++) {
    const ym = addMonth(start, i), annual = t.type === 'prime' ? rateAt(primeText(), ym, 6) + (+t.rate || 0) : t.type === 'var' ? rateAt(t.changes, ym, +t.rate || 0) : (+t.rate || 0), r = Math.max(0, annual) / 1200;
    bal *= 1 + (+t.link || 0) / 1200;
    if (i < (+t.grace || 0) && i < n - 1) { // גרייס: ריבית בלבד, או גרייס מלא (בלי תשלום, והריבית מצטרפת לקרן)
      const gi = bal * r; if (t.graceFull) { bal += gi; rows.push({ ym, pay: 0, interest: gi, bal }); } else rows.push({ ym, pay: gi, interest: gi, bal });
      continue;
    }
    const interest = bal * r, left = n - i, pay = r ? bal * r / (1 - Math.pow(1 + r, -left)) : bal / left;
    bal = left === 1 ? 0 : bal - (pay - interest); rows.push({ ym, pay, interest, bal });
  }
  return rows;
}
function debtTracksInfo(d) {
  const now = today(), all = d.tracks.map(t => trackRows(t, d.start || now.slice(0, 7))), byYm = {};
  if (d.closed) all.forEach((rs, k) => { // פירעון מוקדם: התשלום האחרון בחודש הפירעון כולל את כל היתרה (וקנס, פעם אחת)
    const cut = rs.filter(r => r.ym <= d.closed); rs.length = 0; rs.push(...cut);
    const last = rs[rs.length - 1]; if (last) { last.pay += last.bal + (k === 0 ? +d.closeFee || 0 : 0); last.bal = 0; }
  });
  all.forEach(rs => rs.forEach(r => { const o = byYm[r.ym] ||= { pay: 0, interest: 0 }; o.pay += r.pay; o.interest += r.interest; }));
  const yms = Object.keys(byYm).sort(), pays = [], fut = []; 
  yms.forEach(ym => { const date = payDate(d, ym); (date <= now ? pays : fut).push({ ym, date, amount: byYm[ym].pay, interest: byYm[ym].interest }); });
  const rem = d.tracks.reduce((a, t, i) => { const rs = all[i].filter(r => payDate(d, r.ym) <= now); return a + (rs.length ? rs[rs.length - 1].bal : +t.principal || 0); }, 0);
  return { rem, pays, left: fut.length, future: fut.reduce((a, x) => a + x.amount, 0), interest: fut.reduce((a, x) => a + x.interest, 0), next: fut[0]?.amount || 0, endYm: yms[yms.length - 1] || '' };
}
function debtInfo(d) {
  if (d.tracks && d.tracks.length) return debtTracksInfo(d);
  const bal0 = +d.balance || 0, m = +d.monthly || 0, now = today(), pays = [];
  let rem = bal0;
  if (m > 0 && d.start) for (let ym = d.start; ym <= now.slice(0, 7) && rem > 0 && pays.length < 600; ym = addMonth(ym, 1)) {
    const date = payDate(d, ym); if (date > now) break;
    const amount = Math.min(m, rem); pays.push({ ym, date, amount }); rem -= amount;
  }
  return { rem, pays, left: m > 0 && rem > 0 ? Math.ceil(rem / m) : 0 };
}
const debtCat = d => 'החזר חוב: ' + d.name;
// הכנסה קבועה והוצאה קבועה נספרות מעצמן: נספרות כנכנסו/יצאו בסכום התכנון, אלא אם הוזנה תנועה אמיתית לאותו סעיף בחודש
function autoTxs(months, real) {
  const now = today().slice(0, 7), out = [];
  monthlyPlan().filter(p => isFixedPlan(p) && +p.amount).forEach(p => months.forEach(ym => {
    if (ym > now || ym < (p.autoFrom || now.slice(0, 4) + '-01')) return;
    const type = p.kind === 'income' ? 'income' : 'expense';
    if (real.some(t => ymOf(t) === ym && t.cat === p.name && (t.type === 'income') === (type === 'income'))) return;
    out.push({ id: 'auto-' + p.id + ym, date: payDate(p, ym), type, cat: p.name, amount: +p.amount, note: 'אוטומטי', auto: true });
  }));
  live('debts').forEach(d => debtInfo(d).pays.forEach(x => {
    // החזר שכבר נרשם בחודש (גם אם סווג בשם החוב או בסוגו, למשל "משכנתא") לא נספר שוב כסכום אוטומטי
    const names = [debtCat(d), d.name, d.kind].filter(Boolean);
    if (!months.includes(x.ym) || real.some(t => ymOf(t) === x.ym && names.includes(t.cat))) return;
    out.push({ id: 'auto-' + d.id + x.ym, date: x.date, type: 'expense', cat: debtCat(d), amount: x.amount, note: 'אוטומטי', auto: true });
  }));
  return out;
}
const debtMonthly = () => live('debts').reduce((a, d) => a + (debtInfo(d).rem > 0 ? debtInfo(d).next ?? (+d.monthly || 0) : 0), 0);
function yearSummary(y) {
  const inc = (planSum('income') + planSum('incomeVar')) * 12, exp = (planSum('fixed') + planSum('variable') + planSum('consumption') + planSum('charity') + debtMonthly()) * 12;
  const yi = live('yearly').filter(x => x.kind === 'income' && (!x.year || yrNum(x.year) === y || x.year == y)).reduce((a, x) => a + (+x.amount || 0), 0);
  const ye = live('yearly').filter(x => x.kind !== 'income' && (!x.year || yrNum(x.year) === y || x.year == y)).reduce((a, x) => a + (+x.amount || 0), 0);
  const biz = bizProfit(y);
  const heb = S.settings.calendar === 'heb', gy = heb ? y - 3760 : y, all = live('tx'), real = all.filter(t => yearOf(effDate(t)) === y);
  const txs = [...real, ...autoTxs([...Array(heb ? 14 : 12)].map((_, i) => addMonth(`${heb ? gy - 1 : gy}-${heb ? '09' : '01'}`, i)), all).filter(t => yearOf(t.date) === y)];
  const aI = txs.filter(t => t.type === 'income').reduce((a, t) => a + +t.amount, 0), aE = txs.filter(t => t.type !== 'income').reduce((a, t) => a + +t.amount, 0);
  return { planInc: inc + yi, planExp: exp + ye, biz, aI, aE, txs };
}
function bizProfit(y, bizId) {
  const o = live('orders').filter(x => bizYear(x) === y && (!bizId || x.biz === bizId)), e = live('bizExp').filter(x => bizYear(x) === y && (!bizId || x.biz === bizId));
  const inc = o.reduce((a, x) => a + (+x.amount || 0), 0), c = o.reduce((a, x) => a + (+x.cost || 0), 0), ex = e.reduce((a, x) => a + (+x.amount || 0), 0);
  return { inc, cost: c + ex, net: inc - c - ex, n: o.length, unpaid: o.filter(x => !x.paid).reduce((a, x) => a + (+x.amount || 0), 0) };
}
function alerts() {
  const a = [];
  live('accounts').forEach(c => {
    if (c.min !== '' && c.min != null && +c.balance < +c.min) a.push(['r', `${c.name}: היתרה ${fmt(c.balance)} נמוכה מהמינימום ${fmt(c.min)}`]);
    if (c.max !== '' && c.max != null && +c.balance > +c.max) a.push(['', `${c.name}: היתרה ${fmt(c.balance)} גבוהה מהמקסימום ${fmt(c.max)}`]);
  });
  // סעיף משתנה שההוצאה בו החודש עברה את התכנון (או קרובה אליו): ירוק עד 85%, אחר כך התראה, ומעל 100% אדום
  const ymNow = today().slice(0, 7), spentNow = {};
  live('tx').filter(t => t.type !== 'income' && ymOf(t) === ymNow).forEach(t => { spentNow[t.cat] = (spentNow[t.cat] || 0) + +t.amount; });
  monthlyPlan().filter(p => !isFixedPlan(p) && p.kind !== 'income' && p.kind !== 'incomeVar' && +p.amount > 0).forEach(p => {
    const sp = spentNow[p.name] || 0, pct = Math.round(sp / +p.amount * 100);
    if (pct >= 100) a.push(['r', `חריגה בסעיף ${p.name}: ${fmt(sp)} מתוך ${fmt(p.amount)} (${pct}%)`]);
    else if (pct >= 85) a.push(['', `${p.name}: ${fmt(sp)} מתוך ${fmt(p.amount)} (${pct}%), קרוב לתקרה`]);
  });
  const td = today(), dayNow = new Date(td + 'T12:00:00');
  live('debts').filter(d => debtInfo(d).rem > 0 && +d.day >= 1 && +d.day <= 31).sort((x, y) => (x.urgency || 99) - (y.urgency || 99)).forEach(d => {
    const ym0 = td.slice(0, 7), pd = [payDate(d, ym0), payDate(d, addMonth(ym0, 1))].find(x => x >= td), due = new Date(pd + 'T12:00:00');
    const n = Math.round((due - dayNow) / 864e5);
    if (n <= ((+d.urgency || 99) <= 2 ? 7 : 3)) a.push([n <= 1 ? 'r' : '', `תשלום חוב ל${d.name}${d.monthly ? ' (' + fmt(d.monthly) + ')' : ''} — ${n === 0 ? 'היום' : 'בעוד ' + n + ' ימים'}`]);
  });
  const fd = +S.settings.fillDay, nd = new Date(td + 'T12:00:00');
  if (fd >= 1 && nd.getDate() >= fd) {
    const pm = new Date(nd.getFullYear(), nd.getMonth() - 1, 15, 12), ym = `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, '0')}`;
    const miss = monthlyPlan().filter(q => !isFixedPlan(q) && !live('tx').some(x => ymOf(x) === ym && x.cat === q.name)).map(q => q.name);
    if (miss.length) a.push(['', `הגיע הזמן למלא את ההוצאות וההכנסות המשתנות של ${ym.slice(5)}/${ym.slice(0, 4)} (חסרים: ${miss.slice(0, 5).join(', ')}${miss.length > 5 ? '…' : ''}). נכנסים ללשונית "חודש" ובוחרים את החודש.`]);
  }
  const old = iso => !iso || (new Date(td) - new Date(iso)) / 864e5 > 60, debtsT = live('debts').filter(x => debtInfo(x).rem > 0 && x.tracks && x.tracks.length);
  debtsT.filter(x => x.tracks.some(k => k.type === 'var') && old(x.tracksUpd)).forEach(x => a.push(['', `עדכן את הריבית במסלולים המשתנים של ${x.name} (לא עודכנו מעל חודשיים) — כפתור 📈 בלשונית חובות`]));
  if (debtsT.some(x => x.tracks.some(k => k.type === 'prime')) && !(S.settings.primeAuto !== false && S.autoPrime) && S.primeInfo !== undefined && old(S.settings.primeUpd)) a.push(['', 'עדכן את ריבית הפריים (המשיכה האוטומטית מבנק ישראל לא פעילה) — לשונית חובות']);
  live('policies').forEach(p => { if (!p.renew) return; const n = Math.round((Date.parse(p.renew) - Date.parse(today())) / 864e5); if (n <= 30) a.push([n <= 7 ? 'r' : '', `ביטוח ${p.name}${p.company ? ' (' + p.company + ')' : ''}: ${n < 0 ? 'עבר מועד החידוש' : n === 0 ? 'מתחדש היום' : 'מתחדש בעוד ' + n + ' ימים'}, כדאי להשוות מחירים`]); });
  const t = today(), soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  live('reminders').forEach(r => { const n = nextDue(r); if (n && n <= soon) a.push([n <= t ? 'r' : '', `תזכורת: ${r.title}${r.amount ? ' (' + fmt(r.amount) + ')' : ''} — ${n === t ? 'היום' : n < t ? 'עבר מועד' : hebDateStr(n) + ' · ' + n.split('-').reverse().join('/')}`]); });
  return a;
}
function nextDue(r) {
  if (!r.date) return null; if (r.repeat === 'none' || !r.repeat) return r.date;
  let d = new Date(r.date + 'T12:00:00'); const t = new Date(today() + 'T00:00:00'); let g = 0;
  while (d < t && g++ < 600) { r.repeat === 'monthly' ? d.setMonth(d.getMonth() + 1) : d.setFullYear(d.getFullYear() + 1); }
  return d.toISOString().slice(0, 10);
}

/* ---------- גרפים ---------- */
function bars(items, o = {}) { // items: [{l, vals:[..]}], series: [{n,c}]
  const mx = Math.max(1, ...items.flatMap(i => i.vals.map(Math.abs))), sr = o.series || [{ c: 'var(--pri)' }];
  return `<div>${o.series ? `<div class="row mut" style="font-size:13px">${sr.map(s => `<span><b style="color:${s.c}">■</b> ${s.n}</span>`).join('')}</div>` : ''}` + items.map(i =>
    `<div style="margin:8px 0"><div class="row"><span class="sp">${esc(i.l)}</span>${i.vals.map((v, k) => `<span class="mut" style="font-size:13px">${fmt(v)}</span>`).join(' · ')}</div>` +
    i.vals.map((v, k) => `<div class="bar" style="margin-top:2px"><i style="width:${Math.abs(v) / mx * 100}%;background:${v < 0 ? 'var(--bad)' : sr[k].c}"></i></div>`).join('') + `</div>`).join('') + `</div>`;
}

/* ---------- מסכים ---------- */
const TABS = [['home', '🏠', 'סקירה'], ['month', '📅', 'חודשי'], ['year', '🗓️', 'שנתי'], ['debts', '💳', 'חובות'], ['bank', '🏦', 'בנק'], ['txs', '🧾', 'תנועות'], ['cls', '🏷️', 'סיווג'], ['biz', '🎨', 'עסקים'], ['maaser', '🌾', 'מעשרות'], ['more', '⚙️', 'עוד']];
const V = {};
// מה אמור היה להיכנס ולצאת עד היום (חודשים שיש בהם נתונים, וגם החודש הנוכחי) מול מה שנכנס ויצא
// מה שהוזן בפועל לפריט שנתי באותה שנה (לפי שם הסעיף)
const yearlyActual = (r, y) => live('tx').filter(t => t.cat === r.name && yearOf(effDate(t)) === y && (t.type === 'income') === (r.kind === 'income')).reduce((a, t) => a + +t.amount, 0);
function toDate(y, s) {
  const now = today().slice(0, 7), by = {};
  if (yearOf(today()) === y) by[now] = { i: 0, e: 0 };
  s.txs.forEach(t => { const m = ymOf(t); if (m > now) return; const r = by[m] ||= { i: 0, e: 0 }; if (t.type === 'income') r.i += +t.amount; else r.e += +t.amount; });
  const pI = planSum('income') + planSum('incomeVar'), pE = planSum('fixed') + planSum('variable') + planSum('consumption') + planSum('charity') + debtMonthly();
  const ms = Object.keys(by).sort(), T = { pi: pI * ms.length, pe: pE * ms.length, i: 0, e: 0 };
  ms.forEach(m => { T.i += by[m].i; T.e += by[m].e; });
  return { by, ms, pI, pE, T };
}
function planVsActual(y, s) {
  const { by, ms, pI, pE, T } = toDate(y, s);
  const now = today().slice(0, 7), mult = m => m ? 1 : ms.length, tag = m => m || 'T', lbl = m => m ? m.slice(5) + '/' + m.slice(0, 4) : 'סה"כ';
  const txsOf = (m, inc) => s.txs.filter(t => (m ? ymOf(t) === m : ymOf(t) <= now) && (t.type === 'income') === inc);
  const row = (l, pi, pe, i, e, m) => { const d = (i - e) - (pi - pe); const k = tag(m), w = lbl(m);
    const cell = (id, fn, v) => `<td class="n">${dd(id + k, fn, fmt(v))}</td>`;
    return `<tr><td>${l}</td>${cell('pv-pi', () => ({ title: `הכנסה מתוכננת — ${w}`, total: fmt(pi), explain: m ? 'ההכנסות החודשיות המתוכננות (קבועות ומשתנות).' : `ההכנסה החודשית המתוכננת כפול ${ms.length} חודשים.`, parts: planParts(true, mult(m)) }), pi)}${cell('pv-i', () => ({ title: `נכנס בפועל — ${w}`, total: fmt(i), ...txPart(txsOf(m, true)) }), i)}${cell('pv-pe', () => ({ title: `הוצאה מתוכננת — ${w}`, total: fmt(pe), explain: m ? 'ההוצאות החודשיות המתוכננות והחזרי החובות.' : `ההוצאה החודשית המתוכננת כפול ${ms.length} חודשים.`, parts: planParts(false, mult(m)) }), pe)}${cell('pv-e', () => ({ title: `יצא בפועל — ${w}`, total: fmt(e), ...txPart(txsOf(m, false)) }), e)}<td class="n ${d < 0 ? 'bad' : 'good'}">${dd('pv-d' + k, () => ({ title: `מול התכנון — ${w}`, total: (d < 0 ? 'חסר ' : 'נשאר ') + fmt(Math.abs(d)), explain: '(נכנס פחות יצא) פחות (הכנסה פחות הוצאה מתוכננות). חיובי = נשאר יותר מהתכנון.', parts: [['נכנס בפועל', i], ['יצא בפועל', -e], ['הכנסה מתוכננת', -pi], ['הוצאה מתוכננת', pe]] }), (d < 0 ? 'חסר ' : 'נשאר ') + fmt(Math.abs(d)))}</td></tr>`; };
  if (!ms.length) return '<span class="mut">עוד אין נתונים</span>';
  return `<div class="scroll"><table><tr><th>חודש</th><th>הכנסה מתוכננת</th><th>נכנס</th><th>הוצאה מתוכננת</th><th>יצא</th><th>מול התכנון</th></tr>${ms.map(m => row(m.slice(5) + '/' + m.slice(0, 4), pI, pE, by[m].i, by[m].e, m)).join('')}<tr class="tot">${row('סה"כ', T.pi, T.pe, T.i, T.e, null).slice(4)}</table></div><p class="mut">התכנון לפי הסעיפים הנוכחיים. "חסר/נשאר" = (נכנס פחות יצא) מול (הכנסה פחות הוצאה מתוכננות).</p>`;
}
V.home = () => {
  const y = curYear, s = yearSummary(y), al = alerts(), inc = s.planInc + s.biz.net, bal = inc - s.planExp;
  const td = toDate(y, s), tdDiff = (td.T.i - td.T.e) - (td.T.pi - td.T.pe);
  const debt = live('debts').reduce((a, d) => a + debtInfo(d).rem, 0), pay = debtMonthly();
  const tithable = monthlyPlan().filter(p => p.kind === 'income' && p.tith).reduce((a, p) => a + +p.amount, 0) * 12, titheDue = tithable * S.settings.tithe / 100, charity = planSum('charity') * 12;
  const ys = years().slice(0, 6).reverse().map(yy => { const q = yearSummary(yy); return { l: yearLabel(yy), vals: [q.aI + q.biz.net, q.aE] }; });
  return `${al.map(a => `<div class="alert ${a[0]}">${esc(a[1])}</div>`).join('')}
  <div class="grid"><div class="kpi"><small>הכנסות מתוכננות לשנה</small><strong>${dd('h-pi', () => ({ title: 'הכנסות מתוכננות לשנה', total: fmt(inc), explain: 'הכנסות חודשיות מתוכננות (קבועות ומשתנות) כפול 12, בתוספת הכנסות שנתיות מתוכננות ורווח עסקי של השנה.', parts: [...planParts(true, 12), ...yrItemsOf(y, true).map(x => [x.name, +x.amount || 0, 'הכנסה שנתית']), ['רווח עסקי', s.biz.net, 'ראו את הפירוט של רווח עסקי']] }), fmt(inc))}</strong></div>
  <div class="kpi"><small>הוצאות מתוכננות לשנה</small><strong>${dd('h-pe', () => ({ title: 'הוצאות מתוכננות לשנה', total: fmt(s.planExp), explain: 'הוצאות חודשיות מתוכננות והחזרי חובות כפול 12, בתוספת הוצאות שנתיות מתוכננות.', parts: [...planParts(false, 12), ...yrItemsOf(y, false).map(x => [x.name, +x.amount || 0, 'הוצאה שנתית'])] }), fmt(s.planExp))}</strong></div>
  <div class="kpi"><small>מאזן שנתי</small><strong class="${bal < 0 ? 'bad' : 'good'}">${dd('h-bal', () => ({ title: 'מאזן שנתי', total: fmt(bal), explain: 'הכנסות מתוכננות פחות הוצאות מתוכננות לשנה (כולל החזרי חובות).', parts: [['הכנסות מתוכננות לשנה', inc], ['הוצאות מתוכננות לשנה', -s.planExp]] }), fmt(bal))}</strong></div>
  <div class="kpi"><small>מאזן חודשי ממוצע</small><strong class="${bal < 0 ? 'bad' : 'good'}">${dd('h-avg', () => ({ title: 'מאזן חודשי ממוצע', total: fmt(bal / 12), explain: 'המאזן השנתי מחולק ב-12 חודשים.', parts: [['מאזן שנתי', bal], ['מחולק ב-12', bal / 12]] }), fmt(bal / 12))}</strong></div></div>
  <div class="card"><h2>בפועל השנה עד היום</h2><div class="grid"><div><small class="mut">נכנס</small><br><b class="good">${dd('h-ai', () => ({ title: 'נכנס בפועל השנה', total: fmt(s.aI), explain: 'כל התנועות שנספרות כהכנסה בשנה: תנועות בנק, ייבוא והזנה ידנית (לפי חודש התקציב שלהן), וכן סכום אוטומטי לסעיפי הכנסה קבועים בחודש שאין בו תנועה בסעיף.', ...txPart(s.txs.filter(t => t.type === 'income')) }), fmt(s.aI))}</b><br><small class="mut">אמור היה להיכנס עד היום ${dd('h-ti', () => ({ title: 'אמור היה להיכנס עד היום', total: fmt(td.T.pi), explain: `ההכנסה החודשית המתוכננת כפול מספר החודשים שחלפו (${td.ms.length}: ${td.ms.map(m => m.slice(5) + '/' + m.slice(0, 4)).join(', ')}).`, parts: planParts(true, td.ms.length) }), fmt(td.T.pi))}</small></div><div><small class="mut">יצא</small><br><b class="bad">${dd('h-ae', () => ({ title: 'יצא בפועל השנה', total: fmt(s.aE), explain: 'כל התנועות שנספרות כהוצאה בשנה: תנועות בנק, ייבוא והזנה ידנית, וכן סכום אוטומטי לסעיפים קבועים והחזרי חובות בחודש שאין בו תנועה בסעיף.', ...txPart(s.txs.filter(t => t.type !== 'income')) }), fmt(s.aE))}</b><br><small class="mut">אמור היה לצאת עד היום ${dd('h-te', () => ({ title: 'אמור היה לצאת עד היום', total: fmt(td.T.pe), explain: `ההוצאה החודשית המתוכננת (כולל החזרי חובות) כפול מספר החודשים שחלפו (${td.ms.length}: ${td.ms.map(m => m.slice(5) + '/' + m.slice(0, 4)).join(', ')}).`, parts: planParts(false, td.ms.length) }), fmt(td.T.pe))}</small></div><div><small class="mut">רווח עסקי</small><br><b>${dd('h-biz', () => { const b = s.biz; return { title: 'רווח עסקי', total: fmt(b.net), explain: 'הכנסות מהזמנות פחות עלות ההזמנות והוצאות העסק של השנה.', parts: [['הכנסות מהזמנות', b.inc], ['עלות הזמנות והוצאות עסק', -b.cost], ...live('bizs').map(x => [x.name, bizProfit(y, x.id).net, 'רווח העסק'])] }; }, fmt(s.biz.net))}</b></div></div>
  <p><b class="${tdDiff < 0 ? 'bad' : 'good'}">מצב נוכחי מול התכנון: ${tdDiff < 0 ? 'חסר ' : 'נשאר '}${fmt(Math.abs(tdDiff))}</b></p></div>
  <div class="card"><h2>תכנון מול בפועל — ${yearLabel(y)}</h2>${planVsActual(y, s)}</div>
  <div class="card"><h2>חובות</h2>סה"כ ${fmt(debt)} · החזר חודשי ${fmt(pay)}${bal < 0 ? `<div class="alert r">אחרי החזרי החובות החודשיים חסרים ${fmt(-bal / 12)} בחודש</div>` : ''}</div>
  <div class="card"><h2>מעשר</h2>הכנסות חייבות: ${fmt(tithable)} · חיוב ${S.settings.tithe}%: ${fmt(titheDue)} · צדקה מתוכננת: ${fmt(charity)}<br><b class="${charity >= titheDue ? 'good' : 'bad'}">${charity >= titheDue ? 'עודף' : 'חסר'}: ${fmt(Math.abs(charity - titheDue))}</b></div>
  <div class="card"><h2>השוואה בין שנים (בפועל)</h2>${ys.length ? bars(ys, { series: [{ n: 'הכנסות', c: 'var(--good)' }, { n: 'הוצאות', c: 'var(--bad)' }] }) : '<span class="mut">עוד אין נתונים</span>'}</div>
  <div class="card"><h2>תחזית</h2>${forecast()}</div>`;
};
function forecast() {
  const y = curYear, s = yearSummary(y), net = (s.planInc + s.biz.net - s.planExp) / 12, ds = live('debts'), bal = ds.reduce((a, d) => a + debtInfo(d).rem, 0), pay = debtMonthly();
  if (!bal) return '<span class="mut">אין חובות רשומים</span>';
  const avail = net - 0; const extra = Math.max(0, avail);
  const mo = pay + extra > 0 ? Math.ceil(bal / (pay + extra)) : null;
  return `אם כל העודף החודשי (${dd('f-x', () => ({ title: 'עודף חודשי', total: fmt(extra), explain: 'המאזן השנתי המתוכנן (הכנסות פחות הוצאות, כולל החזרי חובות) מחולק ב-12. אם הוא שלילי אין עודף להפניה.', parts: [['מאזן שנתי מתוכנן', net * 12], ['מחולק ב-12', net], ['עודף (לא פחות מאפס)', extra]] }), fmt(extra))}) יופנה לחובות, יחד עם ההחזר הקיים (${dd('f-p', () => ({ title: 'החזר חודשי קיים', total: fmt(pay), parts: debtRowsOf().map(([n, v]) => [n, v]) }), fmt(pay))}): ${mo ? `חובות של ${dd('f-b', () => ({ title: 'סה\"כ חובות', total: fmt(bal), parts: ds.map(d => [d.name, debtInfo(d).rem]) }), fmt(bal))} יסתיימו בעוד ~${dd('f-m', () => ({ title: 'חודשים עד סיום החובות', total: String(mo) + ' חודשים', explain: 'יתרת החובות מחולקת בהחזר החודשי בתוספת העודף, מעוגל כלפי מעלה. בלי ריבית.', parts: [['יתרת חובות', bal], ['החזר חודשי קיים', pay], ['עודף מופנה', extra], ['סה\"כ לחודש', pay + extra], ['חודשים (יתרה ÷ סה\"כ לחודש)', mo]] }), String(mo))} חודשים (${(mo / 12).toFixed(1)} שנים)` : 'אין עודף להפניה'}.<br><span class="mut">הערכה פשוטה, בלי ריבית.</span>`;
}
V.month = () => {
  const y = +curMonth.slice(0, 4), months = [...Array(12)].map((_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
  const real = live('tx').filter(t => ymOf(t) === curMonth), txs = [...real, ...autoTxs([curMonth], real)];
  const dbt = live('debts').filter(x => txs.some(t => t.cat === debtCat(x)) || (+x.monthly > 0 && debtInfo(x).rem > 0));
  const names = [...new Set([...monthlyPlan().filter(p => p.kind !== 'income').map(p => p.name), ...live('debts').map(debtCat)])];
  const act = n => txs.filter(t => t.type !== 'income' && t.cat === n).reduce((a, t) => a + +t.amount, 0);
  const sub = subTab.month || 'expense', kinds = sub === 'income' ? ['income', 'incomeVar'] : ['fixed', 'variable', 'consumption', 'charity'];
  const rows = monthlyPlan().filter(p => kinds.includes(p.kind));
  const tI = txs.filter(t => t.type === 'income').reduce((a, t) => a + +t.amount, 0), tE = txs.filter(t => t.type !== 'income').reduce((a, t) => a + +t.amount, 0);
  const other = txs.filter(t => t.type !== 'income' && !names.includes(t.cat)).reduce((a, t) => a + +t.amount, 0);
  return `<div class="row"><select id="mpick" style="width:auto">${months.map(m => `<option value="${m}" ${m === curMonth ? 'selected' : ''}>${m.slice(5)}/${m.slice(0, 4)}</option>`).join('')}</select><span class="mut">${hebMonthOf(curMonth + '-15')} ${hebLabel(hebYearOf(curMonth + '-15'))}</span></div>
  <div class="grid" style="margin-top:8px"><div class="kpi"><small>נכנס בפועל</small><strong class="good">${dd('m-i', () => ({ title: `נכנס בפועל — ${curMonth.slice(5)}/${curMonth.slice(0, 4)}`, total: fmt(tI), ...txPart(txs.filter(t => t.type === 'income')) }), fmt(tI))}</strong></div><div class="kpi"><small>יצא בפועל</small><strong class="bad">${dd('m-e', () => ({ title: `יצא בפועל — ${curMonth.slice(5)}/${curMonth.slice(0, 4)}`, total: fmt(tE), ...txPart(txs.filter(t => t.type !== 'income')) }), fmt(tE))}</strong></div><div class="kpi"><small>הפרש</small><strong>${dd('m-d', () => ({ title: 'הפרש בחודש', total: fmt(tI - tE), explain: 'נכנס פחות יצא באותו חודש.', parts: [['נכנס בפועל', tI], ['יצא בפועל', -tE]] }), fmt(tI - tE))}</strong></div></div>
  <div class="tabs"><button class="${sub === 'expense' ? 'on' : ''}" data-sub="month:expense">הוצאות</button><button class="${sub === 'income' ? 'on' : ''}" data-sub="month:income">הכנסות</button></div>
  ${[[true, 'קבועות — נספרות לבד, אין צורך למלא'], [false, 'משתנות — למלא בכל חודש']].map(([fx, title]) => { const rs = [...rows.filter(p => isFixedPlan(p) === fx), ...(fx && sub === 'expense' ? dbt.map(x => ({ id: x.id, name: debtCat(x), amount: debtInfo(x).next ?? x.monthly, debt: true })) : [])]; return rs.length || !fx ? `<div class="card"><h2>${sub === 'income' ? 'הכנסות' : 'הוצאות'} ${title}</h2>
  <div class="scroll"><table><tr><th>סעיף</th><th>תכנון</th><th>בפועל</th><th></th><th></th></tr>${rs.map(p => {
    const a = sub === 'income' ? txs.filter(t => t.type === 'income' && t.cat === p.name).reduce((x, t) => x + +t.amount, 0) : act(p.name), pct = p.amount ? Math.min(100, a / p.amount * 100) : 0;
    const filled = real.some(t => t.cat === p.name);
    return `<tr><td>${esc(p.name)}${!fx && !filled ? ' <span class="bad">●</span>' : ''}<div class="bar"><i style="width:${pct}%;background:${sub !== 'income' && a > p.amount ? 'var(--bad)' : 'var(--pri)'}"></i></div></td><td class="n">${dd('m-p' + p.id, () => ({ title: `תכנון — ${p.name}`, total: fmt(p.amount), explain: p.debt ? 'החזר חודשי של החוב לפי לוח הסילוקין.' : `${PLAN_KINDS[p.kind] || ''}${fx ? '. סעיף קבוע: נספר אוטומטית בחודש שאין בו תנועה בסעיף.' : '. סעיף משתנה: נספר רק לפי תנועות.'}${p.day ? ' יום בחודש: ' + p.day + '.' : ''}`, parts: [[p.name, +p.amount || 0, 'סכום חודשי מתוכנן']] }), fmt(p.amount))}</td><td class="n">${dd('m-a' + p.id, () => ({ title: `בפועל — ${p.name}`, total: fmt(a), ...txPart(txs.filter(t => t.cat === p.name && (sub === 'income' ? t.type === 'income' : t.type !== 'income'))) }), fmt(a))}</td><td>${canEdit() && !fx ? `${!filled && +p.amount ? `<button class="ic" data-done="${p.id}" title="בוצע כמתוכנן">✓</button>` : ''}<button class="ic" data-fill="${p.id}" title="סכום אחר">＋</button>` : ''}</td><td>${canEdit() ? `<button class="ic" data-edit="${p.debt ? 'debts' : 'plan'}:${p.id}">✏️</button>${delBtn(p.debt ? 'debts' : 'plan', p.id)}` : ''}</td></tr>`;
  }).join('')}${!fx && sub === 'expense' && other ? `<tr><td>אחר (ללא סעיף בתקציב)</td><td></td><td class="n">${fmt(other)}</td><td></td><td></td></tr>` : ''}</table></div>${!fx ? addBtn('plan', 'סעיף חדש', `data-extra='${JSON.stringify({ kind: sub === 'income' ? 'incomeVar' : 'variable' })}'`) + addBtn('plan', 'סעיף קבוע חדש', `data-extra='${JSON.stringify({ kind: sub === 'income' ? 'income' : 'fixed' })}'`) : ''}</div>` : ''; }).join('')}
  <div class="card"><h2>תנועות החודש</h2>${txs.length > real.length ? '<p class="mut">הכנסות והוצאות קבועות נספרות אוטומטית בסכום הקבוע ואינם מופיעים כאן. הזנת תנועה לסעיף מחליפה את הסכום האוטומטי.</p>' : ''}${table('tx', [['date', 'תאריך', '', r => r.date.slice(8) + '/' + r.date.slice(5, 7)], ['cat', 'סעיף'], ['note', 'הערה'], ['amount', 'סכום', 'n', r => (r.type === 'income' ? '+' : '−') + fmt(r.amount)]], real.sort((a, b) => b.date.localeCompare(a.date)))}</div>`;
};
V.year = () => {
  const y = curYear, items = live('yearly').filter(x => !x.year || yrNum(x.year) === y || x.year == y);
  const s = yearSummary(y), by = {}; items.forEach(x => (by[x.month] ||= []).push(x));
  return `<div class="grid"><div class="kpi"><small>הוצאות שנתיות מתוכננות</small><strong>${dd('y-e', () => { const l = items.filter(x => x.kind !== 'income'); return { title: 'הוצאות שנתיות מתוכננות', total: fmt(l.reduce((a, x) => a + +x.amount || 0, 0)), explain: 'סכום הפריטים השנתיים מסוג הוצאה בשנה הנבחרת.', parts: l.map(x => [x.name, +x.amount || 0, x.month]) }; }, fmt(items.filter(x => x.kind !== 'income').reduce((a, x) => a + +x.amount || 0, 0)))}</strong></div><div class="kpi"><small>הכנסות שנתיות מתוכננות</small><strong>${dd('y-i', () => { const l = items.filter(x => x.kind === 'income'); return { title: 'הכנסות שנתיות מתוכננות', total: fmt(l.reduce((a, x) => a + +x.amount || 0, 0)), explain: 'סכום הפריטים השנתיים מסוג הכנסה בשנה הנבחרת.', parts: l.map(x => [x.name, +x.amount || 0, x.month]) }; }, fmt(items.filter(x => x.kind === 'income').reduce((a, x) => a + +x.amount || 0, 0)))}</strong></div><div class="kpi"><small>לחסוך כל חודש לכיסוי</small><strong>${dd('y-m', () => { const t = items.filter(x => x.kind !== 'income').reduce((a, x) => a + +x.amount || 0, 0); return { title: 'לחסוך כל חודש לכיסוי', total: fmt(t / 12), explain: 'ההוצאות השנתיות המתוכננות מחולקות ב-12 חודשים.', parts: [['הוצאות שנתיות מתוכננות', t], ['מחולק ב-12', t / 12]] }; }, fmt(items.filter(x => x.kind !== 'income').reduce((a, x) => a + +x.amount || 0, 0) / 12))}</strong></div></div>
  ${[...HEB_MONTHS, 'כללי'].filter(m => by[m]).map(m => `<div class="card"><h2>${m}</h2>${table('yearly', [['name', 'שם'], ['amount', 'סכום', 'n', r => (r.kind === 'income' ? '+' : '') + fmt(r.amount)], ['done', 'בפועל', 'n', r => { const a = yearlyActual(r, y); return a ? fmt(a) : (canEdit() ? `${+r.amount ? `<button class="ic" data-ydone="${r.id}" title="בוצע כמתוכנן">✓</button>` : ''}<button class="ic" data-yfill="${r.id}" title="סכום אחר">＋</button><span class="bad"> ●</span>` : ''); }]], by[m])}<div class="mut">סה"כ ${fmt(by[m].reduce((a, x) => a + (x.kind === 'income' ? -1 : 1) * (+x.amount || 0), 0))}</div></div>`).join('')}
  ${addBtn('yearly', 'פריט שנתי')}`;
};
V.debts = () => {
  const d = live('debts').sort((a, b) => (a.urgency || 99) - (b.urgency || 99)), inf = x => debtInfo(x), bal = d.reduce((a, x) => a + inf(x).rem, 0), pay = debtMonthly();
  return `<div class="grid"><div class="kpi"><small>סה"כ חובות</small><strong class="bad">${dd('d-bal', () => ({ title: 'סה"כ חובות', total: fmt(bal), explain: 'סכום היתרות שנותרו בכל החובות, לפי לוח הסילוקין (סכום ההתחלה פחות מה ששולם עד היום).', parts: d.map(x => [x.name, inf(x).rem, x.kind || '']) }), fmt(bal))}</strong></div><div class="kpi"><small>החזר חודשי</small><strong>${dd('d-pay', () => ({ title: 'החזר חודשי', total: fmt(pay), explain: 'סכום ההחזרים החודשיים של חובות שיש להם יתרה. נרשם לבד בהוצאות בכל חודש.', parts: debtRowsOf().map(([n, v]) => [n, v]) }), fmt(pay))}</strong></div></div>
  <p class="mut">ההחזר החודשי נרשם לבד בהוצאות בכל חודש ביום ההחזר, והיתרה והתשלומים שנותרו מתעדכנים אוטומטית.</p>
  ${canEdit() ? '<p><button class="b sec" id="mortgage-import">📥 ייבוא פירוט משכנתא מקובץ</button></p>' : ''}
  <div class="card">${table('debts', [['name', 'מלווה'], ['kind', 'סוג'], ['balance', 'נותר', 'n', r => dd('d-r' + r.id, () => ({ title: `יתרה — ${r.name}`, total: fmt(inf(r).rem), explain: 'סכום החוב בתחילת ההחזרים פחות ההחזרים שבוצעו לפי לוח הסילוקין, ועד היום.', parts: [['סכום החוב בתחילת ההחזרים', +r.balance || 0], ['הוחזר עד היום', -((+r.balance || 0) - inf(r).rem), `${(inf(r).pays || []).length} תשלומים`], ['יתרה', inf(r).rem]], txs: live('tx').filter(t => t.cat === debtCat(r)) }), fmt(inf(r).rem))], ['monthly', 'חודשי', 'n', r => fmt(inf(r).next ?? r.monthly)], ['day', 'יום החזר', '', r => r.day ? (r.cal === 'heb' ? 'ה׳ ' : '') + esc(r.day) : ''], ['left', 'תשלומים שנותרו', '', r => inf(r).left || (inf(r).rem > 0 ? '' : '✓')], ['urgency', 'דחיפות'], ['tr', 'ריביות', '', r => canEdit() ? `<button class="ic" data-tracks="${r.id}" title="מסלולי ריבית">📈</button>${r.tracks && r.tracks.length && debtInfo(r).rem > 0 ? `<button class="ic" data-payoff="${r.id}" title="פירעון מוקדם">🏁</button>` : ''}` : '']], d)}${addBtn('debts', 'חוב')}</div>
  ${d.filter(x => x.tracks && x.tracks.length).map(x => { const i = inf(x); return `<div class="card"><h2>${esc(x.name)} — מסלולי ריבית</h2>נותר לפירעון (קרן): <b>${fmt(i.rem)}</b><br>סה"כ החזרים עתידיים: <b>${fmt(i.future)}</b> (מזה ריבית ${fmt(i.interest)})<br>תשלום קרוב: ${fmt(i.next)} · עוד ${i.left} תשלומים${i.endYm ? ' · עד ' + i.endYm.slice(5) + '/' + i.endYm.slice(0, 4) : ''}${mortgagePaidHtml(x)}<br><span class="mut">${x.tracks.map(t => esc(t.name || 'מסלול') + ' ' + ({ prime: 'פריים' + (+t.rate ? (t.rate > 0 ? '+' : '') + t.rate : ''), var: 'משתנה ' + rateAt(t.changes, today().slice(0, 7), +t.rate || 0) + '%', fixed: 'קבועה ' + (+t.rate || 0) + '%' }[t.type])).join(' · ')}</span></div>`; }).join('')}
  <div class="card"><h2>ריבית פריים</h2><p class="mut">חלה על כל מסלולי הפריים בכל החובות. שורה לכל שינוי: חודש וריבית, למשל <b>2026-01 5.5</b>. כרגע: <b>${primeNow()}%</b>.</p><label><input type="checkbox" id="prime-auto" ${S.settings.primeAuto !== false ? 'checked' : ''}> למשוך אוטומטית מבנק ישראל (ריבית בנק ישראל + 1.5%)</label><p class="mut">${S.autoPrime ? (S.primeInfo.builtin ? 'לא הצלחנו למשוך מבנק ישראל, ולכן מוצגת הריבית שנשמרה במערכת (פריים כיום ' + primeNow() + '%). אפשר לתקן ידנית בתיבה למטה: מבטלים את הסימון, כותבים שורה לכל שינוי ושומרים.' : 'מקור: בנק ישראל, עודכן ' + esc((S.primeInfo.fetched || '').slice(0, 10))) : S.primeInfo ? 'המשיכה האוטומטית לא הצליחה' + (S.primeInfo.error ? ' (' + esc(S.primeInfo.error) + ')' : '') + '. משתמשים במה שהוזן ידנית:' : 'טוען...'}</p><textarea id="prime-hist" rows="4" style="width:100%">${esc(S.settings.primeHist || '')}</textarea>${canEdit() ? '<div class="row" style="margin-top:8px"><button class="b" id="prime-save">שמירה</button></div>' : ''}</div><div class="card"><h2>תחזית</h2>${forecast()}</div>`;
};
V.bank = () => {
  const acc = live('accounts');
  return `${alerts().filter(a => a[1].includes('היתרה')).map(a => `<div class="alert ${a[0]}">${esc(a[1])}</div>`).join('')}
  <div class="card">${table('accounts', [['name', 'חשבון'], ['balance', 'יתרה', 'n', r => `<b class="${+r.balance < 0 ? 'bad' : ''}">${fmt(r.balance)}</b>`], ['min', 'מינימום', 'n'], ['max', 'מקסימום', 'n']], acc)}${addBtn('accounts', 'חשבון בנק')}</div>
  <p class="mut">התראות מוצגות בראש המסך ובמסך הסקירה. כשמזינים תנועה ובוחרים חשבון — היתרה מתעדכנת אוטומטית.</p>${netWorthCard()}`;
};
V.biz = () => {
  const bz = live('bizs'); if (!curBiz || !bz.find(b => b.id === curBiz)) curBiz = bz[0]?.id;
  const y = curYear, o = live('orders').filter(x => x.biz === curBiz), e = live('bizExp').filter(x => x.biz === curBiz);
  const yo = o.filter(x => bizYear(x) === y), ye = e.filter(x => bizYear(x) === y), p = bizProfit(y, curBiz), sub = subTab.biz || 'orders';
  const all = years().slice(0, 8).reverse().map(yy => { const q = bizProfit(yy, curBiz); return { l: yearLabel(yy), vals: [q.net] }; }).filter(i => i.vals[0]);
  const unk = o.filter(x => !bizYear(x)).length + e.filter(x => !bizYear(x)).length;
  return `<div class="tabs">${bz.map(b => `<button class="${b.id === curBiz ? 'on' : ''}" data-biz="${b.id}">${esc(b.name)}</button>`).join('')}${addBtn('bizs', 'עסק חדש')}</div>
  ${!curBiz ? '<p class="mut">הוסף עסק כדי להתחיל.</p>' : `
  <div class="grid"><div class="kpi"><small>הכנסות ${yearLabel(y)}</small><strong>${dd('b-i', () => ({ title: `הכנסות העסק ${yearLabel(y)}`, total: fmt(p.inc), explain: 'תשלומים מלקוחות בהזמנות של השנה.', parts: yo.map(x => [x.client || 'הזמנה', +x.amount || 0, [x.date || x.when || '', x.paid ? '' : 'לא שולם'].filter(Boolean).join(' · ')]) }), fmt(p.inc))}</strong></div><div class="kpi"><small>הוצאות</small><strong>${dd('b-c', () => ({ title: `הוצאות העסק ${yearLabel(y)}`, total: fmt(p.cost), explain: 'הוצאות על הזמנות בתוספת הוצאות העסק של השנה.', parts: [...yo.filter(x => +x.cost).map(x => [x.client || 'הזמנה', +x.cost || 0, 'הוצאה על הזמנה']), ...ye.map(x => [x.item || 'הוצאה', +x.amount || 0, x.date || x.when || ''])] }), fmt(p.cost))}</strong></div><div class="kpi"><small>רווח</small><strong class="${p.net < 0 ? 'bad' : 'good'}">${dd('b-n', () => ({ title: 'רווח העסק', total: fmt(p.net), explain: 'הכנסות פחות הוצאות על הזמנות והוצאות העסק.', parts: [['הכנסות', p.inc], ['הוצאות', -p.cost]] }), fmt(p.net))}</strong></div><div class="kpi"><small>ממוצע חודשי</small><strong>${dd('b-a', () => ({ title: 'ממוצע חודשי', total: fmt(p.net / 12), explain: 'הרווח השנתי מחולק ב-12 חודשים.', parts: [['רווח שנתי', p.net], ['מחולק ב-12', p.net / 12]] }), fmt(p.net / 12))}</strong></div><div class="kpi"><small>טרם שולם</small><strong class="bad">${dd('b-u', () => ({ title: 'טרם שולם', total: fmt(p.unpaid), explain: 'הזמנות של השנה שסומנו כלא שולמו.', parts: yo.filter(x => !x.paid).map(x => [x.client || 'הזמנה', +x.amount || 0, x.date || x.when || '']) }), fmt(p.unpaid))}</strong></div></div>
  <div class="tabs">${[['orders', 'הזמנות'], ['exp', 'הוצאות'], ['inv', 'חשבוניות וקבלות'], ['cmp', 'השוואת שנים']].map(t => `<button class="${sub === t[0] ? 'on' : ''}" data-sub="biz:${t[0]}">${t[1]}</button>`).join('')}<button class="on" data-edit="bizs:${curBiz}" style="background:var(--surface);color:var(--text)!important;border:1px solid var(--border)">✏️ פרטי עסק</button></div>
  ${unk ? `<div class="alert">יש ${unk} רשומות בלי שנה מזוהה — הן לא נספרות בשום שנה. ערוך אותן והוסף תאריך.</div>` : ''}
  ${sub === 'orders' ? `<div class="card">${table('orders', [['client', 'לקוח'], ['when', 'מועד', '', r => esc(r.date ? r.date.split('-').reverse().join('/') : r.when)], ['amount', 'תשלום', 'n'], ['cost', 'הוצאות', 'n'], ['paid', 'שולם', '', r => r.paid ? '✓' : '<b class="bad">✗</b>'], ['inv', '', '', r => canEdit() ? `<button class="ic" data-inv="${r.id}" title="הפקת מסמך">🧾</button>` : '']], yo, { sum: 'amount' })}${addBtn('orders', 'הזמנה', `data-extra='${JSON.stringify({ biz: curBiz })}'`)}</div>` : ''}
  ${sub === 'exp' ? `<div class="card">${table('bizExp', [['item', 'הוצאה'], ['when', 'מועד', '', r => esc(r.date ? r.date.split('-').reverse().join('/') : r.when)], ['amount', 'סכום', 'n']], ye, { sum: 'amount' })}${addBtn('bizExp', 'הוצאה', `data-extra='${JSON.stringify({ biz: curBiz })}'`)}</div>` : ''}
  ${sub === 'inv' ? `<div class="card">${table('invoices', [['num', 'מספר'], ['kind', 'סוג'], ['client', 'לקוח'], ['date', 'תאריך'], ['amount', 'סכום', 'n'], ['p', '', '', r => `<button class="ic" data-print="${r.id}">🖨️</button>`]], live('invoices').filter(x => x.biz === curBiz).sort((a, b) => (b.num || 0) - (a.num || 0)))}${addBtn('invoices', 'מסמך חדש', `data-extra='${JSON.stringify({ biz: curBiz, date: today() })}'`)}<p class="mut">לחץ 🧾 ליד הזמנה להפקת מסמך. 🖨️ להדפסה או שמירה כ-PDF. חשוב: בדוק עם רואה החשבון אם נדרש מספר הקצאה או תוכנה מאושרת.</p></div>` : ''}
  ${sub === 'cmp' ? `<div class="card"><h2>רווח לפי שנה</h2>${all.length ? bars(all) : '<span class="mut">אין נתונים</span>'}</div>` : ''}`}`;
};
/* ---------- שווי נקי: נכסים פחות התחייבויות, צילומי מצב לגרף מגמה, וקרן חירום ---------- */
function netWorth() {
  const accs = live('accounts'), as = live('assets'), pos = accs.reduce((a, x) => a + Math.max(0, +x.balance || 0), 0), neg = accs.reduce((a, x) => a + Math.max(0, -(+x.balance || 0)), 0);
  const assets = pos + as.filter(x => x.kind !== 'borrowed').reduce((a, x) => a + (+x.value || 0), 0);
  const loans = live('debts').reduce((a, d) => a + (debtInfo(d).rem || 0), 0), temp = as.filter(x => x.kind === 'borrowed').reduce((a, x) => a + (+x.value || 0), 0);
  const liq = pos + as.filter(x => x.kind === 'cash' || x.kind === 'deposit').reduce((a, x) => a + (+x.value || 0), 0);
  const monthly = monthlyPlan().filter(p => p.kind !== 'income' && p.kind !== 'incomeVar').reduce((a, p) => a + (+p.amount || 0), 0) + live('debts').reduce((a, d) => a + (debtInfo(d).rem > 0 ? +d.monthly || 0 : 0), 0);
  return { assets, liab: loans + temp + neg, net: assets - loans - temp - neg, liq, monthly, loans, temp, neg };
}
function netWorthCard() {
  if (ME.role === 'home') return '';
  const n = netWorth(), snaps = live('snaps').sort((a, b) => String(a.date).localeCompare(b.date)), efM = +S.settings.efMonths || 3, goal = n.monthly * efM, lent = live('assets').filter(x => x.kind === 'lent');
  const row = a => `<tr><td>${esc(a.name)}${a.due ? `<br><span class="mut">עד ${esc(a.due.split('-').reverse().join('/'))}</span>` : ''}</td><td>${esc(ASSET_KINDS[a.kind] || '')}</td><td class="n">${fmt(a.value)}</td><td>${canEdit() ? `<button class="ic" data-edit="assets:${esc(a.id)}">✏️</button>${delBtn('assets', esc(a.id))}` : ''}</td></tr>`;
  return `<div class="card"><h2>שווי נקי</h2>
  <div class="grid"><div class="kpi"><small>נכסים</small><strong class="good">${dd('nw-a', () => ({ title: 'נכסים', total: fmt(n.assets), explain: 'יתרות חיוביות בחשבונות בנק, בתוספת נכסים שהוגדרו (פרט לכסף שלקחת).', parts: [...live('accounts').filter(x => +x.balance > 0).map(x => [x.name, +x.balance, 'יתרת חשבון']), ...live('assets').filter(x => x.kind !== 'borrowed').map(x => [x.name, +x.value || 0, ASSET_KINDS[x.kind] || ''])] }), fmt(n.assets))}</strong></div><div class="kpi"><small>התחייבויות</small><strong class="bad">${dd('nw-l', () => ({ title: 'התחייבויות', total: fmt(n.liab), explain: 'יתרות החובות וההלוואות שנותרו, יתרות חשבון במינוס, וכסף שלקחת.', parts: [...live('debts').filter(d => debtInfo(d).rem > 0).map(d => [d.name, debtInfo(d).rem, 'חוב']), ...live('accounts').filter(x => +x.balance < 0).map(x => [x.name, -(+x.balance), 'יתרה במינוס']), ...live('assets').filter(x => x.kind === 'borrowed').map(x => [x.name, +x.value || 0, 'כסף שלקחת'])] }), fmt(n.liab))}</strong></div><div class="kpi"><small>שווי נקי</small><strong class="${n.net < 0 ? 'bad' : 'good'}">${dd('nw-n', () => ({ title: 'שווי נקי', total: fmt(n.net), explain: 'נכסים פחות התחייבויות.', parts: [['נכסים', n.assets], ['התחייבויות', -n.liab]] }), fmt(n.net))}</strong></div></div>
  <p class="mut">נכסים: יתרות בנק חיוביות ומה שמוגדר למטה. התחייבויות: חובות וסכום ההלוואות שנותר, יתרות בנק במינוס, וכסף שלקחת.</p>
  ${live('assets').length ? `<div class="scroll"><table><tr><th>שם</th><th>סוג</th><th>שווי</th><th></th></tr>${live('assets').map(row).join('')}</table></div>` : ''}${addBtn('assets', 'נכס או כסף שלוויתי')}
  ${canEdit() ? '<button class="b sec" id="nw-snap">📸 שמירת צילום מצב להיום</button>' : ''}
  ${snaps.length > 1 ? `<h3>מגמה</h3>${bars(snaps.slice(-12).map(x => ({ l: String(x.date).split('-').reverse().join('/'), vals: [+x.net || 0] })))}` : snaps.length ? '<p class="mut">נשמר צילום מצב אחד. אחרי עוד אחד יופיע גרף מגמה.</p>' : '<p class="mut">שומרים צילום מצב מדי פעם (למשל פעם בחודש), ומהם נבנה גרף מגמה.</p>'}
  ${lent.length ? `<p>כסף שמגיע לך: <b>${fmt(lent.reduce((a, x) => a + (+x.value || 0), 0))}</b></p>` : ''}
  <h3>קרן חירום</h3><p>הוצאות קבועות ומתוכננות בחודש: ${dd('nw-m', () => ({ title: 'הוצאות חודשיות מתוכננות', total: fmt(n.monthly), explain: 'סכום הסעיפים המתוכננים בהוצאות והחזרי החובות החודשיים. זו הבסיס לחישוב קרן החירום.', parts: [...planRowsOf(EXP_KINDS).map(p => [p.name, +p.amount || 0, PLAN_KINDS[p.kind]]), ...live('debts').filter(d => debtInfo(d).rem > 0 && +d.monthly).map(d => [d.name, +d.monthly || 0, 'החזר חודשי'])] }), fmt(n.monthly))}. יעד: <input id="ef-m" type="number" min="1" max="24" value="${efM}" style="width:60px"> חודשי מחיה = ${fmt(goal)}. נזיל (בנק, מזומן ופיקדונות): <b>${dd('nw-q', () => ({ title: 'נזיל', total: fmt(n.liq), explain: 'יתרות חיוביות בחשבונות בנק, מזומן ופיקדונות.', parts: [...live('accounts').filter(x => +x.balance > 0).map(x => [x.name, +x.balance, 'יתרת חשבון']), ...live('assets').filter(x => x.kind === 'cash' || x.kind === 'deposit').map(x => [x.name, +x.value || 0, ASSET_KINDS[x.kind]])] }), fmt(n.liq))}</b> — ${goal > 0 ? (n.liq >= goal ? '<span class="good">מוגן</span>' : `<span class="bad">חסר ${fmt(goal - n.liq)}</span>`) : ''}</p></div>`;
}
const askCard = () => `<div class="card"><h2>שאל את הבינה על התקציב</h2><p class="mut">הבינה מקבלת רק סיכום מספרי של שלושת החודשים האחרונים לפי סעיף, בלי תיאורי תנועות ובלי שמות עסקים. היא משתמשת במפתח האישי שלך מצ'אט הבינה של האתר.</p>
  <div class="row"><input id="ai-q" placeholder="למשל: איפה אפשר לחסוך החודש?" style="flex:1;min-width:160px" maxlength="400"><button class="b" id="ai-go">שאל</button></div>
  <div class="row" style="margin-top:6px">${['כמה הוצאתי על אוכל החודש?', 'באיזה סעיף אני מוציא הכי הרבה?', 'תן המלצות לחיסכון'].map(q => `<button class="b sec" data-aiq="${esc(q)}">${esc(q)}</button>`).join('')}</div><div id="ai-a" style="white-space:pre-wrap;margin-top:10px"></div></div>`;
async function askAI(q) {
  const out = $('#ai-a'); if (!out) return; out.textContent = 'חושב…';
  try {
    const r = await fetch(API + 'ask', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }, body: JSON.stringify({ q }) });
    const j = await r.json().catch(() => ({})); out.textContent = j.answer || j.error || 'לא התקבלה תשובה';
  } catch { out.textContent = 'אין חיבור, נסה שוב'; }
}
function policiesCard() {
  const t = today(), list = live('policies').sort((a, b) => String(a.renew).localeCompare(b.renew)), yearly = p => (+p.premium || 0) * (p.per === 'month' ? 12 : 1);
  const rows = list.map(p => { const days = p.renew ? Math.round((Date.parse(p.renew) - Date.parse(t)) / 864e5) : null, chg = +p.prev > 0 ? Math.round(((+p.premium) / (+p.prev) - 1) * 100) : null;
    return `<tr><td>${esc(p.name)}<br><span class="mut">${esc(p.company || '')}</span></td><td class="n">${fmt(p.premium)} ${p.per === 'month' ? 'לחודש' : 'לשנה'}${chg ? `<br><span class="${chg > 0 ? 'bad' : 'good'}">${chg > 0 ? 'התייקר' : 'הוזל'} ב-${Math.abs(chg)}%</span>` : ''}</td><td>${p.renew ? esc(p.renew.split('-').reverse().join('/')) : ''}${days !== null ? `<br><span class="${days < 0 ? 'bad' : days <= 30 ? 'warn' : 'mut'}">${days < 0 ? 'עבר המועד' : 'בעוד ' + days + ' ימים'}</span>` : ''}</td><td>${canEdit() ? `<button class="ic" data-renew="${esc(p.id)}" title="חידוש">🔄</button><button class="ic" data-edit="policies:${esc(p.id)}">✏️</button>${delBtn('policies', esc(p.id))}` : ''}</td></tr>`; }).join('');
  return `<div class="card"><h2>ביטוחים</h2>${list.length ? `<p>עלות שנתית כוללת: <b>${dd('p-t', () => ({ title: 'עלות שנתית כוללת של ביטוחים', total: fmt(list.reduce((a, p) => a + yearly(p), 0)), explain: 'פרמיה שנתית לכל פוליסה (פרמיה חודשית כפול 12).', parts: list.map(p => [p.name, yearly(p), `${fmt(+p.premium || 0)} ${p.per === 'month' ? 'לחודש × 12' : 'לשנה'}`]) }), fmt(list.reduce((a, p) => a + yearly(p), 0)))}</b></p><div class="scroll"><table><tr><th>פוליסה</th><th>פרמיה</th><th>חידוש</th><th></th></tr>${rows}</table></div>` : '<p class="mut">אפשר לרשום ביטוחים עם תאריך חידוש, ולקבל התראה חודש לפני.</p>'}${addBtn('policies', 'ביטוח')}</div>`;
}
// כמה צריך להפקיד כל חודש כדי להגיע ליעד בתאריך: הפקדה בסוף כל חודש, עם ריבית חודשית אם הוגדרה
function goalMonthly(g, now = today()) {
  const left = Math.max(0, (+g.target || 0) - (+g.saved || 0)); if (!left) return 0;
  const n = Math.round((Date.parse(g.date) - Date.parse(now)) / (30.44 * 864e5)); if (!(n > 0)) return left;
  const i = (+g.rate || 0) / 1200, grown = (+g.saved || 0) * Math.pow(1 + i, n), need = Math.max(0, (+g.target || 0) - grown);
  return Math.ceil(i > 0 ? need * i / (Math.pow(1 + i, n) - 1) : need / n);
}
const goalsCard = () => `<div class="card"><h2>יעדי חיסכון</h2>${live('goals').length ? `<div class="scroll"><table><tr><th>יעד</th><th>נחסך</th><th>התקדמות</th><th>להפקיד בחודש</th><th></th></tr>${live('goals').map(g => { const pct = Math.min(100, Math.round((+g.saved || 0) / (+g.target || 1) * 100)); return `<tr><td>${esc(g.name)}${g.date ? `<br><span class="mut">עד ${esc(g.date.split('-').reverse().join('/'))}</span>` : ''}</td><td class="n">${fmt(g.saved || 0)} מתוך ${fmt(g.target)}</td><td>${pct}%</td><td class="n">${pct >= 100 ? '✅' : dd('g-' + g.id, () => { const left = Math.max(0, (+g.target || 0) - (+g.saved || 0)), n = g.date ? Math.round((Date.parse(g.date) - Date.parse(today())) / (30.44 * 864e5)) : 0; return { title: `להפקיד בחודש — ${g.name}`, total: fmt(goalMonthly(g)), explain: n > 0 ? 'הסכום הנדרש להפקדה בסוף כל חודש כדי להגיע ליעד בתאריך (עם ריבית שנתית אם הוגדרה, שמגדילה גם את מה שכבר נחסך).' : 'עבר התאריך או לא הוגדר תאריך, ולכן נדרש כל הסכום שנותר.', parts: [['יעד', +g.target || 0], ['נחסך עד היום', -(+g.saved || 0)], ['נותר', left], ['חודשים עד התאריך', n > 0 ? String(n) : 'אין'], ['ריבית שנתית', (+g.rate || 0) + '%']] }; }, fmt(goalMonthly(g)))}</td><td>${canEdit() ? `<button class="ic" data-deposit="${esc(g.id)}" title="הפקדה">＋</button><button class="ic" data-edit="goals:${esc(g.id)}">✏️</button>${delBtn('goals', esc(g.id))}` : ''}</td></tr>`; }).join('')}</table></div>` : '<p class="mut">אפשר להגדיר יעד, למשל חופשה או קרן חירום, ולראות כמה להפקיד בכל חודש כדי להגיע אליו בזמן.</p>'}${addBtn('goals', 'יעד')}</div>`;
/* ---------- בריאות מערכת: מה מחובר, מתי הסנכרון האחרון, וכמה מהתנועות מסווגות ---------- */
let healthTried = false;
function healthCard() {
  const tx = S.data.tx.filter(x => !x.del), real = tx.filter(t => !isDup(t));
  const cards = new Set(), banks = new Set();
  tx.forEach(t => { const co = coOf(t); if (!co) return; (CARD_COS.includes(co) ? cards : banks).add(co + (t.ac ? '·' + t.ac : '')); });
  const accts = live('accounts').filter(a => String(a.id).startsWith('acct-bk-'));
  const uncat = real.filter(t => !t.cat).length, pct = real.length ? Math.round(100 * (real.length - uncat) / real.length) : 0;
  const last = tx.map(t => String(t.date)).sort().pop(), dups = tx.length - real.length;
  const mort = live('debts').find(d => d.kind === 'משכנתא');
  const row = (ok, label, val) => `<tr><td>${ok === null ? '' : ok ? '✅' : '⚠️'}</td><td>${label}</td><td>${val}</td></tr>`;
  const st = SYNC ? (SYNC.status === 'ok' ? 'הושלם' : SYNC.status === 'partial' ? 'הושלם חלקית' : SYNC.status === 'error' ? 'נכשל' : SYNC.status === 'running' ? 'רץ עכשיו' : 'עוד לא היה') : 'טוען...';
  return `<div class="card"><h2>🩺 בריאות המערכת</h2><div class="scroll"><table>
    ${row(SYNC ? !!SYNC.online : null, 'מזרק במחשב', SYNC ? (SYNC.online ? 'פועלת' : 'לא פועלת כרגע') : '...')}
    ${row(SYNC ? SYNC.status === 'ok' : null, 'סנכרון אחרון', `${st}${SYNC && SYNC.run_finished_at ? ' · ' + when(SYNC.run_finished_at) : ''}`)}
    ${row(banks.size > 0, 'חשבונות בנק עם תנועות', banks.size ? [...banks].map(b => esc((BANK_NAMES[b.split('·')[0]] || b.split('·')[0]) + (b.includes('·') ? ' ·' + b.split('·')[1] : ''))).join(', ') : 'אין')}
    ${row(accts.length > 0, 'יתרות בנק מעודכנות', accts.length ? `${accts.length} חשבונות · עודכן ${when(new Date(Math.max(...accts.map(a => +a.u || 0))).toISOString())}` : 'עוד לא נשלחו יתרות')}
    ${row(cards.size > 0, 'כרטיסי אשראי עם תנועות', cards.size ? [...cards].map(b => esc((BANK_NAMES[b.split('·')[0]] || b.split('·')[0]) + (b.includes('·') ? ' ·' + b.split('·')[1] : ''))).join(', ') : 'אין')}
    ${row(!!mort, 'משכנתא', mort ? `מעודכנת ${mort.tracksUpd ? mort.tracksUpd.split('-').reverse().join('/') : ''}` : 'לא נמשכה')}
    ${row(pct >= 80, 'תנועות מסווגות', dd('hl-u', () => ({ title: 'תנועות בלי סעיף', total: `${uncat} מתוך ${real.length}`, explain: `אחוז התנועות המסווגות = (כל התנועות הנספרות פחות אלה בלי סעיף) ÷ כל התנועות הנספרות = ${pct}%.`, txs: real.filter(t => !t.cat) }), `${pct}% (${uncat} בלי סעיף מתוך ${real.length})`))}
    ${row(null, 'תנועה אחרונה', last ? last.slice(0, 10).split('-').reverse().join('/') : '—')}
    ${row(null, 'חיובי כרטיס שלא נספרים (כפילות)', dd('hl-d', () => ({ title: 'תנועות שלא נספרות', total: String(dups), explain: 'כפילויות של חיוב כרטיס מול פירוט הכרטיס, העברות בין חשבונות, תנועות מפוצלות, תנועות שאינן נספרות בתקציב, תנועות שהוסתרו ככפילות או הועברו לדף הייבוא.', txs: tx.filter(isDup) }), String(dups)))}
  </table></div><p class="mut">⚠️ מסמן מקום שכדאי לטפל בו. סנכרון חדש: בלשונית "תנועות".</p></div>`;
}
V.more = () => {
  const st = S.settings;
  return `${healthCard()}${askCard()}${policiesCard()}${goalsCard()}<div class="card"><h2>תזכורות</h2>${table('reminders', [['title', 'מה'], ['date', 'מתי', '', r => { const n = nextDue(r); return n ? hebDateStr(n) + ' · ' + n.split('-').reverse().join('/') : ''; }], ['repeat', 'חזרה', '', r => ({ none: 'פעם', monthly: 'חודשי', yearly: 'שנתי' }[r.repeat || 'none'])]], live('reminders'))}${addBtn('reminders', 'תזכורת')}</div>
  <div class="card"><h2>פרטיות</h2>
  <label class="sw"><input type="checkbox" id="s-priv-a" ${st.privAlways ? 'checked' : ''}><span><b>הסתרת סכומים קבועה</b><small>הסכומים יוצגו כ-•••• תמיד, וגם העין בכותרת לא תחשוף אותם</small></span></label>
  <label class="sw"><input type="checkbox" id="s-priv-d" ${st.privDefault ? 'checked' : ''}><span><b>הסתרת סכומים כברירת מחדל</b><small>בכל פתיחה הסכומים יוצגו כ-•••• עד לחיצה על העין</small></span></label>
  <p class="muted">לחצו 👁 בכותרת כדי להציג או להסתיר סכומים. "קבועה" חוסמת הצגה גם דרך העין. "ברירת מחדל" קובעת רק את המצב ההתחלתי.</p>
  <h3>קוד גישה</h3>
  <div class="sw-row"><span>${st.pin ? 'מוגדר ✓' : 'לא מוגדר'}</span>${st.pin ? '<button class="b sec" id="pin-chg">שנה</button><button class="b sec" id="pin-rm">הסר</button>' : ''}</div>
  <div id="pin-form" ${st.pin ? 'hidden' : ''}><label for="s-pin">קוד חדש (4 עד 8 ספרות)</label><input id="s-pin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"><button class="b" id="pin-set">שמירת קוד</button></div></div>
  <div class="card"><h2>הגדרות</h2><label for="s-fam">שם המשפחה</label><input id="s-fam" value="${esc(st.family)}">
  <label for="s-cal">ספירת שנים</label><select id="s-cal"><option value="heb" ${st.calendar === 'heb' ? 'selected' : ''}>עברית (תשפ"ז)</option><option value="greg" ${st.calendar === 'greg' ? 'selected' : ''}>לועזית (2026)</option></select>
  <label for="s-fill">תזכורת חודשית למלא הוצאות והכנסות משתנות: ביום בחודש (ריק = בלי תזכורת)</label><input id="s-fill" type="number" min="1" max="28" value="${st.fillDay || ''}"><label for="s-dateby">חישוב החודש של תנועה לפי</label><select id="s-dateby"><option value="date" ${st.dateBy !== 'value' ? 'selected' : ''}>תאריך העסקה</option><option value="value" ${st.dateBy === 'value' ? 'selected' : ''}>תאריך הערך או החיוב (כשיש)</option></select><label for="s-acct">חשבון ברירת מחדל להזנת תנועה</label><select id="s-acct"><option value="">ללא (לבחור בכל הזנה)</option><option value="cash" ${st.defaultAcct === 'cash' ? 'selected' : ''}>מזומן</option>${live('accounts').map(a => `<option value="${esc(a.id)}" ${st.defaultAcct === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select><label for="s-tithe">אחוז מעשר</label><input id="s-tithe" type="number" value="${st.tithe}"><label><input id="s-call" type="checkbox" ${st.alertCall ? 'checked' : ''}> בהתראות תקציב לחייג גם בטלפון (לקו ולמספר שהוגדרו בפרופיל)</label><div class="row" style="margin-top:10px"><button class="b" id="s-save">שמירה</button></div></div>
  ${ME.role === 'admin' ? '<div class="card" id="sumit-card"><h2>חיבור לסמיט (הפקת חשבוניות)</h2><div class="mut">טוען…</div></div>' : ''}
  ${window.BUDGET_PEOPLE ? `<div class="card"><h2>חיבורים</h2><div id="conn" class="mut">בודק…</div><p style="margin-top:10px"><a class="btn sec" href="/plans/limits/">📏 הגבלות לפי משתמש</a></p></div>` : ''}
  ${ME.role === 'admin' ? `<div class="card" id="mz-card"><h2>חיבור לתוכנת מזרק</h2><p class="mut">מזרק מושכת את התנועות מהבנקים וחברות האשראי ושולחת אותן לכאן אוטומטית. הדרך הקלה: לוחצים כאן על "יצירת קוד חיבור", מעתיקים את הקוד, ומדביקים אותו בתוכנה (יעד "התקציב שלי"). הקוד כולל גם את כתובת האתר וגם את המפתח.</p><label>שם החיבור</label><input id="mz-name" placeholder="למשל: המחשב בבית"><p><button class="b" id="mz-gen">יצירת קוד חיבור למזרק</button></p><div id="mz-code" class="mut"></div><p class="mut">או, אם יצרתם מפתח בתוך מזרק, מדביקים אותו כאן:</p><label>מפתח החיבור</label><input id="mz-key" dir="ltr" placeholder="mz_..." autocomplete="off"><p><button class="b" id="mz-add">חיבור</button></p><div id="mz-list" class="mut">טוען...</div></div>` : ''}
  ${canEdit() ? `<div class="card">${window.BUDGET_PEOPLE ? `<p><a class="btn sec" href="${esc(window.BUDGET_PEOPLE)}">👥 הרשאות לפי אדם</a></p>` : ''}<h2>גיבוי וייבוא נתונים</h2><p><a class="btn" href="${API}export" download>⬇ גיבוי כל הנתונים לקובץ</a></p><p class="mut">הקובץ מכיל את כל התקציב, ואפשר לשחזר אותו כאן בעזרת "בחירת קובץ". אפשר לבחור גם קובץ תנועות שמופק במזרק, והן ייכנסו בלי כפילויות.</p><label class="btn" style="margin:0">בחירת קובץ<input type="file" id="imp" accept=".json" hidden></label><p class="mut">ייבוא מוסיף לנתונים הקיימים ולא מוחק. הנתונים משותפים לכל משתמשי פרויקט התקציב.</p>${window.BUDGET_CAN_WIPE ? '<button class="b red" id="wipe">מחיקת כל הנתונים</button><p class="mut">מחיקה לצמיתות של כל נתוני התקציב המשותפים לכל משתמשי הפרויקט. אי אפשר לשחזר.</p>' : ''}</div>` : ''}`;
};

/* ---------- ייבוא ---------- */
function importAny(j) {
  if (j && j.docs) { // שחזור מקובץ גיבוי: המזהים נשמרים, ולכן שחזור חוזר לא יוצר כפילויות
    let n = 0; for (const c of COLL) for (const d of j.docs[c] || []) if (d && d.id) { put(c, d); n++; }
    if (j.docs.settings && j.docs.settings.main) { Object.assign(S.settings, j.docs.settings.main); save(); }
    return 'שוחזרו ' + n + ' רשומות';
  }
  if (Array.isArray(j)) { // תנועות מ"מזרק" (כספיון): המזהה נגזר מה-hash, ולכן ייבוא חוזר לא יוצר כפילויות
    let n = 0;
    for (const t of j) {
      const amt = +(t.chargedAmount ?? t.originalAmount); if (!t || !t.hash || !amt) continue;
      put('tx', { id: 'bk-' + t.hash, type: amt < 0 ? 'expense' : 'income', amount: Math.abs(amt), cat: t.category || '', note: [t.description, t.memo].filter(Boolean).join(' - '), date: String(t.date || '').slice(0, 10) || today(), acct: '' });
      n++;
    }
    return 'יובאו ' + n + ' תנועות';
  }
  const by = (o, k) => o[k] || [];
  const add = (c, o) => put(c, { id: uid(), ...o });
  const m = j.monthly || {};
  Object.entries({ income: 'income', fixed: 'fixed', variable: 'variable', consumption: 'consumption', charity: 'charity' }).forEach(([k, kind]) => by(m, k).forEach(p => add('plan', { kind, name: p.name, amount: p.amount, day: p.day || '', tith: kind === 'income', active: true })));
  by(j, 'yearExpense').forEach(x => add('yearly', { kind: 'expense', month: x.month, name: x.name, amount: x.amount, year: '' }));
  by(j, 'yearIncome').forEach(x => add('yearly', { kind: 'income', month: 'כללי', name: x.name, amount: x.amount, year: '' }));
  by(j, 'debts').forEach(d => add('debts', d));
  const b = { id: uid(), name: 'ציור בחול' }; put('bizs', b);
  by(j, 'orders').forEach(o => add('orders', { biz: b.id, client: o.client, when: o.when, year: o.year, amount: o.amount, cost: o.cost, paid: o.paid, note: o.note }));
  by(j, 'bizExpenses').forEach(o => add('bizExp', { biz: b.id, item: o.item, when: o.when, year: o.year, amount: o.amount }));
  return 'הנתונים יובאו';
}

/* ---------- הפקת מסמך ---------- */
function makeInvoice(orderId) {
  const o = live('orders').find(x => x.id === orderId), bz = live('bizs').find(b => b.id === curBiz);
  const m = modal(`<h2>הפקת מסמך</h2><label>סוג</label><select id="ik"><option>חשבון עסקה</option><option>חשבונית</option><option>קבלה</option><option>חשבונית-קבלה</option></select><label>לקוח</label><input id="ic" value="${esc(o.client)}"><label>סכום</label><input id="ia" type="number" value="${o.amount || ''}"><label>תיאור</label><input id="id" value="${esc(o.note || 'תוכנית ציור בחול')}"><div class="row" style="margin-top:14px"><button class="b" id="ok">הפקה</button><button class="b sec" id="no">ביטול</button></div>`);
  m.querySelector('#no').onclick = () => m.remove();
  m.querySelector('#ok').onclick = () => {
    const kind = m.querySelector('#ik').value, mx = Math.max(0, ...live('invoices').filter(i => i.biz === curBiz && i.kind === kind).map(i => +i.num || 0));
    const inv = { id: uid(), biz: curBiz, order: o.id, kind, num: mx + 1, client: m.querySelector('#ic').value, amount: +m.querySelector('#ia').value, desc: m.querySelector('#id').value, date: today() };
    put('invoices', inv); m.remove(); printInv(inv.id); render();
  };
}
function printInv(id) {
  const i0 = live('invoices').find(x => x.id === id), b = live('bizs').find(x => x.id === i0.biz) || {}; let i = i0;
  if (!i.num) { i = { ...i, num: Math.max(0, ...live('invoices').filter(x => x.biz === i.biz && x.kind === i.kind).map(x => +x.num || 0)) + 1 }; put('invoices', i); }
  const txt = `${i.kind} מס' ${i.num}\n${b.name || ''} ${b.taxid ? 'עוסק מס\' ' + b.taxid : ''}\nתאריך: ${i.date.split('-').reverse().join('/')}\nלכבוד: ${i.client}\n${i.desc}\nסה"כ: ${fmt(i.amount)}`;
  const m = modal(`<div style="background:#fff;color:#000;padding:16px;border-radius:10px"><h2>${esc(i.kind)} מס' ${i.num}</h2><p><b>${esc(b.name || '')}</b><br>${esc(b.taxid ? 'עוסק מס\' ' + b.taxid : '')} ${esc(b.phone || '')}<br>${esc(b.address || '')}</p><p>תאריך: ${i.date.split('-').reverse().join('/')}<br>לכבוד: <b>${esc(i.client)}</b></p><table style="color:#000"><tr><th>תיאור</th><th>סכום</th></tr><tr><td>${esc(i.desc)}</td><td>${fmt(i.amount)}</td></tr><tr class="tot" style="color:#000"><td>סה"כ</td><td>${fmt(i.amount)}</td></tr></table></div>${i.sumit ? `<p class="good">הופק בסמיט: מספר ${esc(i.sumit.number)}${i.sumit.draft ? ' (טיוטה)' : ''}${i.sumit.url ? ` · <a href="${esc(i.sumit.url)}" target="_blank" rel="noopener">הורדה</a>` : ''}</p>` : ''}<div class="row" style="margin-top:12px">${!i.sumit && window.BUDGET_SUMIT && window.BUDGET_SUMIT.includes(i.kind) ? `${['קבלה', 'חשבונית-קבלה'].includes(i.kind) ? '<label for="spay" style="margin:0">אמצעי תשלום</label><select id="spay" style="width:auto"><option value="cash">מזומן</option><option value="transfer">העברה בנקאית</option></select>' : ''}<button class="b" id="sm">הפקה בסמיט</button>` : ''}<button class="b sec" id="cp">העתקת הטקסט</button><button class="b sec" id="cps">העתקה להפקה בסמיט</button><button class="b sec" id="cl">סגירה</button></div>`);
  m.querySelector('#cl').onclick = () => m.remove();
  const sm = m.querySelector('#sm');
  if (sm) sm.onclick = async () => {
    sm.disabled = true; sm.textContent = 'מפיק…';
    try {
      const r = await fetch(API + 'sumit', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }, body: JSON.stringify({ kind: i.kind, client: i.client, desc: i.desc, amount: i.amount, date: i.date, payment: (m.querySelector('#spay') || {}).value || 'cash' }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'ההפקה נכשלה');
      put('invoices', { ...i, sumit: { number: j.number, id: j.id, url: j.url, draft: j.draft } }); m.remove(); toast('הופק בסמיט' + (j.draft ? ' (טיוטה)' : '')); render();
    } catch (e) { sm.disabled = false; sm.textContent = 'הפקה בסמיט'; toast(e.message || 'ההפקה נכשלה'); }
  };
  m.querySelector('#cps').onclick = () => navigator.clipboard.writeText(`סוג המסמך: ${i.kind}\nלקוח: ${i.client}\nתיאור: ${i.desc || ''}\nסכום: ${+i.amount || 0}\nתאריך: ${i.date.split('-').reverse().join('/')}`).then(() => toast('הועתק. מדביקים בסמיט'), () => toast('ההעתקה נכשלה'));
  m.querySelector('#cp').onclick = () => navigator.clipboard.writeText(txt).then(() => toast('הועתק'), () => toast('אפשר לצלם מסך'));
}

/* ---------- מסלולי ריבית של חוב ---------- */
function tracksModal(d) {
  if (!d) return;
  const trackHtml = t => `<div class="card trk" style="margin:8px 0"><label>שם המסלול</label><input data-f="name" value="${esc(t.name || '')}">
    <label>סוג</label><select data-f="type">${Object.entries({ fixed: 'ריבית קבועה', prime: 'פריים (עוקב אחרי ריבית הפריים)', var: 'משתנה (מעדכנים בעצמי)' }).map(([a, b]) => `<option value="${a}" ${(t.type || 'fixed') === a ? 'selected' : ''}>${b}</option>`).join('')}</select>
    <label>סכום המסלול בתחילת ההחזרים</label><input data-f="principal" type="number" step="any" value="${esc(t.principal ?? '')}">
    <label>מספר תשלומים חודשיים כולל</label><input data-f="months" type="number" value="${esc(t.months ?? '')}">
    <label>ריבית שנתית % (בפריים: המרווח מהפריים, למשל -0.5)</label><input data-f="rate" type="number" step="any" value="${esc(t.rate ?? '')}">
    <label>חודשי גרייס בתחילת ההלוואה (בלי החזר קרן)</label><input data-f="grace" type="number" min="0" value="${esc(t.grace ?? '')}">
    <label>סוג הגרייס</label><select data-f="graceFull"><option value="">ריבית בלבד (משלמים רק ריבית)</option><option value="1" ${t.graceFull ? 'selected' : ''}>מלא (אין תשלום, והריבית מצטרפת לקרן)</option></select>
    <label>הצמדה למדד, אחוז שנתי משוער (0 אם אין)</label><input data-f="link" type="number" step="any" value="${esc(t.link ?? '')}">
    <label>שינויי ריבית (למסלול משתנה): שורה לכל שינוי, למשל 2026-03 4.7</label><textarea data-f="changes" rows="2" style="width:100%">${esc(t.changes || '')}</textarea>
    <button class="b red" data-rm style="margin-top:6px">הסרת המסלול</button></div>`;
  const m = modal(`<h2>מסלולי ריבית — ${esc(d.name)}</h2><p class="mut">החישוב לפי לוח סילוקין רגיל (שפיצר), בכל חודש מחדש לפי הריבית באותו חודש. תחילת ההחזרים נקבעת בפרטי החוב.</p><div id="trks">${(d.tracks || []).map(trackHtml).join('')}</div>
    <div class="row"><button class="b sec" id="t-add">＋ מסלול</button></div><div class="row" style="margin-top:14px"><button class="b" id="t-ok">שמירה</button><button class="b sec" id="t-no">ביטול</button></div>`);
  const box = m.querySelector('#trks'), wire = () => box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => b.closest('.trk').remove());
  wire();
  m.querySelector('#t-add').onclick = () => { box.insertAdjacentHTML('beforeend', trackHtml({})); wire(); };
  m.querySelector('#t-no').onclick = () => m.remove();
  m.querySelector('#t-ok').onclick = () => {
    const tracks = [...box.querySelectorAll('.trk')].map(c => { const o = {}; c.querySelectorAll('[data-f]').forEach(e => { o[e.dataset.f] = e.value.trim(); }); return o; }).filter(t => +t.principal > 0 && +t.months > 0);
    const nd = { ...d, tracks, tracksUpd: today(), start: d.start || today().slice(0, 7) };
    if (tracks.length) { const i = debtInfo(nd); nd.balance = tracks.reduce((a, t) => a + +t.principal, 0); nd.monthly = Math.round(i.next || 0); nd.end = i.endYm; } else delete nd.end;
    put('debts', nd); m.remove(); render();
  };
}

/* ---------- הזנה מהירה ---------- */
function quickAdd(pre = {}) {
  const names = [...new Set(monthlyPlan().map(p => p.name))], acc = live('accounts');
  const m = modal(`<h2>הזנה מהירה</h2><div class="tabs"><button class="${pre.type === 'income' ? '' : 'on'}" data-t="expense">הוצאה</button><button class="${pre.type === 'income' ? 'on' : ''}" data-t="income">הכנסה</button></div>
  <input id="q-amt" type="number" inputmode="decimal" step="any" placeholder="סכום" style="font-size:28px;text-align:center" autofocus>
  <label>סעיף</label><input id="q-cat" list="q-list" placeholder="בחר או כתוב" value="${esc(pre.cat || '')}"><datalist id="q-list">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
  <label>הערה</label><input id="q-note"><label>תאריך</label><input id="q-date" type="date" value="${pre.date || today()}">
  <label>חשבון</label><select id="q-acc"><option value="">—</option><option value="cash" ${pre.acct === undefined && S.settings.defaultAcct === 'cash' ? 'selected' : ''}>מזומן</option>${acc.map(a => `<option value="${a.id}" ${pre.acct === undefined && S.settings.defaultAcct === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
  <div class="row" style="margin-top:14px"><button class="b" id="ok">שמירה</button><button class="b sec" id="no">ביטול</button></div>`);
  let type = pre.type || 'expense'; m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { type = b.dataset.t; m.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x === b)); });
  m.querySelector('#no').onclick = () => m.remove();
  m.querySelector('#ok').onclick = () => {
    const amt = +m.querySelector('#q-amt').value; if (!amt) return toast('חסר סכום');
    const t = { id: uid(), type, amount: amt, cat: m.querySelector('#q-cat').value.trim(), note: m.querySelector('#q-note').value.trim(), date: m.querySelector('#q-date').value || today(), acct: m.querySelector('#q-acc')?.value || '' };
    put('tx', t);
    if (t.acct && t.acct !== 'cash') { const a = live('accounts').find(x => x.id === t.acct); if (a) put('accounts', { ...a, balance: (+a.balance || 0) + (type === 'income' ? amt : -amt) }); }
    m.remove(); toast('נשמר'); render();
  };
  setTimeout(() => m.querySelector('#q-amt').focus(), 100);
}

/* ---------- סנכרון עם הבנקים (מזרק רץ ברקע במחשב) ---------- */
let SYNC = null;
const syncKey = j => j && [j.online, j.status, j.pending, j.message, j.last_added, j.run_finished_at, JSON.stringify(j.progress)].join('|');
async function syncLoad() {
  try {
    const r = await fetch(API + 'sync-state', { credentials: 'same-origin' }); if (!r.ok) return;
    const prev = SYNC; SYNC = await r.json();
    if (prev && prev.status === 'running' && SYNC.status === 'ok') { await pull(); return; }
    if (tab === 'txs' && syncKey(prev) !== syncKey(SYNC) && !document.activeElement?.matches?.('select,input')) render();
  } catch (e) { /* בלי חיבור */ }
}
setInterval(() => { if (tab === 'txs' && !document.hidden && (!SYNC || SYNC.status === 'running' || SYNC.pending)) syncLoad(); }, 3000);
setInterval(() => { if (tab === 'txs' && !document.hidden) syncLoad(); }, 15000);
const when = iso => iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '';
function syncCard() {
  const j = SYNC; let line;
  if (!j) line = 'טוען...';
  else if (j.status === 'running') line = '⏳ מסנכרן עכשיו מול הבנקים... זה לוקח כמה דקות, והתנועות יופיעו כאן לבד.';
  else if (!j.online) line = `⚠️ התוכנה מזרק לא פועלת כרגע במחשב שלך. היא צריכה להיות דלוקה (היא נפתחת לבד עם Windows ופועלת ברקע). הסנכרון יתחיל ברגע שתתחבר.${j.run_finished_at ? ' הסנכרון האחרון: ' + when(j.run_finished_at) + '.' : ''}`;
  else if (j.pending) line = '⏳ הבקשה נשלחה. מזרק תתחיל לסנכרן בתוך חצי דקה.';
  else if (j.status === 'error') line = `❌ הסנכרון האחרון נכשל (${when(j.run_finished_at)}): ${esc(j.message || 'שגיאה לא ידועה')}`;
  else if (j.status === 'partial') line = `⚠️ הסנכרון האחרון הושלם חלקית (${when(j.run_finished_at)}). מה שהצליח כבר נוסף (${j.last_added || 0} תנועות חדשות). לא הצליח: ${esc(j.message || '')}`;
  else if (j.status === 'ok') line = `✅ הסנכרון האחרון: ${when(j.run_finished_at)}. נוספו ${j.last_added || 0} תנועות חדשות.`;
  else line = '✅ מזרק מחוברת. עוד לא היה סנכרון.';
  const pr = j && j.status === 'running' ? j.progress : null;
  const bar = pr ? `<div class="bar" style="margin:8px 0"><i style="width:${+pr.percent || 0}%"></i></div><p><b>${+pr.percent || 0}%</b> · ${esc(pr.text || '')}</p><ul style="list-style:none;padding:0;margin:0">${(pr.steps || []).map(s => `<li>${{ done: '✅', error: '❌', running: '⏳', waiting: '⏸️' }[s.status] || '⏸️'} ${esc(s.name)}${s.detail ? ' <span class="mut">· ' + esc(s.detail) + '</span>' : ''}</li>`).join('')}</ul>` : '';
  const busy = j && (j.status === 'running' || j.pending);
  return `<div class="card" id="sync-card"><h2>🔄 סנכרון עם הבנקים</h2><p>${line}</p>${bar}${canEdit() ? `<p><button class="b" id="sync-now" ${busy ? 'disabled' : ''}>סנכרן עכשיו</button></p>` : ''}<p class="mut">מזרק פועלת ברקע במחשב שלך ומסנכרנת לבד כל ${j ? j.auto_hours : 6} שעות, כל עוד המחשב דלוק. אין צורך לפתוח אותה.</p></div>`;
}
async function syncSend(mode) {
  try {
    const r = await fetch(API + 'sync-request', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRFToken': csrf(), 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'הבקשה נכשלה');
    SYNC = await r.json(); toast('הבקשה נשלחה'); render();
  } catch (x) { toast(x.message); }
}
// אם בשעה האחרונה הסנכרון הושלם רק חלקית, שואלים: רק מה שלא הצליח (לא מעמיסים על האתרים), או הכל מחדש
function syncNow() {
  const recent = SYNC && SYNC.run_finished_at && (Date.now() - Date.parse(SYNC.run_finished_at)) < 3600e3;
  if (!(SYNC && SYNC.status === 'partial' && recent)) { syncSend(''); return; }
  const m = modal(`<h2>איך לסנכרן?</h2><p class="mut">לפני פחות משעה הסנכרון הושלם חלקית. כדי לא להעמיס על אתרי הבנקים (וכך לא להיחסם), אפשר לסנכרן רק את מה שלא הצליח.</p>
    <div class="row" style="margin-top:12px"><button class="b" id="sy-failed">רק מה שלא הצליח</button><button class="b sec" id="sy-all">סנכרן הכל מחדש</button><button class="b sec" id="sy-no">ביטול</button></div>`);
  m.querySelector('#sy-failed').onclick = () => { m.remove(); syncSend(''); };
  m.querySelector('#sy-all').onclick = () => { m.remove(); syncSend('all'); };
  m.querySelector('#sy-no').onclick = () => m.remove();
}

/* ---------- כל התנועות: סיווג לסעיפים ---------- */
const BANK_NAMES = { hapoalim: 'הפועלים', hapoalimBeOnline: 'הפועלים', isracard: 'ישראכרט', amex: 'אמריקן אקספרס', visaCal: 'ויזה כאל', max: 'מקס', leumiCard: 'לאומי קארד', leumi: 'לאומי', beinleumi: 'הבינלאומי', pagi: 'פאג"י', massad: 'מסד', otsarHahayal: 'אוצר החייל', union: 'איגוד', discount: 'דיסקונט', mizrahi: 'מזרחי', yahav: 'יהב', mercantile: 'מרכנתיל', behatsdaa: 'בהצדעה', beyahadBishvilha: 'ביחד בשבילך' };
// שם הבנק או הכרטיס של תנועה שנקלטה מ"מזרק" (מתוך המזהה שלה), עם 4 ספרות אחרונות של החשבון
const bankOf = t => {
  if (t.bank) return t.bank;
  if (t.acct === 'cash') return 'מזומן';
  if (t.acct) { const a = S.data.accounts.find(x => x.id === t.acct && !x.del); if (a) return a.name; }
  if (t.co) return (BANK_NAMES[t.co] || t.co) + (t.ac ? ' ·' + t.ac : '');
  const p = String(t.id || '').startsWith('bk-') ? t.id.slice(3).split('_') : [];
  if (p.length < 3) return '';
  const co = p[p.length - 2], ac = p[p.length - 1].replace(/\D/g, '').slice(-4);
  return (BANK_NAMES[co] || co) + (ac ? ' ·' + ac : '');
};
const txSel = new Set();
let txf = { month: '', bank: '', q: '', cat: '', none: false, limit: 100 };
// הסעיפים שאפשר לשייך אליהם תנועה: חודשיים, שנתיים וחובות (הכנסות לסעיפי הכנסה)
const catGroups = type => {
  const inc = type === 'income';
  const monthly = monthlyPlan().filter(p => (p.kind === 'income' || p.kind === 'incomeVar') === inc).map(p => p.name);
  const yearly = live('yearly').filter(x => (x.kind === 'income') === inc).map(x => x.name);
  const debts = inc ? [] : live('debts').map(debtCat);
  return [['חודשיות', monthly], ['שנתיות', yearly], ['חובות', debts], [EXTRA_G[0], miscCats()], [EXTRA_G[1], nbCats()]].map(([title, names]) => [title, [...new Set(names)]]).filter(g => g[1].length);
};
// שיוך סעיף לכמה תנועות יחד: רק להן, או גם כלל לתיאורים שלהן (לכל תיאור שונה כלל משלו) שחל גם על דומות שאין להן סעיף ועל עתידיות
async function assignCats(ids, cat, after = render) {
  const list = ids.map(id => S.data.tx.find(t => t.id === id && !t.del)).filter(Boolean);
  if (!list.length) return after();
  if (list.length === 1) return setTxCat(list[0].id, cat, after);
  if (!cat) { list.forEach(t => put('tx', withCat(t, ''))); toast(`הסעיף הוסר מ-${list.length} תנועות`); return after(); }
  const keys = [...new Set(list.map(t => normNote(t.note)).filter(k => k.length >= 3))];
  const similar = () => S.data.tx.filter(x => !x.del && !x.cat && !list.includes(x) && keys.some(k => normNote(x.note).includes(k)));
  const m = modal(`<h2>שיוך ${list.length} תנועות לסעיף "${esc(cat)}"</h2>
    <div class="card"><h3>1. רק לתנועות שנבחרו</h3><button class="b" id="ac-one">עדכן רק את ${list.length} התנועות</button></div>
    <div class="card"><h3>2. הגדרה כללית</h3><p class="mut">ייווצר כלל לכל תיאור שונה בנבחרות (${keys.length} כללים: ${esc(keys.slice(0, 4).join(', '))}${keys.length > 4 ? '…' : ''}). הכללים יחולו גם על ${similar().length} תנועות דומות שאין להן סעיף, ועל תנועות עתידיות.</p><button class="b" id="ac-rule" ${keys.length ? '' : 'disabled'}>צור כללים ועדכן</button></div>
    <div class="row"><button class="b sec" id="ac-no">ביטול</button></div>`);
  m.addEventListener('click', e => { if (e.target === m) after(); });
  m.querySelector('#ac-no').onclick = () => { m.remove(); after(); };
  m.querySelector('#ac-one').onclick = () => { list.forEach(t => put('tx', withCat(t, cat))); m.remove(); toast(`שויכו ${list.length} תנועות`); after(); };
  m.querySelector('#ac-rule').onclick = () => {
    const extra = similar(); let made = 0;
    keys.forEach(k => { const ex = live('rules').find(r => normNote(r.key) === k); put('rules', ex ? { ...ex, cat } : { id: 'r-' + uid(), key: k, cat }); made++; });
    list.concat(extra).forEach(t => put('tx', withCat(t, cat)));
    m.remove(); toast(`נוצרו או עודכנו ${made} כללים, ושויכו ${list.length + extra.length} תנועות`); after();
  };
}
async function setTxCat(id, cat, after = render) {
  const t = S.data.tx.find(x => x.id === id && !x.del);
  if (!t) { toast('התנועה לא נמצאה, נסו לרענן את הדף'); return after(); }
  const note = String(t.note || '').slice(0, 60);
  if (!cat) {
    if (!await ask(`להסיר את הסעיף מהתנועה "${note}"?`)) return after();
    put('tx', withCat(t, cat)); toast('הסעיף הוסר מהתנועה'); return after();
  }
  const key0 = normNote(t.note);
  const m = modal(`<h2>שיוך לסעיף "${esc(cat)}"</h2><p class="mut">${esc(note)} · ${fmt(t.amount)}</p>
    <div class="card"><h3>1. רק לתנועה הזו</h3><label for="sc-one-th">מעשרות לתנועה הזו</label><select id="sc-one-th">${mzTxTitheOpts(t.tithe)}</select><button class="b" id="sc-one">עדכן רק את התנועה הזו</button></div>
    <div class="card"><h3>2. הגדרה כללית לכל התנועות הדומות</h3>
      <label for="sc-key">כל תנועה שהתיאור שלה מכיל:</label><input id="sc-key" value="${esc(key0)}">
      <label><input type="checkbox" id="sc-over"> גם תנועות שכבר משויכות לסעיף אחר (יוחלפו)</label>
      <label for="sc-th">מעשרות</label><select id="sc-th">${mzTitheOpts((live('rules').find(r => normNote(r.key) === normNote(key0)) || {}).tithe || '')}</select>
      <p class="mut" id="sc-count"></p>
      <button class="b" id="sc-rule">צור כלל ועדכן את התנועות</button></div>
    <div class="row"><button class="b sec" id="sc-no">ביטול</button></div>`);
  m.addEventListener('click', e => { if (e.target === m) after(); });
  const matches = () => { const k = normNote(m.querySelector('#sc-key').value), over = m.querySelector('#sc-over').checked; return k ? S.data.tx.filter(x => !x.del && x.id !== t.id && normNote(x.note).includes(k) && (over || !x.cat)) : []; };
  const upd = () => { const n = matches().length, k = normNote(m.querySelector('#sc-key').value); m.querySelector('#sc-count').textContent = k ? `הכלל יחול על התנועה הזו ועל עוד ${n} תנועות${m.querySelector('#sc-over').checked ? '' : ' שאין להן סעיף'}, וגם על תנועות עתידיות.` : 'כתבו מילה מהתיאור.'; m.querySelector('#sc-rule').disabled = !k; };
  m.querySelector('#sc-key').oninput = upd; m.querySelector('#sc-over').onchange = upd; upd();
  m.querySelector('#sc-no').onclick = () => { m.remove(); after(); };
  m.querySelector('#sc-one').onclick = () => { put('tx', { ...withCat(t, cat), tithe: m.querySelector('#sc-one-th').value || undefined }); m.remove(); toast('נשמר: הסעיף עודכן בתנועה הזו בלבד'); after(); };
  m.querySelector('#sc-rule').onclick = () => {
    const key = m.querySelector('#sc-key').value.trim(), list = matches(), nk = normNote(key), ex = live('rules').find(r => normNote(r.key) === nk);
    const th = m.querySelector('#sc-th').value;
    put('rules', { ...(ex || { id: 'r-' + uid(), key }), cat, ...(th ? { tithe: th } : { tithe: undefined }) });
    put('tx', withCat(t, cat)); list.forEach(x => put('tx', withCat(x, cat)));
    m.remove(); toast(`${ex ? 'הכלל עודכן' : 'נוצר כלל'}, והסעיף עודכן ב-${list.length + 1} תנועות`); after();
  };
}
V.txs = () => {
  const all = S.data.tx.filter(x => !x.del && !x.arch).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const months = [...new Set(all.map(ymOf))];
  const banks = [...new Set(all.map(bankOf).filter(Boolean))].sort();
  const q = txf.q.trim();
  const base = all.filter(t => (!txf.month || ymOf(t) === txf.month) && (!txf.bank || bankOf(t) === txf.bank) && (!txf.none || !t.cat) && (!q || `${t.note || ''} ${t.cat || ''} ${t.tags || ''}`.includes(q)));
  // סינון לפי סעיף: שבבים עם סכום לכל סעיף בתנועות המסוננות (הכנסות בשבב נפרד)
  const byCatSum = {}; base.filter(t => !isDup(t)).forEach(t => { const k = t.type === 'income' ? '__inc' : (t.cat || '__none'); byCatSum[k] = (byCatSum[k] || 0) + +t.amount; });
  const topExp = Object.entries(byCatSum).filter(([k]) => k !== '__inc').sort((a, b) => b[1] - a[1]).slice(0, 8);
  const chips = Object.entries(byCatSum).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<button class="chip ${txf.cat === k ? 'on' : ''}" data-txchip="${esc(k)}">${esc(k === '__inc' ? 'הכנסות' : k === '__none' ? 'ללא סעיף' : k)} · ${fmt(v)}</button>`).join('');
  const rows = txf.cat ? base.filter(t => txf.cat === '__inc' ? t.type === 'income' : (txf.cat === '__none' ? (!t.cat && t.type !== 'income') : t.cat === txf.cat)) : base;
  const sum = f => rows.filter(t => !isDup(t) && f(t)).reduce((a, t) => a + +t.amount, 0);
  const inc = sum(t => t.type === 'income'), exp = sum(t => t.type !== 'income'), uncat = all.filter(t => !t.cat && !isDup(t)).length;
  const opts = t => {
    const groups = catGroups(t.type), known = groups.some(g => g[1].includes(t.cat));
    return `<option value="">ללא סעיף (אחר)</option>${t.cat && !known ? `<option value="${esc(t.cat)}" selected>${esc(t.cat)}</option>` : ''}${groups.map(([title, names]) => `<optgroup label="${title}">${names.map(n => `<option value="${esc(n)}" ${n === t.cat ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('')}`;
  };
  return `${syncCard()}<div class="card"><h2>כל התנועות</h2>
  <p class="mut">התנועות מהבנקים וחברות האשראי (מתוכנת מזרק), וגם מה שהזנת ידנית. לכל תנועה בוחרים סעיף: חודשי, שנתי או חוב, וכך היא נכנסת למקום הנכון בתקציב. תנועה בלי סעיף נספרת תחת "אחר".</p>
  <div class="row"><select id="tx-month" style="width:auto"><option value="">כל התקופה</option>${months.map(m => `<option value="${m}" ${m === txf.month ? 'selected' : ''}>${m.slice(5)}/${m.slice(0, 4)}</option>`).join('')}</select>
  <select id="tx-bank" style="width:auto"><option value="">כל החשבונות ביחד</option>${banks.map(b => `<option value="${esc(b)}" ${b === txf.bank ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
  <input id="tx-q" placeholder="חיפוש בתיאור או בסעיף" value="${esc(txf.q)}" style="flex:1;min-width:140px"></div>
  ${canEdit() && txf.bank ? `<p><button class="b sec" id="bk-hide">${hiddenBanks().includes(txf.bank) ? 'ביטול הסתרה: ' : 'הסתרת החשבון מהסיכומים: '}${esc(txf.bank)}</button></p>` : ''}
  ${canEdit() ? '<p><button class="b sec" id="bf-open">⬆ ייבוא מקובץ בנק</button> <button class="b sec" id="tr-open">🔄 העברות בין חשבונות</button> <button class="b sec" id="dp-open">👯 כפילויות מייבוא</button> <button class="b sec" id="src-open">🏦 מקורות בנק</button> <button class="b sec" id="imp-open">' + impLabel() + '</button> <button class="b sec" id="rc-open">🔁 חיובים חוזרים</button> <button class="b sec" id="rl-open">🏷️ כללי סיווג</button> <button class="b sec" id="cats-open">🗂 ניהול קטגוריות</button></p>' : ''}
  <p><label><input type="checkbox" id="tx-none" ${txf.none ? 'checked' : ''}> רק תנועות בלי סעיף (${uncat})</label><br><span class="mut">בחירת סעיף כאן מציעה שתי אפשרויות: לעדכן רק את התנועה הזו, או ליצור כלל לכל התנועות הדומות.</span></p>
  <div class="grid"><div class="kpi"><small>הכנסות</small><strong class="good">${dd('t-i', () => ({ title: 'הכנסות בסינון הנוכחי', total: fmt(inc), explain: 'תנועות הכנסה שמוצגות לפי המסננים (חודש, חשבון, חיפוש, סעיף). לא נספרות העברות בין חשבונות, כפילויות ותנועות שלא נספרות בתקציב.', ...txPart(rows.filter(t => !isDup(t) && t.type === 'income')) }), fmt(inc))}</strong></div><div class="kpi"><small>הוצאות</small><strong class="bad">${dd('t-e', () => ({ title: 'הוצאות בסינון הנוכחי', total: fmt(exp), explain: 'תנועות הוצאה שמוצגות לפי המסננים. לא נספרות העברות בין חשבונות, כפילויות ותנועות שלא נספרות בתקציב.', ...txPart(rows.filter(t => !isDup(t) && t.type !== 'income')) }), fmt(exp))}</strong></div><div class="kpi"><small>הפרש</small><strong>${dd('t-d', () => ({ title: 'הפרש בסינון הנוכחי', total: fmt(inc - exp), explain: 'הכנסות פחות הוצאות בתנועות שמוצגות.', parts: [['הכנסות', inc], ['הוצאות', -exp]] }), fmt(inc - exp))}</strong></div></div>
  ${canEdit() && rows.length ? `<div class="row" style="margin-top:8px"><label><input type="checkbox" id="tx-all"> סימון כל המוצגות</label><select id="tx-bulkcat" style="width:auto"><option value="">סעיף לסימונים…</option>${[...catGroups('expense'), ...catGroups('income').filter(g => !EXTRA_G.includes(g[0])).map(g => [g[0] + ' (הכנסות)', g[1]])].map(([title, names]) => `<optgroup label="${title}">${names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>`).join('')}</select><button class="b sec" id="tx-bulkset">החלה על המסומנות</button><button class="b red" id="tx-bulkdel">מחיקת המסומנות</button></div>` : ''}
  ${topExp.length ? `<div class="card" style="margin:8px 0"><b>הוצאות לפי סעיף</b>${topExp.map(([k, v]) => `<div data-txchip="${esc(k)}" style="cursor:pointer;margin:4px 0"><div style="display:flex;justify-content:space-between;font-size:.9rem"><span>${esc(k === '__none' ? 'ללא סעיף' : k)}</span><span>${fmt(v)}</span></div><div style="background:var(--surface-2,#eef2f7);border-radius:6px;height:8px"><div style="width:${Math.max(2, Math.round(100 * v / topExp[0][1]))}%;height:8px;border-radius:6px;background:var(--primary,#2563eb)"></div></div></div>`).join('')}</div>` : ''}
  <div class="row" style="flex-wrap:wrap;margin:8px 0">${txf.cat ? '<button class="chip" id="tx-chipclear">✕ כל הסעיפים</button>' : ''}${chips}</div>
  ${rows.length ? `<div class="scroll"><table><tr>${canEdit() ? '<th></th>' : ''}<th>תאריך</th><th>חשבון</th><th>תיאור</th><th>סכום</th><th>סעיף</th>${canEdit() ? '<th></th>' : ''}</tr>${rows.slice(0, txf.limit).map(t => `<tr>${canEdit() ? `<td><input type="checkbox" data-sel="${esc(t.id)}" ${txSel.has(t.id) ? 'checked' : ''}></td>` : ''}<td>${esc(String(t.date).slice(8, 10))}/${esc(String(t.date).slice(5, 7))}</td><td>${esc(bankOf(t))}</td><td>${esc(t.note || '')}${t.tags ? ` <span class="mut">#${esc(String(t.tags).split(',').map(x => x.trim()).filter(Boolean).join(' #'))}</span>` : ''}${isDup(t) ? ` <span class="mut">(${t.sp ? 'פוצלה לכמה סעיפים למטה' : t.nb ? 'סומנה כלא נספרת בתקציב' : hiddenBanks().includes(bankOf(t)) ? 'חשבון מוסתר' : t.tr ? 'העברה בין החשבונות שלך' : 'מכוסה בפירוט הכרטיס'}, לא נספר)</span>` : ''}</td><td class="n ${t.type === 'income' ? 'good' : 'bad'}">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</td><td>${canEdit() ? `<select data-txcat="${esc(t.id)}" style="min-width:130px" ${!t.cat && !isDup(t) ? 'class="uncls"' : ''}>${opts(t)}</select>${!t.cat && !isDup(t) ? '<div class="bad" style="font-size:.8rem">● לסווג</div>' : ''}${!isDup(t) ? `<select data-txth="${esc(t.id)}" style="min-width:130px;margin-top:4px;font-size:.85rem" title="האם התנועה נספרת במעשרות">${mzTxTitheOpts(t.tithe)}</select>` : ''}` : esc(t.cat || '—')}</td>${canEdit() ? `<td><button class="ic" data-edit="tx:${esc(t.id)}" title="עריכה">✏️</button>${t.sp ? `<button class="ic" data-unsplit="${esc(t.id)}" title="ביטול פיצול">↩️</button>` : `<button class="ic" data-split="${esc(t.id)}" title="פיצול לכמה סעיפים">✂️</button><button class="ic" data-dup="${esc(t.id)}" title="שכפול">⧉</button>`}${delBtn('tx', esc(t.id))}</td>` : ''}</tr>`).join('')}</table></div>${rows.length > txf.limit ? `<p><button class="b sec" id="tx-more">הצג עוד (${rows.length - txf.limit} נוספות)</button></p>` : ''}` : '<p class="mut">אין תנועות להצגה. אפשר להפעיל את מזרק, או לייבא קובץ בלשונית "עוד".</p>'}
  <p class="mut">סעיף חדש מוסיפים בלשונית "חודשי" או "שנתי", והוא יופיע כאן ברשימה.</p></div>`;
};
/* ---------- ייבוא תנועות מקובץ שהורדו מאתר הבנק או הכרטיס ---------- */
const BF_FIELDS = [['date', 'תאריך', /תאריך\s*(עסקה|רכישה|הפעולה)?$|^תאריך|date/i], ['note', 'תיאור', /תיאור|פרטים|שם\s*בית\s*עסק|בית\s*עסק|תאור|description|merchant/i],
  ['vdate', 'תאריך ערך או חיוב (לא חובה)', /תאריך\s*(ערך|חיוב)|value\s*date/i], ['amount', 'סכום (עמודה אחת)', /סכום|amount|^שקל|₪/i], ['debit', 'חובה (הוצאה)', /^חובה|סכום\s*חובה|debit/i], ['credit', 'זכות (הכנסה)', /^זכות|סכום\s*זכות|credit/i]];
const bfNum = v => { let t = String(v ?? '').trim(); if (!t) return 0; const neg = /^\(.*\)$|^-|-$/.test(t) || /^[−–]/.test(t); const n = parseFloat(t.replace(/[^\d.,]/g, '').replace(/,/g, '')); return Number.isFinite(n) ? (neg ? -n : n) : 0; };
function bfDate(v) {
  const m = String(v || '').match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})|(\d{4})-(\d{1,2})-(\d{1,2})/); if (!m) return '';
  let y, mo, d; if (m[4]) { y = +m[4]; mo = +m[5]; d = +m[6]; } else { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// בקבצי בנק יש לפעמים שורות כותרת לפני הטבלה: הכותרת האמיתית היא השורה הראשונה שיש בה גם תאריך וגם סכום (או חובה/זכות)
function bfTable(text) {
  const lines = String(text || '').split(/\r?\n/), from = lines.slice(0, 15).findIndex(l => /תאריך|date/i.test(l) && /סכום|חובה|זכות|amount|debit|credit/i.test(l) && /[,;\t]/.test(l));
  const t = mgParseTable(from > 0 ? lines.slice(from).join('\n') : text), all = t.headers.length ? [t.headers, ...t.rows] : [];
  const has = (r, i) => r.some(c => BF_FIELDS[i][2].test(c.replace(/["']/g, ''))), at = all.slice(0, 15).findIndex(r => has(r, 0) && (has(r, 3) || has(r, 4) || has(r, 5)));
  return at < 0 ? { headers: [], rows: [] } : { headers: all[at], rows: all.slice(at + 1) };
}
function bfDetect(headers) {
  const used = new Set(), map = {};
  BF_FIELDS.forEach(([k, , re]) => { const i = headers.findIndex((h, n) => !used.has(n) && re.test(h.replace(/["']/g, ''))); map[k] = i; if (i >= 0) used.add(i); });
  if (map.debit >= 0 && map.credit >= 0) map.amount = -1;
  return map;
}
const bfKey = (d, type, amt, note) => `${d}|${type}|${amt.toFixed(2)}|${normNote(note)}`;
// מהשורות והמיפוי: תנועות לייבוא. plusIsExpense: בקובץ עם עמודת סכום אחת, האם סכום חיובי הוא הוצאה (כרטיסי אשראי לרוב)
function bfRows(rows, map, plusIsExpense) {
  const cell = (r, k) => map[k] >= 0 ? r[map[k]] : '', out = [], skipped = [];
  rows.forEach((r, n) => {
    const date = bfDate(cell(r, 'date')), note = String(cell(r, 'note') || '').trim();
    let amt = 0;
    if (map.amount >= 0) { const v = bfNum(cell(r, 'amount')); amt = plusIsExpense ? -v : v; }
    else { const dv = Math.abs(bfNum(cell(r, 'debit'))), cv = Math.abs(bfNum(cell(r, 'credit'))); amt = cv - dv; }
    if (!date || !amt) { if (r.some(Boolean)) skipped.push(n + 1); return; }
    out.push({ date, vd: bfDate(cell(r, 'vdate')), note, type: amt < 0 ? 'expense' : 'income', amount: Math.round(Math.abs(amt) * 100) / 100 });
  });
  // כפילות: תנועה זהה (תאריך, סוג, סכום ותיאור) שכבר קיימת. שתי תנועות זהות בקובץ נספרות כשתיים, ורק מה שכבר קיים נחשב כפול
  const have = {}; S.data.tx.filter(x => !x.del).forEach(t => { const k = bfKey(String(t.date).slice(0, 10), t.type, +t.amount, t.note); have[k] = (have[k] || 0) + 1; });
  out.forEach(t => { const k = bfKey(t.date, t.type, t.amount, t.note); if (have[k] > 0) { have[k]--; t.dup = true; } });
  return { rows: out, skipped };
}
const bfBatches = () => { const g = {}; S.data.tx.filter(t => !t.del && t.imp).forEach(t => { const b = g[t.imp] = g[t.imp] || { id: t.imp, n: 0, from: t.date, to: t.date, bank: t.bank || '', at: t.imp.slice(4, 14) }; b.n++; if (t.date < b.from) b.from = t.date; if (t.date > b.to) b.to = t.date; }); return Object.values(g).sort((a, b) => b.id.localeCompare(a.id)); };
async function bfDecode(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1255').decode(buf); }
}
function bankImport() {
  const banks = [...new Set(S.data.tx.filter(x => !x.del).map(bankOf).filter(Boolean))].sort();
  const m = modal(`<h2>ייבוא תנועות מקובץ בנק</h2>
    <p class="mut">נכנסים לאתר הבנק או הכרטיס, מורידים את התנועות כקובץ CSV (באקסל: "שמירה בשם" ← CSV), ובוחרים אותו כאן. אפשר גם להעתיק טבלה מהאקסל ולהדביק. תנועות שכבר קיימות מסומנות ולא נכנסות שוב.</p>
    <label>שם החשבון או הכרטיס</label><input id="bf-bank" list="bf-banks" placeholder="למשל: הפועלים או ויזה 1234"><datalist id="bf-banks">${banks.map(b => `<option value="${esc(b)}">`).join('')}</datalist>
    <label class="btn sec" style="margin:6px 0">בחירת קובץ CSV<input type="file" id="bf-file" accept=".csv,.txt,.tsv" hidden></label>
    <label>או הדבקה מהאקסל</label><textarea id="bf-text" rows="4" style="width:100%" placeholder="הדביקו כאן את הטבלה, כולל שורת הכותרות"></textarea>
    <div id="bf-map"></div><div id="bf-prev"></div>
    <div class="row" style="margin-top:12px"><button class="b" id="bf-ok" disabled>ייבוא</button><button class="b sec" id="bf-no">סגירה</button></div>
    <div id="bf-hist"></div>`);
  let table = null, map = {}, built = null;
  const hist = () => {
    const bs = bfBatches();
    m.querySelector('#bf-hist').innerHTML = bs.length ? `<h3>ייבואים קודמים</h3><div class="scroll"><table><tr><th>תאריך ייבוא</th><th>חשבון</th><th>תנועות</th><th>טווח</th><th></th></tr>${bs.map(b => `<tr><td>${esc(b.at)}</td><td>${esc(b.bank)}</td><td>${b.n}</td><td>${esc(b.from)} עד ${esc(b.to)}</td><td><button class="b red" data-undo="${esc(b.id)}">ביטול ייבוא</button></td></tr>`).join('')}</table></div>` : '';
    m.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => {
      const ids = S.data.tx.filter(t => t.imp === b.dataset.undo).map(t => t.id);
      if (!confirm(`למחוק ${ids.length} תנועות מהייבוא הזה? אי אפשר לשחזר.`)) return;
      ids.forEach(id => remove('tx', id)); toast(`נמחקו ${ids.length} תנועות`); hist(); render();
    });
  };
  const refresh = () => {
    if (!table) return;
    m.querySelectorAll('[data-bf]').forEach(s => { map[s.dataset.bf] = +s.value; });
    const plus = m.querySelector('#bf-plus')?.value === '1';
    built = bfRows(table.rows, map, plus);
    const fresh = built.rows.filter(t => !t.dup), dup = built.rows.length - fresh.length;
    m.querySelector('#bf-prev').innerHTML = built.rows.length ? `<h3>מה ייובא</h3><p>${fresh.length} חדשות${dup ? `, ${dup} כבר קיימות (לא ייובאו)` : ''}${built.skipped.length ? `, ${built.skipped.length} שורות בלי תאריך או סכום דולגו` : ''}</p>
      <div class="scroll"><table><tr><th>תאריך</th><th>תיאור</th><th>סכום</th><th></th></tr>${built.rows.slice(0, 60).map(t => `<tr${t.dup ? ' style="opacity:.5"' : ''}><td>${esc(t.date)}</td><td>${esc(t.note)}</td><td class="${t.type === 'income' ? 'good' : 'bad'}">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</td><td>${t.dup ? 'כבר קיימת' : 'חדשה'}</td></tr>`).join('')}</table></div>${built.rows.length > 60 ? `<p class="mut">מוצגות 60 הראשונות</p>` : ''}` : '<p class="bad">לא נמצאו תנועות. בדקו שהעמודות מזוהות נכון.</p>';
    m.querySelector('#bf-ok').disabled = !fresh.length;
  };
  const run = text => {
    table = bfTable(text); if (!table.headers.length || !table.rows.length) { table = null; toast('לא זוהתה טבלת תנועות עם תאריך וסכום'); return; }
    map = bfDetect(table.headers);
    const neg = table.rows.some(r => map.amount >= 0 && bfNum(r[map.amount]) < 0);
    m.querySelector('#bf-map').innerHTML = '<h3>זיהוי העמודות</h3>' + BF_FIELDS.map(([k, label]) => `<label>${label}</label><select data-bf="${k}"><option value="-1">—</option>${table.headers.map((h, i) => `<option value="${i}" ${map[k] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`).join('')
      + `<label>בעמודת סכום אחת: סכום חיובי הוא</label><select id="bf-plus"><option value="0" ${neg ? 'selected' : ''}>הכנסה (מינוס הוא הוצאה)</option><option value="1" ${neg ? '' : 'selected'}>הוצאה (כמו בפירוט כרטיס אשראי)</option></select>`;
    m.querySelectorAll('[data-bf],#bf-plus').forEach(s => s.onchange = refresh); refresh();
  };
  m.querySelector('#bf-text').addEventListener('change', e => run(e.target.value));
  m.querySelector('#bf-file').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; if (f.size > 5e6) { toast('הקובץ גדול מדי'); return; } if (/\.xlsx?$/i.test(f.name)) { toast('באקסל: שמירה בשם ← CSV'); return; } const txt = await bfDecode(f); m.querySelector('#bf-text').value = txt; run(txt); });
  m.querySelector('#bf-no').onclick = () => m.remove();
  m.querySelector('#bf-ok').onclick = () => {
    const fresh = (built?.rows || []).filter(t => !t.dup); if (!fresh.length) return;
    const bank = m.querySelector('#bf-bank').value.trim() || 'קובץ בנק', batch = 'imp-' + today() + '-' + Date.now().toString(36);
    // תנועה חדשה מסווגת כמו תנועה דומה שכבר סווגה (אותו תיאור בלי מספרים)
    fresh.forEach((t, i) => put('tx', withCat({ id: `f-${batch.slice(4)}-${i}`, type: t.type, amount: t.amount, note: t.note, date: t.date, ...(t.vd ? { vd: t.vd } : {}), acct: '', bank, imp: batch }, ruleCat(t.note))));
    toast(`יובאו ${fresh.length} תנועות`); built = null; table = null; m.querySelector('#bf-map').innerHTML = ''; m.querySelector('#bf-prev').innerHTML = ''; m.querySelector('#bf-ok').disabled = true; m.querySelector('#bf-text').value = ''; hist(); render();
  };
  hist();
}
/* ---------- העברות בין החשבונות שלך: יציאה מחשבון אחד וכניסה לאחר באותו סכום, ולכן לא הוצאה ולא הכנסה ---------- */
const TR_DAYS = 3;
function trPairs() {
  const tx = S.data.tx.filter(t => !t.del && !t.tr && !dupIds().has(t.id) && bankOf(t));
  const outs = tx.filter(t => t.type !== 'income').sort((a, b) => String(a.date).localeCompare(b.date)), ins = tx.filter(t => t.type === 'income'), used = new Set(), pairs = [];
  outs.forEach(o => {
    const d = Date.parse(o.date); let best = null, gap = Infinity;
    ins.forEach(i => { const g = Math.abs(Date.parse(i.date) - d) / 864e5; if (!used.has(i.id) && bankOf(i) !== bankOf(o) && Math.abs(i.amount - o.amount) < 0.015 && g <= TR_DAYS && g < gap) { best = i; gap = g; } });
    if (best) { used.add(best.id); pairs.push([o, best]); }
  });
  return pairs;
}
function trMarked() {
  const g = {}; S.data.tx.filter(t => !t.del && t.tr).forEach(t => { (g[t.tr] = g[t.tr] || []).push(t); });
  return Object.values(g);
}
function transfers() {
  const m = modal(`<h2>העברות בין החשבונות שלך</h2><p class="mut">העברה בין חשבונות לא נספרת כהוצאה וגם לא כהכנסה. כאן מוצגים זוגות חשודים: יציאה מחשבון אחד וכניסה לחשבון אחר באותו סכום, בהפרש של עד ${TR_DAYS} ימים. מסמנים רק את מה שבאמת העברה שלך.</p><div id="tr-list"></div><div class="row" style="margin-top:12px"><button class="b" id="tr-ok">סימון כהעברה</button><button class="b sec" id="tr-no">סגירה</button></div><div id="tr-done"></div>`);
  let pairs = [];
  const draw = () => {
    pairs = trPairs();
    m.querySelector('#tr-list').innerHTML = pairs.length ? `<div class="scroll"><table><tr><th></th><th>יצא מ</th><th>נכנס ל</th><th>סכום</th><th>תאריכים</th></tr>${pairs.map(([o, i], n) => `<tr><td><input type="checkbox" data-trp="${n}" checked></td><td>${esc(bankOf(o))}</td><td>${esc(bankOf(i))}</td><td class="n">${fmt(o.amount)}</td><td>${esc(String(o.date).slice(5))} ← ${esc(String(i.date).slice(5))}</td></tr>`).join('')}</table></div>` : '<p class="mut">לא נמצאו זוגות חשודים.</p>';
    m.querySelector('#tr-ok').disabled = !pairs.length;
    const done = trMarked();
    m.querySelector('#tr-done').innerHTML = done.length ? `<h3>מסומנות כהעברה (${done.length})</h3><div class="scroll"><table>${done.slice(0, 50).map(g => `<tr><td>${esc(g.map(bankOf).join(' ← '))}</td><td class="n">${fmt(g[0].amount)}</td><td>${esc(String(g[0].date).slice(0, 10))}</td><td><button class="ic" data-trun="${esc(g[0].tr)}" title="ביטול סימון">↩️</button></td></tr>`).join('')}</table></div>` : '';
    m.querySelectorAll('[data-trun]').forEach(b => b.onclick = () => { S.data.tx.filter(t => t.tr === b.dataset.trun).forEach(t => { const { tr, ...rest } = t; put('tx', rest); }); toast('הסימון בוטל'); draw(); render(); });
  };
  m.querySelector('#tr-no').onclick = () => m.remove();
  m.querySelector('#tr-ok').onclick = () => {
    let n = 0; m.querySelectorAll('[data-trp]:checked').forEach(c => { const [o, i] = pairs[+c.dataset.trp], id = 'tr-' + uid(); put('tx', { ...o, tr: id }); put('tx', { ...i, tr: id }); n++; });
    toast(n ? `סומנו ${n} העברות` : 'לא נבחר דבר'); draw(); render();
  };
  draw();
}
/* ---------- כפילויות בין תנועות שיובאו מקובץ לבין תנועות הבנק: אותו אירוע נספר פעמיים ---------- */
const DP_DAYS = 10;
function dupPairs() {
  const live2 = S.data.tx.filter(t => !t.del && !t.tr && !t.sp && !t.dupOf && !t.arch);
  const isBank = t => String(t.id).startsWith('bk-');
  const bank = live2.filter(isBank), imported = live2.filter(t => !isBank(t)).sort((a, b) => String(a.date).localeCompare(b.date)), used = new Set(), pairs = [];
  imported.forEach(i => {
    const d = Date.parse(i.date); let best = null, gap = Infinity;
    bank.forEach(b => {
      if (used.has(b.id) || b.type !== i.type || Math.abs(b.amount - i.amount) > 1) return;
      const g = Math.abs(Date.parse(b.date) - d) / 864e5; if (g <= DP_DAYS && g < gap) { best = b; gap = g; }
    });
    if (best) { used.add(best.id); pairs.push([i, best]); }
  });
  return pairs;
}
function dupFinder() {
  const m = modal(`<h2>כפילויות מייבוא</h2><p class="mut">תנועות שיובאו מקובץ (לא מהבנק) שיש להן תנועה זהה מהבנק: אותו סכום וסוג, בהפרש של עד ${DP_DAYS} ימים. התנועה מהייבוא תוסתר מהספירה (אפשר לבטל), והסעיף שלה יעבור לתנועת הבנק אם לה אין סעיף. בדקו את הרשימה לפני האישור.</p>
    <div id="dp-list"></div><div class="row" style="margin-top:12px"><button class="b" id="dp-ok">הסתר את הנבחרות מהספירה</button><button class="b sec" id="dp-no">סגירה</button></div><div id="dp-done"></div>`);
  let pairs = [];
  const draw = () => {
    pairs = dupPairs();
    m.querySelector('#dp-list').innerHTML = pairs.length ? `<p><b>${pairs.length}</b> כפילויות חשודות</p><div class="scroll"><table><tr><th></th><th>מהייבוא</th><th>מהבנק</th><th>סכום</th></tr>${pairs.map(([i, b], n) => `<tr><td><input type="checkbox" data-dpp="${n}" checked></td><td>${esc(String(i.date).slice(0, 10))} · ${esc(i.note || '')}${i.cat ? ' · <span class="mut">' + esc(i.cat) + '</span>' : ''}</td><td>${esc(String(b.date).slice(0, 10))} · ${esc(b.note || '')}${b.cat ? ' · <span class="mut">' + esc(b.cat) + '</span>' : ''}</td><td class="n">${fmt(i.amount)}</td></tr>`).join('')}</table></div>` : '<p>לא נמצאו כפילויות.</p>';
    m.querySelector('#dp-ok').disabled = !pairs.length;
    const hidden = S.data.tx.filter(t => !t.del && t.dupOf);
    m.querySelector('#dp-done').innerHTML = hidden.length ? `<h3>מוסתרות (${hidden.length})</h3><p><button class="b sec" id="dp-undo-all">שחזור כל המוסתרות</button></p>` : '';
    m.querySelector('#dp-undo-all')?.addEventListener('click', () => { hidden.forEach(t => { const { dupOf, ...rest } = t; put('tx', rest); }); toast('השחזור בוצע'); draw(); render(); });
  };
  m.querySelector('#dp-no').onclick = () => m.remove();
  m.querySelector('#dp-ok').onclick = () => {
    let n = 0; m.querySelectorAll('[data-dpp]:checked').forEach(c => {
      const [i, b] = pairs[+c.dataset.dpp];
      put('tx', { ...i, dupOf: b.id });
      if (i.cat && !b.cat) put('tx', withCat(b, i.cat));
      n++;
    });
    toast(n ? `הוסתרו ${n} כפילויות` : 'לא נבחר דבר'); draw(); render();
  };
  draw();
}
/* ---------- דף הייבוא: תנועות שלא מהבנק. אחרי איפוס הן לא נספרות בתקציב, ומכאן בוחרים מה להחזיר, לתקן או למחוק ---------- */
let impf = { q: '', limit: 200 };
const impLabel = () => { const n = S.data.tx.filter(t => !t.del && t.arch).length; return '📦 דף הייבוא' + (n ? ' (' + n + ')' : ''); };
const isBankTx = t => String(t.id).startsWith('bk-');
const impKeep = () => S.settings.impKeep || [];
// לכל חודש: כמה תנועות מהייבוא נספרות, כמה בדף הייבוא, וכמה תנועות בנק יש בו
function impMonths() {
  const g = {}, row = ym => g[ym] = g[ym] || { ym, counted: 0, arch: 0, bank: 0 };
  S.data.tx.filter(t => !t.del).forEach(t => { const r = row(ymOf(t)); if (isBankTx(t)) r.bank++; else if (t.arch) r.arch++; else r.counted++; });
  return Object.values(g).filter(r => r.counted || r.arch).sort((a, b) => b.ym.localeCompare(a.ym));
}
const impList = () => S.data.tx.filter(t => !t.del && t.arch).sort((a, b) => String(b.date).localeCompare(a.date));
V.imp = () => {
  const all = impList(), q = impf.q.trim(), rows = all.filter(t => !q || `${t.note || ''} ${t.cat || ''}`.includes(q));
  const notBank = S.data.tx.filter(t => !t.del && !t.arch && !isBankTx(t)).length;
  return `<div class="card"><h2>📦 דף הייבוא</h2>
  <p class="mut">התקציב מחושב אוטומטית לפי תנועות הבנק בלבד. תנועות שיובאו מקובץ (ולא הגיעו מהבנק) נשמרות כאן, ואינן נספרות. אפשר להחזיר מהן לספירה, לתקן, למחוק, או להעביר את הסעיפים שלהן לתנועות בנק תואמות.</p>
  <div class="row"><button class="b sec" data-tab="txs">← חזרה לתנועות</button>${canEdit() ? '<button class="b sec" id="imp-plan">📈 תכנון לפי הייבוא</button>' : ''}${canEdit() ? `<button class="b red" id="imp-reset">🧹 איפוס: לחשב לפי הבנק${notBank ? ` (${notBank} תנועות מהייבוא בספירה)` : ''}</button>` : ''}</div></div>
  ${impMonthsCard()}
  <div class="card"><h3>${all.length} תנועות בדף הייבוא</h3>
  <div class="row"><input id="imp-q" placeholder="חיפוש בתיאור או בסעיף" value="${esc(impf.q)}">${canEdit() && all.length ? '<button class="b sec" id="imp-cats">העבר סעיפים לתנועות בנק תואמות</button> <button class="b sec" id="imp-back">החזר לספירה את הנבחרות</button> <button class="b red" id="imp-del">מחק את הנבחרות</button>' : ''}</div>
  ${rows.length ? `<div class="scroll"><table><tr><th><input type="checkbox" id="imp-all"></th><th>תאריך</th><th>תיאור</th><th>סכום</th><th>סעיף</th><th></th></tr>${rows.slice(0, impf.limit).map(t => `<tr><td><input type="checkbox" data-imp="${t.id}"></td><td>${esc(String(t.date).slice(0, 10))}</td><td>${esc(t.note || '')}</td><td class="n">${t.type === 'income' ? '' : '-'}${fmt(t.amount)}</td><td>${esc(t.cat || '')}</td><td>${canEdit() ? `<button class="ic" data-impedit="${t.id}" title="עריכה">✏️</button>` : ''}</td></tr>`).join('')}</table></div>${rows.length > impf.limit ? `<p><button class="b sec" id="imp-more">הצג עוד (${rows.length - impf.limit})</button></p>` : ''}` : '<p class="mut">אין תנועות בדף הייבוא.</p>'}</div>`;
};
function impMonthsCard() {
  const ms = impMonths(); if (!ms.length) return '';
  const years = [...new Set(ms.map(r => r.ym.slice(0, 4)))];
  return `<div class="card"><h3>הייבוא לפי חודשים ושנים</h3>
  <p class="mut">בחודש שיש בו נתוני בנק אפשר להעביר את הייבוא לדף הזה, ובחודש בלי נתוני בנק כדאי להשאיר אותו בספירה. סימון שנה בוחר את כל החודשים שלה. חודש שהוחזר לספירה נשאר בדף הראשי גם אחרי איפוס.</p>
  <div class="scroll"><table><tr><th></th><th>חודש</th><th>בספירה (מהייבוא)</th><th>בדף הייבוא</th><th>תנועות בנק</th><th></th></tr>${years.map(y => `<tr class="tot"><td><input type="checkbox" data-impyear="${y}"></td><td colspan="5"><b>${y}</b></td></tr>` + ms.filter(r => r.ym.startsWith(y)).map(r => `<tr><td><input type="checkbox" data-impm="${r.ym}"></td><td>${r.ym.slice(5)}/${y}</td><td class="n">${r.counted}</td><td class="n">${r.arch}</td><td class="n">${r.bank}</td><td class="mut">${impKeep().includes(r.ym) ? 'נשאר בדף הראשי' : ''}</td></tr>`).join('')).join('')}</table></div>
  ${canEdit() ? '<div class="row" style="margin-top:8px"><button class="b" id="imp-m-back">החזר לספירה (ויישאר בדף הראשי)</button> <button class="b sec" id="imp-m-away">העבר לדף הייבוא</button></div>' : ''}</div>`;
}
function bindImp() {
  const R = $('#app'), picked = () => [...R.querySelectorAll('[data-imp]:checked')].map(c => S.data.tx.find(t => t.id === c.dataset.imp)).filter(Boolean);
  $('#imp-q')?.addEventListener('change', e => { impf.q = e.target.value; impf.limit = 200; render(); });
  $('#imp-more')?.addEventListener('click', () => { impf.limit += 200; render(); });
  $('#imp-all')?.addEventListener('change', e => R.querySelectorAll('[data-imp]').forEach(c => { c.checked = e.target.checked; }));
  R.querySelectorAll('[data-impedit]').forEach(b => b.onclick = () => form('tx', S.data.tx.find(t => t.id === b.dataset.impedit), render));
  R.querySelectorAll('[data-impyear]').forEach(c => c.onchange = () => R.querySelectorAll(`[data-impm^="${c.dataset.impyear}-"]`).forEach(x => { x.checked = c.checked; }));
  const pickedMonths = () => new Set([...R.querySelectorAll('[data-impm]:checked')].map(c => c.dataset.impm));
  const moveMonths = back => {
    const ms = pickedMonths(); if (!ms.size) return toast('לא נבחר חודש');
    let n = 0; S.data.tx.filter(t => !t.del && !isBankTx(t) && ms.has(ymOf(t)) && !!t.arch === back).forEach(t => { if (back) { const { arch, ...rest } = t; put('tx', rest); } else put('tx', { ...t, arch: true }); n++; });
    S.settings.impKeep = back ? [...new Set([...impKeep(), ...ms])] : impKeep().filter(m => !ms.has(m)); save();
    toast(back ? `הוחזרו ${n} תנועות לספירה` : `הועברו ${n} תנועות לדף הייבוא`); render();
  };
  $('#imp-m-back')?.addEventListener('click', () => moveMonths(true));
  $('#imp-m-away')?.addEventListener('click', () => moveMonths(false));
  $('#imp-plan')?.addEventListener('click', planFromImport);
  $('#imp-reset')?.addEventListener('click', () => {
    const m = modal(`<h2>איפוס: לחשב לפי הבנק</h2>
      <p class="mut">שום דבר לא נמחק. אפשר להחזיר הכול מדף הייבוא.</p>
      <p><label><input type="checkbox" id="rs-move" checked> העבר את הייבוא לדף הייבוא, <b>רק בחודשים שיש בהם נתוני בנק</b> (חודשים בלי נתוני בנק וחודשים שהוגדרו להישאר בדף הראשי לא ייגעו)</label></p>
      <p><label><input type="checkbox" id="rs-cats"> אפס גם את הסיווגים של תנועות הבנק לברירת המחדל: סיווג אוטומטי לפי כללי הסיווג בלבד. סיווגים שנקבעו ביד לתנועות בנק יימחקו.</label></p>
      <p><label><input type="checkbox" id="rs-plan" checked> אחרי האיפוס, הצע לעדכן את תכנון ההכנסות וההוצאות לפי הייבוא (בבנק יש רק "בפועל", והתכנון נשאר מהייבוא)</label></p>
      <div class="row" style="margin-top:12px"><button class="b red" id="rs-ok">איפוס</button><button class="b sec" id="rs-no">ביטול</button></div>`);
    m.querySelector('#rs-no').onclick = () => m.remove();
    m.querySelector('#rs-ok').onclick = () => {
      const move = m.querySelector('#rs-move').checked, cats = m.querySelector('#rs-cats').checked;
      let moved = 0, recat = 0;
      if (move) {
        const bankMonths = new Set(S.data.tx.filter(t => !t.del && isBankTx(t)).map(ymOf)), keep = new Set(impKeep());
        S.data.tx.filter(t => !t.del && !t.arch && !isBankTx(t) && bankMonths.has(ymOf(t)) && !keep.has(ymOf(t))).forEach(t => { put('tx', { ...t, arch: true }); moved++; });
      }
      if (cats) S.data.tx.filter(t => !t.del && !t.sp && isBankTx(t)).forEach(t => { const c = ruleCat(t.note); if ((t.cat || '') !== c || (!!t.nb && !nbCats().includes(c))) { put('tx', withCat({ ...t }, c)); recat++; } });
      const plan = m.querySelector('#rs-plan').checked;
      m.remove(); toast(`הועברו ${moved} תנועות לדף הייבוא${cats ? `, אופסו ${recat} סיווגים` : ''}`); render();
      if (plan) setTimeout(planFromImport, 300);
    };
  });
  $('#imp-back')?.addEventListener('click', () => { const l = picked(); if (!l.length) return toast('לא נבחר דבר'); l.forEach(t => { const { arch, ...rest } = t; put('tx', rest); }); toast(`הוחזרו ${l.length} תנועות לספירה`); render(); });
  $('#imp-del')?.addEventListener('click', async () => { const l = picked(); if (!l.length) return toast('לא נבחר דבר'); if (!await ask(`למחוק ${l.length} תנועות לצמיתות?`)) return; l.forEach(t => remove('tx', t.id)); toast('נמחקו'); render(); });
  $('#imp-cats')?.addEventListener('click', async () => {
    const bank = S.data.tx.filter(t => !t.del && !t.tr && !t.sp && isBankTx(t) && !t.cat), used = new Set(), todo = [];
    impList().filter(t => t.cat).forEach(i => {
      const d = Date.parse(i.date); let best = null, gap = Infinity;
      bank.forEach(b => { if (used.has(b.id) || b.type !== i.type || Math.abs(b.amount - i.amount) > 1) return; const g = Math.abs(Date.parse(b.date) - d) / 864e5; if (g <= DP_DAYS && g < gap) { best = b; gap = g; } });
      if (best) { used.add(best.id); todo.push([i, best]); }
    });
    if (!todo.length) return toast('לא נמצאו תנועות בנק תואמות בלי סעיף');
    if (!await ask(`להעביר סעיף ל-${todo.length} תנועות בנק (אותו סכום וסוג, עד ${DP_DAYS} ימים הפרש)?`)) return;
    todo.forEach(([i, b]) => put('tx', withCat(b, i.cat))); toast(`עודכנו ${todo.length} תנועות בנק`); render();
  });
}
/* ---------- הודעה על חודשים שיש בהם גם נתוני בנק וגם ייבוא שנספר, ותכנון לפי הייבוא ---------- */
function impPrompt() {
  if (!canEdit()) return '';
  const ms = impMonths().filter(r => r.bank && r.counted && !impKeep().includes(r.ym));
  if (!ms.length) return '';
  const names = ms.slice(0, 6).map(r => `${r.ym.slice(5)}/${r.ym.slice(0, 4)}`).join(', ') + (ms.length > 6 ? ` ועוד ${ms.length - 6}` : '');
  return `<div class="card" id="ip-card"><h2>🏦 הגיעו נתוני בנק</h2><p>ב${ms.length === 1 ? 'חודש' : '-' + ms.length + ' חודשים'} <b>${names}</b> יש גם תנועות בנק וגם תנועות מהייבוא, ולכן הן נספרות פעמיים. לאפס ${ms.length === 1 ? 'את החודש' : 'את החודשים'} מהייבוא (הייבוא יעבור לדף הייבוא ולא יימחק)?</p>
  <div class="row"><button class="b" id="ip-away">כן, העבר לדף הייבוא</button><button class="b sec" id="ip-keep">לא, השאר בדף הראשי</button><button class="b sec" id="ip-pick">בחירה לפי חודש</button></div></div>`;
}
function bindImpPrompt() {
  const ms = () => impMonths().filter(r => r.bank && r.counted && !impKeep().includes(r.ym)).map(r => r.ym);
  $('#ip-away')?.addEventListener('click', () => { const set = new Set(ms()); let n = 0; S.data.tx.filter(t => !t.del && !t.arch && !isBankTx(t) && set.has(ymOf(t))).forEach(t => { put('tx', { ...t, arch: true }); n++; }); toast(`הועברו ${n} תנועות לדף הייבוא`); render(); });
  $('#ip-keep')?.addEventListener('click', () => { S.settings.impKeep = [...new Set([...impKeep(), ...ms()])]; save(); toast('נשאר בדף הראשי. אפשר לשנות בדף הייבוא'); render(); });
  $('#ip-pick')?.addEventListener('click', () => { tab = 'imp'; render(); scrollTo(0, 0); });
}
const _home = V.home, _txs = V.txs;
V.home = () => impPrompt() + dupNotice() + _home();
V.txs = () => impPrompt() + dupNotice() + _txs();
const _month = V.month;
V.month = () => dupNotice(curMonth) + _month();
// תכנון הכנסות והוצאות לפי הייבוא: בבנק יש רק "בפועל", ולכן הממוצע החודשי מהייבוא (12 החודשים האחרונים שלו) מוצע כתכנון
function planFromImport() {
  const imp = S.data.tx.filter(t => !t.del && !isBankTx(t) && t.cat && !t.tr && !t.sp && !nbCats().includes(t.cat));
  if (!imp.length) return toast('אין בייבוא תנועות עם סעיף');
  const last = imp.map(ymOf).sort().pop(), from = addMonth(last, -11), win = imp.filter(t => ymOf(t) >= from && ymOf(t) <= last);
  const n = new Set(win.map(ymOf)).size || 1, g = {};
  win.forEach(t => { const k = (t.type === 'income' ? 'i|' : 'e|') + t.cat; g[k] = (g[k] || 0) + +t.amount; });
  const rows = Object.entries(g).map(([k, tot]) => { const inc = k[0] === 'i', name = k.slice(2), avg = Math.round(tot / n), ex = monthlyPlan().find(p => p.name === name && (p.kind === 'income' || p.kind === 'incomeVar') === inc); return { inc, name, avg, ex }; }).filter(r => r.avg > 0).sort((a, b) => (b.inc - a.inc) || (b.avg - a.avg));
  const m = modal(`<h2>תכנון לפי הייבוא</h2><p class="mut">ממוצע חודשי לכל סעיף מתוך ${n} חודשי הייבוא האחרונים (עד ${from.slice(5)}/${from.slice(0, 4)}-${last.slice(5)}/${last.slice(0, 4)}). סעיף חדש נוסף כהכנסה או הוצאה משתנה (לא נספר אוטומטית), וסעיף קיים מקבל את הסכום החדש. אפשר לשנות אחר כך בדף התכנון.</p>
    <div class="scroll"><table><tr><th></th><th>סעיף</th><th>סוג</th><th>ממוצע חודשי</th><th>תכנון קיים</th></tr>${rows.map((r, i) => `<tr><td><input type="checkbox" data-pfi="${i}" ${!r.ex || Math.abs(+r.ex.amount - r.avg) > 1 ? 'checked' : ''}></td><td>${esc(r.name)}</td><td>${r.inc ? 'הכנסה' : 'הוצאה'}</td><td class="n">${fmt(r.avg)}</td><td class="n">${r.ex ? fmt(+r.ex.amount) : '<span class="mut">חדש</span>'}</td></tr>`).join('')}</table></div>
    <div class="row" style="margin-top:12px"><button class="b" id="pfi-ok">עדכן את התכנון</button><button class="b sec" id="pfi-no">סגירה</button></div>`);
  m.querySelector('#pfi-no').onclick = () => m.remove();
  m.querySelector('#pfi-ok').onclick = () => {
    let c = 0; m.querySelectorAll('[data-pfi]:checked').forEach(ch => { const r = rows[+ch.dataset.pfi]; put('plan', r.ex ? { ...r.ex, amount: r.avg } : { id: uid(), kind: r.inc ? 'incomeVar' : 'variable', name: r.name, amount: r.avg, active: true }); c++; });
    m.remove(); toast(c ? `עודכנו ${c} סעיפי תכנון` : 'לא נבחר דבר'); render();
  };
}
/* ---------- תנועות שנראות כפולות באותו חודש: אותו חשבון, סכום ותיאור. רק התראה, ההחלטה אצל המשתמש ---------- */
function suspectDups() {
  const g = {};
  live('tx').filter(t => !t.nodup && !t.auto).forEach(t => { const k = [ymOf(t), t.type, (+t.amount).toFixed(2), bankOf(t), normNote(t.note)].join('|'); (g[k] = g[k] || []).push(t); });
  return Object.values(g).filter(a => a.length > 1).map(a => a.sort((x, y) => String(x.date).localeCompare(y.date)));
}
function dupNotice(ym) {
  if (!canEdit()) return '';
  const n = suspectDups().filter(a => !ym || ymOf(a[0]) === ym).length;
  return n ? `<div class="alert y" id="sd-notice">⚠️ ${n} ${n === 1 ? 'תנועה שנראית כפולה' : 'קבוצות של תנועות שנראות כפולות'}${ym ? ' בחודש הזה' : ''} (אותו חשבון, סכום ותיאור באותו חודש). <button class="b sec" data-sd-open>בדיקה</button></div>` : '';
}
function dupSameMonth() {
  const groups = suspectDups().sort((a, b) => ymOf(b[0]).localeCompare(ymOf(a[0])));
  const m = modal(`<h2>תנועות שנראות כפולות</h2><p class="mut">אותו חשבון, סכום ותיאור באותו חודש. תנועות זהות לגמרי יכולות להיות אמיתיות (למשל שתי קניות זהות באותו יום), ולכן ההחלטה שלך: להסתיר את ההעתק מהספירה (אפשר לבטל בדף הייבוא או בכפתור הכפילויות), או לסמן שזו לא כפילות.</p>
    ${groups.length ? `<div class="scroll"><table><tr><th>חודש</th><th>תיאור</th><th>סכום</th><th>תאריכים</th><th></th></tr>${groups.slice(0, 80).map((a, i) => `<tr><td>${ymOf(a[0]).slice(5)}/${ymOf(a[0]).slice(0, 4)}</td><td>${esc(a[0].note || '')} <span class="mut">${esc(bankOf(a[0]))}</span></td><td class="n">${fmt(+a[0].amount)} ×${a.length}</td><td>${a.map(t => esc(String(t.date).slice(8, 10) + '/' + String(t.date).slice(5, 7))).join(', ')}</td><td><button class="b sec" data-sd-hide="${i}">הסתר העתקים</button> <button class="b sec" data-sd-ok="${i}">לא כפילות</button></td></tr>`).join('')}</table></div>${groups.length > 80 ? `<p class="mut">מוצגות 80 הראשונות מתוך ${groups.length}.</p>` : ''}` : '<p>לא נמצאו.</p>'}
    <div class="row" style="margin-top:12px"><button class="b sec" id="sd-close">סגירה</button></div>`);
  m.querySelector('#sd-close').onclick = () => { m.remove(); render(); };
  m.querySelectorAll('[data-sd-hide]').forEach(b => b.onclick = () => { const a = groups[+b.dataset.sdHide]; a.slice(1).forEach(t => put('tx', { ...t, dupOf: a[0].id })); toast(`הוסתרו ${a.length - 1} העתקים`); b.closest('tr').remove(); });
  m.querySelectorAll('[data-sd-ok]').forEach(b => b.onclick = () => { groups[+b.dataset.sdOk].forEach(t => put('tx', { ...t, nodup: true })); toast('סומן שזו לא כפילות'); b.closest('tr').remove(); });
}
/* ---------- פירוט חישוב: לחיצה על כל סיכום פותחת את מרכיביו והתנועות שמהן הוא מורכב ---------- */
const DDB = {};
const dd = (key, fn, html) => { DDB[key] = fn; return `<a class="dd" data-dd="${esc(key)}" role="button" tabindex="0" title="לחצו לפירוט החישוב">${html}</a>`; };
const srcOf = t => t.auto ? 'אוטומטי (מהתכנון)' : String(t.id).startsWith('bk-') ? 'בנק' : 'ייבוא או הזנה ידנית';
const byCatParts = txs => { const g = {}; txs.forEach(t => { const k = t.cat || 'ללא סעיף'; g[k] = (g[k] || 0) + (t.type === 'income' ? 1 : -1) * +t.amount; }); return Object.entries(g).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])); };
const planRowsOf = kinds => monthlyPlan().filter(p => kinds.includes(p.kind));
const yrItemsOf = (y, inc) => live('yearly').filter(x => (x.kind === 'income') === inc && (!x.year || yrNum(x.year) === y || x.year == y));
const debtRowsOf = () => live('debts').map(d => [debtCat(d), debtInfo(d).rem > 0 ? (debtInfo(d).next ?? (+d.monthly || 0)) : 0]).filter(r => r[1]);
const INC_KINDS = ['income', 'incomeVar'], EXP_KINDS = ['fixed', 'variable', 'consumption', 'charity'];
const planParts = (inc, mult, label = '') => inc
  ? planRowsOf(INC_KINDS).map(p => [p.name, (+p.amount || 0) * mult, `${fmt(+p.amount || 0)}${mult > 1 ? ' × ' + mult : ''} · ${PLAN_KINDS[p.kind]}${label}`])
  : [...planRowsOf(EXP_KINDS).map(p => [p.name, (+p.amount || 0) * mult, `${fmt(+p.amount || 0)}${mult > 1 ? ' × ' + mult : ''} · ${PLAN_KINDS[p.kind]}${label}`]), ...debtRowsOf().map(([n, v]) => [n, v * mult, `החזר חודשי${mult > 1 ? ' × ' + mult : ''}`])];
const txPart = (txs, extra = []) => ({ txs, parts: [...extra, ...(txs.some(t => t.auto) ? [['מזה: סכומים אוטומטיים מהתכנון', txs.filter(t => t.auto).reduce((a, t) => a + (t.type === 'income' ? 1 : -1) * +t.amount, 0), 'בחודשים שאין בהם תנועה בסעיף קבוע']] : []), ...byCatParts(txs).map(([c, v]) => [c, v, 'לפי סעיף', c === 'ללא סעיף' ? '' : c])] });
const catOptionsHtml = () => `<option value="">בחירת סעיף…</option><option value="__none">ללא סעיף</option>${[...catGroups('expense').map(([t, n]) => ['הוצאות · ' + t, n]), ...catGroups('income').map(([t, n]) => ['הכנסות · ' + t, n])].map(([t, names]) => `<optgroup label="${esc(t)}">${names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>`).join('')}`;
function openDD(key) {
  if (!DDB[key]) return;
  let openCat, showAll = false, picked = new Set();
  const m = modal('');
  const txTable = (list, cap = 200) => `${canEdit() ? `<div class="row"><b>1.</b> סמנו תנועות <b>2.</b> בחרו סעיף <b>3.</b> <select class="dd-cat" data-ph="בחרו סעיף לשיוך (אפשר להקליד לחיפוש)">${catOptionsHtml()}</select><button class="b dd-assign">שייך את הנבחרות</button></div>` : ''}<div class="scroll"><table><tr>${canEdit() ? '<th><input type="checkbox" class="dd-pall"></th>' : ''}<th>תאריך</th><th>מקור</th><th>תיאור</th><th>סעיף</th><th>סכום</th></tr>${list.slice(0, cap).map(t => `<tr>${canEdit() ? `<td>${t.auto ? '' : `<input type="checkbox" data-ddt="${esc(t.id)}" ${picked.has(t.id) ? 'checked' : ''}>`}</td>` : ''}<td>${esc(String(effDate(t)).slice(0, 10).split('-').reverse().join('/'))}</td><td class="mut">${esc(srcOf(t))}${bankOf(t) ? ' · ' + esc(bankOf(t)) : ''}</td><td>${esc(t.note || '')}</td><td>${esc(t.cat || '')}</td><td class="n ${t.type === 'income' ? 'good' : 'bad'}">${t.type === 'income' ? '+' : '−'}${fmt(+t.amount)}</td></tr>`).join('')}</table></div>${list.length > cap ? `<p class="mut">מוצגות ${cap} הראשונות מתוך ${list.length}.</p>` : ''}`;
  const draw = () => {
    const d = DDB[key](), sorted = (d.txs || []).slice().sort((x, c) => String(effDate(c)).localeCompare(effDate(x)));
    const hasCats = (d.parts || []).some(p => p[3] !== undefined);
    m.firstElementChild.innerHTML = `<h2>${esc(d.title)}</h2><p style="font-size:1.6rem;margin:.2rem 0"><b>${d.total}</b></p>${d.explain ? `<p class="mut">${esc(d.explain)}</p>` : ''}
    ${(d.parts || []).length ? `<h3>מרכיבי החישוב</h3>${hasCats ? '<p class="mut">לחיצה על סעיף פותחת מתחתיו את התנועות שלו, ואפשר לשייך או לשנות סעיף.</p>' : ''}<div class="scroll"><table><tr><th>רכיב</th><th>סכום</th></tr>${d.parts.map(([l, v, note, cat], i) => `<tr ${cat !== undefined ? `class="dd-row" data-ddp="${i}" style="cursor:pointer${openCat === cat ? ';background:var(--soft,#eee)' : ''}"` : String(l).startsWith('מזה') ? 'style="font-style:italic;opacity:.75"' : ''}><td>${cat !== undefined ? (openCat === cat ? '▾ ' : '▸ ') : ''}${esc(l)}${String(l).startsWith('מזה') ? ' (כלול בסעיפים שלמטה)' : ''}${note ? ' <span class="mut">· ' + esc(note) + '</span>' : ''}</td><td class="n">${typeof v === 'number' ? fmt(v) : esc(v)}</td></tr>${cat !== undefined && openCat === cat ? `<tr class="dd-sub"><td colspan="2" data-scope="sub">${txTable(sorted.filter(t => (t.cat || '') === cat))}</td></tr>` : ''}`).join('')}</table></div>` : ''}
    ${sorted.length && !hasCats ? `<h3>${sorted.length} תנועות</h3><div data-scope="all">${txTable(sorted)}</div>` : ''}
    ${sorted.length && hasCats ? (showAll ? `<h3>כל ${sorted.length} התנועות <button class="b sec" id="dd-hideall">הסתר</button></h3><div data-scope="all">${txTable(sorted)}</div>` : `<p><button class="b sec" id="dd-showall">הצג את כל ${sorted.length} התנועות</button></p>`) : ''}
    <div class="row" style="margin-top:12px"><button class="b sec" id="dd-close">סגירה</button></div>`;
    m.querySelector('#dd-close').onclick = () => m.remove();
    m.querySelector('#dd-showall')?.addEventListener('click', () => { showAll = true; draw(); });
    m.querySelector('#dd-hideall')?.addEventListener('click', () => { showAll = false; draw(); });
    m.querySelectorAll('[data-ddp]').forEach(r => r.onclick = () => { const c = d.parts[+r.dataset.ddp][3]; openCat = openCat === c ? undefined : c; picked = new Set(); draw(); });
    m.querySelectorAll('[data-scope]').forEach(box => {
      box.querySelector('.dd-pall')?.addEventListener('change', e => box.querySelectorAll('[data-ddt]').forEach(c => { c.checked = e.target.checked; }));
      box.querySelectorAll('[data-ddt]').forEach(c => c.onchange = () => { if (c.checked) picked.add(c.dataset.ddt); else picked.delete(c.dataset.ddt); });
      box.querySelector('.dd-assign')?.addEventListener('click', () => {
        const v = box.querySelector('.dd-cat').value, ids = [...box.querySelectorAll('[data-ddt]:checked')].map(c => c.dataset.ddt);
        if (!ids.length) return toast('סמנו קודם את התנועות לשיוך (התיבות בצד הטבלה)');
        if (!v) { toast('בחרו סעיף מהרשימה שליד הכפתור'); const si = box.querySelector('.dd-cat').parentElement.querySelector('input'); (si || box.querySelector('.dd-cat')).focus(); return; }
        const cat = v === '__none' ? '' : v;
        assignCats(ids, cat, () => { picked = new Set(); render(); draw(); });
      });
    });
  };
  draw();
}
/* ---------- מקורות בנק: כל חשבון או כרטיס שמהם הגיעו תנועות. אפשר להסתיר מקור מהסיכומים, או למחוק את כל התנועות של מקור אחד ---------- */
function bankSources() {
  const g = {}, seen = {};
  S.data.tx.filter(t => !t.del && isBankTx(t)).forEach(t => {
    const k = bankOf(t) || 'לא ידוע', r = g[k] = g[k] || { k, n: 0, from: '9999', to: '', ids: [], shared: 0 }, d = String(t.date).slice(0, 10);
    r.n++; r.ids.push(t.id); if (d < r.from) r.from = d; if (d > r.to) r.to = d;
    const key = [d, t.type, (+t.amount).toFixed(2), t.ac || '', normNote(t.note)].join('|');
    (seen[key] = seen[key] || new Set()).add(k);
  });
  // אותה תנועה (יום, סכום, תיאור וספרות חשבון) שמופיעה ביותר ממקור אחד: אולי אותו חשבון שהוגדר פעמיים
  S.data.tx.filter(t => !t.del && isBankTx(t)).forEach(t => { const key = [String(t.date).slice(0, 10), t.type, (+t.amount).toFixed(2), t.ac || '', normNote(t.note)].join('|'); if (seen[key].size > 1) g[bankOf(t) || 'לא ידוע'].shared++; });
  return Object.values(g).sort((a, b) => b.n - a.n);
}
function bankSourcesModal() {
  const m = modal(`<h2>מקורות בנק</h2><p class="mut">כל חשבון או כרטיס שמהם הגיעו תנועות. הסתרה מוציאה מקור מכל הסיכומים (אפשר לבטל). מחיקה מסירה את כל התנועות שלו לצמיתות. אם החשבון עדיין פעיל בסנכרון, התנועות יחזרו בסריקה הבאה, ולכן קודם מכבים אותו בהגדרות הסנכרון. מקור שמוצגות לידו תנועות זהות במקור אחר עשוי להיות אותו חשבון שהוגדר פעמיים.</p><div id="src-list"></div><div class="row" style="margin-top:12px"><button class="b sec" id="src-close">סגירה</button></div>`);
  const draw = () => {
    const rows = bankSources();
    m.querySelector('#src-list').innerHTML = rows.length ? `<div class="scroll"><table><tr><th>מקור</th><th>תנועות</th><th>תקופה</th><th>זהות במקור אחר</th><th></th></tr>${rows.map((r, i) => `<tr><td>${esc(r.k)}${hiddenBanks().includes(r.k) ? ' <span class="mut">(מוסתר מהסיכומים)</span>' : ''}</td><td class="n">${r.n}</td><td>${esc(r.from.slice(0, 7).split('-').reverse().join('/'))} - ${esc(r.to.slice(0, 7).split('-').reverse().join('/'))}</td><td class="n">${r.shared ? `<b class="bad">${r.shared}</b>` : '0'}</td><td><button class="b sec" data-src-hide="${i}">${hiddenBanks().includes(r.k) ? 'בטל הסתרה' : 'הסתר מהסיכומים'}</button> <button class="b red" data-src-del="${i}">מחק את כל התנועות</button></td></tr>`).join('')}</table></div>` : '<p>אין תנועות בנק.</p>';
    m.querySelectorAll('[data-src-hide]').forEach(b => b.onclick = () => { const k = rows[+b.dataset.srcHide].k, h = hiddenBanks(); S.settings.hiddenBanks = h.includes(k) ? h.filter(x => x !== k) : [...h, k]; save(); draw(); render(); });
    m.querySelectorAll('[data-src-del]').forEach(b => b.onclick = async () => {
      const r = rows[+b.dataset.srcDel];
      if (!await ask(`למחוק לצמיתות את כל ${r.n} התנועות של "${r.k}"? אי אפשר לבטל. התנועות של שאר המקורות לא ייגעו.`)) return;
      r.ids.forEach(id => remove('tx', id)); toast(`נמחקו ${r.n} תנועות`); draw(); render();
    });
  };
  m.querySelector('#src-close').onclick = () => m.remove();
  draw();
}
/* ---------- פיצול תנועה לכמה סעיפים: התנועה המקורית נשארת (מסומנת כפוצלה ולא נספרת) והחלקים נספרים במקומה ---------- */
function splitTx(t) {
  if (!t) return;
  const groups = catGroups(t.type), optsHtml = c => `<option value="">ללא סעיף</option>${groups.map(([title, names]) => `<optgroup label="${title}">${names.map(n => `<option value="${esc(n)}" ${n === c ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('')}`;
  const half = Math.round(t.amount * 50) / 100, parts = [{ amount: half, cat: t.cat || '', note: t.note || '' }, { amount: Math.round((t.amount - half) * 100) / 100, cat: '', note: t.note || '' }];
  const m = modal(`<h2>פיצול תנועה</h2><p class="mut">${esc(t.note || '')}: ${fmt(t.amount)}. סכום החלקים חייב להיות שווה לסכום התנועה.</p><div id="sp-rows"></div><p><button class="b sec" id="sp-add">＋ חלק</button> ${canEdit() && ME.role !== 'view' ? '<label class="btn sec" style="margin:0">📎 קריאת חשבונית בבינה<input type="file" id="sp-inv" accept="image/*,.pdf" hidden></label>' : ''}</p><p class="mut" id="sp-inv-note">קריאת חשבונית שולחת את התמונה לספק הבינה שלך. הסכומים תמיד צריך לבדוק.</p><p id="sp-sum"></p>
    <div class="row"><button class="b" id="sp-ok">פיצול</button><button class="b sec" id="sp-no">ביטול</button></div>`);
  const draw = () => {
    m.querySelector('#sp-rows').innerHTML = parts.map((p, i) => `<div class="row"><input data-spa="${i}" type="number" step="any" value="${p.amount}" style="width:90px"><select data-spc="${i}" style="min-width:120px">${optsHtml(p.cat)}</select><input data-spn="${i}" value="${esc(p.note)}" style="flex:1;min-width:100px">${parts.length > 2 ? `<button class="ic" data-spx="${i}">🗑️</button>` : ''}</div>`).join('');
    const sum = () => Math.round(parts.reduce((a, p) => a + (+p.amount || 0), 0) * 100) / 100, show = () => { const d = Math.round((t.amount - sum()) * 100) / 100; m.querySelector('#sp-sum').innerHTML = d === 0 ? '<span class="good">הסכום מתאים</span>' : `<span class="bad">נשאר ${fmt(d)}</span>`; m.querySelector('#sp-ok').disabled = d !== 0 || parts.some(p => !(+p.amount > 0)); };
    m.querySelectorAll('[data-spa]').forEach(e => e.oninput = () => { parts[+e.dataset.spa].amount = +e.value; show(); });
    m.querySelectorAll('[data-spc]').forEach(e => e.onchange = () => { parts[+e.dataset.spc].cat = e.value; });
    m.querySelectorAll('[data-spn]').forEach(e => e.oninput = () => { parts[+e.dataset.spn].note = e.value; });
    m.querySelectorAll('[data-spx]').forEach(e => e.onclick = () => { parts.splice(+e.dataset.spx, 1); draw(); });
    show();
  };
  m.querySelector('#sp-add').onclick = () => { parts.push({ amount: 0, cat: '', note: t.note || '' }); draw(); };
  m.querySelector('#sp-inv')?.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return; const note = m.querySelector('#sp-inv-note'); note.textContent = 'קורא את החשבונית…';
    const fd = new FormData(); fd.append('file', f); fd.append('total', t.amount);
    try {
      const r = await fetch(API + 'invoice', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRFToken': csrf() }, body: fd }), j = await r.json().catch(() => ({}));
      if (!j.items) { note.textContent = j.error || 'הקריאה נכשלה'; return; }
      parts.splice(0, parts.length, ...j.items.map(i => ({ amount: i.amount, cat: '', note: i.description || t.note || '' })));
      note.textContent = 'הפריטים נקראו מהחשבונית. בדוק את הסכומים ובחר סעיף לכל חלק.'; draw();
    } catch { note.textContent = 'אין חיבור, נסה שוב'; }
  });
  m.querySelector('#sp-no').onclick = () => m.remove();
  m.querySelector('#sp-ok').onclick = () => {
    const base = uid();
    parts.forEach((p, i) => put('tx', { id: `s-${base}-${i}`, type: t.type, amount: +p.amount, cat: p.cat, note: p.note, date: t.date, acct: t.acct || '', bank: bankOf(t), par: t.id }));
    put('tx', { ...t, sp: 1 }); m.remove(); toast('התנועה פוצלה'); render();
  };
  draw();
}
/* ---------- חיובים חוזרים: אותו תיאור (בלי מספרים) בלפחות 3 חודשים שונים, בסכום דומה ----------- */
function recurringTx() {
  const g = {};
  live('tx').filter(t => t.type !== 'income').forEach(t => { const k = normNote(t.note); if (k) (g[k] = g[k] || []).push(t); });
  return Object.entries(g).map(([k, ts]) => {
    const months = [...new Set(ts.map(t => String(t.date).slice(0, 7)))].sort(), amts = ts.map(t => +t.amount).sort((a, b) => a - b), med = amts[Math.floor(amts.length / 2)];
    const steady = amts.filter(a => Math.abs(a - med) <= med * 0.1).length / amts.length >= 0.7;
    return { key: k, months, n: ts.length, med, day: Math.round(ts.reduce((a, t) => a + +String(t.date).slice(8, 10), 0) / ts.length), cat: ts[ts.length - 1].cat || '', steady };
  }).filter(r => r.months.length >= 3 && r.steady && r.n <= r.months.length * 1.5).sort((a, b) => b.med - a.med);
}
function recurringModal() {
  const rs = recurringTx(), total = rs.reduce((a, r) => a + r.med, 0);
  const m = modal(`<h2>חיובים חוזרים</h2><p class="mut">תנועות עם אותו תיאור שחוזרות בלפחות 3 חודשים בסכום דומה: מנויים, הוראות קבע וחיובים קבועים. כדאי לעבור ולבדוק אם יש מנוי ששכחת.</p>
    ${rs.length ? `<p>סה"כ בערך <b>${fmt(total)}</b> לחודש</p><div class="scroll"><table><tr><th>תיאור</th><th>סכום</th><th>חודשים</th><th>בערך ביום</th><th>סעיף</th></tr>${rs.slice(0, 80).map(r => `<tr><td>${esc(r.key)}</td><td class="n">${fmt(r.med)}</td><td>${r.months.length}</td><td>${r.day}</td><td>${esc(r.cat || '—')}</td></tr>`).join('')}</table></div>` : '<p class="mut">עוד אין מספיק היסטוריה לזיהוי חיובים חוזרים.</p>'}
    <div class="row" style="margin-top:12px"><button class="b sec" id="rc-no">סגירה</button></div>`);
  m.querySelector('#rc-no').onclick = () => m.remove();
}
/* ---------- כללי סיווג: מילה בתיאור התנועה קובעת סעיף. הארוך והספציפי קודם ---------- */
const ruleList = () => live('rules').map(r => ({ ...r, nk: normNote(r.key) })).filter(r => r.nk && r.cat).sort((a, b) => b.nk.length - a.nk.length);
const ruleCat = note => { const n = normNote(note); return (ruleList().find(r => n.includes(r.nk)) || {}).cat || ''; };
function ruleSuggestions() {
  const have = ruleList(), g = {};
  live('tx').filter(t => t.cat && t.note).forEach(t => { const k = normNote(t.note); if (k.length >= 3) { const o = g[k] = g[k] || { key: k, cats: {}, n: 0 }; o.n++; o.cats[t.cat] = (o.cats[t.cat] || 0) + 1; } });
  return Object.values(g).filter(o => o.n >= 2 && !have.some(r => o.key.includes(r.nk))).map(o => { const [cat, c] = Object.entries(o.cats).sort((a, b) => b[1] - a[1])[0]; return { key: o.key, cat, n: o.n, sure: c === o.n }; }).filter(o => o.sure).sort((a, b) => b.n - a.n).slice(0, 30);
}
const byCat = rs => Object.entries(rs.reduce((a, r) => ((a[r.cat] = a[r.cat] || []).push(r), a), {})).sort((a, b) => a[0].localeCompare(b[0], 'he'));
function rulesModal() {
  const m = modal('<div id="rl-body"></div>'), body = m.querySelector('#rl-body'); m.classList.add('wide');
  const catOpts = (sel = '') => `<option value="">בחירת סעיף</option>${[...catGroups('expense'), ...catGroups('income').filter(g => !EXTRA_G.includes(g[0])).map(g => [g[0] + ' (הכנסות)', g[1]])].map(([title, names]) => `<optgroup label="${title}">${names.map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('')}`;
  const ensureCat = val => val;
  const draw = () => {
    const rs = ruleList(), sg = ruleSuggestions(), fq = clsGroups().filter(g => g.n >= 3 && !g.cat && g.key !== '(ללא תיאור)' && !ruleCat(g.key)).sort((a, b) => b.n - a.n).slice(0, 12), uncat = live('tx').filter(t => !t.cat && ruleCat(t.note)).length;
    body.innerHTML = `<h2>כללי סיווג</h2><p class="mut"><b>איך זה עובד:</b> כותבים מילה שמופיעה בתיאור של תנועה בבנק (למשל "שופרסל"), בוחרים לאיזה סעיף היא שייכת, ולוחצים "הוספת כלל". מעכשיו כל תנועה שהתיאור שלה מכיל את המילה תקבל את הסעיף לבד. הכלל פועל על תנועות חדשות, ואפשר גם להחיל אותו על תנועות ישנות שאין להן סעיף (הכפתור למטה).</p><p class="mut"><b>אין סעיף מתאים?</b> קודם יוצרים קטגוריה בטופס "קטגוריה חדשה" בהמשך החלון, ואז חוזרים לכאן.</p>
      <h3>יצירת כלל</h3><div class="rl-form"><input id="rl-k" placeholder="מילה בתיאור, למשל שופרסל"><select id="rl-c">${catOpts()}</select><select id="rl-t" title="האם נספרת במעשרות">${mzTitheOpts()}</select><button class="b" id="rl-add">הוספת כלל</button></div>
      <h3>הכללים הקיימים (${rs.length})</h3>
      ${rs.length ? `<p class="mut">אפשר לשנות את המילה או את הסעיף ולשמור, או למחוק כלל. שינוי בסעיף משפיע על תנועות חדשות בלבד. הגדרת המעשרות חלה גם על תנועות קיימות.</p><div class="scroll"><table>${rs.map((r, i) => `<tr><td><input data-rke="${i}" value="${esc(r.key)}" style="min-width:110px"></td><td><select data-rce="${i}">${catOpts(r.cat)}</select></td><td><select data-rte="${i}" title="האם נספרת במעשרות">${mzTitheOpts(r.tithe)}</select></td><td><button class="b sec" data-rse="${i}">שמירה</button> <button class="ic" data-rldel="${esc(r.id)}" title="מחיקה">✕</button></td></tr>`).join('')}</table></div>` : '<p class="mut">עוד אין כללים.</p>'}
      <h3>קטגוריה חדשה</h3><p class="mut">אין סעיף מתאים ברשימה? יוצרים כאן. מגדירים שם, אם היא חוזרת כל חודש או פעם בשנה, האם זו הכנסה או הוצאה, והאם הסכום קבוע או משתנה. "שונות" היא קטגוריה כללית שנספרת בהכנסות או בהוצאות. "לא קשור" לא נספרת בכלל, למשל העברה בין חשבונות או הלוואה לחבר וההחזר שלו. אחרי היצירה היא תופיע ברשימת הסעיפים של הכלל.</p><div class="rl-form"><input id="nc-n" placeholder="שם הקטגוריה, למשל חוגים"><select id="nc-f"><option value="monthly">חודשית</option><option value="yearly">שנתית</option></select><select id="nc-t"><option value="expense">הוצאה</option><option value="income">הכנסה</option><option value="misc">שונות (נספרת)</option><option value="nb">לא קשור (לא נספרת)</option></select><select id="nc-k"><option value="fixed">קבועה (אותו סכום)</option><option value="var">לא קבועה (משתנה)</option></select><select id="nc-th" title="האם נספרת במעשרות">${mzTitheOpts()}</select><button class="b sec" id="nc-add">הוספת קטגוריה</button></div>
      ${fq.length ? `<h3>תיאורים נפוצים בלי סעיף</h3><p class="mut">מופיעים הרבה ואין להם סעיף. בוחרים סעיף ויוצרים כלל:</p><div class="scroll"><table>${fq.map((o, i) => `<tr><td>${esc(o.key)}</td><td class="mut">הופיע ${o.n} פעמים</td><td><select data-fqc="${i}" style="min-width:120px">${catOpts()}</select></td><td><button class="b sec" data-fqb="${i}">צור כלל +</button></td></tr>`).join('')}</table></div>` : ''}
      <p><button class="b sec" id="rl-apply" ${uncat ? '' : 'disabled'}>החלה על ${uncat} תנועות בלי סעיף</button></p>
      ${sg.length ? `<h3>הצעות</h3><p class="mut">תיאורים שסיווגת כבר כמה פעמים לאותו סעיף:</p><div class="scroll"><table>${sg.map((o, i) => `<tr><td>${esc(o.key)}</td><td>${esc(o.cat)}</td><td>${o.n} פעמים</td><td><button class="b sec" data-rlsg="${i}">הוספה</button></td></tr>`).join('')}</table></div>` : ''}
      <p style="margin-top:12px"><button class="b" id="rl-cats">🗂 הקטגוריות שלי: ניהול כדף נפרד</button> <span class="mut">שינוי הכנסה / הוצאה, חודשית / שנתית, "לא נספרת" ומחיקה</span></p>
      <div class="row" style="margin-top:12px"><button class="b sec" id="rl-no">סגירה</button></div>`;
    body.querySelector('#rl-no').onclick = () => m.remove();
    body.querySelector('#rl-cats').onclick = () => { m.remove(); tab = 'cats'; render(); scrollTo(0, 0); };
    body.querySelector('#rl-add').onclick = async () => { const key = body.querySelector('#rl-k').value.trim(), cat = ensureCat(body.querySelector('#rl-c').value); if (!normNote(key)) return toast('כותבים מילה מהתיאור'); if (!cat) return toast('לא נבחר סעיף. אם אין סעיף מתאים, קודם יוצרים קטגוריה בטופס "קטגוריה חדשה" למטה.'); if (!await ask(`ליצור כלל: כל תנועה שהתיאור שלה מכיל "${key}" תסווג ל"${cat}"?`)) return; const th = body.querySelector('#rl-t').value; put('rules', { id: 'r-' + uid(), key, cat, ...(th ? { tithe: th } : {}) }); toast('הכלל נוסף'); draw(); render(); };
    body.querySelector('#nc-t').onchange = e => { const x = e.target.value === 'misc' || e.target.value === 'nb'; body.querySelector('#nc-f').disabled = x; body.querySelector('#nc-k').disabled = x; };
    body.querySelector('#nc-add').onclick = () => {
      const name = body.querySelector('#nc-n').value.trim(), freq = body.querySelector('#nc-f').value, typ = body.querySelector('#nc-t').value, inc = typ === 'income', fixed = body.querySelector('#nc-k').value === 'fixed';
      if (typ === 'misc' || typ === 'nb') {
        if (!name) return toast('כותבים שם לקטגוריה');
        const key = typ === 'nb' ? 'nbCats' : 'miscCats', cur = typ === 'nb' ? nbCats() : miscCats();
        if (cur.includes(name)) return toast('כבר יש קטגוריה כזו בשם "' + name + '"');
        S.settings[key] = [...cur, name]; mzSetCatTithe(name, body.querySelector('#nc-th').value); save();
        toast('הקטגוריה "' + name + '" נוספה. עכשיו אפשר לבחור אותה בכלל.'); draw(); render(); return;
      }
      if (!name) return toast('כותבים שם לקטגוריה');
      mzSetCatTithe(name, body.querySelector('#nc-th').value);
      if (freq === 'yearly' ? live('yearly').some(x => x.name === name) : monthlyPlan().some(p => p.name === name)) return toast('כבר יש קטגוריה ' + (freq === 'yearly' ? 'שנתית' : 'חודשית') + ' בשם "' + name + '". בוחרים אותה ברשימת הסעיפים של הכלל.');
      if (freq === 'yearly') put('yearly', { id: 'y-' + uid(), kind: inc ? 'income' : 'expense', month: 'כללי', name, amount: '0', year: '', fixed });
      else put('plan', { id: 'p-' + uid(), kind: inc ? (fixed ? 'income' : 'incomeVar') : (fixed ? 'fixed' : 'variable'), name, amount: '0', active: true });
      toast('הקטגוריה "' + name + '" נוספה. עכשיו אפשר לבחור אותה בכלל.'); draw(); render();
    };
    body.querySelectorAll('[data-rldel]').forEach(b => b.onclick = async () => { const r = live('rules').find(x => x.id === b.dataset.rldel); if (!await ask(`למחוק את הכלל "${r ? r.key : ''}"? תנועות שכבר סווגו לא ישתנו.`)) return; remove('rules', b.dataset.rldel); draw(); });
    body.querySelectorAll('[data-rse]').forEach(b => b.onclick = async () => {
      const i = b.dataset.rse, r = rs[+i], key = body.querySelector(`[data-rke="${i}"]`).value.trim(), cat = body.querySelector(`[data-rce="${i}"]`).value;
      if (!normNote(key)) return toast('כותבים מילה מהתיאור');
      if (!cat) return toast('בוחרים סעיף לכלל');
      const th = body.querySelector(`[data-rte="${i}"]`).value;
      if (key === r.key && cat === r.cat && th === (r.tithe || '')) return toast('לא שונה כלום');
      if (!await ask(`לשמור את השינוי? כל תנועה חדשה שהתיאור שלה מכיל "${key}" תסווג ל"${cat}".`)) return;
      put('rules', { id: r.id, key, cat, ...(th ? { tithe: th } : {}) }); toast('הכלל עודכן'); draw(); render();
    });
    body.querySelectorAll('[data-fqb]').forEach(b => b.onclick = async () => { const o = fq[+b.dataset.fqb], cat = ensureCat(body.querySelector(`[data-fqc="${b.dataset.fqb}"]`).value); if (!cat) return toast('בוחרים סעיף'); const cnt = live('tx').filter(t => !t.cat && normNote(t.note).includes(normNote(o.key))).length; if (!await ask(`ליצור כלל: "${o.key}" ← "${cat}"? הסעיף יעודכן גם ב-${cnt} תנועות שאין להן סעיף.`)) return; put('rules', { id: 'r-' + uid(), key: o.key, cat }); let n = 0; live('tx').filter(t => !t.cat && normNote(t.note).includes(normNote(o.key))).forEach(t => { put('tx', withCat(t, cat)); n++; }); toast(`נוצר כלל, והסעיף עודכן ב-${n} תנועות`); draw(); render(); });
    body.querySelectorAll('[data-rlsg]').forEach(b => b.onclick = async () => { const o = sg[+b.dataset.rlsg]; if (!await ask(`ליצור כלל: "${o.key}" ← "${o.cat}"?`)) return; put('rules', { id: 'r-' + uid(), key: o.key, cat: o.cat }); draw(); });
    body.querySelector('#rl-apply').onclick = async () => { if (!await ask(`להחיל את הכללים על ${uncat} תנועות שאין להן סעיף?`)) return; let n = 0; live('tx').filter(t => !t.cat).forEach(t => { const c = ruleCat(t.note); if (c) { put('tx', withCat(t, c)); n++; } }); toast(`הסעיף עודכן ב-${n} תנועות`); draw(); render(); };
  };
  draw();
}
/* ---------- בחירת סעיף עם הקלדה וחיפוש (גם בכתיב לא מדויק) ---------- */
const sNorm = x => String(x || '').toLowerCase().replace(/["'״׳`.,()\-_/]/g, '').replace(/\s+/g, ' ').trim();
function editDist(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// ציון התאמה: 0 = לא מתאים, ככל שגבוה יותר כך מתאים יותר
function fuzzyScore(query, name) {
  const q = sNorm(query), n = sNorm(name);
  if (!q) return 1;
  if (n === q) return 100;
  if (n.startsWith(q)) return 90;
  if (n.includes(q)) return 80;
  const nw = n.split(' ');
  let total = 0;
  for (const w of q.split(' ')) {
    const best = Math.min(...nw.map(x => x.includes(w) || (w.length > 2 && w.includes(x) && x.length > 2) ? 0 : editDist(w, x.slice(0, Math.max(w.length, 1) + 1)) / Math.max(w.length, 1)));
    if (best > 0.4) return 0;
    total += best;
  }
  return 60 - total * 40;
}
function makeSearchable(sel) {
  if (sel.dataset.srch || sel.multiple || !sel.querySelector('optgroup') || sel.options.length < 8) return;
  sel.dataset.srch = '1';
  const wrap = document.createElement('span'), inp = document.createElement('input'), list = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:inline-block;min-width:150px;max-width:100%;vertical-align:middle;' + (sel.closest('.bud-top') ? '' : 'width:100%');
  if (sel.classList.contains('uncls')) inp.className = 'uncls'; inp.type = 'text'; inp.autocomplete = 'off'; inp.placeholder = sel.dataset.ph || 'הקלדה לחיפוש...'; inp.style.width = '100%';
  list.style.cssText = 'display:none;position:absolute;inset-inline:0;top:100%;z-index:120;max-height:240px;overflow:auto;background:var(--surface,#fff);color:var(--text,#111);border:1px solid var(--border,#ccc);border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.2);text-align:right';
  sel.style.display = 'none'; sel.before(wrap); wrap.append(inp, list, sel);
  const label = () => sel.selectedOptions[0] && sel.value ? sel.selectedOptions[0].textContent : '';
  const shown = () => { inp.value = label(); };
  const items = () => [...sel.options].map(o => ({ v: o.value, t: o.textContent, g: o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '' }));
  const fill = q => {
    const rows = items().map(o => ({ ...o, sc: o.v ? fuzzyScore(q, o.t) : (q ? 0 : 1) })).filter(o => o.sc > 0);
    if (q) rows.sort((a, b) => b.sc - a.sc);
    list.innerHTML = rows.length ? '' : '<div style="padding:.6rem .8rem;opacity:.7">לא נמצא סעיף דומה</div>';
    let lastG = null;
    rows.forEach(o => {
      if (!q && o.g !== lastG && o.g) { lastG = o.g; const h = document.createElement('div'); h.textContent = o.g; h.style.cssText = 'padding:.3rem .8rem;font-weight:700;opacity:.7;font-size:.85em'; list.append(h); }
      const d = document.createElement('div'); d.textContent = o.t + (q && o.g ? ' · ' + o.g : ''); d.style.cssText = 'padding:.55rem .8rem;cursor:pointer;' + (o.v === sel.value ? 'font-weight:700' : '');
      d.onmousedown = e => { e.preventDefault(); markNear(inp); sel.value = o.v; sel.dispatchEvent(new Event('change', { bubbles: true })); shown(); list.style.display = 'none'; inp.blur(); };
      list.append(d);
    });
  };
  inp.onfocus = () => { inp.select(); fill(''); list.style.display = 'block'; };
  inp.oninput = () => { fill(inp.value); list.style.display = 'block'; };
  inp.onblur = () => { list.style.display = 'none'; shown(); };
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const f = list.querySelector('div[style*="cursor"]'); if (f) f.onmousedown(e); } };
  shown();
}
(() => {
  const run = root => (root.querySelectorAll ? root.querySelectorAll('select') : []).forEach(makeSearchable);
  const go = () => { run(document); new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && (n.tagName === 'SELECT' ? makeSearchable(n) : run(n))))).observe(document.body, { childList: true, subtree: true }); };
  document.body ? go() : document.addEventListener('DOMContentLoaded', go);
})();
/* ---------- ניהול קטגוריות כדף נפרד: סוג, תדירות, "לא נספרת" ומחיקה ---------- */
const catRowsAll = () => [
  ...monthlyPlan().map(x => ({ c: 'plan', x, inc: x.kind === 'income' || x.kind === 'incomeVar', fixed: x.kind === 'income' || x.kind === 'fixed', special: ['consumption', 'charity'].includes(x.kind) ? x.kind : '' })),
  ...live('yearly').map(x => ({ c: 'yearly', x, inc: x.kind === 'income', fixed: !!x.fixed, special: '' }))];
const planKind = (inc, fixed) => inc ? (fixed ? 'income' : 'incomeVar') : (fixed ? 'fixed' : 'variable');
function catAdd(freq, name, inc, fixed, amount) {
  if (freq === 'yearly') put('yearly', { id: 'y-' + uid(), kind: inc ? 'income' : 'expense', month: 'כללי', name, amount: String(amount || 0), year: '', fixed });
  else put('plan', { id: 'p-' + uid(), kind: planKind(inc, fixed), name, amount: String(amount || 0), active: true });
}
V.cats = () => {
  const rows = catRowsAll(), nb = nbCats(), misc = miscCats();
  const row = r => `<tr><td>${esc(r.x.name)}</td>
    <td><select data-cx="${r.c}|${esc(r.x.id)}|q"><option value="plan" ${r.c === 'plan' ? 'selected' : ''}>חודשית</option><option value="yearly" ${r.c === 'yearly' ? 'selected' : ''}>שנתית</option></select></td>
    <td><select data-cx="${r.c}|${esc(r.x.id)}|t"><option value="expense" ${r.inc ? '' : 'selected'}>הוצאה</option><option value="income" ${r.inc ? 'selected' : ''}>הכנסה</option></select></td>
    <td>${r.c === 'plan' ? `<select data-cx="${r.c}|${esc(r.x.id)}|f"><option value="fixed" ${r.fixed ? 'selected' : ''}>קבועה</option><option value="var" ${!r.fixed && !r.special ? 'selected' : ''}>משתנה</option>${r.special ? `<option value="${r.special}" selected>${PLAN_KINDS[r.special]}</option>` : ''}</select>` : '<span class="mut">—</span>'}</td>
    <td><select data-cth="${esc(r.x.name)}">${mzTitheOpts((mz().cats || {})[r.x.name])}</select></td>
    <td style="white-space:nowrap"><button class="b sec" data-cnb="${r.c}|${esc(r.x.id)}" title="לא נספרת בתקציב">🚫 לא נספרת</button> <button class="b red" data-cdel="${r.c}|${esc(r.x.id)}" title="מחיקה" aria-label="מחיקת ${esc(r.x.name)}">🗑️</button></td></tr>`;
  const back = n => `<tr><td>${esc(n)}</td><td colspan="3"><select data-cback="${esc(n)}"><option value="">להחזיר לספירה כ…</option><option value="plan|0">הוצאה חודשית</option><option value="plan|1">הכנסה חודשית</option><option value="yearly|0">הוצאה שנתית</option><option value="yearly|1">הכנסה שנתית</option></select></td><td><button class="b red" data-cnbdel="${esc(n)}" aria-label="מחיקת ${esc(n)}">🗑️</button></td></tr>`;
  return `<div class="card"><p><button class="b sec" id="cats-back">→ חזרה לסיווג</button></p><h2>🗂 הקטגוריות שלי</h2>
    <p class="mut">כל הקטגוריות במקום אחד. אפשר לשנות לכל אחת: הכנסה או הוצאה, חודשית או שנתית (הסכום מתורגם: חודשי × 12 לשנתי), קבועה או משתנה, "לא נספרת" (תנועות שלה לא נכנסות לתקציב), או למחוק. תנועות שכבר סווגו נשארות עם שם הקטגוריה.</p>
    <p><button class="b sec" id="cats-rules">🏷️ כללי סיווג וקטגוריה חדשה</button></p>
    <h3>קטגוריות נספרות (${rows.length})</h3>
    ${rows.length ? `<div class="scroll"><table><tr><th>שם</th><th>תדירות</th><th>סוג</th><th>קבועה / משתנה</th><th>מעשרות</th><th></th></tr>${rows.map(row).join('')}</table></div>` : '<p class="mut">אין קטגוריות.</p>'}
    <h3>לא נספרות (${nb.length})</h3><p class="mut">תנועות בקטגוריות האלה לא נספרות בהכנסות ובהוצאות.</p>
    ${nb.length ? `<div class="scroll"><table>${nb.map(back).join('')}</table></div>` : '<p class="mut">אין.</p>'}
    ${misc.length ? `<h3>שונות (${misc.length})</h3><div class="scroll"><table>${misc.map(n => `<tr><td>${esc(n)}</td><td><button class="b red" data-cmdel="${esc(n)}" aria-label="מחיקת ${esc(n)}">🗑️</button></td></tr>`).join('')}</table></div>` : ''}</div>`;
};
function bindCats() {
  const R = $('#app'), find = key => { const [c, id] = key.split('|'); return { c, x: live(c).find(r => r.id === id) }; };
  $('#cats-back')?.addEventListener('click', () => { tab = 'cls'; render(); scrollTo(0, 0); });
  $('#cats-rules')?.addEventListener('click', rulesModal);
  R.querySelectorAll('[data-cth]').forEach(el => el.onchange = () => { mzSetCatTithe(el.dataset.cth, el.value); save(); toast('נשמר: ' + (el.value === 'none' ? 'לא נספרת במעשרות' : MZ_CLASSES[el.value] || 'ברירת מחדל')); });
  R.querySelectorAll('[data-cx]').forEach(el => el.onchange = async () => {
    const [c, id, w] = el.dataset.cx.split('|'), x = live(c).find(r => r.id === id);
    if (!x) return toast('הקטגוריה לא נמצאה, נסו לרענן');
    if (!await ask(`לשנות את הקטגוריה "${x.name}"? זה משפיע על התקציב והדוחות.`)) return render();
    const inc = c === 'plan' ? (x.kind === 'income' || x.kind === 'incomeVar') : x.kind === 'income', fixed = c === 'plan' ? (x.kind === 'income' || x.kind === 'fixed') : !!x.fixed;
    if (w === 'q') {
      const to = el.value; if (to === c) return render();
      if (to === 'yearly' ? live('yearly').some(y => y.name === x.name) : monthlyPlan().some(p => p.name === x.name)) { toast('כבר יש קטגוריה ' + (to === 'yearly' ? 'שנתית' : 'חודשית') + ' בשם "' + x.name + '"'); return render(); }
      const amt = c === 'plan' ? Math.round((+x.amount || 0) * 12) : Math.round((+x.amount || 0) / 12);
      catAdd(to, x.name, inc, fixed, amt); remove(c, x.id);
    } else if (c === 'yearly') put('yearly', w === 't' ? { ...x, kind: el.value } : x);
    else {
      const ninc = w === 't' ? el.value === 'income' : inc, nfixed = w === 'f' ? el.value === 'fixed' : fixed;
      const sp = w === 'f' && ['consumption', 'charity'].includes(el.value) ? el.value : '';
      put('plan', { ...x, kind: sp && !ninc ? sp : planKind(ninc, nfixed) });
    }
    toast('הקטגוריה "' + x.name + '" עודכנה'); render();
  });
  R.querySelectorAll('[data-cnb]').forEach(b => b.onclick = async () => {
    const { c, x } = find(b.dataset.cnb); if (!x) return;
    if (!await ask(`להגדיר את "${x.name}" כלא נספרת? התנועות שלה לא ייכנסו לתקציב, והיא תוסר מהקטגוריות הנספרות.`)) return;
    if (!nbCats().includes(x.name)) { S.settings.nbCats = [...nbCats(), x.name]; save(); }
    remove(c, x.id); live('tx').filter(t => t.cat === x.name).forEach(t => put('tx', withCat(t, x.name)));
    toast('"' + x.name + '" הוגדרה כלא נספרת'); render();
  });
  R.querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => {
    const { c, x } = find(b.dataset.cdel); if (!x) return;
    if (!await ask(`למחוק את הקטגוריה "${x.name}"? תנועות שכבר סווגו אליה יישארו עם השם שלה.`)) return;
    remove(c, x.id); toast('הקטגוריה נמחקה'); render();
  });
  R.querySelectorAll('[data-cback]').forEach(el => el.onchange = async () => {
    if (!el.value) return; const n = el.dataset.cback, [freq, inc] = el.value.split('|');
    if (!await ask(`להחזיר את "${n}" להיספר בתקציב?`)) return render();
    catAdd(freq, n, inc === '1', true, 0);
    S.settings.nbCats = nbCats().filter(x => x !== n); save();
    live('tx').filter(t => t.cat === n && t.nb).forEach(t => put('tx', { ...t, nb: false }));
    toast('"' + n + '" חזרה להיספר'); render();
  });
  R.querySelectorAll('[data-cnbdel]').forEach(b => b.onclick = async () => {
    const n = b.dataset.cnbdel; if (!await ask(`למחוק את "${n}" מהרשימה? תנועות שכבר סווגו אליה יישארו עם השם שלה.`)) return;
    S.settings.nbCats = nbCats().filter(x => x !== n); save(); toast('נמחקה'); render();
  });
  R.querySelectorAll('[data-cmdel]').forEach(b => b.onclick = async () => {
    const n = b.dataset.cmdel; if (!await ask(`למחוק את "${n}" מהקטגוריות שונות?`)) return;
    S.settings.miscCats = miscCats().filter(x => x !== n); save(); toast('נמחקה'); render();
  });
}
/* ---------- סיווג לפי תיאור: דברים שחוזרים על עצמם מופיעים פעם אחת ומסווגים בבת אחת ---------- */
const normNote = n => String(n || '').replace(/[₪]|סכום העסקה|מתוך/g, ' ').replace(/\d[\d,./:-]*/g, ' ').replace(/[\s\-:]+/g, ' ').trim();
let clsf = { q: '', none: true, limit: 60 };
function clsGroups() {
  const g = {};
  live('tx').forEach(t => {
    const k = normNote(t.note) || '(ללא תיאור)', x = g[k] = g[k] || { key: k, ids: [], n: 0, inc: 0, exp: 0, cats: {}, banks: new Set(), type: t.type };
    x.ids.push(t.id); x.n++; (t.type === 'income' ? (x.inc += +t.amount) : (x.exp += +t.amount)); x.cats[t.cat || ''] = (x.cats[t.cat || ''] || 0) + 1; x.banks.add(bankOf(t));
  });
  return Object.values(g).map(x => ({ ...x, cat: Object.entries(x.cats).sort((a, b) => b[1] - a[1])[0][0], mixed: Object.keys(x.cats).length > 1 }));
}
V.cls = () => {
  const q = clsf.q.trim(), all = clsGroups(), rows = all.filter(x => (!clsf.none || !x.cat || x.mixed) && (!q || x.key.includes(q))).sort((a, b) => (b.inc + b.exp) - (a.inc + a.exp));
  const opts = x => { const groups = catGroups(x.inc > x.exp ? 'income' : 'expense'), known = groups.some(g => g[1].includes(x.cat)); return `<option value="">ללא סעיף (אחר)</option>${x.cat && !known ? `<option value="${esc(x.cat)}" selected>${esc(x.cat)}</option>` : ''}${groups.map(([title, names]) => `<optgroup label="${title}">${names.map(n => `<option value="${esc(n)}" ${n === x.cat && !x.mixed ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('')}`; };
  return `<div class="card"><h2>סיווג לפי תיאור</h2><p class="mut">חיובים דומים (הוראת קבע, תשלומים, אותו מקום עם סכומים שונים) מופיעים כאן פעם אחת. בוחרים סעיף פעם אחת והוא חל על כל התנועות, וגם על תנועות חדשות שייקלטו.</p>
    <div class="row"><input id="cls-q" placeholder="חיפוש תיאור" value="${esc(clsf.q)}"><label><input type="checkbox" id="cls-none" ${clsf.none ? 'checked' : ''}> רק מה שלא סווג</label></div>
    <p class="mut">${rows.length} קבוצות מתוך ${all.length}</p>
    ${rows.length ? `<div class="scroll"><table class="cls"><tr><th>תיאור</th><th>תנועות</th><th>סה"כ</th><th>סעיף</th></tr>${rows.slice(0, clsf.limit).map((x, i) => `<tr><td>${esc(x.key)}<div class="mut">${esc([...x.banks].filter(Boolean).join(', '))}</div></td><td class="n">${x.n}</td><td class="n ${x.inc > x.exp ? 'good' : 'bad'}">${fmt(x.inc > x.exp ? x.inc : x.exp)}</td><td>${canEdit() ? `<select data-cls="${esc(x.key)}">${opts(x)}</select>${x.mixed ? '<div class="mut">יש כמה סעיפים בקבוצה</div>' : ''}` : esc(x.cat || '—')}</td></tr>`).join('')}</table></div>${rows.length > clsf.limit ? `<p><button class="b sec" id="cls-more">הצג עוד (${rows.length - clsf.limit})</button></p>` : ''}` : '<p class="mut">אין קבוצות להצגה.</p>'}</div>`;
};
function bindCls() {
  $('#cls-q')?.addEventListener('change', e => { clsf.q = e.target.value; clsf.limit = 60; render(); });
  $('#cls-none')?.addEventListener('change', e => { clsf.none = e.target.checked; clsf.limit = 60; render(); });
  $('#cls-more')?.addEventListener('click', () => { clsf.limit += 100; render(); });
  $('#app').querySelectorAll('[data-cls]').forEach(sel => sel.onchange = async () => {
    const key = sel.dataset.cls, cat = sel.value, hit = live('tx').filter(t => (normNote(t.note) || '(ללא תיאור)') === key); let n = 0;
    if (!await ask(cat ? `לשייך ${hit.length} תנועות עם התיאור "${key}" לסעיף "${cat}"?` : `להסיר את הסעיף מ-${hit.length} תנועות עם התיאור "${key}"?`)) return render();
    hit.forEach(t => { put('tx', withCat(t, cat)); n++; });
    toast(`הסעיף עודכן ב-${n} תנועות`); render();
  });
}
function bindTxs() {
  const R = $('#app'), again = () => { txf.limit = 100; render(); };
  if (!SYNC) syncLoad();
  $('#sync-now')?.addEventListener('click', syncNow);
  $('#bf-open')?.addEventListener('click', bankImport);
  $('#bk-hide')?.addEventListener('click', () => { const h = hiddenBanks(); S.settings.hiddenBanks = h.includes(txf.bank) ? h.filter(x => x !== txf.bank) : [...h, txf.bank]; save(); render(); });
  $('#tr-open')?.addEventListener('click', transfers);
  $('#dp-open')?.addEventListener('click', dupFinder);
  $('#src-open')?.addEventListener('click', bankSourcesModal);
  $('#imp-open')?.addEventListener('click', () => { tab = 'imp'; render(); scrollTo(0, 0); });
  $('#rc-open')?.addEventListener('click', recurringModal);
  $('#rl-open')?.addEventListener('click', rulesModal);
  $('#cats-open')?.addEventListener('click', () => { tab = 'cats'; render(); scrollTo(0, 0); });
  R.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => { c.checked ? txSel.add(c.dataset.sel) : txSel.delete(c.dataset.sel); });
  $('#tx-all')?.addEventListener('change', e => { R.querySelectorAll('[data-sel]').forEach(c => { c.checked = e.target.checked; e.target.checked ? txSel.add(c.dataset.sel) : txSel.delete(c.dataset.sel); }); });
  const picked = () => S.data.tx.filter(t => txSel.has(t.id) && !t.del);
  $('#tx-bulkset')?.addEventListener('click', async () => { const cat = $('#tx-bulkcat').value, ts = picked(); if (!cat || !ts.length) return toast('בוחרים סעיף וסימון תנועות'); if (!await ask(`לשנות את הסעיף של ${ts.length} תנועות מסומנות ל"${cat}"?`)) return; ts.forEach(t => put('tx', withCat(t, cat))); txSel.clear(); toast(`הסעיף עודכן ב-${ts.length} תנועות`); render(); });
  $('#tx-bulkdel')?.addEventListener('click', () => { const ts = picked(); if (!ts.length) return toast('לא סומנו תנועות'); ask(`למחוק ${ts.length} תנועות?`, () => { ts.forEach(t => remove('tx', t.id)); txSel.clear(); render(); }); });
  R.querySelectorAll('[data-dup]').forEach(b => b.onclick = () => { const t = S.data.tx.find(x => x.id === b.dataset.dup); if (!t) return; const { tr, sp, par, imp, pd, ...rest } = t; put('tx', { ...rest, id: 'd-' + uid(), bank: bankOf(t) }); toast('התנועה שוכפלה'); render(); });
  R.querySelectorAll('[data-split]').forEach(b => b.onclick = () => splitTx(S.data.tx.find(x => x.id === b.dataset.split)));
  R.querySelectorAll('[data-unsplit]').forEach(b => b.onclick = () => { const id = b.dataset.unsplit; ask('לבטל את הפיצול? החלקים יימחקו.', () => { S.data.tx.filter(t => t.par === id).forEach(t => remove('tx', t.id)); const t = S.data.tx.find(x => x.id === id); if (t) { const { sp, ...rest } = t; put('tx', rest); } render(); }); });
  $('#tx-month')?.addEventListener('change', e => { txf.month = e.target.value; again(); });
  $('#tx-bank')?.addEventListener('change', e => { txf.bank = e.target.value; again(); });
  $('#tx-q')?.addEventListener('change', e => { txf.q = e.target.value; again(); });
  R.querySelectorAll('[data-txchip]').forEach(b => b.onclick = () => { txf.cat = txf.cat === b.dataset.txchip ? '' : b.dataset.txchip; again(); });
  $('#tx-chipclear')?.addEventListener('click', () => { txf.cat = ''; again(); });
  $('#tx-none')?.addEventListener('change', e => { txf.none = e.target.checked; again(); });
  $('#tx-more')?.addEventListener('click', () => { txf.limit += 200; render(); });
  R.querySelectorAll('[data-txcat]').forEach(sel => sel.onchange = () => setTxCat(sel.dataset.txcat, sel.value));
  R.querySelectorAll('[data-txth]').forEach(sel => sel.onchange = () => { const t = S.data.tx.find(x => x.id === sel.dataset.txth); if (!t) return; put('tx', { ...t, tithe: sel.value || undefined }); toast(sel.value === 'none' ? 'התנועה לא תיספר במעשרות' : sel.value ? 'נספרת במעשרות: ' + MZ_CLASSES[sel.value] : 'המעשרות לפי הכללים'); });
}

/* ---------- ייבוא פירוט משכנתא מקובץ (CSV או הדבקה מהאקסל) ---------- */
// שדות שמחפשים בכותרות הטבלה. סדר העיבוד חשוב: "שנותרו" נבדק לפני "מספר תשלומים"
const MG_FIELDS = [
  ['name', 'שם המסלול', /שם.?מסלול|מסלול|תיאור/],
  ['kind', 'סוג הריבית (קבועה / פריים / משתנה)', /סוג.?ריבית|עוגן|סוג/],
  ['rate', 'ריבית (%) או מרווח מהפריים', /ריבית|מרווח/],
  ['original', 'סכום מקורי', /סכום.?מקורי|סכום.?ההלוואה|סכום.?המסלול|קרן.?מקורית|סכום.?הקרן/],
  ['balance', 'יתרה נוכחית', /יתרה|קרן.?נותרת|נותר.?קרן/],
  ['left', 'תשלומים שנותרו', /שנותרו|נותרו|נותרים/],
  ['total', 'מספר תשלומים כולל', /(מספר.?תשלומים|תקופה)(?!.*נותר)/],
  ['start', 'תאריך לקיחה', /תאריך.?(לקיחה|התחלה|ביצוע|תחילת|נטילה|הפקדה)/],
];
function mgParseTable(text) {
  const t = String(text || '').replace(/^﻿/, '').trim(); if (!t) return { headers: [], rows: [] };
  const first = t.split(/\r?\n/)[0], delim = [['\t', first.split('\t').length], [';', first.split(';').length], [',', first.split(',').length]].sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return { headers: rows[0] || [], rows: rows.slice(1) };
}
// הדבקה מדף המשכנתאות של פאג"י: כל מסלול הוא רשימת שדות (לא טבלה). מספר התשלומים שנותרו מחושב מהיתרה, הריבית וההחזר החודשי
function mgFromFieldText(text) {
  const t = String(text || ''); if (!/מספר\s*משנה/.test(t) || !/יתרת\s*קרן/.test(t)) return null;
  const parts = t.split(/מספר\s*משנה\s*:?\s*/).slice(1), rows = [];
  const num = (b, re) => { const m = b.match(re); return m ? mgNum(m[1]) : 0; };
  parts.forEach(b => {
    const id = (b.match(/^\s*(\d+)/) || [])[1] || String(rows.length + 1);
    const bal = num(b, /יתרת\s*קרן[^\d\n]{0,20}([\d,]+\.?\d*)/);
    const rate = num(b, /ריבית\s*הכוללת\s*החזויה[^\d\n]{0,25}([\d.]+)\s*%|שיעור\s*ריבית[^\d\n]{0,25}([\d.]+)\s*%/) || num(b, /([\d.]+)\s*%/);
    const pay = num(b, /(?:תשלום|החזר)\s*חודשי[^\d\n]{0,40}([\d,]+\.?\d*)/) || num(b, /תשלום\s*אחרון\s*לחיוב[^\d\n]{0,20}([\d,]+\.?\d*)/) || num(b, /חודש[^\n\d]{0,12}\d{4}[^\d\n]{0,10}([\d,]+\.\d+)/);
    if (!(bal > 0)) return;
    const i = rate / 1200; let n = 0;
    if (pay > 0) n = i > 0 && pay > bal * i ? -Math.log(1 - i * bal / pay) / Math.log(1 + i) : bal / pay;
    rows.push([`מסלול ${id}`, /פריים/.test(b) ? 'פריים' : 'קבועה', String(rate), String(bal), n > 0 ? String(Math.round(n)) : '']);
  });
  return rows.length ? { headers: ['שם המסלול', 'סוג הריבית', 'ריבית', 'יתרה נוכחית', 'תשלומים שנותרו'], rows } : null;
}
function mgDetect(headers) {
  const used = new Set(), map = {};
  MG_FIELDS.forEach(([k, , re]) => { const i = headers.findIndex((h, n) => !used.has(n) && re.test(h.replace(/["']/g, ''))); map[k] = i; if (i >= 0) used.add(i); });
  return map;
}
const mgNum = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.,-]/g, '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const mgDate = v => { const m = String(v || '').match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})|(\d{4})-(\d{2})|(\d{1,2})[./-](\d{4})/); if (!m) return ''; return m[3] ? `${m[3]}-${m[2].padStart(2, '0')}` : m[4] ? `${m[4]}-${m[5]}` : `${m[7]}-${m[6].padStart(2, '0')}`; };
const mgType = s => /פריים/.test(s) ? 'prime' : /משתנ/.test(s) ? 'var' : 'fixed';
// מהשורות והמיפוי: מסלולים בפורמט של הדף. יש שתי דרכים: יתרה + תשלומים שנותרו (ההחזרים מתחילים החודש), או סכום מקורי + תשלומים כולל + תאריך
function mgTracks(rows, map, headers) {
  const cell = (r, k) => map[k] >= 0 ? r[map[k]] : '', marginCol = map.rate >= 0 && /מרווח/.test(headers[map.rate]);
  const now = today().slice(0, 7), tracks = [], notes = []; let start = '';
  rows.forEach(r => {
    const name = cell(r, 'name') || 'מסלול', kindText = cell(r, 'kind') || name, type = mgType(kindText);
    let principal = 0, months = 0;
    if (map.balance >= 0 && map.left >= 0 && mgNum(cell(r, 'balance')) > 0) { principal = mgNum(cell(r, 'balance')); months = Math.round(mgNum(cell(r, 'left'))); start = start || now; }
    else if (map.original >= 0 && map.total >= 0) { principal = mgNum(cell(r, 'original')); months = Math.round(mgNum(cell(r, 'total'))); const d = mgDate(cell(r, 'start')); if (d && (!start || d < start)) start = d; }
    if (!(principal > 0 && months > 0)) { notes.push(`דילגתי על "${name}": חסר סכום או מספר תשלומים`); return; }
    let rate = mgNum(cell(r, 'rate'));
    // בפריים: מספר קטן (עד 3) הוא כבר המרווח מהפריים, וריבית כוללת (למשל 5.5) הופכת למרווח
    if (type === 'prime' && !marginCol && Math.abs(rate) >= 3) rate = Math.round((rate - primeNow()) * 100) / 100;
    tracks.push({ name, type, principal: String(principal), months: String(months), rate: String(rate), link: '0', changes: '' });
  });
  return { tracks, start: start || now, notes };
}
function mortgageImport() {
  const m = modal(`<h2>ייבוא פירוט משכנתא</h2>
    <p class="mut">מעתיקים את דף המשכנתאות מאתר הבנק (בפאג"י: מסמנים את כל הדף ומעתיקים), או טבלה מהאקסל, ומדביקים כאן, או בוחרים קובץ CSV. הכותרות מזוהות לבד, ואפשר לתקן. קובץ אקסל: שמרו אותו כ-CSV, או העתיקו את הטבלה.</p>
    <label>שם החוב</label><input id="mg-name" value="משכנתא">
    <label>הדבקה מהאקסל או מהאתר</label><textarea id="mg-text" rows="5" style="width:100%" placeholder="הדביקו כאן את הטבלה"></textarea>
    <label class="btn sec" style="margin:6px 0">או בחירת קובץ CSV<input type="file" id="mg-file" accept=".csv,.txt,.tsv" hidden></label>
    <div id="mg-map"></div><div id="mg-prev"></div>
    <div class="row" style="margin-top:12px"><button class="b" id="mg-ok" disabled>ייבוא</button><button class="b sec" id="mg-no">ביטול</button></div>`);
  let built = null;
  const run = text => {
    const { headers, rows } = mgFromFieldText(text) || mgParseTable(text); if (!headers.length || !rows.length) { toast('לא זוהתה טבלה'); return; }
    const map = mgDetect(headers);
    m.querySelector('#mg-map').innerHTML = '<h3>זיהוי העמודות</h3>' + MG_FIELDS.map(([k, label]) => `<label>${label}</label><select data-mg="${k}"><option value="-1">—</option>${headers.map((h, i) => `<option value="${i}" ${map[k] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`).join('');
    const refresh = () => {
      m.querySelectorAll('[data-mg]').forEach(s => { map[s.dataset.mg] = +s.value; });
      built = mgTracks(rows, map, headers);
      m.querySelector('#mg-prev').innerHTML = built.tracks.length ? `<h3>מה ייובא</h3><div class="scroll"><table><tr><th>מסלול</th><th>סוג</th><th>סכום</th><th>תשלומים</th><th>ריבית</th></tr>${built.tracks.map(t => `<tr><td>${esc(t.name)}</td><td>${{ fixed: 'קבועה', prime: 'פריים', var: 'משתנה' }[t.type]}</td><td class="n">${fmt(t.principal)}</td><td class="n">${esc(t.months)}</td><td class="n">${esc(t.rate)}${t.type === 'prime' ? ' (מרווח)' : '%'}</td></tr>`).join('')}</table></div><p class="mut">תחילת ההחזרים: ${built.start.split('-').reverse().join('/')}. ${built.notes.map(esc).join(' ')}</p>` : `<p class="bad">לא נמצאו מסלולים. בדקו שהעמודות מזוהות נכון. ${built.notes.map(esc).join(' ')}</p>`;
      m.querySelector('#mg-ok').disabled = !built.tracks.length;
    };
    m.querySelectorAll('[data-mg]').forEach(s => s.onchange = refresh); refresh();
  };
  m.querySelector('#mg-text').addEventListener('change', e => run(e.target.value));
  m.querySelector('#mg-file').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; const txt = await f.text(); m.querySelector('#mg-text').value = txt; run(txt); });
  m.querySelector('#mg-no').onclick = () => m.remove();
  m.querySelector('#mg-ok').onclick = () => {
    if (!built || !built.tracks.length) return;
    const name = m.querySelector('#mg-name').value.trim() || 'משכנתא', old = live('debts').find(x => x.name === name);
    const nd = { ...(old || { id: uid(), name, kind: 'משכנתא', day: '' }), tracks: built.tracks, tracksUpd: today(), start: built.start };
    const i = debtInfo(nd); nd.balance = built.tracks.reduce((a, t) => a + +t.principal, 0); nd.monthly = Math.round(i.next || 0); nd.end = i.endYm;
    put('debts', nd); m.remove(); toast(old ? 'החוב עודכן' : 'החוב נוסף'); render();
  };
}

/* ---------- מעשרות: ניהול מעשר וחומש (הועבר מתוסף "מעשר כספים" של אוצריא) ----------
   הכנסות ותרומות נשמרות באוסף tithes, תרומות קבועות באוסף titheRec, וההגדרות ב-settings.maaser.
   הסתרת סכומים וקוד גישה הם של התקציב כולו (העין בכותרת, והגדרות בלשונית "עוד"). */
const MH = (() => { // לוח עברי (חישוב עצמאי, כמו בתוסף)
  const EP = -1373427, mod = (a, b) => ((a % b) + b) % b, leap = y => mod(7 * y + 1, 19) < 7;
  const ce = y => { const me = Math.floor((235 * y - 234) / 19), p = 12084 + 13753 * me; let d = 29 * me + Math.floor(p / 25920); if (mod(3 * (d + 1), 7) < 3) d++; return d; };
  const yd = y => { if (y <= 1) return 0; const n0 = ce(y - 1), n1 = ce(y), n2 = ce(y + 1); if (n2 - n1 === 356) return 2; if (n1 - n0 === 382) return 1; return 0; };
  const ny = y => EP + ce(y) + yd(y), ylen = y => ny(y + 1) - ny(y);
  const md = (y, m) => [2, 4, 6, 10, 13].includes(m) ? 29 : m === 12 ? (leap(y) ? 30 : 29) : m === 8 ? (ylen(y) % 10 === 5 ? 30 : 29) : m === 9 ? (ylen(y) % 10 === 3 ? 29 : 30) : 30;
  const toRD = (y, m, d) => { const lm = leap(y) ? 13 : 12; let days = 0; if (m < 7) { for (let i = 7; i <= lm; i++) days += md(y, i); for (let i = 1; i < m; i++) days += md(y, i); } else for (let i = 7; i < m; i++) days += md(y, i); return ny(y) + days + d - 1; };
  const fromRD = rd => { let y = Math.floor((rd - EP) / 365.25) + 1; while (ny(y + 1) <= rd) y++; while (ny(y) > rd) y--; const order = [7, 8, 9, 10, 11, 12]; if (leap(y)) order.push(13); for (let i = 1; i <= 6; i++) order.push(i); let month = 7; for (const m of order) if (rd < toRD(y, m, 1) + md(y, m)) { month = m; break; } return { year: y, month, day: rd - toRD(y, month, 1) + 1 }; };
  const gl = y => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const gRD = (y, m, d) => { const p = y - 1; return 365 * p + Math.floor(p / 4) - Math.floor(p / 100) + Math.floor(p / 400) + Math.floor((367 * m - 362) / 12) + (m <= 2 ? 0 : gl(y) ? -1 : -2) + d; };
  const toG = rd => { let y = Math.floor((rd - 1) / 365.25) + 1; while (gRD(y + 1, 1, 1) <= rd) y++; while (gRD(y, 1, 1) > rd) y--; const dpm = [31, gl(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; let p = rd - gRD(y, 1, 1), m = 0; while (m < 12 && p >= dpm[m]) { p -= dpm[m]; m++; } return { year: y, month: m + 1, day: p + 1 }; };
  const N = [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א']];
  const num = n => { if (n <= 0 || n >= 10000) return String(n); let rem = n, res = ''; for (const [v, l] of N) while (rem >= v) { if (v === 10 && rem % 100 === 15) { res += 'טו'; rem -= 15; continue; } if (v === 10 && rem % 100 === 16) { res += 'טז'; rem -= 16; continue; } res += l; rem -= v; } return res.length === 1 ? res + '׳' : res.slice(0, -1) + '״' + res.slice(-1); };
  const isoRD = iso => { const [y, m, d] = iso.split('-').map(Number); return gRD(y, m, d); };
  const rdISO = rd => { const g = toG(rd); return `${g.year}-${String(g.month).padStart(2, '0')}-${String(g.day).padStart(2, '0')}`; };
  return { leap, md, toRD, fromRD, gRD, toG, num, isoRD, rdISO, fromISO: iso => fromRD(isoRD(iso)) };
})();
const MZ_HM = { 1: 'ניסן', 2: 'אייר', 3: 'סיוון', 4: 'תמוז', 5: 'אב', 6: 'אלול', 7: 'תשרי', 8: 'חשוון', 9: 'כסלו', 10: 'טבת', 11: 'שבט', 12: 'אדר', 13: 'אדר ב׳' };
const MZ_CIVIL = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
const MZ_GM = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const MZ_HOL = [{ id: 'rosh_hashana', name: 'ראש השנה', month: 7, day: 1 }, { id: 'yom_kippur', name: 'יום כיפור', month: 7, day: 10 }, { id: 'sukkot', name: 'סוכות', month: 7, day: 15 }, { id: 'pesach', name: 'פסח', month: 1, day: 15 }, { id: 'shavuot', name: 'שבועות', month: 3, day: 6 }];
const MZ_BEFORE = [[0, 'ביום עצמו'], [1, 'יום לפני'], [3, '3 ימים'], [7, 'שבוע'], [14, 'שבועיים'], [30, 'חודש לפני']];
const MZ_FREQ = { monthly: 'חודשי', weekly: 'שבועי', yearly: 'שנתי' };
const mzHebStr = iso => { const h = MH.fromISO(iso); return `${MH.num(h.day)} ${MZ_HM[h.month]} ${MH.num(h.year % 1000)}`; };
const mzGregStr = iso => new Date(iso + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
const mzNotifDef = () => ({ enabled: false, threshold: 100, timeOfDay: '09:00', dayOfMonth: 1, hebrewMonths: [], gregorianMonths: [], holidays: Object.fromEntries(MZ_HOL.map(h => [h.id, { enabled: false, daysBefore: 0 }])) });
function mz() {
  const s = S.settings; if (!s.maaser) s.maaser = {}; const m = s.maaser;
  if (typeof m.rate !== 'number') m.rate = .1;
  m.notif = { ...mzNotifDef(), ...(m.notif || {}) }; m.notif.holidays = { ...mzNotifDef().holidays, ...m.notif.holidays };
  return m;
}
let mzAdd = 'income', mzHist = { tf: 'all', q: '', pft: 'none', year: null, month: null };
const MZ_CLASSES = { income: 'הכנסה חייבת במעשרות', payment: 'תרומה', payRec: 'תרומה קבועה' };
const mzTitheOpts = (sel = '', first = 'ברירת מחדל (הכנסה חייבת, הוצאה רגילה)') => `<option value="">${first}</option><option value="none" ${sel === 'none' ? 'selected' : ''}>לא נספרת במעשרות</option>${Object.entries(MZ_CLASSES).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('')}`;
const mzTxTitheOpts = sel => mzTitheOpts(sel, '🌾 מעשרות: לפי כלל / ברירת מחדל');
// תנועות בנק שנספרות במעשרות: לפי התנועה (tx.tithe), הכלל (rules[].tithe), הקטגוריה (settings.maaser.cats), ואחרת ברירת המחדל: כל הכנסה חייבת במעשרות וכל הוצאה רגילה. 'none' מוציא מהספירה. רישום ידני באותו סכום ובטווח 3 ימים נחשב אותה תנועה, ולא נספר פעמיים
function mzBank() {
  const cats = mz().cats || {}, rl = ruleList(), out = [];
  const manual = S.data.tithes.map(e => ({ type: e.type, amt: +e.amount, rd: MH.isoRD(e.date), used: false }));
  const nb = nbCats();
  for (const t of live('tx')) { // live כבר מוציא תנועות שלא נספרות בתקציב (העברות, כפילויות, "לא נספרת"), וכאן גם קטגוריות "לא קשור"
    if (nb.includes(t.cat)) continue;
    const n = normNote(t.note), r = rl.find(x => n.includes(x.nk)), k = t.tithe || (r && r.tithe) || cats[t.cat] || (t.type === 'income' ? 'income' : ''), amt = +t.amount, type = k === 'income' ? 'income' : 'payment';
    if (!MZ_CLASSES[k] || !(amt > 0) || (k === 'income') !== (t.type === 'income')) continue; // 'none' ואי-התאמה בין סוג התנועה לסיווג מוחרגים
    const date = effDate(t), rd = MH.isoRD(date), dup = manual.find(m => !m.used && m.type === type && Math.abs(m.amt - amt) < 0.005 && Math.abs(m.rd - rd) <= 3);
    if (dup) { dup.used = true; continue; }
    out.push({ id: 'tx-' + t.id, date, type, amount: amt, description: t.note || t.cat || 'תנועת בנק', note: 'מהבנק' + (t.cat ? ' · ' + t.cat : ''), fromTx: true, ...(k === 'payRec' ? { recurringId: 'bank' } : {}) });
  }
  return out;
}
const mzAll = () => [...S.data.tithes, ...mzBank()];
function mzTotals() {
  let inc = 0, paid = 0; mzAll().forEach(e => { if (e.type === 'income') inc += +e.amount; if (e.type === 'payment') paid += +e.amount; });
  const oblig = inc * mz().rate, bal = Math.max(0, oblig - paid);
  return { inc, paid, oblig, bal, extra: Math.max(0, paid - oblig), pct: oblig > 0 ? Math.min(100, paid / oblig * 100) : 0 };
}
const mzR2 = n => Math.round(n * 100) / 100;
function mzNext(rec, fromISO) { // המועד הבא של תרומה קבועה אחרי מועד נתון
  const [y, m, d] = fromISO.split('-').map(Number), [sy, sm, sd] = rec.startDate.split('-').map(Number);
  const dim = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate(), iso = (yy, mm, dd) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  if (rec.frequency === 'weekly') return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  if (rec.frequency === 'monthly') { const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1; return iso(ny, nm, Math.min(sd, dim(ny, nm))); }
  return iso(y + 1, sm, Math.min(sd, dim(y + 1, sm)));
}
function mzProcess() { // רושם תרומה לכל מועד קבוע שהגיע. המזהה נגזר מהמועד, ולכן שני מכשירים לא יוצרים כפילות
  const t = today(); let n = 0;
  for (const rec of S.data.titheRec.filter(r => r.active !== false)) {
    let cur = rec.lastProcessed ? mzNext(rec, rec.lastProcessed) : rec.startDate, guard = 0, changed = false, r = { ...rec };
    while (cur <= t && guard++ < 1000) {
      if (r.endDate && cur > r.endDate) { r.active = false; changed = true; break; }
      const id = 'm-' + rec.id + '-' + cur;
      if (!S.data.tithes.some(e => e.id === id)) { put('tithes', { id, date: cur, type: rec.type === 'income' ? 'income' : 'payment', amount: +rec.amount, description: rec.description, note: `${rec.type === 'income' ? 'הכנסה' : 'תרומה'} קבועה (${MZ_FREQ[rec.frequency]})`, recurringId: rec.id }); n++; }
      r.lastProcessed = cur; changed = true; cur = mzNext(rec, cur);
    }
    if (r.endDate && r.lastProcessed && mzNext(rec, r.lastProcessed) > r.endDate && r.active !== false) { r.active = false; changed = true; }
    if (changed) put('titheRec', r);
  }
  if (n) toast(n + ' רשומות קבועות נרשמו');
}
function mzTodayLabel() { // האם היום מוגדרת התראה: מחזיר את שם האירוע, או null
  const n = mz().notif, t = today(), h = MH.fromISO(t), rd = MH.isoRD(t), [, gm, gd] = t.split('-').map(Number), dom = n.dayOfMonth || 1;
  if (n.hebrewMonths.includes(h.month) && h.day === dom) return MZ_HM[h.month];
  if (n.gregorianMonths.includes(gm) && gd === dom) return MZ_GM[gm - 1];
  for (const [id, cfg] of Object.entries(n.holidays)) {
    if (!cfg.enabled) continue; const hol = MZ_HOL.find(x => x.id === id); if (!hol) continue;
    const b = cfg.daysBefore || 0;
    if ([h.year, h.year - 1].some(y => MH.toRD(y, hol.month, hol.day) - b === rd)) return b > 0 ? `${b} ימים לפני ${hol.name}` : hol.name;
  }
  return null;
}
function mzSetCatTithe(name, v) { // 'none' נשמר, כי הוא מוציא קטגוריה של הכנסות מהספירה
  const c = mz().cats || (mz().cats = {}); if (v) c[name] = v; else delete c[name]; }
function mzSnap() { // היתרה נשמרת בהגדרות כדי שההתראות בשרת יתבססו על אותו חישוב (כולל תנועות הבנק)
  const m = mz(), bal = Math.round(mzTotals().bal * 100) / 100; if (m.bal !== bal) { m.bal = bal; save(); }
}
function mzNav(sub) { return `<div class="mz-tabs">${[['dash', '▦', 'סיכום'], ['add', '＋', 'הוספה'], ['hist', '🕘', 'היסטוריה'], ['notif', '🔔', 'התראות'], ['set', '⚙️', 'הגדרות']].map(([k, ic, l]) => `<button class="${k === sub ? 'active' : ''}" data-sub="maaser:${k}"><b>${ic}</b>${l}</button>`).join('')}</div>`; }
const mzTog = (attrs, on) => `<label class="tog-wrap"><input type="checkbox" ${attrs} ${on ? 'checked' : ''}><span class="tog-slider"></span></label>`;
const mzDel = (c, id) => canEdit() ? `<button class="h-del" data-del="${c}:${id}" title="מחיקה">✕</button>` : '';
function mzDash() {
  const { inc, paid, oblig, bal, extra, pct } = mzTotals(), pc = Math.round(mz().rate * 100);
  return `<div class="summary-grid"><div class="sc"><div class="sc-label">סה"כ הכנסות</div><div class="sc-value">${fmt(inc)}</div></div><div class="sc hi"><div class="sc-label">חובת מעשר (${pc}%)</div><div class="sc-value">${fmt(oblig)}</div></div>
  <div class="sc"><div class="sc-label">שולם עד כה</div><div class="sc-value">${fmt(paid)}</div></div><div class="sc ${bal > 0 ? 'err' : 'ok'}"><div class="sc-label">יתרה לתשלום</div><div class="sc-value">${fmt(bal)}</div>${extra > 0 ? `<div class="sc-label" style="margin-top:4px">עודף ${fmt(extra)} למעשר הבא ✓</div>` : ''}</div></div>
  <div class="card"><div class="mz-row"><span class="card-title" style="margin:0">התקדמות תשלום המעשר</span><span class="sp"></span><b style="font-size:.8em;color:${pct >= 100 ? '#228B22' : 'var(--c-pri)'}">${pct >= 100 ? '✓ שולם' : Math.round(pct) + '%'}</b></div><div class="prog-wrap"><div class="prog-bar" style="width:${pct.toFixed(1)}%;${pct >= 100 ? 'background:#228B22' : ''}"></div></div></div>
  ${canEdit() ? '<button class="qp-trigger-card" id="mz-quick"><span><div class="qp-trigger-label">⚡ תרומה מהירה</div><div class="qp-trigger-sub">לחץ לתשלום מעשר</div></span><span class="qp-trigger-icon">‹</span></button>' : ''}`;
}
function mzAddView() {
  return `<div class="card"><div class="type-toggle">${[['income', 't-inc', '💰 הכנסה'], ['payment', 't-pay', '🕊️ תרומות'], ['recurring', 't-rec', '🔁 קבועה']].map(([k, c, l]) => `<button class="type-btn ${c} ${k === mzAdd ? 'active' : ''}" data-mz-type="${k}">${l}</button>`).join('')}</div>
  <div id="mz-one" ${mzAdd === 'recurring' ? 'hidden' : ''}><div class="form-group"><label class="form-label">סכום (₪) *</label><input class="form-input" id="mz-amt" type="number" min="0" step="0.01" placeholder="0.00"><div class="preview-box" id="mz-prev" hidden></div></div>
  <div class="form-group"><label class="form-label">תיאור *</label><input class="form-input" id="mz-desc" type="text" placeholder="משכורת או תרומה..."></div>
  <div class="form-group"><label class="form-label">תאריך</label><input class="form-input" id="mz-date" type="date" value="${today()}"></div>
  <div class="form-group"><label class="form-label">הערה</label><textarea class="form-textarea" id="mz-note" placeholder="פרטים נוספים..."></textarea></div>
  <button class="btn btn-pri btn-full" id="mz-save">💾 שמור</button></div>
  <div id="mz-rec" ${mzAdd === 'recurring' ? '' : 'hidden'}><div class="form-group"><label class="form-label">סוג</label><select class="form-select" id="mz-r-type"><option value="income">💰 הכנסה קבועה</option><option value="payment">🕊️ תרומה קבועה</option></select></div>
  <div class="form-group"><label class="form-label">סכום (₪) *</label><input class="form-input" id="mz-r-amt" type="number" min="0" step="0.01" placeholder="0.00"></div>
  <div class="form-group"><label class="form-label">תיאור *</label><input class="form-input" id="mz-r-desc" type="text" placeholder="משכורת, תרומה חודשית לישיבה..."></div>
  <div class="form-group"><label class="form-label">תדירות</label><select class="form-select" id="mz-r-freq">${Object.entries(MZ_FREQ).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
  <div class="form-group"><label class="form-label">תאריך התחלה</label><input class="form-input" id="mz-r-start" type="date" value="${today()}"></div>
  <div class="form-group"><div class="mz-row" style="margin-bottom:5px"><label class="form-label" style="margin:0">תאריך סיום</label>${mzTog('id="mz-r-has"', false)}</div><input class="form-input" id="mz-r-end" type="date" disabled style="opacity:.42"></div>
  <div class="form-group"><label class="form-label">הערה</label><input class="form-input" id="mz-r-note" type="text" placeholder="פרטים..."></div>
  <button class="btn btn-full" id="mz-r-save" style="background:#E65100;color:#fff">💾 שמירה</button></div></div>`;
}
function mzMatch(e) {
  const h = mzHist, q = h.q.trim().toLowerCase();
  if (h.tf === 'recurring' ? !e.recurringId : h.tf !== 'all' && (e.type !== h.tf || e.recurringId)) return false;
  if (h.pft !== 'none' && h.year !== null) {
    if (h.pft === 'hebrew') { const x = MH.fromISO(e.date); if (x.year !== h.year || (h.month !== null && x.month !== h.month)) return false; }
    else { const [y, m] = e.date.split('-').map(Number); if (y !== h.year || (h.month !== null && m !== h.month)) return false; }
  }
  return !q || e.description.toLowerCase().includes(q) || (e.note || '').toLowerCase().includes(q) || e.date.includes(q) || mzHebStr(e.date).includes(h.q.trim()) || mzGregStr(e.date).includes(h.q.trim());
}
function mzList() {
  const list = mzAll().filter(mzMatch).sort((a, b) => b.date.localeCompare(a.date)), rate = mz().rate;
  return `<div class="result-count">${list.length ? list.length + ' רשומות' : ''}</div>` + (list.length ? `<div class="hist-list">${list.map(e => { const inc = e.type === 'income', rec = !!e.recurringId, k = rec ? 'rec' : inc ? 'inc' : 'pay';
    return `<div class="hist-item${rec ? ' rec-item' : ''}"><div class="h-icon ${k}">${rec ? '🔁' : inc ? '💰' : '🕊️'}</div><div class="h-body"><div class="h-desc">${esc(e.description)}</div><div class="h-meta">${mzHebStr(e.date)} · ${mzGregStr(e.date)}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
    <div class="h-right"><div class="h-amt ${k}">${inc ? '+' : '-'}${fmt(e.amount)}</div>${inc ? `<span class="h-maaser">מעשר: ${fmt(e.amount * rate)}</span>` : ''}</div>${e.fromTx ? '<span title="נספר אוטומטית מתנועת בנק. משנים בכללי הסיווג" style="font-size:.8em;opacity:.6">🏦</span>' : mzDel('tithes', e.id)}</div>`; }).join('')}</div>` : '<div class="empty"><div class="empty-icon">📭</div><div class="empty-txt">אין רשומות תואמות</div></div>');
}
function mzHistView() {
  const h = mzHist, all = mzAll(), years = new Set(all.map(e => h.pft === 'hebrew' ? MH.fromISO(e.date).year : +e.date.slice(0, 4))), chip = (on, attr, l, cls = '') => `<button class="chip ${cls} ${on ? 'active' : ''}" ${attr}>${l}</button>`;
  let sel = '';
  if (h.pft !== 'none') {
    sel = `<div class="filter-label">שנה</div><div class="chip-row" style="margin-bottom:6px">${[...years].sort((a, b) => b - a).map(y => chip(h.year === y, `data-mz-year="${y}"`, h.pft === 'hebrew' ? `${MH.num(y % 1000)} (${y})` : y)).join('')}</div>`;
    if (h.year !== null) { const ms = new Set(all.map(e => h.pft === 'hebrew' ? MH.fromISO(e.date) : { year: +e.date.slice(0, 4), month: +e.date.slice(5, 7) }).filter(x => x.year === h.year).map(x => x.month));
      sel += `<div class="filter-label">חודש</div><div class="chip-row">` + (h.pft === 'hebrew' ? MZ_CIVIL : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).filter(m => ms.has(m)).map(m => chip(h.month === m, `data-mz-month="${m}"`, h.pft === 'hebrew' ? MZ_HM[m] : MZ_GM[m - 1])).join('') + '</div>'; }
  }
  return `<div class="hist-toolbar"><div class="chip-row" style="flex:1">${[['all', 'הכל', ''], ['income', '💰 הכנסות', ''], ['payment', '🕊️ תרומות', ''], ['recurring', '🔁 קבועות', 'org']].map(([k, l, c]) => chip(h.tf === k, `data-mz-tf="${k}"`, l, c)).join('')}</div><div class="io-btns"><button class="btn btn-sec btn-sm" id="mz-exp" title="יצוא">📄</button><button class="btn btn-sec btn-sm" id="mz-imp" title="ייבוא">📥</button></div></div>
  <div class="search-wrap"><span class="search-icon">🔍</span><input class="form-input search-input" id="mz-q" type="text" placeholder="חיפוש לפי תיאור, הערה, תאריך..." value="${esc(h.q)}"></div>
  <div class="filter-block"><div class="filter-label">סינון לפי תקופה</div><div class="chip-row" style="margin-bottom:6px">${[['none', 'ללא סינון'], ['hebrew', 'עברי'], ['greg', 'לועזי']].map(([k, l]) => chip(h.pft === k, `data-mz-pft="${k}"`, l)).join('')}</div>${sel}</div><div id="mz-list">${mzList()}</div>`;
}
function mzNotifView() {
  const n = mz().notif, hol = MZ_HOL.map(h => `<div class="hol-card">${mzTog(`data-mz-hol="${h.id}"`, n.holidays[h.id].enabled)}<div class="hol-name">${h.name}</div>
    <select class="form-select" data-mz-holb="${h.id}" style="width:auto;padding:3px 7px;font-size:.7em">${MZ_BEFORE.map(([v, l]) => `<option value="${v}" ${n.holidays[h.id].daysBefore === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`).join('');
  return `<div class="notif-master"><div><div style="font-size:.88em;font-weight:700">🔔 התראות מערכת</div><div style="font-size:.68em;opacity:.6;margin-top:2px">שלח התראה כאשר יתרת המעשר גבוהה</div></div>${mzTog('id="mz-n-on"', n.enabled)}</div>
  <div class="notif-sec ${n.enabled ? 'on' : ''}"><div class="card"><div class="card-title">⚙️ סף וזמן</div><div class="form-group"><label class="form-label">שלח כאשר יתרה גבוהה מ- (₪)</label><input class="form-input" id="mz-n-th" type="number" min="0" step="10" value="${n.threshold}"></div>
  <div class="form-group"><label class="form-label">שעת שליחה</label><input class="form-input" id="mz-n-time" type="time" value="${esc(n.timeOfDay)}"></div><div class="form-group"><label class="form-label">ביום ה- ___ לחודש</label><select class="form-select" id="mz-n-dom">${[1, 5, 10, 15, 20, 25].map(d => `<option ${n.dayOfMonth === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div></div>
  <div class="card"><div class="card-title">📅 חודשים עבריים</div><div class="chip-row">${MZ_CIVIL.map(m => `<button class="chip ${n.hebrewMonths.includes(m) ? 'active' : ''}" data-mz-hm="${m}">${MZ_HM[m]}</button>`).join('')}</div></div>
  <div class="card"><div class="card-title">📅 חודשים לועזיים</div><div class="chip-row">${MZ_GM.map((l, i) => `<button class="chip ${n.gregorianMonths.includes(i + 1) ? 'active' : ''}" data-mz-gm="${i + 1}">${l}</button>`).join('')}</div></div>
  <div class="card"><div class="card-title">✡️ חגים ומועדים</div><div style="font-size:.68em;opacity:.6;margin-bottom:8px">תזכורת לפני (או ביום) חג:</div>${hol}</div>
  <div class="mz-row"><button class="btn btn-pri" style="flex:1" id="mz-n-save">💾 שמור</button><button class="btn btn-sec" id="mz-n-test">🔍 בדוק היום</button></div>
  <div style="font-size:.68em;opacity:.55;margin-top:8px;line-height:1.4">ההתראה נשלחת מהשרת לטלפון ולמייל של מי שמורשה לתקציב, פעם אחת בכל מועד. השעה נקבעת לפי תדירות הטיימר של האתר.</div></div>`;
}
function mzSetView() {
  const r = mz().rate, recs = S.data.titheRec;
  return `<div class="settings-section"><div class="settings-sec-title">שיעור המעשר</div><div class="rate-grid"><button class="rate-btn ${r === .1 ? 'sel' : ''}" data-mz-rate="0.1">מעשר<small>10% מהכנסות</small></button><button class="rate-btn ${r === .2 ? 'sel' : ''}" data-mz-rate="0.2">חומש<small>20% מהכנסות</small></button></div></div><hr class="div">
  <div class="settings-section"><div class="settings-sec-title">מה נספר אוטומטית</div><div style="font-size:.72em;opacity:.65;line-height:1.4">כל הכנסה בתקציב (תנועות בנק) נספרת כחייבת במעשרות. הוצאה נספרת כתרומה רק אם סימנת אותה כך. להוצאה או להכנסה מסוימת אפשר לשנות בטבלת התנועות, בכללי הסיווג או בקטגוריות: "לא נספרת במעשרות", תרומה, תרומה קבועה או הכנסה חייבת.</div></div><hr class="div">
  <div class="settings-section"><div class="settings-sec-title">פרטיות וקוד גישה</div><div style="font-size:.72em;opacity:.65;line-height:1.4">הסתרת הסכומים (👁 בכותרת) וקוד הגישה פועלים על כל התקציב כולל המעשרות, ומגדירים אותם בלשונית "עוד".</div></div><hr class="div">
  <div class="settings-section"><div class="settings-sec-title">הכנסות ותרומות קבועות</div>${recs.length ? recs.map(x => `<div class="rec-card${x.active === false ? ' ended' : ''}"><div style="flex-shrink:0">${x.type === 'income' ? '💰' : '🕊️'}🔁</div><div class="rec-body"><div class="rec-name">${esc(x.description)} · ${fmt(x.amount)}</div><div class="rec-meta">${MZ_FREQ[x.frequency]} · ${x.endDate ? 'עד ' + mzGregStr(x.endDate) : 'ללא הגבלה'}</div></div><span class="rec-status ${x.active === false ? 'ended' : 'active'}">${x.active === false ? 'הסתיים' : 'פעיל'}</span>${mzDel('titheRec', x.id)}</div>`).join('') : '<div class="empty" style="padding:10px"><div class="empty-txt">אין רשומות קבועות</div></div>'}<div style="font-size:.68em;opacity:.5;margin-top:4px">להוספה: "הוספה" ← 🔁 קבועה</div></div><hr class="div">
  ${canEdit() ? '<div class="settings-section"><div class="settings-sec-title">אזור מסוכן</div><div class="danger-zone"><div class="danger-zone-title">⚠️ איפוס נתוני מעשרות</div><div class="danger-zone-sub">מחיקת כל ההכנסות, התרומות והרשומות הקבועות של המעשרות (שאר התקציב לא נפגע). פעולה בלתי הפיכה.</div><button class="btn btn-err btn-full" id="mz-clear">🗑️ מחק את כל נתוני המעשרות</button></div></div>' : ''}`;
}
V.maaser = () => { const sub = subTab.maaser || 'dash'; mzSnap(); return `<div class="mz">${mzNav(sub)}<div class="mz-panel">${({ dash: mzDash, add: mzAddView, hist: mzHistView, notif: mzNotifView, set: mzSetView }[sub] || mzDash)()}</div></div>`; };
function mzConfirm(msg) { return new Promise(res => { const m = modal(`<h2>${esc(msg)}</h2><div class="row"><button class="b red" id="y">כן</button><button class="b sec" id="n">לא</button></div>`); m.querySelector('#y').onclick = () => { m.remove(); res(true); }; m.querySelector('#n').onclick = () => { m.remove(); res(false); }; }); }
function mzQuick() {
  const m = modal(`<div class="mz"><div class="qp-title">⚡ תרומה מהירה</div><div class="form-group"><label class="form-label">סכום (₪)</label><input class="form-input" id="q-a" type="number" min="0" step="0.01" placeholder="0.00"></div><div class="form-group"><label class="form-label">תיאור (אופציונלי)</label><input class="form-input" id="q-d" type="text" placeholder="צדקה, ישיבה, עניים..."></div><button class="btn btn-pri btn-full" id="q-ok" style="padding:12px">שלם / תרום ✓</button><button class="btn btn-sec btn-full" id="q-no" style="margin-top:8px">ביטול</button></div>`);
  m.querySelector('#q-no').onclick = () => m.remove(); setTimeout(() => m.querySelector('#q-a').focus(), 100);
  m.querySelector('#q-ok').onclick = () => { const a = +m.querySelector('#q-a').value; if (!a || a <= 0) return toast('יש להזין סכום תקין'); put('tithes', { id: uid(), date: today(), type: 'payment', amount: mzR2(a), description: m.querySelector('#q-d').value.trim() || 'תשלום מעשר', note: '' }); m.remove(); render(); toast(`תרומה ${fmt(a)} נרשמה ✓`); };
}
function mzImport(j) {
  if (!j || !Array.isArray(j.entries)) throw new Error('חסר שדה entries');
  const have = new Set(S.data.tithes.map(e => e.id)), haveR = new Set(S.data.titheRec.map(r => r.id)); let n = 0;
  j.entries.filter(e => e && e.id && e.date && e.description && +e.amount > 0 && (e.type === 'income' || e.type === 'payment') && !have.has(String(e.id))).forEach(e => { put('tithes', { id: String(e.id), date: e.date, type: e.type, amount: +e.amount, description: String(e.description), note: e.note || '', ...(e.recurringId ? { recurringId: String(e.recurringId) } : {}) }); n++; });
  (Array.isArray(j.recurring) ? j.recurring : []).filter(r => r && r.id && !haveR.has(String(r.id)) && r.startDate && MZ_FREQ[r.frequency]).forEach(r => put('titheRec', { id: String(r.id), type: r.type === 'income' ? 'income' : 'payment', description: String(r.description || ''), amount: +r.amount || 0, frequency: r.frequency, startDate: r.startDate, endDate: r.endDate || null, lastProcessed: r.lastProcessed || null, active: r.active !== false, note: r.note || '' }));
  if (typeof j.rate === 'number' && (j.rate === .1 || j.rate === .2)) mz().rate = j.rate;
  if (j.notif && typeof j.notif === 'object') { const { scheduledIds, ...nt } = j.notif; mz().notif = { ...mz().notif, ...nt }; }
  save(); return n;
}
function bindMaaser() {
  const R = $('#app'), N = () => mz().notif;
  R.querySelectorAll('[data-mz-type]').forEach(b => b.onclick = () => { mzAdd = b.dataset.mzType; render(); });
  $('#mz-quick')?.addEventListener('click', mzQuick);
  $('#mz-amt')?.addEventListener('input', e => { const p = $('#mz-prev'), a = +e.target.value; p.hidden = !(mzAdd === 'income' && a > 0); p.classList.toggle('vis', !p.hidden); p.textContent = `↳ מעשר (${Math.round(mz().rate * 100)}%): ${fmt(a * mz().rate)}`; });
  $('#mz-save')?.addEventListener('click', () => {
    const a = +$('#mz-amt').value, d = $('#mz-desc').value.trim(); if (!a || a <= 0) return toast('יש להזין סכום תקין'); if (!d) return toast('יש להזין תיאור');
    put('tithes', { id: uid(), date: $('#mz-date').value || today(), type: mzAdd, amount: mzR2(a), description: d, note: $('#mz-note').value.trim() });
    subTab.maaser = 'dash'; render(); toast(`${mzAdd === 'income' ? 'הכנסה' : 'תרומה'} ${fmt(a)} נשמרה ✓`);
  });
  $('#mz-r-has')?.addEventListener('change', e => { $('#mz-r-end').disabled = !e.target.checked; });
  $('#mz-r-save')?.addEventListener('click', () => {
    const a = +$('#mz-r-amt').value, d = $('#mz-r-desc').value.trim(), start = $('#mz-r-start').value || today(), end = $('#mz-r-has').checked ? $('#mz-r-end').value : '';
    if (!a || a <= 0) return toast('יש להזין סכום'); if (!d) return toast('יש להזין תיאור'); if (end && end < start) return toast('תאריך סיום לפני התחלה');
    put('titheRec', { id: uid(), type: $('#mz-r-type').value, description: d, amount: mzR2(a), frequency: $('#mz-r-freq').value, startDate: start, endDate: end || null, lastProcessed: null, active: true, note: $('#mz-r-note').value.trim() });
    mzProcess(); subTab.maaser = 'set'; render(); toast('רשומה קבועה נוספה ✓');
  });
  R.querySelectorAll('[data-mz-tf]').forEach(b => b.onclick = () => { mzHist.tf = b.dataset.mzTf; render(); });
  R.querySelectorAll('[data-mz-pft]').forEach(b => b.onclick = () => { Object.assign(mzHist, { pft: b.dataset.mzPft, year: null, month: null }); render(); });
  R.querySelectorAll('[data-mz-year]').forEach(b => b.onclick = () => { const y = +b.dataset.mzYear; mzHist.year = mzHist.year === y ? null : y; mzHist.month = null; render(); });
  R.querySelectorAll('[data-mz-month]').forEach(b => b.onclick = () => { const m = +b.dataset.mzMonth; mzHist.month = mzHist.month === m ? null : m; render(); });
  $('#mz-q')?.addEventListener('input', e => { mzHist.q = e.target.value; $('#mz-list').innerHTML = mzList(); });
  $('#mz-exp')?.addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ version: 4, exportDate: today(), rate: mz().rate, entries: S.data.tithes, recurring: S.data.titheRec, notif: mz().notif }, null, 2)], { type: 'application/json' })); a.download = `maaser_${today()}.json`; a.click(); toast('יוצא בהצלחה ✓'); });
  $('#mz-imp')?.addEventListener('click', () => { const f = document.createElement('input'); f.type = 'file'; f.accept = '.json'; f.onchange = async () => { try { const n = mzImport(JSON.parse(await f.files[0].text())); mzProcess(); render(); toast(`ייבוא הצליח ✓ (${n} רשומות)`); } catch (x) { toast('קובץ לא תקין'); } }; f.click(); });
  R.querySelectorAll('[data-mz-rate]').forEach(b => b.onclick = () => { mz().rate = +b.dataset.mzRate; save(); render(); });
  $('#mz-clear')?.addEventListener('click', async () => { if (!await mzConfirm('למחוק את כל נתוני המעשרות? אי אפשר לשחזר.')) return; [...S.data.tithes].forEach(x => remove('tithes', x.id)); [...S.data.titheRec].forEach(x => remove('titheRec', x.id)); render(); toast('נתוני המעשרות נמחקו'); });
  const tog = (k, v) => { const a = N()[k], i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); save(); render(); };
  R.querySelectorAll('[data-mz-hm]').forEach(b => b.onclick = () => tog('hebrewMonths', +b.dataset.mzHm));
  R.querySelectorAll('[data-mz-gm]').forEach(b => b.onclick = () => tog('gregorianMonths', +b.dataset.mzGm));
  $('#mz-n-on')?.addEventListener('change', e => { N().enabled = e.target.checked; save(); render(); });
  $('#mz-n-save')?.addEventListener('click', () => {
    const n = N(); n.threshold = parseFloat($('#mz-n-th').value) || 100; n.timeOfDay = $('#mz-n-time').value || '09:00'; n.dayOfMonth = +$('#mz-n-dom').value || 1;
    MZ_HOL.forEach(h => { n.holidays[h.id] = { enabled: $(`[data-mz-hol="${h.id}"]`).checked, daysBefore: +$(`[data-mz-holb="${h.id}"]`).value || 0 }; }); save(); toast('נשמר ✓');
  });
  $('#mz-n-test')?.addEventListener('click', () => {
    const n = N(); if (!n.enabled) return toast('התראות כבויות'); const { bal } = mzTotals(); if (bal < n.threshold) return toast(`יתרה ${fmt(bal)} נמוכה מהסף`);
    const l = mzTodayLabel(); toast(l ? `🔔 יתרה ${fmt(bal)} — ${l}` : 'היום לא מוגדרת התראה');
  });
}

/* ---------- ציור ---------- */
/* ---------- נעילה בקוד: מסתירה את התקציב ממי שנמצא ליד המסך (הקוד נשמר כגיבוב, לא גלוי) ---------- */
async function pinHash(pin) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('budget-pin:' + pin));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const pinOk = () => { try { return !S.settings.pin || sessionStorage.getItem('bud_ok') === S.settings.pin; } catch (e) { return !S.settings.pin; } };
function lockScreen() {
  $('#app').innerHTML = `<div class="card" style="max-width:340px;margin:12vh auto;text-align:center"><h2>🔒 התקציב נעול</h2><input id="pin-in" type="password" inputmode="numeric" maxlength="8" placeholder="קוד כניסה" style="text-align:center" autocomplete="off"><p><button class="b" id="pin-go">כניסה</button></p><p class="mut" id="pin-msg"></p></div>`;
  const go = async () => { const h = await pinHash($('#pin-in').value.trim()); if (h === S.settings.pin) { try { sessionStorage.setItem('bud_ok', h); } catch (e) { /* בלי אחסון */ } render(); } else $('#pin-msg').textContent = 'קוד שגוי'; };
  $('#pin-go').onclick = go; $('#pin-in').onkeydown = e => { if (e.key === 'Enter') go(); }; $('#pin-in').focus();
}
function render() {
  if (ready && !pinOk()) { lockScreen(); return; }
  if (!ready) { $('#app').innerHTML = '<div class="bud-body"><p class="mut">טוען…</p></div>'; return; }
  const ys = years(); if (!curYear || !ys.includes(curYear)) curYear = ys[0];
  const vis = TABS.filter(t => ME.role !== 'home' || !['biz', 'debts'].includes(t[0]));
  if (tab !== 'cats' && tab !== 'imp' && !vis.find(t => t[0] === tab)) tab = 'home';
  if (amtHidden === null || S.settings.privAlways) amtHidden = !!(S.settings.privAlways || S.settings.privDefault);
  applyPriv();
  const keepY = scrollY;
  $('#app').innerHTML = `<nav class="bud-nav">${vis.map(t => `<button class="${t[0] === tab || (t[0] === 'cls' && tab === 'cats') || (t[0] === 'txs' && tab === 'imp') ? 'on' : ''}" data-tab="${t[0]}"><b>${t[1]}</b>${t[2]}</button>`).join('')}</nav>
    <div class="bud-top"><h1>${esc(S.settings.family || 'תקציב המשפחה')}</h1>${window.BUDGET_EXIT ? `<a href="${esc(window.BUDGET_EXIT[0])}">${esc(window.BUDGET_EXIT[1])}</a>` : ''}
    <select id="yr">${ys.map(y => `<option value="${y}" ${y === curYear ? 'selected' : ''}>${yearLabel(y)}</option>`).join('')}</select>
    <button id="cal" title="עברי / לועזי">${S.settings.calendar === 'heb' ? 'עברי' : 'לועזי'}</button><button id="eye" class="b sec" title="הצגה או הסתרה של הסכומים">👁 סכומים</button></div>
    <div class="bud-body">${V[tab]()}</div>${canEdit() ? '<button class="fab" id="fab" title="הזנה מהירה">+</button>' : ''}`;
  bind();
  scrollTo(0, keepY);
}
function bind() {
  const R = $('#app');
  if (tab === 'more' && !SYNC && !healthTried) { healthTried = true; syncLoad().then(() => render()); }
  if (tab === 'maaser') bindMaaser();
  if (tab === 'txs') bindTxs();
  if (tab === 'cls') bindCls();
  if (tab === 'cats') bindCats();
  if (tab === 'imp') bindImp();
  bindImpPrompt();
  R.querySelectorAll('[data-dd]').forEach(el => { el.onclick = () => openDD(el.dataset.dd); el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDD(el.dataset.dd); } }; });
  R.querySelectorAll('[data-sd-open]').forEach(b => b.onclick = dupSameMonth);
  $('#mortgage-import')?.addEventListener('click', mortgageImport);
  R.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); scrollTo(0, 0); });
  $('#yr').onchange = e => { curYear = +e.target.value; render(); };
  $('#eye').onclick = () => { if (S.settings.privAlways) return toast('הסתרה קבועה מופעלת. אפשר לבטל אותה בהגדרות'); amtHidden = !amtHidden; applyPriv(); };
  $('#cal').onclick = () => { S.settings.calendar = S.settings.calendar === 'heb' ? 'greg' : 'heb'; curYear = null; save(); render(); };
  $('#fab')?.addEventListener('click', quickAdd);
  R.querySelectorAll('[data-done]').forEach(b => b.onclick = () => { const p = live('plan').find(x => x.id === b.dataset.done); if (!p) return; put('tx', { id: uid(), type: p.kind === 'incomeVar' || p.kind === 'income' ? 'income' : 'expense', amount: +p.amount, cat: p.name, note: 'בוצע כמתוכנן', date: curMonth === today().slice(0, 7) ? today() : curMonth + '-15', acct: '' }); toast('נרשם: ' + p.name); render(); });
  R.querySelectorAll('[data-ydone]').forEach(b => b.onclick = () => { const r = live('yearly').find(x => x.id === b.dataset.ydone); if (!r) return; put('tx', { id: uid(), type: r.kind === 'income' ? 'income' : 'expense', amount: +r.amount, cat: r.name, note: 'בוצע כמתוכנן', date: today(), acct: '' }); toast('נרשם: ' + r.name); render(); });
  R.querySelectorAll('[data-yfill]').forEach(b => b.onclick = () => { const r = live('yearly').find(x => x.id === b.dataset.yfill); if (r) quickAdd({ cat: r.name, type: r.kind === 'income' ? 'income' : 'expense', date: today() }); });
  R.querySelectorAll('[data-fill]').forEach(b => b.onclick = () => { const p = live('plan').find(x => x.id === b.dataset.fill); if (p) quickAdd({ cat: p.name, type: p.kind === 'incomeVar' || p.kind === 'income' ? 'income' : 'expense', date: curMonth === today().slice(0, 7) ? today() : curMonth + '-15' }); });
  R.querySelectorAll('[data-add]').forEach(b => b.onclick = () => form(b.dataset.add, null, null, b.dataset.extra ? JSON.parse(b.dataset.extra) : {}));
  $('#prime-save')?.addEventListener('click', () => { S.settings.primeHist = $('#prime-hist').value; S.settings.primeAuto = $('#prime-auto').checked; S.settings.primeUpd = today(); save(); render(); toast('נשמר'); });
  R.querySelectorAll('[data-payoff]').forEach(b => b.onclick = () => {
    const d = S.data.debts.find(x => x.id === b.dataset.payoff); if (!d) return;
    const m = modal(`<h2>פירעון מוקדם: ${esc(d.name)}</h2><p class="mut">בחודש שתבחר ישולם כל מה שנשאר בבת אחת, וההחזרים אחריו יפסקו.</p><label>חודש הפירעון</label><input id="po-m" type="month" value="${today().slice(0, 7)}"><label>קנס או עמלה (לא חובה)</label><input id="po-f" type="number" step="any"><div class="row" style="margin-top:12px"><button class="b" id="po-ok">שמירה</button><button class="b sec" id="po-no">ביטול</button></div>`);
    m.querySelector('#po-no').onclick = () => m.remove();
    m.querySelector('#po-ok').onclick = () => { const ym = m.querySelector('#po-m').value; if (!ym) return; const nd = { ...d, closed: ym, closeFee: +m.querySelector('#po-f').value || 0 }; nd.end = debtInfo(nd).endYm; put('debts', nd); m.remove(); toast('הפירעון המוקדם נשמר'); render(); };
  });
  R.querySelectorAll('[data-tracks]').forEach(b => b.onclick = () => tracksModal(S.data.debts.find(x => x.id === b.dataset.tracks)));
  R.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const [c, id] = b.dataset.del.split(':'); ask('למחוק?', () => { remove(c, id); render(); }); });
  $('#ai-go')?.addEventListener('click', () => { const q = $('#ai-q').value.trim(); if (q) askAI(q); });
  R.querySelectorAll('[data-aiq]').forEach(b => b.onclick = () => { $('#ai-q').value = b.dataset.aiq; askAI(b.dataset.aiq); });
  $('#nw-snap')?.addEventListener('click', () => { const n = netWorth(), d = today(); put('snaps', { id: 's-' + d, date: d, assets: Math.round(n.assets), liab: Math.round(n.liab), net: Math.round(n.net) }); toast('צילום המצב נשמר'); render(); });
  $('#ef-m')?.addEventListener('change', e => { S.settings.efMonths = Math.max(1, Math.min(24, +e.target.value || 3)); save(); render(); });
  R.querySelectorAll('[data-renew]').forEach(b => b.onclick = () => { const p = S.data.policies.find(x => x.id === b.dataset.renew); if (!p) return; const m = modal(`<h2>חידוש: ${esc(p.name)}</h2><p class="mut">פרמיה נוכחית ${fmt(p.premium)}. מה הפרמיה החדשה?</p><input id="pn" type="number" inputmode="decimal" step="any" value="${esc(p.premium)}"><div class="row" style="margin-top:12px"><button class="b" id="pn-ok">חידוש לשנה</button><button class="b sec" id="pn-no">ביטול</button></div>`); m.querySelector('#pn-no').onclick = () => m.remove(); m.querySelector('#pn-ok').onclick = () => { const v = +m.querySelector('#pn').value; if (!(v > 0)) return; const d = new Date((p.renew || today()) + 'T12:00:00'); d.setFullYear(d.getFullYear() + 1); put('policies', { ...p, prev: p.premium, premium: v, renew: d.toISOString().slice(0, 10) }); m.remove(); render(); }; });
  R.querySelectorAll('[data-deposit]').forEach(b => b.onclick = () => { const g = S.data.goals.find(x => x.id === b.dataset.deposit); if (!g) return; const m = modal(`<h2>הפקדה ליעד: ${esc(g.name)}</h2><input id="gd" type="number" inputmode="decimal" step="any" placeholder="סכום" autofocus><div class="row" style="margin-top:12px"><button class="b" id="gd-ok">שמירה</button><button class="b sec" id="gd-no">ביטול</button></div>`); m.querySelector('#gd-no').onclick = () => m.remove(); m.querySelector('#gd-ok').onclick = () => { const v = +m.querySelector('#gd').value; if (!v) return; put('goals', { ...g, saved: (+g.saved || 0) + v }); m.remove(); render(); }; });
  R.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const [c, id] = b.dataset.edit.split(':'); form(c, S.data[c].find(x => x.id === id)); });
  R.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { const [k, v] = b.dataset.sub.split(':'); subTab[k] = v; render(); });
  R.querySelectorAll('[data-biz]').forEach(b => b.onclick = () => { curBiz = b.dataset.biz; render(); });
  R.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => makeInvoice(b.dataset.inv));
  R.querySelectorAll('[data-print]').forEach(b => b.onclick = () => printInv(b.dataset.print));
  $('#mpick')?.addEventListener('change', e => { curMonth = e.target.value; render(); });
  if ($('#sumit-card')) fetch(API + 'sumit-config', { credentials: 'same-origin' }).then(r => r.json()).then(j => {
    $('#sumit-card').innerHTML = `<h2>חיבור לסמיט (הפקת חשבוניות)</h2><p>${j.on ? '✅ מחובר' + (j.from_env ? ' (דרך הגדרות השרת)' : '') : '⚪ לא מחובר'}</p>
    <p class="mut">בחשבון הסמיט שלך (sumit.co.il): הגדרות ← הגדרות API. שם מוצג <b>מספר החברה</b>, ושם יוצרים או מעתיקים את <b>מפתח ה-API</b> (הסודי, לא המפתח הציבורי). מעתיקים אותם לכאן. אם אין לך את האפשרות בתפריט, ייתכן שהיא לא פתוחה במסלול שלך, ואז צריך לפנות לתמיכה של סמיט.</p>
    <label>מספר חברה</label><input id="sm-co" inputmode="numeric" value="${esc(j.company)}"><label>מפתח API</label><input id="sm-key" type="password" autocomplete="off" placeholder="${j.has_key ? 'שמור (השאר ריק כדי לא לשנות)' : ''}">
    <label><input type="checkbox" id="sm-draft" ${j.draft !== false ? 'checked' : ''}> מצב טיוטה (המסמכים נוצרים בסמיט כטיוטה ולא נשלחים ללקוח). מומלץ להתחיל כך ולהוריד רק אחרי בדיקה</label>
    <div class="row" style="margin-top:10px"><button class="b" id="sm-save">שמירה</button>${j.company || j.has_key ? '<button class="b sec" id="sm-off">ניתוק</button>' : ''}</div>`;
    const send = async body => { const r = await fetch(API + 'sumit-config', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }, body: JSON.stringify(body) }); const x = await r.json().catch(() => ({})); if (!r.ok) return toast(x.error || 'השמירה נכשלה'); toast('נשמר'); setTimeout(() => location.reload(), 700); };
    $('#sm-save').onclick = () => send({ company: $('#sm-co').value.trim(), key: $('#sm-key').value.trim(), draft: $('#sm-draft').checked });
    $('#sm-off')?.addEventListener('click', () => ask('לנתק את החיבור לסמיט?', () => send({ company: '', key: '' })));
  });
  if ($('#conn')) fetch(API + 'status').then(r => r.json()).then(j => {
    const ok = (b, t, f) => `<li>${b ? '✅' : '⚪'} ${b ? t : f}</li>`;
    $('#conn').innerHTML = `<ul style="list-style:none;padding:0;margin:0;line-height:1.9">
      ${ok(j.sumit.on, 'סמיט מחובר' + (j.sumit.draft ? ' (מצב טיוטה: המסמכים לא נשלחים ללקוח)' : ' (מסמכים אמיתיים!)') + ' · סוגים: ' + j.sumit.kinds.join(', '), 'סמיט לא מחובר: להגדיר ב-Render את SUMIT_COMPANY_ID ו-SUMIT_API_KEY')}
      ${ok(j.files.kind === 'drive', 'קבצים וגיבויים נשמרים בדרייב של ' + esc(j.files.account || 'חשבון האתר'), 'חשבון גוגל לא מחובר: הקבצים נשמרים על השרת ויימחקו בעדכון')}
      ${ok(j.backup.cron_secret, 'גיבוי יומי אפשרי (נדרשת משימה ב-cron-job.org לכתובת /internal/backup/)', 'חסר CRON_SECRET ב-Render, בלעדיו אין גיבוי יומי')}
      <li>📦 ${j.docs} רשומות בתקציב · 👥 ${j.people} הרשאות אישיות</li></ul>`;
  }).catch(() => { $('#conn').textContent = 'לא ניתן לטעון את מצב החיבורים'; });
  $('#s-save')?.addEventListener('click', () => { const s = S.settings; s.family = $('#s-fam').value; s.calendar = $('#s-cal').value; s.tithe = +$('#s-tithe').value || 10; s.alertCall = $('#s-call').checked; s.dateBy = $('#s-dateby').value; s.defaultAcct = $('#s-acct').value; s.fillDay = Math.min(28, Math.max(0, +$('#s-fill').value || 0));
    curYear = null; save(); render(); toast('נשמר'); });
  const privSet = (k, v) => { S.settings[k] = v; amtHidden = !!(S.settings.privAlways || S.settings.privDefault); save(); applyPriv(); };
  $('#s-priv-a')?.addEventListener('change', e => privSet('privAlways', e.target.checked));
  $('#s-priv-d')?.addEventListener('change', e => privSet('privDefault', e.target.checked));
  $('#pin-set')?.addEventListener('click', () => { const pin = ($('#s-pin').value || '').trim(); if (!/^\d{4,8}$/.test(pin)) return toast('הקוד: 4 עד 8 ספרות'); pinHash(pin).then(h => { S.settings.pin = h; try { sessionStorage.setItem('bud_ok', h); } catch (e) { /* בלי אחסון */ } save(); render(); toast('הקוד נשמר'); }); });
  $('#pin-chg')?.addEventListener('click', () => { $('#pin-form').hidden = false; $('#s-pin').focus(); });
  $('#pin-rm')?.addEventListener('click', () => { delete S.settings.pin; try { sessionStorage.removeItem('bud_ok'); } catch (e) { /* בלי אחסון */ } save(); render(); toast('הקוד הוסר'); });
  const cl = signup => async () => { S.settings.sync = { url: $('#y-url').value.trim().replace(/\/$/, ''), key: $('#y-key').value.trim(), email: $('#y-mail').value.trim() }; save(); try { await cloudLogin(S.settings.sync.email, $('#y-pass').value, signup); toast(signup ? 'החשבון נוצר (ייתכן שצריך לאשר במייל)' : 'מחובר'); sync(true); } catch (e) { toast('ההתחברות נכשלה: ' + e.message); } };
  $('#y-in')?.addEventListener('click', cl(false)); $('#y-up')?.addEventListener('click', cl(true));
  $('#adduser')?.addEventListener('click', () => {
    const m = modal(`<h2>משתמש חדש</h2><label>שם</label><input id="u-n"><label>סיסמה</label><input id="u-p" type="password"><label>הרשאה</label><select id="u-r">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === 'home' ? 'selected' : ''}>${v}</option>`).join('')}</select><div class="row" style="margin-top:14px"><button class="b" id="ok">הוספה</button></div>`);
    m.querySelector('#ok').onclick = async () => { const n = m.querySelector('#u-n').value.trim(), p = m.querySelector('#u-p').value; if (!n || !p) return; S.settings.users.push({ name: n, hash: await hash(p), role: m.querySelector('#u-r').value }); save(); m.remove(); render(); };
  });
  $('#exp')?.addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ settings: { users: [] }, data: S.data })], { type: 'application/json' })); a.download = 'גיבוי-תקציב-' + today() + '.json'; a.click(); });
  $('#imp')?.addEventListener('change', async e => { try { const r = importAny(JSON.parse(await e.target.files[0].text())); save(); toast(r); render(); } catch (x) { toast('הקובץ לא תקין'); } });
  if ($('#mz-card')) {
    const mzCall = async (method, body) => { const r = await fetch(API + 'sync-keys', { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'הפעולה נכשלה'); return j; };
    const mzShow = async () => {
      try {
        const { keys } = await mzCall('GET');
        $('#mz-list').innerHTML = keys.length ? '<h3>חיבורים פעילים</h3>' + keys.map(k => `<p>${esc(k.name)} · נוצר ${esc(k.created)}${k.last_used ? ' · שימוש אחרון ' + esc(k.last_used.slice(0, 10)) : ' · עוד לא שימש'} <button class="b red" data-mz-del="${k.id}">ביטול</button></p>`).join('') : 'עוד אין חיבורים.';
        $('#mz-list').querySelectorAll('[data-mz-del]').forEach(b => b.onclick = async () => { if (!confirm('לבטל את החיבור? מזרק תפסיק לשלוח לכאן.')) return; try { await mzCall('DELETE', { id: +b.dataset.mzDel }); toast('החיבור בוטל'); mzShow(); } catch (x) { toast(x.message); } });
      } catch (x) { $('#mz-list').textContent = x.message; }
    };
    mzShow();
    $('#mz-gen').onclick = async () => {
      try {
        const { code } = await mzCall('POST', { generate: true, name: $('#mz-name').value });
        $('#mz-code').innerHTML = `<p><b>הקוד (מוצג פעם אחת, העתיקו אותו עכשיו):</b></p><textarea id="mz-code-text" readonly rows="3" dir="ltr" style="width:100%">${esc(code)}</textarea><p><button class="b sec" id="mz-copy">העתקה</button> <span class="mut">בתוכנה מזרק: "התקציב שלי" ← הדבקת קוד חיבור ← החלה ← שמור ← פעיל.</span></p>`;
        $('#mz-copy').onclick = () => { const t = $('#mz-code-text'); t.select(); navigator.clipboard?.writeText(t.value).then(() => toast('הועתק'), () => toast('סמנו והעתיקו ידנית')); };
        mzShow();
      } catch (x) { toast(x.message); }
    };
    $('#mz-add').onclick = async () => { try { await mzCall('POST', { name: $('#mz-name').value, key: $('#mz-key').value }); $('#mz-key').value = ''; toast('החיבור נוסף'); mzShow(); } catch (x) { toast(x.message); } };
  }
  $('#wipe')?.addEventListener('click', () => {
    if (!window.BUDGET_CAN_WIPE || !canEdit()) return;
    const phrase = 'מחק את כל נתוני התקציב';
    const m = modal(`<h2>מחיקה לצמיתות</h2>
      <p class="bad">הפעולה תמחק את כל נתוני התקציב, כולל ההגדרות, ההכנסות, ההוצאות, החובות והמסמכים, עבור כל משתמשי הפרויקט. אי אפשר לשחזר את הנתונים.</p>
      <label for="wipe-confirm">כדי לאשר, הקלד בדיוק: <b>${phrase}</b></label>
      <input id="wipe-confirm" autocomplete="off">
      <div class="row" style="margin-top:14px"><button class="b red" id="wipe-go" disabled>מחיקה לצמיתות</button><button class="b sec" id="wipe-cancel">ביטול</button></div>`);
    const input = m.querySelector('#wipe-confirm'), go = m.querySelector('#wipe-go');
    m.querySelector('#wipe-cancel').onclick = () => m.remove();
    input.addEventListener('input', () => { go.disabled = input.value.trim() !== phrase; });
    go.onclick = async () => {
      if (input.value.trim() !== phrase) return;
      go.disabled = true; go.textContent = 'מוחק…';
      let queued = [], wiped = false;
      try {
        // ממתינים לבקשות שמירה שכבר נשלחו כדי שלא יכתבו מחדש נתונים אחרי המחיקה.
        clearTimeout(flushT);
        while (flushing) await new Promise(resolve => setTimeout(resolve, 40));
        clearTimeout(flushT);
        queued = pending.slice();
        pending = [];
        const r = await fetch(API + 'wipe', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
          body: JSON.stringify({ confirm: 'DELETE_ALL_BUDGET_DATA' })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || 'השרת לא אישר את המחיקה');
        wiped = true; queued = [];
        COLL.forEach(c => { S.data[c] = []; });
        S.settings = { family: '', calendar: 'heb', tithe: 10 };
        pending = []; tab = 'home'; curBiz = null; curYear = null;
        m.remove(); render(); toast('כל נתוני התקציב נמחקו לצמיתות');
      } catch (e) {
        if (!wiped && queued.length) {
          pending.unshift(...queued);
          clearTimeout(flushT); flushT = setTimeout(flush, 200);
        }
        go.disabled = false; go.textContent = 'מחיקה לצמיתות';
        toast('המחיקה נכשלה: ' + (e.message || 'שגיאת תקשורת'));
      }
    };
  });
}


(async function init() {
  render();
  try { await pull(); } catch (e) { ready = true; render(); toast('אין חיבור לשרת'); }
  setInterval(() => { if (!document.querySelector('.modal') && !pending.length && !flushing && document.visibilityState === 'visible') pull(true).catch(() => { }); }, 60000);
})();
})();
