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
// פעולה שנתקעת לא תעצור את כל השלב
const limited = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([promise, sleep(ms).then(() => Promise.reject(new Error(`${label}: חרג מ-${ms / 1000} שניות`)))]);
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

// כל שורות הטקסט שמוצגות כרגע בכל המסגרות (בלי הפרסומות של נטפרי)
async function visibleLines(page: Page) {
  const lines = new Set<string>();
  for (const frame of page.frames().filter((f) => !/netfree/i.test(f.url()))) {
    const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((l) => lines.add(l));
  }
  return lines;
}

async function markTransferLinks(page: Page) {
  let total = 0;
  for (const frame of page.frames().filter((f) => !/netfree/i.test(f.url()))) {
    total += await frame
      .evaluate((max) => {
        const links = Array.from(document.querySelectorAll('a')).filter((a) =>
          /^העברה מהחשבון/.test((a.textContent ?? '').trim()),
        );
        links.slice(0, max).forEach((a, i) => a.setAttribute('data-pagi-transfer', String(i)));
        return Math.min(links.length, max);
      }, MAX_TRANSFERS)
      .catch(() => 0);
  }
  return total;
}

async function readDialog(page: Page): Promise<TransferDetail[]> {
  for (const frame of page.frames()) {
    const rows = await limited(
      frame.evaluate(() => {
        const out: { date: string; amount: string; name: string }[] = [];
        for (const table of Array.from(document.querySelectorAll('table'))) {
          const rowsEls = Array.from(table.querySelectorAll('tr'));
          const headers = Array.from(rowsEls[0]?.querySelectorAll('th, td') ?? []).map((c) =>
            (c.textContent ?? '').trim(),
          );
          const [iDate, iAmount, iName] = ['תאריך', 'סכום', 'שם'].map((h) => headers.indexOf(h));
          if (!headers.includes('מהות ההעברה') || iDate < 0 || iAmount < 0 || iName < 0) continue;
          for (const tr of rowsEls.slice(1)) {
            const cells = Array.from(tr.querySelectorAll('td')).map((c) => (c.textContent ?? '').trim());
            if (cells.length > iName) out.push({ date: cells[iDate], amount: cells[iAmount], name: cells[iName] });
          }
        }
        return out;
      }),
      4000,
      'קריאת חלון',
    ).catch(() => [] as { date: string; amount: string; name: string }[]);
    const details = rows
      .map((r) => ({
        date: isoFromIsraeli(r.date),
        amount: Math.abs(Number(r.amount.replace(/,/g, ''))),
        name: r.name,
      }))
      .filter((r) => r.date && Number.isFinite(r.amount) && r.name);
    if (details.length) return details;
  }
  return [];
}

