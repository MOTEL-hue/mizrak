import { describe, expect, it } from 'vitest';
import { builtinSeries, parseRates } from './rates';

describe('parseRates', () => {
  it('CSV: פריים = ריבית + 1.5, ורק נקודות שינוי', () => {
    const csv = 'TIME_PERIOD,OBS_VALUE\n2026-01,4.0\n2026-02,4.0\n2026-03,3.75\n';
    expect(parseRates(csv)).toEqual([['2026-01', 5.5], ['2026-03', 5.25]]);
  });
  it('XML', () => {
    expect(parseRates('<Obs TIME_PERIOD="2026-05" OBS_VALUE="3.5"/>')).toEqual([['2026-05', 5]]);
  });
  it('קובץ לא תקין והנתונים המובנים', () => {
    expect(parseRates('זבל')).toEqual([]);
    expect(builtinSeries()[0]).toEqual(['2015-03', 1.6]);
  });
});
