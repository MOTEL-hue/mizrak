import fs from 'node:fs';
import path from 'node:path';
import { type Browser, type Page } from 'puppeteer-core';
import { userDataPath } from '@/app-globals';
import { logAppEvent } from '/@/logging/operationLogger';
import { clickByText } from './pagiMortgages';

// בנקים שיש להם (או יהיה להם) קורא הלוואות ומשכנתא. בפאג"י הקורא קיים (pagiMortgages). בשאר: שלב גילוי, שאוסף את מבנה
// אזור ההלוואות באתר הבנק (שמות וקישורים בלבד, בלי מספרים), כדי לבנות קורא מתאים. מוסיפים בנק חדש כאן ובמפה LANDING.
export const LOAN_BANKS = ['pagi', 'beinleumi', 'hapoalim'] as const;
const DISCOVERY_ONLY = ['hapoalim'];
const LANDING: Record<string, string> = {
  hapoalim: 'https://login.bankhapoalim.co.il/ng-portals/rb/he/homepage',
};
export const needsDiscovery = (companyId: string) => DISCOVERY_ONLY.includes(companyId);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mask = (s: string) => s.replace(/[\d-]{5,}/g, '###');
const limited = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, sleep(ms).then(() => Promise.reject(new Error('חרג מהזמן')))]);

export const discoveryFile = (companyId: string) => path.join(userDataPath, `loan-discovery-${companyId}.txt`);

async function pageText(page: Page, max: number) {
  const text = await limited(
    page.evaluate(() => document.body?.innerText ?? ''),
    8000,
  ).catch(() => '');
  return mask(text.replace(/\s+/g, ' ')).slice(0, max);
}

// מילות מפתח של אזור ההלוואות: מוצאים קישורים וכפתורים שמכילים אותן
const KEYWORDS = 'הלוואות|הלוואה|משכנתא|משכנתאות|אשראי|פיקדון|חיסכון';

export async function discoverLoanPages(browser: Browser, companyId: string, timeout: number): Promise<void> {
  const lines: string[] = [];
  const startedAt = Date.now();
  const log = (message: string) => {
    lines.push(`${Math.round((Date.now() - startedAt) / 1000)}s ${message}`);
    try {
      fs.writeFileSync(discoveryFile(companyId), lines.join('\n'));
    } catch {
      // אבחון בלבד
    }
  };
  let page: Page | undefined;
  const work = async () => {
    const landing = LANDING[companyId];
    if (!landing) return log('אין כתובת התחלה לבנק הזה');
    page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(landing, { waitUntil: 'domcontentloaded' });
    await sleep(10_000);
    log(`כתובת: ${mask(page.url()).slice(0, 120)}`);
    log(`טקסט הדף הראשי: ${await pageText(page, 900)}`);
    const links = await limited(
      page.evaluate((words) => {
        const re = new RegExp(words);
        return Array.from(document.querySelectorAll<HTMLElement>('a, button, [role=menuitem], [role=tab], li'))
          .filter((el) => (el.textContent ?? '').trim().length < 40 && re.test(el.textContent ?? ''))
          .slice(0, 25)
          .map((el) => `${el.tagName} "${(el.textContent ?? '').trim()}" ${el.getAttribute('href') ?? ''}`);
      }, KEYWORDS),
      8000,
    ).catch(() => [] as string[]);
    log(`קישורים שנמצאו (${links.length}): ${mask(links.join(' | ')).slice(0, 1500)}`);
    for (const label of ['^הלוואות', 'משכנתא']) {
      const clicked = await limited(clickByText(page, label), 8000).catch(() => false);
      log(`לחיצה על "${label}": ${clicked ? 'נלחץ' : 'לא נמצא'}`);
      if (!clicked) continue;
      await sleep(8000);
      log(`אחרי "${label}" כתובת: ${mask(page.url()).slice(0, 120)}`);
      log(`אחרי "${label}" טקסט: ${await pageText(page, 1500)}`);
    }
  };
  try {
    await Promise.race([work(), sleep(90_000)]);
  } catch (e) {
    log(`שגיאה: ${(e as Error).message}`);
  } finally {
    await Promise.race([page?.close().catch(() => undefined), sleep(5000)]);
    log('סיום');
    logAppEvent('LOAN_DISCOVERY_DONE', { company: companyId });
  }
}
