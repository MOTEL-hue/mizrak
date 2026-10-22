import { describe, expect, it } from 'vitest';
import { docsToAll } from './docView';

describe('docsToAll', () => {
  it('מקבץ לפי סוג, מדלג על מחוקים והגדרות לפי מזהה', () => {
    const docs = [
      { c: 'tx', id: 'a', data: { id: 'a' }, updated: '2026-01-01T00:00:00Z' },
      { c: 'tx', id: 'b', data: { id: 'b' }, updated: '2026-01-01T00:00:00Z', deleted: true },
      { c: 'settings', id: 'main', data: { family: 'x' }, updated: '2026-01-01T00:00:00Z' },
      { c: 'zzz', id: 'q', data: {}, updated: '2026-01-01T00:00:00Z' },
    ];
    expect(docsToAll(docs)).toEqual({ tx: [{ id: 'a' }], settings: { main: { family: 'x' } } });
  });
});
