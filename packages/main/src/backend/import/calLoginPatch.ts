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
type FrameLike = {
  url: () => string;
  evaluate: <T>(fn: (...args: never[]) => T, ...args: unknown[]) => Promise<T>;
  waitForSelector: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
  click: (selector: string) => Promise<void>;
};
type PageLike = FrameLike & { frames: () => FrameLike[] };

async function waitForLoginFrame(page: PageLike, timeoutMs: number): Promise<FrameLike> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => f.url().includes('calconnect') || f.url().includes('connect.cal-online'));
    if (frame) return frame;
    await sleep(1000);
  }
  throw new Error('לא נמצאה מסגרת ההתחברות של כאל');
}

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
      let loginFrame: FrameLike | null = null;
      options.preAction = async () => {
        // דף הכניסה מכיל מסגרת (iframe) עם שתי לשוניות: "כניסה מהירה" ו"כניסה עם שם משתמש"
        const frame = await waitForLoginFrame(page, 40_000);
        await frame.waitForSelector('#regular-login', { timeout: 30_000 });
        await sleep(1500);
        await frame.click('#regular-login');
        await frame.waitForSelector('[formcontrolname="userName"]', { timeout: 20_000 });
        loginFrame = frame;
        return frame;
      };
      // הכפתור הגלוי ששולח את הטופס (לא הכפתור של שליחת קוד ב-SMS)
      options.submitButtonSelector = async () => {
        await (loginFrame ?? page).evaluate(() => {
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
