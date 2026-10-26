import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dir } = vi.hoisted(() => ({ dir: `${process.env.TMPDIR ?? '/tmp'}/ms-${process.pid}` }));
vi.mock('@/app-globals', () => ({ userDataPath: dir }));

import { markMortgageOk, markMortgageTry, setMortgageForced, setMortgageMode, shouldReadMortgage } from './mortgageSchedule';

const DAY = 24 * 60 * 60 * 1000;

describe('shouldReadMortgage', () => {
  beforeEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    setMortgageForced(false);
  });

  it('פעם ראשונה: קוראים', () => expect(shouldReadMortgage()).toBe(true));

  it('בחודשי: אחרי הצלחה לא קוראים עד שחולף חודש', () => {
    markMortgageTry();
    markMortgageOk();
    expect(shouldReadMortgage()).toBe(false);
    expect(shouldReadMortgage(Date.now() + 31 * DAY)).toBe(true);
  });

  it('אחרי כישלון מנסים שוב רק אחרי יום', () => {
    markMortgageTry();
    expect(shouldReadMortgage()).toBe(false);
    expect(shouldReadMortgage(Date.now() + 2 * DAY)).toBe(true);
  });

  it('ידני בלבד: לא קוראים, אלא בבקשה מהכפתור', () => {
    setMortgageMode('manual');
    expect(shouldReadMortgage()).toBe(false);
    setMortgageForced(true);
    expect(shouldReadMortgage()).toBe(true);
  });

  it('בכל סנכרון: תמיד קוראים', () => {
    setMortgageMode('always');
    markMortgageOk();
    expect(shouldReadMortgage()).toBe(true);
    expect(fs.existsSync(path.join(dir, 'mortgage-schedule.json'))).toBe(true);
  });
});
