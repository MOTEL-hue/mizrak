import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { type Browser, type Frame, type Page } from 'puppeteer-core';
import { userDataPath } from '@/app-globals';
import { getProxyArgs } from '@/backend/proxyConfig';
import { notifyProblem } from '../../notify';
import { logAppEvent } from '/@/logging/operationLogger';

// משיכת פירוט המשכנתאות מאתר פאג"י (הספרייה של הסורקים לא תומכת בהלוואות ומשכנתאות)
const PAGI_LOGIN_URL =
  'https://online.pagi.co.il/MatafLoginService/MatafLoginServlet?bankId=PAGIPORTAL&site=Private&KODSAFA=HE';
const LOGGED_IN = /FibiMenu\/Online|Resources\/PortalNG\/shell|accountSummary/;
const SLOW_PAGE_MS = 150_000; // האתר נטען דקה עד שתיים אחרי הכניסה
export const PORTAL_URL = 'https://online.pagi.co.il/appsng/Resources/PortalNG/shell/#/accountSummary';
const MORTGAGE_HASH = '#/Online/OnLoansMortgageMenu/OnMortgages/mortgageList';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface MortgageTrack {
  id: string;
  balance: number;
  rate: number;
  payment: number;
  prime: boolean;
  months?: number;
}

const toNumber = (value?: string) => (value ? parseFloat(value.replace(/,/g, '')) || 0 : 0);
const pick = (block: string, re: RegExp) => toNumber(block.match(re)?.[1]);

// ריבית שנתית מתוך יתרה, החזר חודשי ומספר חודשים שנותרו (לוח שפיצר), בחיפוש בינארי
export function solveAnnualRate(balance: number, payment: number, months: number): number {
  if (!(balance > 0 && payment > 0 && months > 0) || payment * months <= balance * 1.0001) return 0;
  let low = 0;
  let high = 0.05; // ריבית חודשית
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    const pay = (balance * mid) / (1 - (1 + mid) ** -months);
    if (pay > payment) high = mid;
    else low = mid;
  }
  return Math.round(((low + high) / 2) * 1200 * 100) / 100;
}

// הדף מציג לכל "מספר משנה" רשימת שדות. מוציאים ממנה את היתרה, הריבית השנתית הכוללת וההחזר החודשי
export function parseMortgageText(text: string): MortgageTrack[] {
  const blocks = text.split(/מספר\s*משנה\s*:?\s*/).slice(1);
  const tracks: MortgageTrack[] = [];
  blocks.forEach((block, index) => {
    const balance = pick(block, /יתרת\s*קרן[\s:₪]{0,20}([\d,]+\.?\d*)/);
    if (!(balance > 0)) return;
    let rate =
      pick(block, /ריבית\s*הכוללת\s*החזויה\s*(?:\(\d\))?[\s:]{0,20}([\d.]+)\s*%/) ||
      pick(block, /שיעור\s*ריבית[^\d]{0,40}?([\d.]+)\s*%/) ||
      pick(block, /ריבית[^\d%]{0,40}?([\d.]+)\s*%/) ||
      pick(block, /([\d.]+)\s*%\s*ריבית/);
    const months =
      pick(block, /(?:תשלומים|חודשים)\s*(?:שנותרו|נותרים|לסיום)[\s:]{0,20}(\d+)/) ||
      pick(block, /(?:שנותרו|נותרו)\s*(\d+)\s*(?:תשלומים|חודשים)/);
    const payment =
      pick(block, /(?:תשלום|החזר)\s*חודשי\s*(?:\([^)]*\))?[\s:₪]{0,20}([\d,]+\.?\d*)/) ||
      pick(block, /תשלום\s*אחרון\s*לחיוב\s*(?:\(\d\))?[\s:₪]{0,20}([\d,]+\.?\d*)/);
    if (!rate && months) rate = solveAnnualRate(balance, payment, months);
    tracks.push({
      id: block.match(/^\s*(\d+)/)?.[1] ?? String(index + 1),
      balance,
      rate,
      payment,
      prime: /פריים/.test(block),
      ...(months ? { months } : {}),
    });
  });
  return tracks;
}

