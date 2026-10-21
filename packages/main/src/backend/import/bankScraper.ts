import { type AccountToScrapeConfig } from '@/backend/commonTypes';
import { createScraper, type ScraperOptions } from 'israeli-bank-scrapers-core';
import { getProxyArgs } from '@/backend/proxyConfig';
import { logAppEvent } from '/@/logging/operationLogger';
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
    defaultTimeout: [...SLOW_COMPANIES, 'visaCal', 'max'].includes(companyId) ? Math.max(timeout, SLOW_TIMEOUT_MS) : timeout,
    // פרופיל קבוע לקבוצת הבינלאומי: אחרי אימות ידני אחד האתר זוכר את הדפדפן ופחות חוסם
    args: SLOW_COMPANIES.includes(companyId)
      ? [...proxyArgs, `--user-data-dir=${path.join(userDataPath, 'browser-profiles', companyId)}`]
      : proxyArgs,
  };
  options.preparePage = async (page) => {
    await page.evaluateOnNewDocument(CLOSE_POPUPS_SCRIPT);
    if (companyId === 'visaCal') await page.evaluateOnNewDocument(DELAY_CAL_LOGIN_BUTTON_SCRIPT);
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && !assistedCompanies.has(companyId) && /perfdrive\.com|radware/i.test(frame.url())) {
        botBlockedUntil.set(companyId, Date.now() + BOT_BLOCK_COOLDOWN_MS);
        logAppEvent('BOT_CHALLENGE_DETECTED', { company: companyId });
        // אין טעם להמתין חמש דקות לכפתור שלא יופיע
        setTimeout(() => page.close().catch(() => undefined), 3000);
      }
    });
    // צילום טקסט של הדף אחרי 90 שניות, כדי לדעת מה האתר הציג כשהכניסה נתקעת (בלי סיסמאות, רק הטקסט הגלוי)
    setTimeout(async () => {
      try {
        if (page.isClosed()) return;
        const snap = await page.evaluate(
          () => `${location.href} | ${document.title} | ${(document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400)}`,
        );
        logAppEvent('PAGE_SNAPSHOT_90S', { company: companyId, snapshot: snap });
      } catch {
        // הדף כבר נסגר
      }
    }, 90_000);
  };
  const scraper = createScraper(options);
  scraper.onProgress((eventCompanyId: string, payload: { type: string }) => {
    emitProgressEvent(companyId, payload.type);
  });
  const scrapeResult = await scraper.scrape(credentials);
  return scrapeResult;
}
