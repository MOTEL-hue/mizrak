import puppeteer, { type Page } from 'puppeteer-core';
import { getProxyArgs } from '@/backend/proxyConfig';

// משיכת פירוט המשכנתאות מאתר פאג"י (הספרייה של הסורקים לא תומכת בהלוואות ומשכנתאות)
const PAGI_LOGIN_URL =
  'https://online.pagi.co.il/MatafLoginService/MatafLoginServlet?bankId=PAGIPORTAL&site=Private&KODSAFA=HE';
const LOGGED_IN = /FibiMenu\/Online|Resources\/PortalNG\/shell|accountSummary/;
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
    const balance = pick(block, /יתרת\s*קרן[^\d\n]{0,20}([\d,]+\.?\d*)/);
    if (!(balance > 0)) return;
    const rate =
      pick(block, /ריבית\s*הכוללת\s*החזויה[^\d\n]{0,25}([\d.]+)\s*%/) || pick(block, /שיעור\s*ריבית[^\d\n]{0,25}([\d.]+)\s*%/);
    const payment =
      pick(block, /(?:תשלום|החזר)\s*חודשי[^\d\n]{0,40}([\d,]+\.?\d*)/) ||
      pick(block, /תשלום\s*אחרון\s*לחיוב[^\d\n]{0,20}([\d,]+\.?\d*)/);
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

async function login(page: Page, credentials: Record<string, string>, timeout: number, interactive: boolean) {
  await page.goto(PAGI_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#username');
  await page.type('#username', credentials.username ?? '');
  await page.type('#password', credentials.password ?? '');
  await sleep(1000);
  await page.click('#continueBtn');
  // אימות נוסף (קוד ב-SMS למשל) אפשר להזין ידנית רק כשהדפדפן מוצג
  const deadline = Date.now() + (interactive ? Math.max(timeout, 120_000) : timeout);
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
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(params.timeout);
    await login(page, params.credentials, params.timeout, params.showBrowser);
    await sleep(2000);
    if (!(await clickByText(page, '^הלוואות ומשכנתאות$'))) throw new Error('פאג"י: לא נמצאה התפריט "הלוואות ומשכנתאות"');
    await sleep(1500);
    if (!(await clickByText(page, '^פירוט משכנתאות$'))) throw new Error('פאג"י: לא נמצא "פירוט משכנתאות"');
    await page.waitForFunction(() => /מספר\s*משנה/.test(document.body.innerText), { timeout: params.timeout });
    // כל מסלול נפתח בלחיצה על החץ שלו
    await page.evaluate(() => {
      document.querySelectorAll<HTMLElement>('[aria-expanded="false"]').forEach((el) => el.click());
    });
    await sleep(1500);
    const text = await page.evaluate(() => document.body.innerText);
    const tracks = parseMortgageText(text);
    if (!tracks.length) throw new Error('פאג"י: לא נמצאו מסלולי משכנתא בדף');
    return tracks;
  } finally {
    await browser.close();
  }
}
