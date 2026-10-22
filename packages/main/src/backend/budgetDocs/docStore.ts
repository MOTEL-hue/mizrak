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

export async function writeDoc(c: string, id: string, data: Record<string, unknown>) {
  await saveDocs(applyLocal(await loadDocs(), { c, id, data }));
}

export async function deleteDoc(c: string, id: string) {
  await saveDocs(applyLocal(await loadDocs(), { c, id, data: {}, deleted: true }));
}

// מקבל את מה שיש באתר, שומר אצלנו את החדש ממנו, ומחזיר מה לשלוח לאתר
export async function mergeRemote(remote: BudgetDoc[]): Promise<BudgetDoc[]> {
  const local = await loadDocs();
  const { toPush, toStore } = planSync(local, remote);
  if (toStore.length > 0) {
    const keys = new Set(toStore.map((d) => `${d.c}/${d.id}`));
    await saveDocs([...local.filter((d) => !keys.has(`${d.c}/${d.id}`)), ...toStore]);
  }
  return toPush;
}
