import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanUpdaterLeftovers } from './updaterCleanup';

const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-'));
  const updaterDir = path.join(root, 'mizrak-updater');
  fs.mkdirSync(path.join(updaterDir, 'pending'), { recursive: true });
  fs.writeFileSync(path.join(updaterDir, 'installer.exe'), 'x'.repeat(100));
  fs.writeFileSync(path.join(updaterDir, 'pending', 'mizrak.exe'), 'x'.repeat(50));
  fs.writeFileSync(path.join(updaterDir, 'pending', 'temp-mizrak.exe'), 'x'.repeat(30));
  return { updaterDir, markerFile: path.join(root, 'marker.txt') };
}

describe('cleanUpdaterLeftovers', () => {
  it('בהרצה הראשונה לא מוחק, רק זוכר את הגרסה', () => {
    const s = setup();
    expect(cleanUpdaterLeftovers({ ...s, version: '1.0.0' })).toBe(0);
    expect(fs.existsSync(path.join(s.updaterDir, 'installer.exe'))).toBe(true);
    expect(fs.readFileSync(s.markerFile, 'utf8')).toBe('1.0.0');
  });

  it('אחרי מעבר גרסה מוחק את כל מה שבתיקיית ההורדות וגם את ההתקנה הישנה', () => {
    const s = setup();
    cleanUpdaterLeftovers({ ...s, version: '1.0.0' });
    const freed = cleanUpdaterLeftovers({ ...s, version: '1.0.1' });
    expect(freed).toBe(180);
    expect(fs.readdirSync(path.join(s.updaterDir, 'pending'))).toEqual([]);
    expect(fs.existsSync(path.join(s.updaterDir, 'installer.exe'))).toBe(false);
  });

  it('באותה גרסה מוחק רק קבצים זמניים שישנים מיום', () => {
    const s = setup();
    cleanUpdaterLeftovers({ ...s, version: '1.0.0' });
    expect(cleanUpdaterLeftovers({ ...s, version: '1.0.0' })).toBe(0);
    const freed = cleanUpdaterLeftovers({ ...s, version: '1.0.0', now: Date.now() + 2 * DAY });
    expect(freed).toBe(30);
    expect(fs.existsSync(path.join(s.updaterDir, 'pending', 'mizrak.exe'))).toBe(true);
  });
});
