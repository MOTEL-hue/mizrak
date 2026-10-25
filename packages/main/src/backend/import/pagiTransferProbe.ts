import fs from 'node:fs';
import path from 'node:path';
import { type Browser, type ElementHandle, type Frame, type Page } from 'puppeteer-core';
import { userDataPath } from '@/app-globals';
import { logAppEvent } from '/@/logging/operationLogger';
import { clickByText, PORTAL_URL } from './pagiMortgages';

// בדיקה חד-פעמית: בפאג"י תנועת העברה מופיעה כ"העברה מהחשבון" בלי שם המעביר או המקבל. כאן נשמר מה שהאתר מציג
// בכל שלב (דף התנועות, ואחרי לחיצה על תנועת העברה), כדי לדעת איפה הפרטים נמצאים. הקובץ נכנס לקובץ האבחון.
export const TRANSFER_DIAGNOSTIC_FILE = 'pagi-transfer-diagnostic-4.txt';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TRANSACTIONS_URL = `${PORTAL_URL.split('#')[0]}#/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;

// אחרי ניווט ההקשר של הדף נהרס באמצע הקריאה: מנסים שוב אחרי שהדף נרגע
async function snapshot(page: Page, title: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await snapshotOnce(page, title);
    } catch {
      await sleep(3000);
    }
  }
  return `## ${title}\n(לא נקלט)`;
}

async function snapshotOnce(page: Page, title: string) {
  const parts = await Promise.all(
    page.frames().filter((f) => !/netfree/i.test(f.url())).map(async (frame) => {
      const text = await frame.evaluate(() => document.body?.innerText ?? '');
      return text.trim() ? `[${frame.url().split('?')[0].slice(-80)}] ${text.replace(/\s+/g, ' ').slice(0, 6000)}` : '';
    }),
  );
  return `## ${title}\n${parts.filter(Boolean).join('\n')}`.replace(/[\d-]{7,}/g, '###');
}

export function transferProbeDone() {
  return fs.existsSync(path.join(userDataPath, TRANSFER_DIAGNOSTIC_FILE));
}

const mask = (s: string) => s.replace(/[\d-]{7,}/g, '###');

// כל שורות הטקסט שמוצגות כרגע בכל המסגרות (בלי הפרסומות של נטפרי)
async function visibleLines(page: Page) {
  const lines = new Set<string>();
  for (const frame of page.frames().filter((f) => !/netfree/i.test(f.url()))) {
    const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    text.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => lines.add(l));
  }
  return lines;
}

async function findTransferRow(page: Page): Promise<{ frame: Frame; row: ElementHandle<Element> } | undefined> {
  for (const frame of page.frames()) {
    const handle = await frame
      .evaluateHandle(() => {
        const cells = Array.from(document.querySelectorAll('td')).filter((td) => (td.textContent ?? '').trim().startsWith('העברה מהחשבון'));
        return cells.at(-1)?.closest('tr') ?? null;
      })
      .catch(() => undefined);
    const row = handle?.asElement();
    if (row) return { frame, row: row as ElementHandle<Element> };
  }
  return undefined;
}

// בדיקה: מה קורה כשלוחצים על שורת "העברה מהחשבון" בטבלת התנועות. נשמרים מבנה השורה, ומה שנוסף למסך אחרי כל לחיצה
export async function probePagiTransfers(browser: Browser, timeout: number) {
  let page: Page | undefined;
  const stages: string[] = [];
  const work = async () => {
    page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    await page.goto(TRANSACTIONS_URL, { waitUntil: 'domcontentloaded' });
    await sleep(12000);
    const found = await findTransferRow(page);
    if (!found) {
      stages.push(await snapshot(page, 'לא נמצאה שורת "העברה מהחשבון"'));
      return;
    }
    const html = await found.row.evaluate((el) => el.outerHTML);
    stages.push(`## מבנה השורה\n${mask(html).replace(/\s+/g, ' ').slice(0, 4000)}`);
    const targets = await found.row.$$('td, a, img, button, span[onclick], div[onclick]');
    const seen = new Set(await visibleLines(page));
    for (const [index, target] of [found.row, ...targets].entries()) {
      await target.click().catch(() => undefined);
      await sleep(3000);
      const now = await visibleLines(page);
      const added = [...now].filter((l) => !seen.has(l));
      added.forEach((l) => seen.add(l));
      const tag = await target.evaluate((el) => `${el.tagName} ${(el.textContent ?? '').trim().slice(0, 30)}`).catch(() => '?');
      stages.push(`## לחיצה ${index} (${mask(tag)})\n${added.length ? mask(added.join(' | ')).slice(0, 2500) : '(לא נוסף דבר)'}`);
    }
    const pages = await browser.pages();
    stages.push(`## חלונות פתוחים: ${pages.map((p) => p.url().split('?')[0].slice(-60)).join(' , ')}`);
  };
  try {
    await Promise.race([work(), sleep(100_000)]);
  } catch (e) {
    stages.push(`שגיאה: ${(e as Error).message}`);
  } finally {
    await page?.close().catch(() => undefined);
    try {
      fs.writeFileSync(path.join(userDataPath, TRANSFER_DIAGNOSTIC_FILE), stages.join('\n\n') || '(לא נקלט דבר)');
      logAppEvent('PAGI_TRANSFER_PROBE_DONE', { stages: stages.length });
    } catch {
      // אבחון בלבד
    }
  }
}
