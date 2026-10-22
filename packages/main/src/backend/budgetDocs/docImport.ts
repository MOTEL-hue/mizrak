import { createHash } from 'crypto';

// קליטת תנועות שנמשכו מהבנקים לתוך מסמכי התקציב: אותה לוגיקה כמו בקליטה שבאתר (api/import).
export interface ScrapedTx {
  hash?: string;
  chargedAmount?: number;
  originalAmount?: number;
  description?: string;
  memo?: string;
  category?: string;
  date?: string;
  processedDate?: string;
}

export type TxDoc = Record<string, unknown> & { id: string; cat: string; note: string; pd: string };

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const cut = (v: unknown, n: number) => String(v ?? '').slice(0, n);

// תיאור בלי מספרים וסכומים, כדי שחיובים חוזרים יתקבצו יחד (אותה פונקציה כמו בדף התקציב)
export const normNote = (note: unknown) =>
  String(note ?? '')
    .replace(/[₪]|סכום העסקה|מתוך/g, ' ')
    .replace(/\d[\d,./:-]*/g, ' ')
    .replace(/[\s\-:]+/g, ' ')
    .trim();

export function importTx(item: ScrapedTx): TxDoc | null {
  const hash = item.hash;
  const amount = Number(item.chargedAmount ?? item.originalAmount);
  if (typeof hash !== 'string' || !hash || !Number.isFinite(amount) || !amount) return null;
  const id = ID_RE.test(`bk-${hash}`) ? `bk-${hash}` : `bk-${createHash('sha256').update(hash, 'utf8').digest('hex').slice(0, 40)}`;
  const parts = hash.split('_');
  const [company, account] = parts.length >= 3 ? [parts[parts.length - 2], parts[parts.length - 1].replace(/\D/g, '').slice(-4)] : ['', ''];
  const note = [cut(item.description, 120), cut(item.memo, 120)].filter(Boolean).join(' - ');
  return {
    id,
    type: amount < 0 ? 'expense' : 'income',
    amount: Math.abs(amount),
    cat: cut(item.category, 60),
    note,
    date: cut(item.date, 10),
    acct: '',
    co: company.slice(0, 30),
    ac: account,
    pd: cut(item.processedDate, 10),
  };
}

// כללי הסיווג שנקבעו במסך הכללים, הארוכים קודם כדי שהספציפי ינצח
export function explicitRules(ruleDocs: { key?: unknown; cat?: unknown }[]): [string, string][] {
  const rules: [string, string][] = [];
  for (const d of ruleDocs) {
    const key = normNote(d.key);
    const cat = String(d.cat ?? '').trim();
    if (key && cat) rules.push([key, cat]);
  }
  return rules.sort((a, b) => b[0].length - a[0].length);
}

export const ruleCat = (rules: [string, string][], note: string) => {
  const norm = normNote(note);
  return rules.find(([key]) => norm.includes(key))?.[1] ?? '';
};
