import { userDataPath } from '@/app-globals';
import { decrypt, encrypt } from '@/backend/configManager/encryption/crypto';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { applyLocal, planSync, type BudgetDoc } from './docSync';

// עותק מקומי ומוצפן של מסמכי התקציב. עובד גם בלי אינטרנט.
const storePath = path.resolve(userDataPath, 'budget.docs.encrypt');

export async function loadDocs(): Promise<BudgetDoc[]> {
  if (!existsSync(storePath)) return [];
  try {
    const decrypted = await decrypt(await fs.readFile(storePath, 'utf8'));
    return decrypted ? (JSON.parse(decrypted) as BudgetDoc[]) : [];
  } catch {
    return [];
  }
}

const saveDocs = async (docs: BudgetDoc[]) => fs.writeFile(storePath, await encrypt(JSON.stringify(docs)), 'utf8');

// קריאה-שינוי-כתיבה אחת בכל פעם, כדי ששמירה מהדף וסנכרון ברקע לא ידרסו זה את זה
let queue: Promise<unknown> = Promise.resolve();
const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
};

export type DocChange = { c: string; id: string; data?: Record<string, unknown>; del?: boolean };

// כמה שינויים בכתיבה אחת של הקובץ (הקובץ מוצפן כולו, ולכן לא כותבים אותו מחדש לכל שינוי)
export const writeMany = (changes: DocChange[]) =>
  exclusive(async () => {
    let docs = await loadDocs();
    for (const ch of changes) {
      docs = applyLocal(docs, ch.del ? { c: ch.c, id: ch.id, data: {}, deleted: true } : { c: ch.c, id: ch.id, data: ch.data ?? {} });
    }
    await saveDocs(docs);
  });

// מקבל את מה שיש באתר, שומר אצלנו את החדש ממנו, ומחזיר מה לשלוח לאתר
export const mergeRemote = (remote: BudgetDoc[]): Promise<BudgetDoc[]> =>
  exclusive(async () => {
    const local = await loadDocs();
    const { toPush, toStore } = planSync(local, remote);
    if (toStore.length > 0) {
      const keys = new Set(toStore.map((d) => `${d.c}/${d.id}`));
      await saveDocs([...local.filter((d) => !keys.has(`${d.c}/${d.id}`)), ...toStore]);
    }
    return toPush;
  });
