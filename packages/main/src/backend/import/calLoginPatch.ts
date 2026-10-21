import { createRequire } from 'node:module';
import { logAppEvent } from '/@/logging/operationLogger';

// באתר של כאל כפתור "כניסה לחשבון" כבר לא פותח חלון קטן עם מסגרת (iframe) כמו שהספרייה מצפה, אלא דף כניסה מלא.
// מנווטים ישר לדף הכניסה, עוברים ללשונית "כניסה עם שם משתמש" ומשתמשים בשדות שלו. שאר התהליך נשאר של הספרייה.
const DIRECT_LOGIN_URL = 'https://digital-web.cal-online.co.il/login?returnedUrl=%2Fdashboard';

type LoginOptions = {
  loginUrl?: string;
  checkReadiness?: () => Promise<unknown>;
  preAction?: () => Promise<unknown>;
  submitButtonSelector?: string | (() => Promise<unknown>);
};
type PageLike = {
  evaluate: <T>(fn: (...args: never[]) => T, ...args: unknown[]) => Promise<T>;
  waitForSelector: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
};

export function patchVisaCalLogin() {
  try {
    const require = createRequire(import.meta.url);
    const module = require('israeli-bank-scrapers-core/lib/scrapers/visa-cal') as {
      default: { prototype: { getLoginOptions: (credentials: unknown) => LoginOptions; page: PageLike } };
    };
    const proto = module.default.prototype;
    const original = proto.getLoginOptions;
    proto.getLoginOptions = function patched(this: { page: PageLike }, credentials: unknown) {
      const options = original.call(this, credentials);
      const page = this.page;
      options.loginUrl = DIRECT_LOGIN_URL;
      options.checkReadiness = async () => undefined;
      options.preAction = async () => {
        await sleep(2500);
        // לשונית "כניסה עם שם משתמש"
        await page.evaluate(() => {
          const tab = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="tab"], li, span, div')).find(
            (el) => (el.textContent ?? '').trim() === 'כניסה עם שם משתמש',
          );
          tab?.click();
        });
        await page.waitForSelector('[formcontrolname="userName"], input[type="password"]', { timeout: 20_000 });
        return page;
      };
      // הכפתור הגלוי ששולח את הטופס (לא הכפתור של שליחת קוד ב-SMS שבלשונית השנייה)
      options.submitButtonSelector = async () => {
        await page.evaluate(() => {
          const visible = Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')).filter(
            (b) => b.offsetParent !== null && !/SMS|סיסמה ב/.test(b.textContent ?? ''),
          );
          visible[0]?.click();
        });
      };
      return options;
    };
    logAppEvent('CAL_LOGIN_PATCHED', {});
  } catch (e) {
    logAppEvent('CAL_LOGIN_PATCH_FAILED', { errorMessage: (e as Error).message });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
