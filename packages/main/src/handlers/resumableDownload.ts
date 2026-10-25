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
export type FetchRange = (start: number) => Promise<RangeResponse>;

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
      await pipeToFile(res, partFile, resumed, (size) => {
        if (total) onProgress?.(Math.round((size / total) * 100));
      });
    } catch (e) {
      log?.(`הורדה נקטעה: ${(e as Error).message}`);
    }
    const now = sizeOf(partFile);
    idle = now > start ? 0 : idle + 1;
    if (idle >= MAX_ATTEMPTS_WITHOUT_PROGRESS) throw new Error('ההורדה לא מתקדמת. בדוק את החיבור לאינטרנט');
    if (!total || now < total) await sleep(Math.min(10 * retryDelayMs, retryDelayMs * (idle + 1)));
  }
}
