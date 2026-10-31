import { type AccountToScrapeConfig } from '@/backend/commonTypes';
import { createScraper, type ScraperOptions } from 'israeli-bank-scrapers-core';
import { getProxyArgs } from '@/backend/proxyConfig';
import { logAppEvent } from '/@/logging/operationLogger';
import puppeteer from 'puppeteer-core';
import { patchVisaCalLogin } from './calLoginPatch';
import { grabMortgagesFromLoggedInBrowser } from './pagiMortgages';
import { discoverLoanPages, needsDiscovery } from './loanDiscovery';
import { isMortgageForced, shouldReadMortgage } from './mortgageSchedule';
import { attachRecipients, readPagiTransferDetails } from './pagiTransferProbe';
import { userDataPath } from '@/app-globals';
import path from 'path';

// חברות שהאתר שלהן זיהה פעילות אוטומטית ודרש אימות אנושי (Radware): זמן סיום ההמתנה לפני ניסיון נוסף
// חברות שרצות כרגע במצב מסייע: חלון גלוי והמתנה שהמשתמש יאשר ידנית (במקום סגירה מיידית)
export const assistedCompanies = new Set<string>();
export const botBlockedUntil = new Map<string, number>();
const BOT_BLOCK_COOLDOWN_MS = 3 * 60 * 60 * 1000;
export const BOT_BLOCK_MESSAGE =
  'האתר זיהה פעילות אוטומטית ודרש אימות אנושי (קפצ\'ה), ולכן הכניסה נחסמה. ריצות רצופות מחמירות את החסימה. כדאי לחכות כמה שעות, ואז לנסות שוב. אפשר גם להפעיל "הצג דפדפן" בהגדרות ולאשר ידנית.';

interface ScrapeParameters {
  companyId: AccountToScrapeConfig['key'];
  credentials: AccountToScrapeConfig['loginFields'];
  startDate: Date;
  showBrowser?: boolean;
  timeout: number;
}

type EmitProgressEventFunction = (eventCompanyId: string, message: string) => Promise<void>;

// אתרי הבנקים מציגים חלונות הודעה (פרסומות, אישורים) מיד אחרי הכניסה, והם חוסמים את הדף.
// הסקריפט סוגר אותם לבד: לוחץ על כפתור סגירה (X) בתוך חלון קופץ גלוי, ולא נוגע בקישורים אחרים.
// קבוצת הבינלאומי ופאג"י נטענת לאט, ולכן ממתינים לכל כפתור עד חמש דקות
const SLOW_COMPANIES = ['beinleumi', 'pagi', 'massad', 'otsarHahayal'];
const SLOW_TIMEOUT_MS = 300_000;
// באתר של כאל כפתור "כניסה לחשבון" מופיע לפני שהדף מוכן ללחיצה, והלחיצה האוטומטית הולכת לאיבוד (בלחיצה ידנית אחרי כמה שניות זה עובד).
// מסתירים אותו בשבע השניות הראשונות, והסורק ממתין שיהיה גלוי ורק אז לוחץ.
const DELAY_CAL_LOGIN_BUTTON_SCRIPT = `
(() => {
  if (window.top !== window) return;
  const style = document.createElement('style');
  style.textContent = '#ccLoginDesktopBtn { visibility: hidden !important; }';
  (document.head || document.documentElement).appendChild(style);
  setTimeout(() => style.remove(), 7000);
})();
`;
const CLOSE_POPUPS_SCRIPT = `
(() => {
  const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight) && getComputedStyle(el).visibility !== 'hidden');
  const isClose = (el) => {
    const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.className && el.className.toString ? el.className.toString() : '')).toLowerCase();
    const text = (el.textContent || '').trim();
    return /close|סגור|סגירה|dismiss/.test(label) || ['×', 'x', 'X', '✕', 'לא, תודה', 'לא תודה', 'לא תודה.'].includes(text);
  };
  setInterval(() => {
    try {
      document.querySelectorAll('[role="dialog"], .modal, .modal-dialog, [class*="popup"], [class*="Popup"], [class*="dialog"]').forEach((box) => {
        if (!visible(box)) return;
        const btn = Array.from(box.querySelectorAll('button, a, [role="button"], span, i')).find((el) => visible(el) && isClose(el));
        if (btn) btn.click();
      });
    } catch (e) {}
  }, 1000);
})();
`;

patchVisaCalLogin();

