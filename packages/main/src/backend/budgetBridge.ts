import { isScrapeRunning, scrapeAndUpdateOutputVendors } from '@/backend';
import { getConfig } from '@/backend/configManager/configManager';
import { BudgetTrackingEventEmitter, EventNames } from '@/backend/eventEmitters/EventEmitter';
import { budgetBase } from '@/backend/export/outputVendors/budget/budget';
import { toHebrewError } from '@/backend/import/hebrewErrors';
import { scrapePagiMortgages } from '@/backend/import/pagiMortgages';
import getChrome from '@/backend/import/downloadChromium';
import { userDataPath } from '@/app-globals';
import { notifyProblem } from '../notify';
import { summarizeFailures } from './bridgeFormat';
import { ProgressTracker } from './syncProgress';
import { logAppEvent } from '/@/logging/operationLogger';

// הגשר לדף התקציב: התוכנה רצה ברקע, שואלת את האתר אם ביקשו סנכרון (או שהגיע הזמן לסנכרון אוטומטי),
// מריצה את הסריקה, ומדווחת לאתר מה קרה. כך לא צריך לפתוח את התוכנה בכלל.
const POLL_MS = 30_000;
const FIRST_POLL_MS = 20_000;

let busy = false;

async function call(base: string, token: string, path: string, body?: unknown) {
  return fetch(`${base}/budget/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

// ריבית בנק ישראל נמשכת מהמחשב שלך ונשלחת לתקציב, כי שרת בענן לא תמיד מצליח להביא אותה
const BOI_RATES_URL =
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BIR/1.0/?c%5BSERIES_CODE%5D=BIR_RATE&format=csv&startperiod=2015-01';

async function pushRates(base: string, token: string) {
  try {
    const response = await fetch(BOI_RATES_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return;
    const csv = await response.text();
    const result = await call(base, token, 'rates-push', { csv });
    logAppEvent('BUDGET_RATES_PUSHED', { status: result.status });
  } catch (e) {
    logAppEvent('BUDGET_RATES_FAILED', { errorMessage: (e as Error).message });
  }
}

// פירוט המשכנתאות מפאג"י נמשך אחרי הסריקה ונשלח לדף החובות. כישלון כאן לא מפיל את הסנכרון
async function pushMortgages(
  base: string,
  token: string,
  config: Awaited<ReturnType<typeof getConfig>>,
  tracker: ProgressTracker,
) {
  const account = config.scraping.accountsToScrape.find((a) => a.key === 'pagi' && a.active !== false);
  if (!account) return;
  try {
    await call(base, token, 'sync-report', { status: 'progress', ...tracker.snapshot(), text: 'פאג"י: מושך פירוט משכנתאות' });
    const chromePath = config.scraping.chromiumPath || (await getChrome(userDataPath, () => undefined));
    const tracks = await scrapePagiMortgages({
      credentials: account.loginFields as Record<string, string>,
      chromePath,
      showBrowser: config.scraping.showBrowser,
      timeout: config.scraping.timeout,
    });
    const result = await call(base, token, 'mortgage', { tracks });
    logAppEvent('BUDGET_MORTGAGE_PUSHED', { status: result.status, tracks: tracks.length });
  } catch (e) {
    logAppEvent('BUDGET_MORTGAGE_FAILED', { errorMessage: (e as Error).message });
    notifyProblem('מזרק: משיכת המשכנתא נכשלה', toHebrewError((e as Error).message));
  }
}

export async function budgetTick() {
  if (busy || isScrapeRunning()) return;
  const config = await getConfig().catch(() => undefined);
  const budget = config?.outputVendors.budget;
  if (!config || !budget?.active || !budget.options.token || !budget.options.siteUrl) return;

  let base: string;
  try {
    base = budgetBase(budget.options.siteUrl);
  } catch {
    return;
  }
  const token = budget.options.token;

  try {
    const poll = await call(base, token, 'sync-poll');
    if (!poll.ok) return;
    const { pending, due, rates_due: ratesDue } = (await poll.json()) as {
      pending?: boolean;
      due?: boolean;
      rates_due?: boolean;
    };
    if (ratesDue) await pushRates(base, token);
    if (!pending && !due) return;

    busy = true;
    logAppEvent('BUDGET_SYNC_START', { reason: pending ? 'manual' : 'auto' });
    await call(base, token, 'sync-report', { status: 'running' });

    const failures: { company: string; message: string }[] = [];
    const events = new BudgetTrackingEventEmitter();
    events.on(EventNames.IMPORTER_ERROR, (event) => {
      failures.push({ company: String(event.vendorId ?? ''), message: event.message });
    });
    // התקדמות לדף התקציב: אחוזים ומה קורה עכשיו (לכל היותר פעם בשתי שניות)
    const tracker = new ProgressTracker(
      config.scraping.accountsToScrape.filter((a) => a.active !== false).map((a) => a.key),
    );
    let lastSent = 0;
    events.onAny((eventName, data) => {
      tracker.onEvent(String(eventName), data as { message?: string; percent?: number });
      const now = Date.now();
      if (now - lastSent < 2000 && eventName !== 'EXPORT_PROCESS_START') return;
      lastSent = now;
      call(base, token, 'sync-report', { status: 'progress', ...tracker.snapshot() }).catch(() => undefined);
    });
    try {
      await scrapeAndUpdateOutputVendors(config, events);
      await pushMortgages(base, token, config, tracker);
      const summary = summarizeFailures(failures);
      // כשחלק מהחשבונות נכשלו, מה שהצליח כבר נשלח לתקציב, ולכן הדיווח הוא "חלקי" ולא כשל מלא
      const allFailed = failures.length > 0 && failures.length >= config.scraping.accountsToScrape.filter((a) => a.active !== false).length;
      await call(base, token, 'sync-report', { status: summary ? (allFailed ? 'error' : 'partial') : 'ok', message: summary });
      if (summary) notifyProblem('מזרק: הסנכרון נכשל בחלק מהחשבונות', `${summary}. לפרטים ולמה לעשות: פתח את מזרק ← עזרה והסברים.`);
      logAppEvent('BUDGET_SYNC_DONE', { failed: failures.length });
    } catch (e) {
      const message = toHebrewError((e as Error).message);
      await call(base, token, 'sync-report', { status: 'error', message });
      notifyProblem('מזרק: הסנכרון נכשל', message);
      logAppEvent('BUDGET_SYNC_FAILED', { errorMessage: (e as Error).message });
    }
  } catch (e) {
    logAppEvent('BUDGET_BRIDGE_ERROR', { errorMessage: (e as Error).message });
  } finally {
    busy = false;
  }
}

export function startBudgetBridge() {
  setTimeout(() => void budgetTick(), FIRST_POLL_MS);
  setInterval(() => void budgetTick(), POLL_MS);
}
