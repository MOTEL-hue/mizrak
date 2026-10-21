// היתרה המדויקת של חשבונות הבנק, כפי שהוחזרה בסריקה האחרונה. נשלחת לתקציב יחד עם התנועות.
// כרטיסי אשראי לא נכללים: היתרה שלהם היא חוב ולא כסף בחשבון.
const CARD_COMPANIES = ['isracard', 'amex', 'visaCal', 'max', 'leumiCard', 'behatsdaa'];

export interface BankBalance {
  key: string;
  accountNumber: string;
  balance: number;
}

const latest = new Map<string, BankBalance>();

export function recordBalances(key: string, accounts: { accountNumber: string; balance?: number }[] | undefined) {
  if (CARD_COMPANIES.includes(key)) return;
  (accounts ?? []).forEach((a) => {
    if (typeof a.balance === 'number' && Number.isFinite(a.balance)) {
      latest.set(`${key}|${a.accountNumber}`, { key, accountNumber: a.accountNumber, balance: a.balance });
    }
  });
}

export const getBalances = (): BankBalance[] => Array.from(latest.values());
