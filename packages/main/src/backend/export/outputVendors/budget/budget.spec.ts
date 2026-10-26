import { describe, expect, it, vi } from 'vitest';

// בדיקות רצות בלי Electron: מחליפים את נתיבי האפליקציה בנתיבים זמניים
vi.mock('@/app-globals', () => ({
  App: { getPath: () => '/tmp', setPath: () => undefined },
  userDataPath: '/tmp',
  configFilePath: '/tmp/config.encrypt',
  defaultCsvPath: '/tmp/transaction.csv',
  defaultJsonPath: '/tmp/transaction.json',
}));

import { applyRules, importUrl, toChunks } from './budget';

describe('budget exporter', () => {
  it('בונה כתובת קליטה ומסיר לוכסן בסוף', () => {
    expect(importUrl(' https://example.com/ ')).toBe('https://example.com/budget/api/import');
  });
  it('דורש https', () => {
    expect(() => importUrl('http://example.com')).toThrow('https');
  });
  it('מחלק לקבוצות של 500', () => {
    const rows = Array.from({ length: 1201 }, (_, i) => ({ hash: `h${i}` })) as never[];
    expect(toChunks(rows).map((c) => c.length)).toEqual([500, 500, 201]);
  });
  it('מוסיף סיווג שנלמד, ולא דורס סיווג קיים', () => {
    const rows = [
      { description: 'סופר', memo: '' },
      { description: 'סופר', category: 'אחר' },
      { description: 'חשמל' },
    ] as never[];
    const result = applyRules(rows, { סופר: 'מזון' }) as { category?: string }[];
    expect(result.map((r) => r.category)).toEqual(['מזון', 'אחר', undefined]);
  });
});
