import { describe, expect, it } from 'vitest';
import { ProgressTracker } from './syncProgress';

describe('ProgressTracker', () => {
  it('מתחיל באפס, וכל החשבונות ממתינים', () => {
    const t = new ProgressTracker(['isracard', 'hapoalim']);
    const s = t.snapshot();
    expect(s.percent).toBe(0);
    expect(s.steps.map((x) => x.status)).toEqual(['waiting', 'waiting']);
  });

  it('מתקדם לפי שלבים של חשבון', () => {
    const t = new ProgressTracker(['isracard', 'hapoalim']);
    t.onEvent('IMPORTER_START');
    t.onEvent('IMPORTER_PROGRESS', { message: 'LOGGING_IN' });
    const s = t.snapshot();
    expect(s.text).toBe('ישראכרט: מתחבר לאתר');
    expect(s.steps[0].status).toBe('running');
    expect(s.percent).toBeGreaterThan(0);
    expect(s.percent).toBeLessThan(40);
  });

  it('חשבון שהסתיים או נכשל, ואז שליחה ואז 100', () => {
    const t = new ProgressTracker(['isracard', 'hapoalim']);
    t.onEvent('IMPORTER_START');
    t.onEvent('IMPORTER_ERROR', { message: 'האתר חסם' });
    t.onEvent('IMPORTER_START');
    t.onEvent('IMPORTER_END');
    const mid = t.snapshot();
    expect(mid.steps.map((x) => x.status)).toEqual(['error', 'done']);
    expect(mid.percent).toBe(85);
    t.onEvent('EXPORT_PROCESS_START');
    expect(t.snapshot().percent).toBe(90);
    t.onEvent('EXPORT_PROCESS_END');
    expect(t.snapshot().percent).toBe(100);
  });

  it('הורדת דפדפן מוצגת בעברית', () => {
    const t = new ProgressTracker(['isracard']);
    t.onEvent('DOWNLOAD_CHROME', { percent: 40 });
    expect(t.snapshot().text).toContain('מוריד דפדפן (40%)');
  });
});
