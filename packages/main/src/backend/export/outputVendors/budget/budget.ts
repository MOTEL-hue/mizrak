import {
  OutputVendorName,
  type EnrichedTransaction,
  type ExportTransactionsFunction,
  type OutputVendor,
} from '@/backend/commonTypes';
import { logAppEvent } from '/@/logging/operationLogger';

// האתר מקבל עד 500 תנועות בכל שליחה
const CHUNK_SIZE = 500;

export function importUrl(siteUrl: string) {
  const base = siteUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) {
    throw new Error('כתובת האתר חייבת להתחיל ב-https://');
  }
  return `${base}/budget/api/import`;
}

// הסיווגים שנלמדו בתקציב: תיאור התנועה ← סעיף. תנועה בלי סיווג מקבלת את הסיווג שתוקן ידנית בתקציב.
export function applyRules(transactions: EnrichedTransaction[], rules: Record<string, string>) {
  return transactions.map((t) => {
    if (t.category) return t;
    const key = [t.description, t.memo].filter(Boolean).join(' - ');
    return rules[key] ? { ...t, category: rules[key] } : t;
  });
}

export function toChunks(transactions: EnrichedTransaction[], size = CHUNK_SIZE) {
  const chunks: EnrichedTransaction[][] = [];
  for (let i = 0; i < transactions.length; i += size) {
    chunks.push(transactions.slice(i, i + size));
  }
  return chunks;
}

const exportTransactions: ExportTransactionsFunction = async ({ transactionsToCreate, outputVendorsConfig }) => {
  const { siteUrl, token } = outputVendorsConfig.budget!.options;
  if (!token) {
    throw new Error('חסר מפתח גישה לתקציב');
  }
  const url = importUrl(siteUrl);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  let rules: Record<string, string> = {};
  try {
    const rulesResponse = await fetch(url.replace(/import$/, 'categories'), { headers });
    if (rulesResponse.ok) rules = ((await rulesResponse.json()) as { rules?: Record<string, string> }).rules ?? {};
  } catch {
    // בלי סיווגים עדיין אפשר לשלוח את התנועות
  }
  let added = 0;
  for (const chunk of toChunks(applyRules(transactionsToCreate, rules))) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ transactions: chunk }),
    });
    if (!response.ok) {
      logAppEvent('BUDGET_EXPORT_FAILED', { status: response.status });
      throw new Error(response.status === 401 ? 'מפתח הגישה לתקציב לא תקין' : `שליחה לתקציב נכשלה (${response.status})`);
    }
    added += ((await response.json()) as { added?: number }).added ?? 0;
  }
  logAppEvent('BUDGET_EXPORT_DONE', { sent: transactionsToCreate.length, added });
  return { exportedTransactionsNum: added };
};

export default {
  name: OutputVendorName.BUDGET,
  exportTransactions,
} as OutputVendor;
