import { userDataPath } from '@/app-globals';
import fs from 'node:fs';
import path from 'node:path';

// היתרה המדויקת של חשבונות הבנק, כפי שהוחזרה בסריקה האחרונה. נשלחת לתקציב יחד עם התנועות.
// נשמרת בקובץ, כדי שלא תאבד כשסריקה ממשיכה מחשבונות ששמורים מריצה קודמת.
// כרטיסי אשראי לא נכללים: היתרה שלהם היא חוב ולא כסף בחשבון.
const CARD_COMPANIES = ['isracard', 'amex', 'visaCal', 'max', 'leumiCard', 'behatsdaa'];
const filePath = () => path.join(userDataPath, 'balances.json');

export interface BankBalance {
  key: string;
  accountNumber: string;
  balance: number;
}

let latest: Map<string, BankBalance> | null = null;

function load() {
  if (latest) return latest;
  latest = new Map();
  try {
    (JSON.parse(fs.readFileSync(filePath(), 'utf8')) as BankBalance[]).forEach((b) =>
      latest!.set(`${b.key}|${b.accountNumber}`, b),
    );
  } catch {
    // עוד אין קובץ
  }
  return latest;
}

export function recordBalances(key: string, accounts: { accountNumber: string; balance?: number }[] | undefined) {
  if (CARD_COMPANIES.includes(key)) return;
  const map = load();
  // גם בנק שלא מחזיר יתרה מסומן כנסרק, כדי שלא יסרק שוב ושוב רק בגלל זה
  map.set(`${key}|__seen`, { key, accountNumber: '__seen', balance: Number.NaN });
  (accounts ?? []).forEach((a) => {
    if (typeof a.balance === 'number' && Number.isFinite(a.balance)) {
      map.set(`${key}|${a.accountNumber}`, { key, accountNumber: a.accountNumber, balance: a.balance });
    }
  });
  try {
    fs.writeFileSync(filePath(), JSON.stringify(Array.from(map.values())));
  } catch {
    // אם השמירה נכשלה, היתרה עדיין זמינה עד סגירת התוכנה
  }
}

export const getBalances = (): BankBalance[] => Array.from(load().values()).filter((b) => Number.isFinite(b.balance));

export const hasBalanceOrIsCard = (key: string) =>
  CARD_COMPANIES.includes(key) || Array.from(load().values()).some((b) => b.key === key);
