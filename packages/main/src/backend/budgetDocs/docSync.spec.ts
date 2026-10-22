import { describe, expect, it } from 'vitest';
import { applyLocal, planSync, visibleDocs, type BudgetDoc } from './docSync';

const doc = (id: string, updated: string, extra: Partial<BudgetDoc> = {}): BudgetDoc => ({ c: 'tx', id, data: {}, updated, ...extra });

describe('planSync', () => {
  it('השינוי האחרון מנצח', () => {
    const plan = planSync([doc('a', '2026-01-02T00:00:00Z'), doc('b', '2026-01-01T00:00:00Z')], [doc('a', '2026-01-01T00:00:00Z'), doc('b', '2026-01-02T00:00:00Z')]);
    expect(plan.toPush.map((d) => d.id)).toEqual(['a']);
    expect(plan.toStore.map((d) => d.id)).toEqual(['b']);
  });
  it('מסמך שחסר בצד אחד עובר אליו', () => {
    const plan = planSync([doc('a', '2026-01-01T00:00:00Z')], [doc('b', '2026-01-01T00:00:00Z')]);
    expect(plan.toPush.map((d) => d.id)).toEqual(['a']);
    expect(plan.toStore.map((d) => d.id)).toEqual(['b']);
  });
  it('זמנים שווים: אין העברה', () => {
    const plan = planSync([doc('a', '2026-01-01T00:00:00Z')], [doc('a', '2026-01-01T00:00:00.000+00:00')]);
    expect(plan).toEqual({ toPush: [], toStore: [] });
  });
  it('מחיקה חדשה יותר מנצחת ולא חוזרת', () => {
    const plan = planSync([doc('a', '2026-01-02T00:00:00Z', { deleted: true })], [doc('a', '2026-01-01T00:00:00Z')]);
    expect(plan.toPush[0].deleted).toBe(true);
    expect(plan.toStore).toEqual([]);
  });
});

describe('applyLocal', () => {
  it('מחליף מסמך קיים ומעדכן זמן', () => {
    const docs = applyLocal([doc('a', '2026-01-01T00:00:00Z')], { c: 'tx', id: 'a', data: { n: 1 } }, new Date('2026-02-01T00:00:00Z'));
    expect(docs).toHaveLength(1);
    expect(docs[0].updated).toBe('2026-02-01T00:00:00.000Z');
  });
  it('מסמכים שנמחקו לא מוצגים', () => {
    expect(visibleDocs([doc('a', '2026-01-01T00:00:00Z', { deleted: true }), doc('b', '2026-01-01T00:00:00Z')]).map((d) => d.id)).toEqual(['b']);
  });
});
