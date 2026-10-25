import fs from 'node:fs';
import path from 'node:path';
import { type Browser, type Page } from 'puppeteer-core';
import { userDataPath } from '@/app-globals';
import { logAppEvent } from '/@/logging/operationLogger';
import { clickByText, PORTAL_URL } from './pagiMortgages';

// בדיקה חד-פעמית: בפאג"י תנועת העברה מופיעה כ"העברה מהחשבון" בלי שם המעביר או המקבל. כאן נשמר מה שהאתר מציג
// בכל שלב (דף התנועות, ואחרי לחיצה על תנועת העברה), כדי לדעת איפה הפרטים נמצאים. הקובץ נכנס לקובץ האבחון.
export const TRANSFER_DIAGNOSTIC_FILE = 'pagi-transfer-diagnostic-6.txt';
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

const MAX_TRANSFERS = 6;

// בתצוגת נייד (מסך צר) כל שורת "העברה מהחשבון" כוללת אייקון, ובלחיצה עליו נפתח חלון עם שם המקבל. מסמנים בדף את השורות והאייקונים
async function markTransferRows(page: Page) {
  let total = 0;
  for (const frame of page.frames().filter((f) => !/netfree/i.test(f.url()))) {
    total += await frame
      .evaluate((max) => {
        const dateRe = /\d{2}[./]\d{2}[./]\d{4}/;
        const labels = Array.from(document.querySelectorAll<HTMLElement>('div, span, td, li, p')).filter(
          (el) => el.children.length === 0 && /^העברה מהחשבון/.test((el.textContent ?? '').trim()),
        );
        let n = 0;
        for (const label of labels) {
          let row: HTMLElement | null = label;
          while (row && !(dateRe.test(row.textContent ?? '') && row.querySelector('svg, img, button, a, [role=button], [onclick], i'))) row = row.parentElement;
          if (!row || row.hasAttribute('data-probe-row') || n >= max) continue;
          const icon = row.querySelector<HTMLElement>('button, a, [role=button], [onclick], svg, img, i');
          row.setAttribute('data-probe-row', String(n));
          icon?.setAttribute('data-probe-click', String(n));
          n++;
        }
        return n;
      }, MAX_TRANSFERS)
      .catch(() => 0);
  }
  return total;
}

async function closeDialog(page: Page) {
  await page.keyboard.press('Escape').catch(() => undefined);
  await clickByText(page, '^(סגור|סגירה|×|✕|X)$');
  await sleep(800);
}

export async function probePagiTransfers(browser: Browser, timeout: number) {
  let page: Page | undefined;
  const stages: string[] = [];
  const work = async () => {
    page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    // כמו שמשתמש מגיע לרשימה: מהדף הראשי ללחיצה על "לכל התנועות" (הדף החדש של פאג"י, עם אייקון הפירוט בכל שורה)
    await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded' });
    await sleep(10000);
    const clicked = await clickByText(page, '^לכל התנועות$');
    await sleep(15000);
    stages.push(`## אחרי "לכל התנועות" (נלחץ: ${clicked}) כתובת: ${mask(page.url().slice(-120))}`);
    for (const frame of page.frames().filter((f) => !/netfree/i.test(f.url()))) {
      const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      stages.push(`## מסגרת ${mask(frame.url().slice(-70))}: ${text.length} תווים\n${mask(text.replace(/\s+/g, ' ').slice(0, 700))}`);
    }
    const count = await markTransferRows(page);
    stages.push(`## שורות העברה שנמצאו: ${count}`);
    if (!count) return;
    for (let i = 0; i < count; i++) {
      for (const frame of page.frames()) {
        const row = await frame.$(`[data-probe-row="${i}"]`);
        if (!row) continue;
        const rowText = mask(await row.evaluate((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)));
        if (i === 0) stages.push(`## מבנה שורה ראשונה\n${mask(await row.evaluate((el) => el.outerHTML)).replace(/\s+/g, ' ').slice(0, 3500)}`);
        const before = await visibleLines(page);
        const icon = await frame.$(`[data-probe-click="${i}"]`);
        await (icon ?? row).click().catch(() => undefined);
        await sleep(2500);
        const added = [...(await visibleLines(page))].filter((l) => !before.has(l));
        stages.push(`## העברה ${i + 1}: ${rowText}\n${added.length ? mask(added.join(' | ')).slice(0, 1500) : '(לא נפתח דבר)'}`);
        await closeDialog(page);
        break;
      }
    }
  };
  try {
    await Promise.race([work(), sleep(110_000)]);
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
