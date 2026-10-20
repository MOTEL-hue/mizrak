import { describe, expect, it } from 'vitest';
import { displayName, summarizeFailures } from './bridgeFormat';

describe('summarizeFailures', () => {
  it('ריק כשאין כשלים', () => {
    expect(summarizeFailures([])).toBe('');
  });
  it('שמות החברות בעברית, והסיבה כמו שהיא', () => {
    expect(
      summarizeFailures([
        { company: 'isracard', message: 'האתר חסם' },
        { company: 'unknownBank', message: 'שגיאה' },
      ]),
    ).toBe('ישראכרט: האתר חסם | unknownBank: שגיאה');
  });
  it('לא ארוך מדי', () => {
    expect(summarizeFailures([{ company: 'leumi', message: 'א'.repeat(500) }]).length).toBeLessThanOrEqual(280);
  });
});

describe('displayName', () => {
  it('שמות בנקים ויעדי ייצוא בעברית', () => {
    expect(displayName('isracard')).toBe('ישראכרט');
    expect(displayName('budget')).toBe('התקציב שלי');
    expect(displayName('zzz')).toBe('zzz');
  });
});
