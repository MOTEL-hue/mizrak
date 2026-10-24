import { userDataPath } from '@/app-globals';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { type BudgetDoc } from './docSync';
import { loadDocs, mergeRemote, repairBankDates } from './docStore';

// הסנכרון הדו-כיווני של מסמכי התקציב עם האתר. נקרא מהגשר ברקע; כישלון (למשל בלי אינטרנט) לא מזיק,
// כי המסמכים נשארים מקומית והסנכרון הבא ישלים.
const cursorPath = path.resolve(userDataPath, 'budget.docs.cursor');
const BATCH = 400; // האתר מקבל עד 500 מסמכים בכל שליחה

const readCursor = async () => (existsSync(cursorPath) ? (await fs.readFile(cursorPath, 'utf8')).trim() : '');

export async function syncDocs(base: string, token: string): Promise<{ pulled: number; pushed: number }> {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const url = `${base}/budget/api/docs-sync`;
  await repairBankDates().catch(() => 0);
  let pulled = 0;
  let pushed = 0;
  let since = await readCursor();
  const toPush = new Map<string, BudgetDoc>();
  for (;;) {
    const response = await fetch(since ? `${url}?since=${encodeURIComponent(since)}` : url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`סנכרון מסמכים נכשל (${response.status})`);
    const page = (await response.json()) as { docs: BudgetDoc[]; more: boolean; now: string };
    for (const d of await mergeRemote(page.docs)) toPush.set(`${d.c}/${d.id}`, d);
    pulled += page.docs.length;
    if (!page.more) {
      since = page.now;
      break;
    }
    since = page.docs[page.docs.length - 1].updated;
  }
  // מה שהאתר כבר מכיר באותה גרסה לא נשלח; השאר נשלח. אם נכשל, הסמן לא מתקדם ונסנכרן שוב.
  const local = await loadDocs();
  const pending = local.filter((d) => toPush.has(`${d.c}/${d.id}`));
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH).map((d) => ({ c: d.c, id: d.id, data: d.data, updated: d.updated, deleted: !!d.deleted }));
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ docs: chunk }), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`שליחת מסמכים נכשלה (${response.status})`);
    pushed += chunk.length;
  }
  await fs.writeFile(cursorPath, since, 'utf8');
  return { pulled, pushed };
}
