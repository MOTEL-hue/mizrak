import { describe, expect, it } from 'vitest';
import { parseMortgageText } from './pagiMortgages';

const SAMPLE = `מספר משנה: 1
סכום ההלוואה 500,000.00
יתרת קרן
412,345.67
ריבית הכוללת החזויה
4.35 %
תשלום חודשי (קרן+ריבית+הצמדה)
₪ 2,500.10
מספר משנה: 2 פריים
יתרת קרן 100,000.00
ריבית הכוללת החזויה 5.5 %
תשלום חודשי 900
מספר משנה: 3
יתרת קרן 0`;

describe('parseMortgageText', () => {
  it('מוציא יתרה, ריבית והחזר לכל מסלול ומדלג על מסלול סגור', () => {
    expect(parseMortgageText(SAMPLE)).toEqual([
      { id: '1', balance: 412345.67, rate: 4.35, payment: 2500.1, prime: false },
      { id: '2', balance: 100000, rate: 5.5, payment: 900, prime: true },
    ]);
  });

  it('מחזיר רשימה ריקה כשאין מסלולים', () => {
    expect(parseMortgageText('שלום')).toEqual([]);
  });
});