// התוכן של פאג"י יכול להיות בתוך מסגרת (iframe) בתוך הפורטל, ולכן מחפשים בכל המסגרות
async function frameWithText(page: Page, re: RegExp, timeoutMs: number): Promise<Frame | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      if (re.test(text)) return frame;
    }
    await sleep(1000);
  }
  return null;
}

export async function clickByText(page: Page | Frame, pattern: string) {
  if ('frames' in page) {
    for (const frame of page.frames()) {
      if (await clickByText(frame, pattern)) return true;
    }
    return false;
  }
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
    const parts = await Promise.all(
      (page?.frames() ?? []).map(async (frame) => {
        const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
        return `[${frame.url().split('?')[0]}] ${text.replace(/\s+/g, ' ').slice(0, 1500)}`;
      }),
    );
    fs.writeFileSync(path.join(userDataPath, 'pagi-mortgage-diagnostic.txt'), parts.join('\n').replace(/[\d-]{7,}/g, '###'));
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


async function extractFromScreen(page: Page, timeout: number): Promise<MortgageTrack[]> {
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
    const re = /מספר\s*משנה/;
    let frame = await frameWithText(page, re, 25_000);
    // הכתובת פותחת לפעמים את דף "ריכוז משכנתאות", ולא את הפירוט. עוברים אליו דרך הקישור "לפירוט משכנתאות"
    logAppEvent('MORTGAGE_NAV', { menuReached: !!reached, onDetails: !!frame, frames: page.frames().length });
    if (!frame) {
      await clickByText(page, 'פירוט משכנתאות');
      frame = await frameWithText(page, re, Math.max(timeout, SLOW_PAGE_MS));
    }
    if (!frame) throw new Error('פאג"י: דף פירוט המשכנתאות לא נטען');
    // הקובץ ששומר הבנק (אייקון השמירה) מכיל את כל המסלולים פתוחים, ולכן הוא הדרך האמינה. קריאת המסך היא הגיבוי
    try {
      return await extractFromDownload(page);
    } catch (e) {
      logAppEvent('MORTGAGE_DOWNLOAD_FIRST_FAILED', { errorMessage: (e as Error).message });
    }
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
    const rows = await frame.evaluate(`(() => { ${headersScript} return headers.length; })()`);
    const openCount = () => frame.evaluate(() => (document.body.innerText.match(/יתרת\s*קרן/g) ?? []).length);
    for (let i = 0; i < Math.max(Number(rows), 1); i += 1) {
      const before = await openCount();
      await frame.evaluate(`(() => { ${headersScript} headers[${i}]?.click(); })()`);
      await sleep(2000);
      // אם הלחיצה על השורה לא פתחה את המסלול, לוחצים על החץ שלה
      if ((await openCount()) <= before) {
        await frame.evaluate(`(() => { ${headersScript}
          const row = headers[${i}]; const box = row?.parentElement ?? row;
          const arrow = box?.querySelector('button, [class*="arrow"], [class*="chevron"], [class*="toggle"], [class*="expand"], i, svg');
          (arrow ?? row)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        })()`);
        await sleep(2000);
      }
      parseMortgageText(await frame.evaluate(() => document.body.innerText)).forEach((t) => found.set(t.id, t));
    }
    const tracks = Array.from(found.values());
    if (!tracks.length) throw new Error('פאג"י: לא נמצאו מסלולי משכנתא בדף');
    return tracks;
}


// אם קריאת הדף לא הצליחה: שומרים את הקובץ שהבנק מציע לשמירה (אייקון השמירה בדף הפירוט), קוראים אותו, ומוחקים אותו בכל מקרה
async function extractFromDownload(page: Page): Promise<MortgageTrack[]> {
  const dir = fs.mkdtempSync(path.join(userDataPath, 'pagi-dl-'));
  try {
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir } as never);
    let clicked = false;
    for (const frame of page.frames()) {
      clicked =
        clicked ||
        (await frame
          .evaluate(() => {
            const icons = Array.from(document.querySelectorAll<HTMLElement>('a, button, [role="button"], i, span, img'));
            const hit = icons.find((el) => /שמור|שמירה|הורד|ייצוא|excel|pdf|save|download/i.test(`${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.className?.toString?.() ?? ''}`));
            hit?.click();
            return !!hit;
          })
          .catch(() => false));
    }
    if (!clicked) throw new Error('לא נמצא אייקון שמירה בדף');
    const deadline = Date.now() + 40_000;
    let file = '';
    while (Date.now() < deadline && !file) {
      await sleep(1000);
      file = fs.readdirSync(dir).find((f) => !f.endsWith('.crdownload')) ?? '';
    }
    if (!file) throw new Error('הבנק לא הוריד קובץ');
    const full = path.join(dir, file);
    logAppEvent('MORTGAGE_DOWNLOAD', { name: path.extname(file), bytes: fs.statSync(full).size });
    const text = fs.readFileSync(full, 'utf8').replace(/<[^>]+>/g, '\n');
    const tracks = parseMortgageText(text);
    // לאבחון: הטקסט של הקובץ (בלי מספרים ארוכים) והערכים שנקראו, כדי לבדוק שהחישוב תואם לבנק
    try {
      const flat = text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n').replace(/[\d-]{7,}/g, '###');
      fs.writeFileSync(path.join(userDataPath, 'pagi-mortgage-diagnostic.txt'), `${JSON.stringify(tracks)}\n${flat.slice(0, 20000)}`);
    } catch {
      // האבחון לא חשוב מספיק כדי להפיל את הקריאה
    }
    if (!tracks.length) throw new Error('הקובץ שירד בפורמט שלא נקרא עדיין');
    return tracks;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// קריאת המסלולים מדף הפורטל אחרי שהמשתמש כבר מחובר (באותו דפדפן ובאותה חיבור שבהם נסרק החשבון)
export async function extractMortgageTracks(page: Page, timeout: number): Promise<MortgageTrack[]> {
  try {
    return await extractFromScreen(page, timeout);
  } catch (e) {
    try {
      return await extractFromDownload(page);
    } catch (e2) {
      logAppEvent('MORTGAGE_DOWNLOAD_FAILED', { errorMessage: (e2 as Error).message });
      throw e;
    }
  }
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
    notifyProblem('תקציב: נדרש אימות ידני בפאג"י', 'נפתח חלון של פאג"י לצורך משיכת המשכנתא. אשר את האימות אם מבקשים, והמשיכה תמשיך לבד.');
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
    return await extractMortgageTracks(page, params.timeout);
  } catch (e) {
    await saveDiagnostic(page);
    throw e;
  } finally {
    await browser.close();
  }
}

