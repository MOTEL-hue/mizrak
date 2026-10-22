import { describe, expect, it } from 'vitest';
import { explicitRules, importTx, normNote, ruleCat } from './docImport';

describe('importTx', () => {
  it('ממיר תנועה: הוצאה, חברה וחשבון מהמזהה', () => {
    const t = importTx({ hash: '2026-09-10T06:37:00.000Z_-30_תיאור__isracard_5461', chargedAmount: -30, description: 'שופרסל', memo: 'דיל', date: '2026-09-10T06:37:00.000Z' })!;
    expect(t).toMatchObject({ type: 'expense', amount: 30, co: 'isracard', ac: '5461', note: 'שופרסל - דיל', date: '2026-09-10' });
    expect(t.id).toMatch(/^bk-[a-f0-9]{40}$/); // מזהה עם עברית נהפך לקיצור קבוע
  });
  it('בלי סכום או מזהה: מדלג', () => {
    expect(importTx({ hash: 'x', chargedAmount: 0 })).toBeNull();
    expect(importTx({ chargedAmount: 5 })).toBeNull();
  });
});

describe('כללי סיווג', () => {
  it('הכלל הארוך והספציפי מנצח, ומספרים לא משפיעים', () => {
    const rules = explicitRules([{ key: 'שופרסל', cat: 'מזון' }, { key: 'שופרסל אונליין', cat: 'משלוחים' }]);
    expect(ruleCat(rules, 'שופרסל אונליין 1234')).toBe('משלוחים');
    expect(ruleCat(rules, 'שופרסל דיל 55.5')).toBe('מזון');
    expect(ruleCat(rules, 'משהו אחר')).toBe('');
  });
  it('מנרמל סכומים וסימנים', () => {
    expect(normNote('הוראת קבע - 120.50 ₪ מתוך 12')).toBe('הוראת קבע');
  });
});
