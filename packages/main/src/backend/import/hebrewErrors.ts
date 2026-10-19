// תרגום הודעות שגיאה נפוצות של הבנקים וחברות האשראי להודעה ברורה בעברית.
// ההודעה המקורית נשמרת בלוג כדי שאפשר יהיה לחפש אותה.
const RULES: { pattern: RegExp; text: string }[] = [
  {
    pattern: /Automation detected|Block Automation|Status:\s*429|blocked automated access/i,
    text: 'האתר חסם את הגישה האוטומטית. כדאי להמתין כמה שעות ולנסות שוב, ולהפעיל חשבון אחד בכל פעם.',
  },
  { pattern: /INVALID_PASSWORD/i, text: 'שם המשתמש או הסיסמה שגויים. כדאי להיכנס ידנית לאתר ולוודא שהפרטים נכונים.' },
  { pattern: /CHANGE_PASSWORD/i, text: 'האתר דורש להחליף סיסמה. יש להיכנס לאתר ידנית ולהחליף אותה, ואז לעדכן כאן.' },
  { pattern: /ACCOUNT_BLOCKED/i, text: 'החשבון נחסם. יש לפתוח אותו דרך האתר או בפנייה לשירות הלקוחות.' },
  { pattern: /TIMEOUT|timed? ?out|Navigation timeout/i, text: 'האתר לא הגיב בזמן. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.' },
  {
    pattern: /Waiting for selector|selector .* failed/i,
    text: 'האתר הציג מסך שהתוכנה לא מכירה (למשל הודעה או אישור). כדאי להיכנס ידנית, לאשר את המסך, ולנסות שוב.',
  },
  { pattern: /net::ERR_|ENOTFOUND|ECONNREFUSED/i, text: 'אין חיבור לאינטרנט או שהאתר לא זמין כרגע.' },
];

export function toHebrewError(message: string | undefined): string {
  if (!message) return 'אירעה שגיאה לא ידועה.';
  const rule = RULES.find((r) => r.pattern.test(message));
  return rule ? rule.text : `אירעה שגיאה: ${message}`;
}
