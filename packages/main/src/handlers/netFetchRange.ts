import { PassThrough } from 'node:stream';
import { net } from 'electron';
import type { FetchRange } from './resumableDownload';

export const netFetchRange =
  (url: string): FetchRange =>
  (start) =>
    new Promise((resolve, reject) => {
      const req = net.request({ url, redirect: 'follow' });
      if (start > 0) req.setHeader('Range', `bytes=${start}-`);
      req.on('error', reject);
      req.on('response', (res) => {
        const body = new PassThrough();
        let finished = false;
        res.on('data', (chunk) => body.write(chunk));
        res.on('end', () => {
          finished = true;
          body.end();
        });
        res.on('error', () => body.destroy(new Error('החיבור נקטע')));
        res.on('aborted', () => body.destroy(new Error('החיבור נקטע')));
        body.on('close', () => {
          if (!finished) req.abort();
        });
        const header = (name: string) => [res.headers[name]].flat()[0];
        const range = /\/(\d+)$/.exec(String(header('content-range') ?? ''));
        const total = range ? Number(range[1]) : Number(header('content-length') ?? 0) || undefined;
        resolve({ status: res.statusCode, total, body });
      });
      req.end();
    });
