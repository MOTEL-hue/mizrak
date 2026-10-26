import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dir } = vi.hoisted(() => ({ dir: `${process.env.TMPDIR ?? '/tmp'}/ms-${process.pid}` }));
vi.mock('@/app-globals', () => ({ userDataPath: dir }));

import { markMortgageOk, markMortgageTry, setMortgageOverride, setMortgageMode, shouldReadMortgage } from './mortgageSchedule';

const DAY = 24 * 60 * 60 * 1000;

describe('shouldReadMortgage', () => {
  beforeEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    setMortgageOverride(undefined);
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

  it('תדירות שבועית: קוראים אחרי שבוע', () => {
    setMortgageMode('periodic', 7);
    markMortgageTry();
    markMortgageOk();
    expect(shouldReadMortgage(Date.now() + 6 * DAY)).toBe(false);
    expect(shouldReadMortgage(Date.now() + 8 * DAY)).toBe(true);
  });

  it('ידני בלבד: לא קוראים, אלא בבקשה מהכפתור', () => {
    setMortgageMode('manual');
    expect(shouldReadMortgage()).toBe(false);
    setMortgageOverride('with');
    expect(shouldReadMortgage()).toBe(true);
  });

  it('בקשה "בלי משכנתא" מדלגת גם כשהגיע הזמן', () => {
    setMortgageOverride('without');
    expect(shouldReadMortgage()).toBe(false);
  });

  it('בכל סנכרון: תמיד קוראים', () => {
    setMortgageMode('always');
    markMortgageOk();
    expect(shouldReadMortgage()).toBe(true);
    expect(fs.existsSync(path.join(dir, 'mortgage-schedule.json'))).toBe(true);
  });
});