export async function scrape(
  { companyId, credentials, startDate, timeout, showBrowser = false }: ScrapeParameters,
  emitProgressEvent: EmitProgressEventFunction,
  chromePath: string,
) {
  const proxyArgs = getProxyArgs();

  const options: ScraperOptions = {
    companyId, // mandatory; one of 'hapoalim', 'discount', 'otsarHahayal', 'leumiCard', 'isracard', 'amex'
    startDate, // the date to fetch transactions from (can't be before the minimum allowed time difference for the scraper)
    combineInstallments: false, // if set to true, all installment transactions will be combine into the first one
    showBrowser, // shows the browser while scraping, good for debugging (default false)
    verbose: false, // include more debug info about in the output
    executablePath: chromePath,
    defaultTimeout: SLOW_COMPANIES.includes(companyId) ? Math.max(timeout, SLOW_TIMEOUT_MS) : timeout,
    // פרופיל קבוע לקבוצת הבינלאומי: אחרי אימות ידני אחד האתר זוכר את הדפדפן ופחות חוסם
    args: SLOW_COMPANIES.includes(companyId)
      ? [...proxyArgs, `--user-data-dir=${path.join(userDataPath, 'browser-profiles', companyId)}`]
      : proxyArgs,
  };
  options.preparePage = async (page) => {
    await page.evaluateOnNewDocument(CLOSE_POPUPS_SCRIPT);
    if (companyId === 'visaCal') {
      await page.evaluateOnNewDocument(DELAY_CAL_LOGIN_BUTTON_SCRIPT);
      await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
    }
    page.on('framenavigated', (frame) => {
      if (
        frame === page.mainFrame() &&
        !assistedCompanies.has(companyId) &&
        /perfdrive\.com|radware/i.test(frame.url())
      ) {
        botBlockedUntil.set(companyId, Date.now() + BOT_BLOCK_COOLDOWN_MS);
        logAppEvent('BOT_CHALLENGE_DETECTED', { company: companyId });
        // אין טעם להמתין חמש דקות לכפתור שלא יופיע
        setTimeout(() => page.close().catch(() => undefined), 3000);
      }
    });
    // כאל: מצלמים את מבנה מסך הכניסה (מזהים של שדות, כפתורים וטאבים) כדי להתאים את הסורק למסך החדש
    if (companyId === 'visaCal') {
      setTimeout(async () => {
        try {
          if (page.isClosed()) return;
          const frames = await Promise.all(
            page.frames().map(async (frame) => {
              const items = await frame
                .evaluate(() =>
                  Array.from(
                    document.querySelectorAll('input, button, iframe, [role="tab"], a[id], [id^="cc"], [id*="ogin"]'),
                  )
                    .slice(0, 60)
                    .map(
                      (el) =>
                        `${el.tagName.toLowerCase()}#${el.id}.${el.getAttribute('formcontrolname') ?? el.getAttribute('name') ?? ''}:${(el.textContent ?? '').trim().slice(0, 25)}`,
                    )
                    .join(' ; '),
                )
                .catch(() => '');
              return `${frame.url().split('?')[0]} => ${items}`;
            }),
          );
          logAppEvent('CAL_LOGIN_STRUCTURE', { frames: frames.join(' || ').slice(0, 4000) });
        } catch {
          // אבחון בלבד
        }
      }, 20_000);
    }
    // צילום טקסט של הדף אחרי 90 שניות, כדי לדעת מה האתר הציג כשהכניסה נתקעת (בלי סיסמאות, רק הטקסט הגלוי)
    setTimeout(async () => {
      try {
        if (page.isClosed()) return;
        const snap = await page.evaluate(
          () =>
            `${location.href} | ${document.title} | ${(document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400)}`,
        );
        logAppEvent('PAGE_SNAPSHOT_90S', { company: companyId, snapshot: snap });
      } catch {
        // הדף כבר נסגר
      }
    }, 90_000);
  };
  let ownBrowser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  if (companyId === 'pagi' || companyId === 'visaCal' || (needsDiscovery(companyId) && isMortgageForced())) {
    // כאל מנטרל את כפתור הכניסה בדפדפן שמסומן כ"נשלט אוטומטית". מסירים את הסימון (דגל האוטומציה ו-navigator.webdriver)
    const stealth = companyId === 'visaCal';
    ownBrowser = await puppeteer.launch({
      executablePath: chromePath,
      headless: !showBrowser,
      args: [...(options.args ?? []), ...(stealth ? ['--disable-blink-features=AutomationControlled'] : [])],
      ignoreDefaultArgs: stealth ? ['--enable-automation'] : undefined,
      protocolTimeout: 600_000,
    });
    Object.assign(options, { browser: ownBrowser, skipCloseBrowser: true });
  }
  const scraper = createScraper(options);
  scraper.onProgress((eventCompanyId: string, payload: { type: string }) => {
    emitProgressEvent(companyId, payload.type);
  });
  let scrapeResult: Awaited<ReturnType<typeof scraper.scrape>>;
  try {
    scrapeResult = await scraper.scrape(credentials);
  } catch (e) {
    await ownBrowser?.close().catch(() => undefined);
    throw e;
  }
  if (ownBrowser) {
    // פאג"י חוסם כניסה שנייה, ולכן את המשכנתא קוראים עכשיו, באותו דפדפן שכבר מחובר
    if (scrapeResult.success && companyId === 'pagi') {
      emitProgressEvent(companyId, 'READING_TRANSFERS');
      const details = await readPagiTransferDetails(ownBrowser, 60_000, (done, total) =>
        emitProgressEvent(companyId, `READING_TRANSFER:${done}/${total}`),
      );
      attachRecipients(scrapeResult.accounts as Parameters<typeof attachRecipients>[0], details);
    }
    if (scrapeResult.success && companyId === 'pagi' && shouldReadMortgage()) {
      emitProgressEvent(companyId, 'READING_MORTGAGE');
      await grabMortgagesFromLoggedInBrowser(ownBrowser, Math.max(timeout, 150_000));
    }
    if (scrapeResult.success && needsDiscovery(companyId) && isMortgageForced()) {
      emitProgressEvent(companyId, 'READING_LOANS');
      await discoverLoanPages(ownBrowser, companyId, 60_000);
    }
    await ownBrowser.close().catch(() => undefined);
  }
  return scrapeResult;
}
