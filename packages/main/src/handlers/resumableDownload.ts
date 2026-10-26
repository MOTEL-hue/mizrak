import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';

// הורדה שממשיכה מהמקום שנעצרה: הקובץ החלקי נשמר בדיסק, וכל ניסיון חדש מבקש רק את ההמשך (Range).
// נטפרי וחיבורים איטיים קוטעים הורדות גדולות, ולכן ממשיכים לנסות עד שאין שום התקדמות כמה ניסיונות ברצף.
export interface RangeResponse {
  status: number;
  total?: number;
  body: Readable;
}
export type FetchRange = (start: number, end?: number) => Promise<RangeResponse>;

const MAX_ATTEMPTS_WITHOUT_PROGRESS = 20;
const STALL_MS = 30_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')));
  });
}

const sizeOf = (file: string) => (fs.existsSync(file) ? fs.statSync(file).size : 0);

async function pipeToFile(res: RangeResponse, partFile: string, append: boolean, onBytes: (size: number) => void) {
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(partFile, { flags: append ? 'a' : 'w' });
    let stall: NodeJS.Timeout;
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => res.body.destroy(new Error('ההורדה נתקעה')), STALL_MS);
    };
    arm();
    res.body.on('data', (chunk: Buffer) => {
      arm();
      out.write(chunk);
    });
    const finish = (err?: Error) => {
      clearTimeout(stall);
      out.end(() => (err ? reject(err) : resolve()));
    };
    res.body.on('end', () => finish());
    res.body.on('error', (err) => finish(err));
    res.body.on('close', () => finish());
  });
  onBytes(sizeOf(partFile));
}

export async function downloadResumable(opts: {
  fetchRange: FetchRange;
  partFile: string;
  sha512: string;
  onProgress?: (percent: number) => void;
  log?: (message: string) => void;
  retryDelayMs?: number;
}): Promise<void> {
  const { fetchRange, partFile, sha512, onProgress, log, retryDelayMs = 1000 } = opts;
  let total = 0;
  let idle = 0;
  let verifyFailures = 0;
  for (;;) {
    const start = sizeOf(partFile);
    if (total && start >= total) {
      if ((await hashFile(partFile)) === sha512) return;
      log?.('סכום הבדיקה של הקובץ שהורד לא תואם, מתחילים מחדש');
      fs.rmSync(partFile, { force: true });
      if (++verifyFailures > 2) throw new Error('הקובץ שהורד פגום');
      continue;
    }
    try {
      const res = await fetchRange(start);
      if (res.status === 416) {
        // השרת אומר שההתחלה חורגת מהקובץ: הקובץ החלקי מלא או פגום, והבדיקה למעלה תחליט
        total = start;
        continue;
      }
      if (res.status !== 200 && res.status !== 206) throw new Error(`השרת החזיר ${res.status}`);
      const resumed = res.status === 206 && start > 0;
      if (res.total) total = res.total;
      // התקדמות תוך כדי ההורדה (ולא רק בסופה), כדי שהסרגל יזוז
      const ticker = setInterval(() => {
        if (total) onProgress?.(Math.min(99, Math.round((sizeOf(partFile) / total) * 100)));
      }, 500);
      try {
        await pipeToFile(res, partFile, resumed, () => undefined);
      } finally {
        clearInterval(ticker);
      }
    } catch (e) {
      log?.(`הורדה נקטעה: ${(e as Error).message}`);
    }
    const now = sizeOf(partFile);
    idle = now > start ? 0 : idle + 1;
    if (idle >= MAX_ATTEMPTS_WITHOUT_PROGRESS) throw new Error('ההורדה לא מתקדמת. בדוק את החיבור לאינטרנט');
    if (!total || now < total) await sleep(Math.min(10 * retryDelayMs, retryDelayMs * (idle + 1)));
  }
}

// הורדה במספר חיבורים במקביל: כל חלק מהקובץ יורד בנפרד (עם המשך מהמקום שנקטע), ובסוף מחברים ובודקים את סכום הבדיקה.
// חיבור בודד מוגבל לפעמים למהירות נמוכה מאוד (למשל בסינון תוכן), וכמה חיבורים יחד מהירים בהרבה.
class RangeUnsupportedError extends Error {}

async function downloadSegment(opts: { fetchRange: FetchRange; file: string; from: number; to: number; log?: (m: string) => void; retryDelayMs: number }) {
  const { fetchRange, file, from, to, log, retryDelayMs } = opts;
  const length = to - from + 1;
  let idle = 0;
  for (;;) {
    const start = sizeOf(file);
    if (start >= length) return;
    try {
      const res = await fetchRange(from + start, to);
      if (res.status !== 206) {
        res.body.destroy();
        // השרת (או הסינון בדרך) לא תומך בהורדה בחלקים: אין טעם לנסות שוב, עוברים להורדה רגילה
        throw new RangeUnsupportedError(`השרת החזיר ${res.status} במקום 206`);
      }
      await pipeToFile(res, file, true, () => undefined);
    } catch (e) {
      if (e instanceof RangeUnsupportedError) throw e;
      log?.(`חלק הורדה נקטע: ${(e as Error).message}`);
    }
    const now = sizeOf(file);
    idle = now > start ? 0 : idle + 1;
    if (now >= length) return;
    if (idle >= MAX_ATTEMPTS_WITHOUT_PROGRESS) throw new Error('ההורדה לא מתקדמת');
    await sleep(Math.min(10 * retryDelayMs, retryDelayMs * (idle + 1)));
  }
}

export async function downloadParallel(opts: {
  fetchRange: FetchRange;
  partFile: string;
  sha512: string;
  total: number;
  segments?: number;
  onProgress?: (percent: number) => void;
  log?: (message: string) => void;
  retryDelayMs?: number;
}): Promise<void> {
  const { fetchRange, partFile, sha512, total, segments = 6, onProgress, log, retryDelayMs = 1000 } = opts;
  const size = Math.ceil(total / segments);
  const ranges = Array.from({ length: segments }, (_, i) => ({ from: i * size, to: Math.min(total, (i + 1) * size) - 1 })).filter((r) => r.from < total);
  const files = ranges.map((_, i) => `${partFile}.seg${i}`);
  log?.(`הורדה במקביל: ${ranges.length} חלקים, ${total} בייט`);
  const ticker = setInterval(() => {
    const done = files.reduce((sum, f) => sum + sizeOf(f), 0);
    onProgress?.(Math.min(99, Math.round((done / total) * 100)));
  }, 500);
  try {
    await Promise.all(ranges.map((r, i) => downloadSegment({ fetchRange, file: files[i], from: r.from, to: r.to, log, retryDelayMs })));
  } finally {
    clearInterval(ticker);
  }
  fs.rmSync(partFile, { force: true });
  for (const f of files) {
    fs.appendFileSync(partFile, fs.readFileSync(f));
    fs.rmSync(f, { force: true });
  }
  if ((await hashFile(partFile)) !== sha512) {
    fs.rmSync(partFile, { force: true });
    throw new Error('הקובץ שהורד פגום');
  }
  onProgress?.(100);
}
