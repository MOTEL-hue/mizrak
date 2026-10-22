// מסמכי התקציב במזרק: כל מסמך נושא זמן עדכון, ובסנכרון עם האתר השינוי האחרון מנצח.
// מחיקה נשמרת כסימון (deleted) כדי שמסמך שנמחק לא יחזור בסנכרון הבא.
export interface BudgetDoc {
  c: string; // סוג (collection)
  id: string;
  data: Record<string, unknown>;
  updated: string; // זמן ISO של השינוי האחרון
  deleted?: boolean;
}

export const docKey = (d: Pick<BudgetDoc, 'c' | 'id'>) => `${d.c}/${d.id}`;

export interface SyncPlan {
  toPush: BudgetDoc[]; // מה שחדש אצלנו ויישלח לאתר
  toStore: BudgetDoc[]; // מה שחדש באתר וישמר אצלנו
}

// השוואת זמנים לפי תאריך אמיתי ולא לפי טקסט, כי האתר והמחשב עשויים לכתוב את הזמן בצורה שונה
const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

export function planSync(local: BudgetDoc[], remote: BudgetDoc[]): SyncPlan {
  const localByKey = new Map(local.map((d) => [docKey(d), d]));
  const remoteByKey = new Map(remote.map((d) => [docKey(d), d]));
  const toPush: BudgetDoc[] = [];
  const toStore: BudgetDoc[] = [];
  for (const [key, l] of localByKey) {
    const r = remoteByKey.get(key);
    if (!r || time(l.updated) > time(r.updated)) toPush.push(l);
  }
  for (const [key, r] of remoteByKey) {
    const l = localByKey.get(key);
    if (!l || time(r.updated) > time(l.updated)) toStore.push(r);
  }
  return { toPush, toStore };
}

// כתיבה מקומית: שומרת עם זמן עדכון חדש. כך גם עריכה בלי אינטרנט תנצח בסנכרון הבא אם היא האחרונה.
export function applyLocal(docs: BudgetDoc[], change: Omit<BudgetDoc, 'updated'>, now = new Date()): BudgetDoc[] {
  const next: BudgetDoc = { ...change, updated: now.toISOString() };
  return [...docs.filter((d) => docKey(d) !== docKey(next)), next];
}

export const visibleDocs = (docs: BudgetDoc[], collection?: string) =>
  docs.filter((d) => !d.deleted && (!collection || d.c === collection));
