import { visibleDocs, type BudgetDoc } from './docSync';

export const COLLECTIONS = ['plan', 'yearly', 'debts', 'accounts', 'tx', 'bizs', 'orders', 'bizExp', 'invoices', 'reminders', 'goals', 'assets', 'snaps', 'policies', 'rules', 'settings', 'tithes', 'titheRec'];

export interface BatchOp {
  c: string;
  id: string;
  data?: Record<string, unknown>;
  del?: boolean;
}

export function docsToAll(docs: BudgetDoc[]) {
  const out: Record<string, unknown> = {};
  for (const d of visibleDocs(docs)) {
    if (!COLLECTIONS.includes(d.c)) continue;
    if (d.c === 'settings') {
      const settings = (out.settings ??= {}) as Record<string, unknown>;
      settings[d.id] = d.data;
    } else {
      ((out[d.c] ??= []) as unknown[]).push(d.data);
    }
  }
  return out;
}