export async function readPagiTransferDetails(
  browser: Browser,
  timeout: number,
  onStep?: (done: number, total: number) => void,
): Promise<TransferDetail[]> {
  let page: Page | undefined;
  const found: TransferDetail[] = [];
  let cancelled = false;
  const startedAt = Date.now();
  const lines: string[] = [];
  // כל שורה נשמרת מיד לקובץ, כדי שגם אם השלב נתקע נדע איפה
  const log = {
    push(message: string) {
      lines.push(`${Math.round((Date.now() - startedAt) / 1000)}s ${message}`);
      try {
        fs.writeFileSync(path.join(userDataPath, TRANSFER_DIAGNOSTIC_FILE), lines.join('\n'));
      } catch {
        // אבחון בלבד
      }
    },
  };
  log.push('מתחיל');
  const work = async () => {
    page = await browser.newPage();
    log.push('נפתח לשונית');
    page.setDefaultTimeout(timeout);
    // אותה זהות כמו הלשונית של הסריקה הרגילה: בלי "Headless" ובלי סימן אוטומציה, אחרת האתר לא מציג את הטבלה
    await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
    await page.setViewport({ width: 1366, height: 900 });
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
    page.on('dialog', (dialog) => {
      log.push(`חלון של הדפדפן: ${dialog.message().slice(0, 80)}`);
      void dialog.dismiss().catch(() => undefined);
    });
    browser.on('targetcreated', (target) => log.push(`נפתח יעד חדש: ${mask(target.url()).slice(0, 80)}`));
    await page.goto(TRANSACTIONS_URL, { waitUntil: 'domcontentloaded' });
    log.push('הדף נטען');
    // ממתינים עד שטבלת התנועות באמת נטענה (עד דקה), ולא זמן קבוע
    let count = 0;
    let tableSeen = false;
    for (let waited = 0; waited < 45_000 && !tableSeen && !cancelled; waited += 3000) {
      await sleep(3000);
      tableSeen = [...(await visibleLines(page))].some((line) => line.includes('אסמכתא'));
      if (!tableSeen && waited === 24_000) {
        log.push('הטבלה לא נטענה: מרעננים');
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
      }
    }
    if (cancelled) return;
    log.push(tableSeen ? 'טבלת התנועות נטענה' : 'טבלת התנועות לא נטענה תוך דקה');
    count = await markTransferLinks(page);
    log.push(`קישורי "העברה מהחשבון" שנמצאו: ${count}`);
    let stop = false;
    for (let i = 0; i < count && !stop && !cancelled; i++) {
      onStep?.(i + 1, count);
      for (const frame of page.frames()) {
        const link = await frame.$(`a[data-pagi-transfer="${i}"]`);
        if (!link) continue;
        if (i === 0) log.push(`קישור ראשון: ${mask(await link.evaluate((el) => el.outerHTML)).slice(0, 400)}`);
        let details: TransferDetail[] = [];
        let how = '';
        // כמה דרכים ללחוץ: לחיצה אמיתית, לחיצה מהדף, ואירועי עכבר מלאים (חלק מהאתרים מגיבים רק לאחד מהם)
        const clicks: [string, () => Promise<unknown>][] = [
          ['לחיצה', () => link.click()],
          ['לחיצה בדף', () => link.evaluate((el) => (el as HTMLElement).click())],
          [
            'אירועי עכבר',
            () =>
              link.evaluate((el) =>
                ['mousedown', 'mouseup', 'click'].forEach((type) =>
                  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })),
                ),
              ),
          ],
        ];
        for (const [name, doClick] of clicks) {
          log.push(`העברה ${i + 1}: ${name}`);
          await limited(doClick(), 8000, name).catch((e) => log.push(`העברה ${i + 1}: ${(e as Error).message}`));
          for (let attempt = 0; attempt < 5 && !details.length; attempt++) {
            await sleep(1000);
            details = await limited(readDialog(page), 15_000, 'בדיקת חלון').catch(() => []);
          }
          log.push(`העברה ${i + 1}: אחרי ${name}, נקראו ${details.length}`);
          if (details.length) {
            how = name;
            break;
          }
        }
        if (!details.length) {
          const lines = [...(await visibleLines(page))].filter((l) => /פירוט|העברות|מהות/.test(l));
          log.push(`העברה ${i + 1}: לא נקראה. שורות רלוונטיות במסך: ${mask(lines.join(' | ')).slice(0, 300) || 'אין'}`);
        } else {
          log.push(`העברה ${i + 1}: נקראה (${how})`);
        }
        found.push(...details);
        // אם הקישור הראשון לא נפתח בשום דרך, אין טעם להמשיך ולבזבז זמן על השאר
        if (!details.length && i === 0) {
          log.push('הקישור הראשון לא נפתח: מפסיקים');
          stop = true;
        }
        await clickByText(page, '^סגור$');
        await sleep(700);
        break;
      }
    }
  };
  try {
    await Promise.race([work(), sleep(90_000)]);
    cancelled = true;
  } catch (e) {
    log.push(`שגיאה: ${(e as Error).message}`);
  } finally {
    cancelled = true;
    await Promise.race([page?.close().catch(() => undefined), sleep(5000)]);
    try {
      log.push(`סיום, נקראו ${found.length} העברות`);
      if (found[0])
        log.push(`דוגמה: ${found[0].date} ${found[0].amount} ${found[0].name.replace(/\S+/g, (w) => `${w[0]}.`)}`);
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
