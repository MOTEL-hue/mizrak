import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { downloadResumable, type FetchRange } from './resumableDownload';

function server(data: Buffer, cutEvery: number): FetchRange {
  return async (start) => {
    const end = Math.min(data.length, start + cutEvery);
    const body = new Readable({ read() {} });
    body.push(data.subarray(start, end));
    // חיבור שנקטע באמצע: הזרם נסגר בלי להגיע לסוף הקובץ
    setImmediate(() => body.push(null));
    return { status: start > 0 ? 206 : 200, total: data.length, body };
  };
}

describe('downloadResumable', () => {
  it('ממשיך מהמקום שנקטע עד שהקובץ שלם ותקין', async () => {
    const data = crypto.randomBytes(100_000);
    const sha = crypto.createHash('sha512').update(data).digest('base64');
    const part = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-')), 'f.part');
    const p = downloadResumable({ fetchRange: server(data, 30_000), partFile: part, sha512: sha, retryDelayMs: 0 });
    await p;
    expect(fs.readFileSync(part).equals(data)).toBe(true);
  });

  it('מתחיל מחדש כשסכום הבדיקה לא תואם', async () => {
    const data = crypto.randomBytes(1000);
    const part = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-')), 'f.part');
    const p = downloadResumable({ fetchRange: server(data, 5000), partFile: part, sha512: 'x', retryDelayMs: 0 });
    await expect(p).rejects.toThrow('פגום');
  });
});
