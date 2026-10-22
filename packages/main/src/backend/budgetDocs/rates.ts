// ריבית בנק ישראל וריבית הפריים (בנק ישראל + 1.5%), נמשכת מהמחשב. אותה לוגיקה כמו budget/rates.py באתר.
export const PRIME_MARGIN = 1.5;

export const BOI_RATES_URLS = [
  'https://edge.boi.gov.il/FusionEdgeServer/ws/public/sdmxapi/rest/data/BIR?startPeriod=2015-01',
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BIR/1.0/?format=csv&startperiod=2015-01',
  'https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BIR/1.0/?format=csv&startperiod=2015-01',
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BIR/1.0/?c%5BSERIES_CODE%5D=BIR_RATE&format=csv&startperiod=2015-01',
];

// ריבית בנק ישראל לפי חודש תחילת התוקף. משמשת רק כשאי אפשר להביא נתון עדכני, כדי שלא יחושב ערך שגוי.
const BUILTIN_BOI: [string, number][] = [['2015-03', 0.1], ['2018-11', 0.25], ['2020-04', 0.1], ['2022-04', 0.35], ['2022-05', 0.75], ['2022-07', 1.25], ['2022-08', 2.0], ['2022-10', 2.75], ['2022-11', 3.25], ['2023-01', 3.75], ['2023-02', 4.25], ['2023-04', 4.5], ['2023-05', 4.75], ['2024-01', 4.5], ['2025-11', 4.25], ['2026-01', 4.0], ['2026-05', 3.75], ['2026-07', 3.5], ['2026-09', 3.25]];

export type PrimeSeries = [string, number][];

const round2 = (n: number) => Math.round(n * 100) / 100;

function* points(text: string): Generator<[string, string]> {
  if (text.trimStart().startsWith('<')) {
    for (const part of text.split(/<(?:\w+:)?Obs\b/).slice(1)) {
      const obs = part.includes('Obs>') ? part.split('Obs>')[0] : part.slice(0, 400);
      const period = obs.match(/(?:TIME_PERIOD|TimePeriod|ObsDimension\b[^>]*?value)="([^"]+)"/);
      const value = obs.match(/(?:OBS_VALUE|ObsValue\b[^>]*?value)="([^"]+)"/);
      if (period && value) yield [period[1], value[1]];
    }
    return;
  }
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const header = (lines.shift() ?? '').split(',').map((h) => h.trim().replace(/^"|"$/g, '').toUpperCase());
  const ti = header.indexOf('TIME_PERIOD');
  const vi = header.indexOf('OBS_VALUE');
  if (ti < 0 || vi < 0) return;
  for (const line of lines) {
    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    yield [cells[ti] ?? '', cells[vi] ?? ''];
  }
}

// קובץ SDMX (CSV או XML) ← [[חודש 'YYYY-MM', ריבית פריים]] רק בנקודות שבהן הריבית השתנתה
export function parseRates(text: string): PrimeSeries {
  const byMonth = new Map<string, number>();
  for (const [period, value] of points(text)) {
    const m = period.match(/^(\d{4})-(\d{2})/);
    const rate = parseFloat(value);
    if (m && Number.isFinite(rate) && rate >= 0 && rate <= 30) byMonth.set(`${m[1]}-${m[2]}`, round2(rate + PRIME_MARGIN));
  }
  const out: PrimeSeries = [];
  for (const ym of [...byMonth.keys()].sort()) {
    const rate = byMonth.get(ym)!;
    if (!out.length || out[out.length - 1][1] !== rate) out.push([ym, rate]);
  }
  return out;
}

export const builtinSeries = (): PrimeSeries => BUILTIN_BOI.map(([ym, r]) => [ym, round2(r + PRIME_MARGIN)]);

export interface RatesResult {
  prime: PrimeSeries;
  fetched: string;
  error: string;
  builtin: boolean;
}

const DAY = 24 * 3600_000;
const HOUR = 3600_000;
let cache: (RatesResult & { tried: number }) | null = null;

// נמשכת לכל היותר פעם ביום (בכישלון: פעם בשעה). בלי אינטרנט: הנתונים המובנים, וההודעה מוצגת בדף.
export async function getRates(): Promise<RatesResult> {
  const now = Date.now();
  if (cache && now - cache.tried < (cache.error ? HOUR : DAY)) return cache;
  const errors: string[] = [];
  for (const url of BOI_RATES_URLS) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`שגיאה ${response.status}`);
      const series = parseRates((await response.text()).slice(0, 2_000_000));
      if (!series.length) throw new Error('לא נמצאו נתוני ריבית בקובץ');
      cache = { prime: series, fetched: new Date(now).toISOString(), error: '', builtin: false, tried: now };
      return cache;
    } catch (e) {
      errors.push((e as Error).message.slice(0, 120));
    }
  }
  cache = { prime: cache?.prime.length ? cache.prime : builtinSeries(), fetched: cache?.fetched ?? '', error: errors[0] ?? 'אין חיבור', builtin: !cache?.prime.length || cache.builtin, tried: now };
  return cache;
}
