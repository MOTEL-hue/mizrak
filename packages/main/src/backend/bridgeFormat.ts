// שמות החברות בעברית, לדיווח לדף התקציב
export const COMPANY_NAMES: Record<string, string> = {
  hapoalim: 'הפועלים',
  hapoalimBeOnline: 'הפועלים',
  isracard: 'ישראכרט',
  amex: 'אמריקן אקספרס',
  visaCal: 'ויזה כאל',
  max: 'מקס',
  leumiCard: 'לאומי קארד',
  leumi: 'לאומי',
  beinleumi: 'הבינלאומי',
  pagi: 'פאג"י',
  massad: 'מסד',
  otsarHahayal: 'אוצר החייל',
  union: 'איגוד',
  discount: 'דיסקונט',
  mizrahi: 'מזרחי',
  yahav: 'יהב',
  mercantile: 'מרכנתיל',
};

export const EXPORTER_NAMES: Record<string, string> = {
  csv: 'אקסל',
  json: 'קובץ נתונים',
  budget: 'התקציב שלי',
  ynab: 'יינאב',
  googleSheets: 'גיליון גוגל',
};

export const displayName = (key: string) => COMPANY_NAMES[key] ?? EXPORTER_NAMES[key] ?? key;

export function summarizeFailures(failures: { company: string; message: string }[]) {
  if (failures.length === 0) return '';
  return failures
    .map((f) => `${displayName(f.company)}: ${f.message}`)
    .join(' | ')
    .slice(0, 280);
}

