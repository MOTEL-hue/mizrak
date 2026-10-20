import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import { userDataPath } from '@/app-globals';
import { getProxyArgs } from '@/backend/proxyConfig';

// משיכת פירוט המשכנתאות מאתר פאג"י (הספרייה של הסורקים לא תומכת בהלוואות ומשכנתאות)
const PAGI_LOGIN_URL =
  'https://online.pagi.co.il/MatafLoginService/MatafLoginServlet?bankId=PAGIPORTAL&site=Private&KODSAFA=HE';
const LOGGED_IN = /FibiMenu\/Online|Resources\/PortalNG\/shell|accountSummary/;
const SLOW_PAGE_MS = 150_000; // האתר נטען דקה עד שתיים אחרי הכניסה
const MORTGAGE_HASH = '#/Online/OnLoansMortgageMenu/OnMortgages/mortgageList';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface MortgageTrack {
  id: string;
  balance: number;
  rate: number;
  payment: number;
  prime: boolean;
}

const toNumber = (value?: string) => (value ? parseFloat(value.replace(/,/g, '')) || 0 : 0);
const pick = (block: string, re: RegExp) => toNumber(block.match(re)?.[1]);

// הדף מציג לכל "מספר משנה" רשימת שדות. מוציאים ממנה את היתרה, הריבית השנתית הכוללת וההחזר החודשי
export function parseMortgageText(text: string): MortgageTrack[] {
  const blocks = text.split(/מספר\s*משנה\s*:?\s*/).slice(1);
  const tracks: MortgageTrack[] = [];
  blocks.forEach((block, index) => {
    const balance = pick(block, /יתרת\s*קרן[\s:₪]{0,20}([\d,]+\.?\d*)/);
    if (!(balance > 0)) return;
    const rate =
      pick(block, /ריבית\s*הכוללת\s*החזויה\s*(?:\(\d\))?[\s:]{0,20}([\d.]+)\s*%/) ||
      pick(block, /שיעור\s*ריבית[^\d]{0,40}?([\d.]+)\s*%/);
    const payment =
      pick(block, /(?:תשלום|החזר)\s*חודשי\s*(?:\([^)]*\))?[\s:₪]{0,20}([\d,]+\.?\d*)/) ||
      pick(block, /תשלום\s*אחרון\s*לחיוב\s*(?:\(\d\))?[\s:₪]{0,20}([\d,]+\.?\d*)/);
    tracks.push({
      id: block.match(/^\s*(\d+)/)?.[1] ?? String(index + 1),
      balance,
      rate,
      payment,
      prime: /פריים/.test(block),
    });
  });
  return tracks;
}

async function clickByText(page: Page, pattern: string) {
  return page.evaluate((source) => {
    const re = new RegExp(source);
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('a, button, li, span, div'));
    const hit = candidates
      .filter((el) => re.test((el.innerText || '').trim()) && (el.innerText || '').trim().length < 40)
      .sort((a, b) => a.innerText.length - b.innerText.length)[0];
    hit?.click();
    return !!hit;
  }, pattern);
}

async function closePopup(page: Page) {
  await clickByText(page, '^(סגור|סגירה|×|X)$');
  await sleep(500);
}

// טקסט הדף לבדיקה כשהמשיכה נכשלת. מספרים ארוכים (חשבון, הלוואה) מוסתרים
async function saveDiagnostic(page?: Page) {
  try {
    const text = (await page?.evaluate(() => document.body.innerText)) ?? '';
    fs.writeFileSync(path.join(userDataPath, 'pagi-mortgage-diagnostic.txt'), text.replace(/[\d-]{7,}/g, '###'));
  } catch {
    // אבחון בלבד
  }
}

async function login(page: Page, credentials: Record<string, string>, timeout: number) {
  await page.goto(PAGI_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#username');
  await page.type('#username', credentials.username ?? '');
  await page.type('#password', credentials.password ?? '');
  await sleep(1000);
  await page.click('#continueBtn');
  // אימות נוסף (קוד ב-SMS למשל) אפשר להזין ידנית רק כשהדפדפן מוצג
  const deadline = Date.now() + Math.max(timeout, SLOW_PAGE_MS);
  while (Date.now() < deadline) {
    await sleep(1500);
    if (LOGGED_IN.test(page.url())) return;
  }
  throw new Error('פאג"י: הכניסה לא הצליחה, או שנדרש אימות נוסף');
}

export async function scrapePagiMortgages(params: {
  credentials: Record<string, string>;
  chromePath: string;
  showBrowser: boolean;
  timeout: number;
}): Promise<MortgageTrack[]> {
  const browser = await puppeteer.launch({
    executablePath: params.chromePath,
    headless: !params.showBrowser,
    args: getProxyArgs(),
  });
  let page: Page | undefined;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(params.timeout);
    await login(page, params.credentials, params.timeout);
    await sleep(5000);
    await closePopup(page);
    const reached =
      (await clickByText(page, '^(ה)?הלוואות (ו)?(ה)?משכנתאות$')) &&
      (await sleep(1500), await clickByText(page, '^פירוט משכנתאות$'));
    if (!reached)
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, MORTGAGE_HASH);
    await page.waitForFunction(() => /מספר\s*משנה/.test(document.body.innerText), {
      timeout: Math.max(params.timeout, SLOW_PAGE_MS),
    });
    await closePopup(page);
    // כל מסלול נטען רק אחרי לחיצה על החץ שלו, ולכן קוראים את הדף אחרי כל פתיחה ומאחדים לפי מספר משנה
    const found = new Map<string, MortgageTrack>();
    const rows = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll<HTMLElement>('div, li, tr')).filter(
          (el) => /^מספר\s*הלוואה/.test(el.innerText.trim()) && el.innerText.length < 120,
        ).length,
    );
    for (let i = 0; i < Math.max(rows, 1); i += 1) {
      await page.evaluate((index) => {
        const headers = Array.from(document.querySelectorAll<HTMLElement>('div, li, tr')).filter(
          (el) => /^מספר\s*הלוואה/.test(el.innerText.trim()) && el.innerText.length < 120,
        );
        headers[index]?.click();
      }, i);
      await sleep(2000);
      parseMortgageText(await page.evaluate(() => document.body.innerText)).forEach((t) => found.set(t.id, t));
    }
    const tracks = Array.from(found.values());
    if (!tracks.length) throw new Error('פאג"י: לא נמצאו מסלולי משכנתא בדף');
    return tracks;
  } catch (e) {
    await saveDiagnostic(page);
    throw e;
  } finally {
    await browser.close();
  }
}
