import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import { userDataPath } from '@/app-globals';
import { getProxyArgs } from '@/backend/proxyConfig';
import { notifyProblem } from '../../notify';
import { logAppEvent } from '/@/logging/operationLogger';

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
    // textContent (ולא innerText) כדי לא לחשב פריסה לאלפי רכיבים, וסינון לפי אורך לפני הבדיקה
    const hit = Array.from(document.querySelectorAll<HTMLElement>('a, button, li, span, div'))
      .filter((el) => {
        const text = el.textContent ?? '';
        return text.length < 40 && re.test(text.trim());
      })
      .sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length)[0];
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
    const text = (await page?.evaluate(() => `${location.href.split('?')[0]} | ${document.body.innerText}`)) ?? '';
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

interface MortgageParams {
  credentials: Record<string, string>;
  chromePath: string;
  showBrowser: boolean;
  timeout: number;
  // שם התיקייה של פרופיל הדפדפן הקבוע (אותו פרופיל של סריקת החשבון, כדי שאישור ידני יחזיק גם כאן)
  profileKey?: string;
}

// קודם בדפדפן שקוף, ואם האתר חוסם את הכניסה (בדיקת בוטים או אימות) פותחים חלון גלוי כדי שאפשר יהיה לאשר ידנית
export async function scrapePagiMortgages(params: MortgageParams): Promise<MortgageTrack[]> {
  try {
    return await scrapeMortgagesOnce(params);
  } catch (e) {
    if (params.showBrowser || !/הכניסה לא הצליחה|אימות/.test((e as Error).message)) throw e;
    notifyProblem('מזרק: נדרש אימות ידני בפאג"י', 'נפתח חלון של פאג"י לצורך משיכת המשכנתא. אשר את האימות אם מבקשים, והמשיכה תמשיך לבד.');
    return scrapeMortgagesOnce({ ...params, showBrowser: true, timeout: Math.max(params.timeout, 300_000) });
  }
}

async function scrapeMortgagesOnce(params: MortgageParams): Promise<MortgageTrack[]> {
  const browser = await puppeteer.launch({
    executablePath: params.chromePath,
    headless: !params.showBrowser,
    protocolTimeout: 600_000,
    args: [...getProxyArgs(), `--user-data-dir=${path.join(userDataPath, 'browser-profiles', params.profileKey ?? 'pagi')}`],
  });
  let page: Page | undefined;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(params.timeout);
    await login(page, params.credentials, params.timeout);
    await sleep(5000);
    await closePopup(page);
    // התפריט: הלוואות ומשכנתאות ← משכנתאות (נפתח תת-תפריט) ← פירוט משכנתאות
    const reached =
      (await clickByText(page, '^(ה)?הלוואות (ו)?(ה)?משכנתאות$')) &&
      (await sleep(1500), await clickByText(page, '^משכנתאות$')) &&
      (await sleep(1200), await clickByText(page, '^פירוט משכנתאות$'));
    if (!reached)
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, MORTGAGE_HASH);
    const hasTracks = () => /מספר\s*משנה/.test(document.body.innerText);
    const onDetails = await page
      .waitForFunction(hasTracks, { timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    // הכתובת פותחת לפעמים את דף "ריכוז משכנתאות", ולא את הפירוט. עוברים אליו דרך הקישור "לפירוט משכנתאות"
    logAppEvent('MORTGAGE_NAV', { menuReached: !!reached, onDetails });
    if (!onDetails) await clickByText(page, 'פירוט משכנתאות');
    await page.waitForFunction(hasTracks, { timeout: Math.max(params.timeout, SLOW_PAGE_MS) });
    await closePopup(page);
    // כל מסלול נטען רק אחרי לחיצה על החץ שלו, ולכן קוראים את הדף אחרי כל פתיחה ומאחדים לפי מספר משנה
    const found = new Map<string, MortgageTrack>();
    // כותרות המסלולים ("מספר הלוואה ... מספר משנה"): הרכיב הפנימי ביותר שמתאים. textContent כדי לא לחשב פריסה לכל הדף
    const headersScript = `
      const all = Array.from(document.querySelectorAll('div, li, tr')).filter((el) => {
        const t = el.textContent || '';
        return t.length < 120 && /^\\s*מספר\\s*הלוואה/.test(t);
      });
      const headers = all.filter((el) => !Array.from(el.children).some((c) => all.includes(c)));
    `;
    const rows = await page.evaluate(`(() => { ${headersScript} return headers.length; })()`);
    const openCount = () => page.evaluate(() => (document.body.innerText.match(/יתרת\s*קרן/g) ?? []).length);
    for (let i = 0; i < Math.max(Number(rows), 1); i += 1) {
      const before = await openCount();
      await page.evaluate(`(() => { ${headersScript} headers[${i}]?.click(); })()`);
      await sleep(2000);
      // אם הלחיצה על השורה לא פתחה את המסלול, לוחצים על החץ שלה
      if ((await openCount()) <= before) {
        await page.evaluate(`(() => { ${headersScript}
          const row = headers[${i}]; const box = row?.parentElement ?? row;
          const arrow = box?.querySelector('button, [class*="arrow"], [class*="chevron"], [class*="toggle"], [class*="expand"], i, svg');
          (arrow ?? row)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        })()`);
        await sleep(2000);
      }
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
