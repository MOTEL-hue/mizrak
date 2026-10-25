import fs from 'node:fs';
import path from 'node:path';
import { type Browser, type Page } from 'puppeteer-core';
import { userDataPath } from '@/app-globals';
import { logAppEvent } from '/@/logging/operationLogger';
import { localDate } from '../budgetDocs/docImport';
import { clickByText, PORTAL_URL } from './pagiMortgages';

// בדף "תנועות בחשבון" של פאג"י תנועת העברה יוצאת מופיעה רק כ"העברה מהחשבון". לחיצה על המילים פותחת חלון "פירוט העברות
// שבוצעו מהחשבון" עם שם המקבל. כאן לוחצים על כל העברה, קוראים את השם, ומוסיפים אותו לתנועה (השם לא נכנס לחישוב המזהה של התנועה).
export const TRANSFER_DIAGNOSTIC_FILE = 'pagi-transfer-diagnostic-7.txt';
const TRANSACTIONS_URL = `${PORTAL_URL.split('#')[0]}#/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;
const MAX_TRANSFERS = 30;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mask = (s: string) => s.replace(/[\d-]{7,}/g, '###');

export interface TransferDetail {
  date: string;
  amount: number;
  name: string;
}

const isoFromIsraeli = (text: string) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

async function markTransferLinks(page: Page) {
  let total = 0;
  for (const frame of page.frames().filter((f) => !/netfree/i.test(f.url()))) {
    total += await frame
      .evaluate((max) => {
        const links = Array.from(document.querySelectorAll('a')).filter((a) => /^העברה מהחשבון/.test((a.textContent ?? '').trim()));
        links.slice(0, max).forEach((a, i) => a.setAttribute('data-pagi-transfer', String(i)));
        return Math.min(links.length, max);
      }, MAX_TRANSFERS)
      .catch(() => 0);
  }
  return total;
}

async function readDialog(page: Page): Promise<TransferDetail[]> {
  for (const frame of page.frames()) {
    const rows = await frame
      .evaluate(() => {
        const out: { date: string; amount: string; name: string }[] = [];
        for (const table of Array.from(document.querySelectorAll('table'))) {
          const rowsEls = Array.from(table.querySelectorAll('tr'));
          const headers = Array.from(rowsEls[0]?.querySelectorAll('th, td') ?? []).map((c) => (c.textContent ?? '').trim());
          const [iDate, iAmount, iName] = ['תאריך', 'סכום', 'שם'].map((h) => headers.indexOf(h));
          if (!headers.includes('מהות ההעברה') || iDate < 0 || iAmount < 0 || iName < 0) continue;
          for (const tr of rowsEls.slice(1)) {
            const cells = Array.from(tr.querySelectorAll('td')).map((c) => (c.textContent ?? '').trim());
            if (cells.length > iName) out.push({ date: cells[iDate], amount: cells[iAmount], name: cells[iName] });
          }
        }
        return out;
      })
      .catch(() => []);
    const details = rows
      .map((r) => ({ date: isoFromIsraeli(r.date), amount: Math.abs(Number(r.amount.replace(/,/g, ''))), name: r.name }))
      .filter((r) => r.date && Number.isFinite(r.amount) && r.name);
    if (details.length) return details;
  }
  return [];
}

export async function readPagiTransferDetails(browser: Browser, timeout: number): Promise<TransferDetail[]> {
  let page: Page | undefined;
  const found: TransferDetail[] = [];
  const log: string[] = [];
  const work = async () => {
    page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    await page.goto(TRANSACTIONS_URL, { waitUntil: 'domcontentloaded' });
    await sleep(12000);
    const count = await markTransferLinks(page);
    log.push(`קישורי "העברה מהחשבון" שנמצאו: ${count}`);
    for (let i = 0; i < count; i++) {
      for (const frame of page.frames()) {
        const link = await frame.$(`a[data-pagi-transfer="${i}"]`);
        if (!link) continue;
        await link.click().catch(() => undefined);
        let details: TransferDetail[] = [];
        for (let attempt = 0; attempt < 8 && !details.length; attempt++) {
          await sleep(1000);
          details = await readDialog(page);
        }
        log.push(`העברה ${i + 1}: ${details.length ? 'נקראה' : 'החלון לא נפתח'}`);
        found.push(...details);
        await clickByText(page, '^סגור$');
        await sleep(700);
        break;
      }
    }
  };
  try {
    await Promise.race([work(), sleep(90_000)]);
  } catch (e) {
    log.push(`שגיאה: ${(e as Error).message}`);
  } finally {
    await page?.close().catch(() => undefined);
    try {
      const sample = found[0] ? `\nדוגמה: ${found[0].date} ${found[0].amount} ${mask(found[0].name)}` : '';
      fs.writeFileSync(path.join(userDataPath, TRANSFER_DIAGNOSTIC_FILE), log.join('\n') + sample);
      logAppEvent('PAGI_TRANSFER_DETAILS_DONE', { transfers: found.length });
    } catch {
      // אבחון בלבד
    }
  }
  return found;
}

type ScrapedTransaction = { date: string; chargedAmount: number; description: string; recipient?: string };

// מוסיף לכל העברה יוצאת את שם המקבל, לפי תאריך וסכום
export function attachRecipients(accounts: { txns: ScrapedTransaction[] }[] | undefined, details: TransferDetail[]) {
  const byKey = new Map<string, string>();
  details.forEach((d) => {
    const key = `${d.date}|${d.amount.toFixed(2)}`;
    if (!byKey.has(key)) byKey.set(key, d.name);
  });
  let attached = 0;
  for (const account of accounts ?? []) {
    for (const tx of account.txns) {
      if (tx.chargedAmount >= 0 || !/^העברה מהחשבון/.test(tx.description ?? '')) continue;
      const name = byKey.get(`${localDate(tx.date)}|${Math.abs(tx.chargedAmount).toFixed(2)}`);
      if (name) {
        tx.recipient = name;
        attached++;
      }
    }
  }
  return attached;
}
