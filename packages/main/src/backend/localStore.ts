import { userDataPath } from '@/app-globals';
import { type AccountToScrapeConfig, type Config, type EnrichedTransaction } from '@/backend/commonTypes';
import { decrypt, encrypt } from '@/backend/configManager/encryption/crypto';
import { existsSync, promises as fs } from 'fs';
import { companyFromHash, mergeStored, type StoredTransaction } from './storeMerge';
import path from 'path';

// עותק מקומי ומוצפן של כל התנועות שנמשכו, כדי להציג אותן בתוכנה גם בלי קובץ ייצוא
const storePath = path.resolve(userDataPath, 'transactions.store.encrypt');
export async function loadStoredTransactions(): Promise<StoredTransaction[]> {
  if (!existsSync(storePath)) return [];
  try {
    const decrypted = await decrypt(await fs.readFile(storePath, 'utf8'));
    return decrypted ? (JSON.parse(decrypted) as StoredTransaction[]) : [];
  } catch {
    return [];
  }
}

export async function saveScrapedTransactions(
  importerIdToTransactions: Record<string, EnrichedTransaction[]>,
  accounts: AccountToScrapeConfig[],
) {
  const added: StoredTransaction[] = Object.entries(importerIdToTransactions).flatMap(([id, transactions]) => {
    const companyKey = accounts.find((a) => a.id === id)?.key ?? '';
    return transactions.map((t) => ({ ...t, companyKey }));
  });
  const merged = mergeStored(await loadStoredTransactions(), added);
  await fs.writeFile(storePath, await encrypt(JSON.stringify(merged)), 'utf8');
  return merged.length;
}

// בפעם הראשונה: אם כבר יש קובץ Json מייצוא קודם, טוענים ממנו את התנועות הקיימות
export async function loadWithSeed(config: Config): Promise<StoredTransaction[]> {
  const stored = await loadStoredTransactions();
  if (stored.length > 0) return stored;
  const jsonPath = config.outputVendors.json?.options.filePath;
  if (!jsonPath || !existsSync(jsonPath)) return [];
  try {
    const rows = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as EnrichedTransaction[];
    const seeded = mergeStored(
      [],
      rows.map((t) => ({ ...t, companyKey: companyFromHash(t.hash) })),
    );
    await fs.writeFile(storePath, await encrypt(JSON.stringify(seeded)), 'utf8');
    return seeded;
  } catch {
    return [];
  }
}
