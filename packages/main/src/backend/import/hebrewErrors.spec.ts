import { describe, expect, it } from 'vitest';
import { toHebrewError } from './hebrewErrors';

describe('toHebrewError', () => {
  it('מתרגם חסימה אוטומטית של ישראכרט', () => {
    expect(toHebrewError('GENERIC: Automation detected and blocked by server. Status: 429')).toContain('חסם');
  });
  it('מתרגם כשל בחיפוש כפתור', () => {
    expect(toHebrewError('GENERIC: Waiting for selector `#continueBtn` failed')).toContain('מסך');
  });
  it('מתרגם סיסמה שגויה', () => {
    expect(toHebrewError('INVALID_PASSWORD')).toContain('סיסמה');
  });
  it('שגיאה לא מוכרת נשמרת עם הטקסט המקורי', () => {
    expect(toHebrewError('weird')).toContain('weird');
  });
  it('ללא הודעה', () => {
    expect(toHebrewError(undefined)).toContain('לא ידועה');
  });
});
