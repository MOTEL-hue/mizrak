import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { downloadParallel, downloadResumable, type FetchRange } from './resumableDownload';

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

describe('downloadParallel', () => {
  it('נכשל מיד כשהשרת לא תומך בחלקים (200 במקום 206)', async () => {
    const part = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-')), 'f.part');
    const body = new Readable({ read() {} });
    body.push(null);
    const started = Date.now();
    await expect(
      downloadParallel({ fetchRange: async () => ({ status: 200, total: 100, body }), partFile: part, sha512: 'x', total: 100, segments: 2, retryDelayMs: 1000 }),
    ).rejects.toThrow('206');
    expect(Date.now() - started).toBeLessThan(500);
  });

  const rangeServer = (data: Buffer, cut: number): FetchRange => async (start, end) => {
    const last = Math.min(end ?? data.length - 1, start + cut - 1);
    const body = new Readable({ read() {} });
    body.push(data.subarray(start, last + 1));
    setImmediate(() => body.push(null));
    return { status: 206, total: data.length, body };
  };

  it('מוריד חלקים במקביל, מחבר ובודק', async () => {
    const data = crypto.randomBytes(200_000);
    const sha = crypto.createHash('sha512').update(data).digest('base64');
    const part = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-')), 'f.part');
    await downloadParallel({ fetchRange: rangeServer(data, 20_000), partFile: part, sha512: sha, total: data.length, segments: 4, retryDelayMs: 0 });
    expect(fs.readFileSync(part).equals(data)).toBe(true);
    expect(fs.existsSync(`${part}.seg0`)).toBe(false);
  });

  it('נכשל כשסכום הבדיקה לא תואם', async () => {
    const data = crypto.randomBytes(50_000);
    const part = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-')), 'f.part');
    await expect(downloadParallel({ fetchRange: rangeServer(data, 50_000), partFile: part, sha512: 'x', total: data.length, segments: 3, retryDelayMs: 0 })).rejects.toThrow('פגום');
  });
});
