import { describe, expect, it } from 'vitest';
import { summarizeFailures } from './bridgeFormat';

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
