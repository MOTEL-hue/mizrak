import { type EnrichedTransaction } from '@/backend/commonTypes';

const MAX_TRANSACTIONS = 50000;

export interface StoredTransaction extends EnrichedTransaction {
  companyKey: string;
}

// שם החברה מופיע בסוף המזהה של התנועה: ..._<חברה>_<מספר חשבון>
export const companyFromHash = (hash: string) => hash.split('_').slice(-2)[0] ?? '';

export const mergeStored = (existing: StoredTransaction[], added: StoredTransaction[]): StoredTransaction[] => {
  const byHash = new Map<string, StoredTransaction>();
  [...existing, ...added].forEach((t) => byHash.set(t.hash, t));
  return [...byHash.values()]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, MAX_TRANSACTIONS);
};

