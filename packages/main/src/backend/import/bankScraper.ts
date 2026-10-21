import { type AccountToScrapeConfig } from '@/backend/commonTypes';
import { createScraper, type ScraperOptions } from 'israeli-bank-scrapers-core';
import { getProxyArgs } from '@/backend/proxyConfig';

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
const CLOSE_POPUPS_SCRIPT = `
(() => {
  const visible = (el) => !!(el && (el.offsetWidth || el.offsetHeight) && getComputedStyle(el).visibility !== 'hidden');
  const isClose = (el) => {
    const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.className && el.className.toString ? el.className.toString() : '')).toLowerCase();
    const text = (el.textContent || '').trim();
    return /close|סגור|dismiss/.test(label) || text === '×' || text === 'x' || text === 'X' || text === '✕';
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
    defaultTimeout: timeout,
    args: proxyArgs, // Add proxy configuration to browser args
  };
  options.preparePage = async (page) => {
    await page.evaluateOnNewDocument(CLOSE_POPUPS_SCRIPT);
  };
  const scraper = createScraper(options);
  scraper.onProgress((eventCompanyId: string, payload: { type: string }) => {
    emitProgressEvent(companyId, payload.type);
  });
  const scrapeResult = await scraper.scrape(credentials);
  return scrapeResult;
}
