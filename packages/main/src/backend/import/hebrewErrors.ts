// תרגום הודעות שגיאה נפוצות של הבנקים וחברות האשראי להודעה ברורה בעברית.
// ההודעה המקורית נשמרת בלוג כדי שאפשר יהיה לחפש אותה.
export interface ErrorRule {
  title: string;
  pattern: RegExp;
  text: string;
}

export const ERROR_RULES: ErrorRule[] = [
  {
    title: 'האתר חסם את הגישה האוטומטית',
    pattern: /Automation detected|Block Automation|Status:\s*429|blocked automated access/i,
    text: 'האתר חסם את הגישה האוטומטית. כדאי להמתין כמה שעות ולנסות שוב, ולהפעיל חשבון אחד בכל פעם.',
  },
  {
    title: 'שם משתמש או סיסמה שגויים',
    pattern: /INVALID_PASSWORD/i,
    text: 'שם המשתמש או הסיסמה שגויים. כדאי להיכנס ידנית לאתר ולוודא שהפרטים נכונים.',
  },
  {
    title: 'האתר דורש להחליף סיסמה',
    pattern: /CHANGE_PASSWORD/i,
    text: 'האתר דורש להחליף סיסמה. יש להיכנס לאתר ידנית ולהחליף אותה, ואז לעדכן כאן.',
  },
  {
    title: 'החשבון נחסם',
    pattern: /ACCOUNT_BLOCKED/i,
    text: 'החשבון נחסם. יש לפתוח אותו דרך האתר או בפנייה לשירות הלקוחות.',
  },
  {
    title: 'האתר לא הגיב בזמן',
    pattern: /TIMEOUT|timed? ?out|Navigation timeout/i,
    text: 'האתר לא הגיב בזמן. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.',
  },
  {
    title: 'מסך לא מוכר באתר',
    pattern: /Waiting for selector|selector .* failed/i,
    text: 'האתר הציג מסך שהתוכנה לא מכירה (למשל הודעה או אישור). כדאי להיכנס ידנית, לאשר את המסך, ולנסות שוב.',
  },
  {
    title: 'אין חיבור לאינטרנט',
    pattern: /net::ERR_|ENOTFOUND|ECONNREFUSED/i,
    text: 'אין חיבור לאינטרנט או שהאתר לא זמין כרגע.',
  },
];

export function toHebrewError(message: string | undefined): string {
  if (!message) return 'אירעה שגיאה לא ידועה.';
  const rule = ERROR_RULES.find((r) => r.pattern.test(message));
  if (rule) return rule.text;
  // הודעה שכבר בעברית (למשל מהתקציב) נשארת כמו שהיא
  return /[\u0590-\u05FF]/.test(message) ? message : `אירעה שגיאה: ${message}`;
}

/** כל ההסברים שמתאימים לטקסט (למשל לוג שלם), בלי כפילויות. */
export function explainText(text: string): string[] {
  return ERROR_RULES.filter((r) => r.pattern.test(text)).map((r) => `${r.title}: ${r.text}`);
}