// מסלולים שנמשכו באותו דפדפן של סריקת החשבון (בלי כניסה נוספת, שהאתר חוסם). נצרכים פעם אחת
let pending: { tracks: MortgageTrack[]; at: number } | null = null;

export async function grabMortgagesFromLoggedInBrowser(browser: Browser, timeout: number) {
  let page: Page | undefined;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded' });
    // תקרה כוללת: אם הדף לא נטען או לא נקרא, לא ממשיכים להחזיק חלון פתוח ולעכב את הסנכרון
    const work = extractMortgageTracks(page, timeout);
    work.catch(() => undefined);
    const tracks = await Promise.race([
      work,
      sleep(100_000).then(() => {
        throw new Error('קריאת המשכנתא לקחה יותר מדי זמן');
      }),
    ]);
    pending = { tracks, at: Date.now() };
    logAppEvent('MORTGAGE_GRABBED_IN_SESSION', { tracks: pending.tracks.length });
  } catch (e) {
    logAppEvent('MORTGAGE_GRAB_IN_SESSION_FAILED', { errorMessage: (e as Error).message });
    await saveDiagnostic(page);
  }
}

export function takePendingMortgages(): MortgageTrack[] | null {
  const fresh = pending && Date.now() - pending.at < 15 * 60 * 1000 ? pending.tracks : null;
  pending = null;
  return fresh;
}
