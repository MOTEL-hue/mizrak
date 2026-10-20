import { describe, expect, it } from 'vitest';
import { companyFromHash, mergeStored } from './storeMerge';

describe('mergeStored', () => {
  it('ממזג בלי כפילויות וממיין מהחדש לישן', () => {
    const a = [{ hash: '1', date: '2026-01-01' }, { hash: '2', date: '2026-02-01' }] as never[];
    const b = [{ hash: '2', date: '2026-02-01' }, { hash: '3', date: '2026-03-01' }] as never[];
    expect(mergeStored(a, b).map((t) => t.hash)).toEqual(['3', '2', '1']);
  });
  it('מזהה חברה לפי המזהה של התנועה', () => {
    expect(companyFromHash('2026-06-10T21:00:00.000Z_-74.9_תיאור__hapoalim_12-533-88927')).toBe('hapoalim');
    expect(companyFromHash('2026-09-10T06:37:00.000Z_-30_תיאור__isracard_5461')).toBe('isracard');
  });
});
