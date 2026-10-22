import { isScrapeRunning, scrapeAndUpdateOutputVendors } from '@/backend';
import { getConfig } from '@/backend/configManager/configManager';
import { BudgetTrackingEventEmitter, EventNames } from '@/backend/eventEmitters/EventEmitter';
import { budgetBase } from '@/backend/export/outputVendors/budget/budget';
import { toHebrewError } from '@/backend/import/hebrewErrors';
import { scrapePagiMortgages, takePendingMortgages } from '@/backend/import/pagiMortgages';
import { saveMortgages } from '@/backend/import/mortgageStore';
import { clearResume } from '@/backend/import/resumeStore';
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
const BOI_RATES_URLS = [
  'https://edge.boi.gov.il/FusionEdgeServer/ws/public/sdmxapi/rest/data/BIR?startPeriod=2015-01',
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BIR/1.0/?format=csv&startperiod=2015-01',
  'https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BIR/1.0/?format=csv&startperiod=2015-01',
  'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BIR/1.0/?c%5BSERIES_CODE%5D=BIR_RATE&format=csv&startperiod=2015-01',
];

async function pushRates(base: string, token: string) {
  // הכתובת הראשונה שהשרת מקבל ממנה נתונים תקינים מנצחת
  for (const url of BOI_RATES_URLS) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) {
        logAppEvent('BUDGET_RATES_FAILED', { url, status: response.status });
        continue;
      }
      const result = await call(base, token, 'rates-push', { csv: await response.text() });
      logAppEvent('BUDGET_RATES_PUSHED', { url, status: result.status });
      if (result.ok) return;
    } catch (e) {
      logAppEvent('BUDGET_RATES_FAILED', { url, errorMessage: (e as Error).message });
    }
  }
}

// פירוט המשכנתאות מפאג"י נמשך אחרי הסריקה ונשלח לדף החובות. כישלון כאן לא מפיל את הסנכרון
async function pushMortgages(
  base: string,
  token: string,
  config: Awaited<ReturnType<typeof getConfig>>,
  tracker: ProgressTracker,
): Promise<string | null> {
  const account = config.scraping.accountsToScrape.find((a) => (a.key === 'pagi' || a.key === 'beinleumi') && a.active !== false);
  if (!account) return null;
  const started = Date.now();
  const report = () => {
    const seconds = Math.round((Date.now() - started) / 1000);
    tracker.setExtra(`פאג"י: מושך פירוט משכנתאות (${seconds} שניות)`, Math.min(98, 92 + Math.floor(seconds / 30)));
    call(base, token, 'sync-report', { status: 'progress', ...tracker.snapshot() }).catch(() => undefined);
  };
  report();
  const heartbeat = setInterval(report, 8000);
  try {
    const chromePath = config.scraping.chromiumPath || (await getChrome(userDataPath, () => undefined));
    const tracks =
      takePendingMortgages() ??
      (await scrapePagiMortgages({
      credentials: account.loginFields as Record<string, string>,
      chromePath,
      showBrowser: config.scraping.showBrowser,
      timeout: config.scraping.timeout,
      profileKey: account.key,
    }));
    await saveMortgages(tracks).catch(() => undefined);
    const result = await call(base, token, 'mortgage', { tracks });
    logAppEvent('BUDGET_MORTGAGE_PUSHED', { status: result.status, tracks: tracks.length });
    return null;
  } catch (e) {
    logAppEvent('BUDGET_MORTGAGE_FAILED', { errorMessage: (e as Error).message });
    const message = toHebrewError((e as Error).message);
    notifyProblem('תקציב: משיכת המשכנתא נכשלה', message);
    return message;
  } finally {
    clearInterval(heartbeat);
    tracker.setExtra(null);
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
    const { pending, due, rates_due: ratesDue, mode } = (await poll.json()) as {
      pending?: boolean;
      due?: boolean;
      rates_due?: boolean;
      mode?: string;
    };
    if (ratesDue) await pushRates(base, token);
    if (!pending && !due) return;

    busy = true;
    // "סנכרן הכל מחדש": מוחקים את מה שנשמר מהסריקה החלקית, אחרת רק חשבונות שלא הסתיימו נסרקים שוב
    if (pending && mode === 'all') await clearResume();
    logAppEvent('BUDGET_SYNC_START', { reason: pending ? 'manual' : 'auto', mode: mode || 'failed-only' });
    await call(base, token, 'sync-report', { status: 'running' });

    const failures: { company: string; message: string }[] = [];
    const events = new BudgetTrackingEventEmitter();
    events.on(EventNames.IMPORTER_ERROR, (event) => {
      failures.push({ company: String(event.vendorId ?? ''), message: event.message });
    });
    // ניסיון חוזר או מסייע שהצליח מבטל את השגיאה שדווחה קודם לאותו חשבון
    events.on(EventNames.IMPORTER_END, (event) => {
      const company = String(event.vendorId ?? '');
      for (let i = failures.length - 1; i >= 0; i--) if (failures[i].company === company) failures.splice(i, 1);
    });
    // התקדמות לדף התקציב: אחוזים ומה קורה עכשיו (לכל היותר פעם בשתי שניות)
    const tracker = new ProgressTracker(
      config.scraping.accountsToScrape.filter((a) => a.active !== false).map((a) => a.key),
    );
    // התקדמות מיידית (גם אם כל החשבונות נלקחים מהשמור ואין אירועים), כדי שדף התקציב לא יציג רק "מסנכרן"
    call(base, token, 'sync-report', { status: 'progress', ...tracker.snapshot(), text: 'מתחיל לסרוק' }).catch(() => undefined);
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
      const mortgageError = await pushMortgages(base, token, config, tracker);
      if (mortgageError) failures.push({ company: 'pagi', message: `משכנתא: ${mortgageError}` });
      const summary = summarizeFailures(failures);
      // כשחלק מהחשבונות נכשלו, מה שהצליח כבר נשלח לתקציב, ולכן הדיווח הוא "חלקי" ולא כשל מלא
      const allFailed = failures.length > 0 && failures.length >= config.scraping.accountsToScrape.filter((a) => a.active !== false).length;
      await call(base, token, 'sync-report', { status: summary ? (allFailed ? 'error' : 'partial') : 'ok', message: summary });
      if (summary) notifyProblem('תקציב: הסנכרון נכשל בחלק מהחשבונות', `${summary}. לפרטים ולמה לעשות: פתח את תקציב ← עזרה והסברים.`);
      logAppEvent('BUDGET_SYNC_DONE', { failed: failures.length });
    } catch (e) {
      const message = toHebrewError((e as Error).message);
      await call(base, token, 'sync-report', { status: 'error', message });
      notifyProblem('תקציב: הסנכרון נכשל', message);
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

// משיכת משכנתא מהכפתור "הפעל" בתוך התוכנה: נשמרת מקומית להצגה, ונשלחת לתקציב אם הוא מחובר
export async function pullMortgagesInApp(config: Awaited<ReturnType<typeof getConfig>>): Promise<string | null> {
  const account = config.scraping.accountsToScrape.find((a) => (a.key === 'pagi' || a.key === 'beinleumi') && a.active !== false);
  if (!account) return null;
  try {
    const chromePath = config.scraping.chromiumPath || (await getChrome(userDataPath, () => undefined));
    const tracks =
      takePendingMortgages() ??
      (await scrapePagiMortgages({
      credentials: account.loginFields as Record<string, string>,
      chromePath,
      showBrowser: config.scraping.showBrowser,
      timeout: config.scraping.timeout,
      profileKey: account.key,
    }));
    await saveMortgages(tracks);
    logAppEvent('MORTGAGE_PULLED_IN_APP', { tracks: tracks.length });
    const budget = config.outputVendors.budget;
    if (budget?.active && budget.options.token && budget.options.siteUrl) {
      await call(budgetBase(budget.options.siteUrl), budget.options.token, 'mortgage', { tracks });
    }
    return null;
  } catch (e) {
    logAppEvent('MORTGAGE_PULL_FAILED', { errorMessage: (e as Error).message });
    return toHebrewError((e as Error).message);
  }
}

// התקדמות של סריקה שהופעלה מתוך התוכנה, כדי שדף התקציב יציג אחוזים ושלבים גם אז
export function reportAppProgress(config: Awaited<ReturnType<typeof getConfig>>, events: BudgetTrackingEventEmitter) {
  const budget = config.outputVendors.budget;
  if (!budget?.active || !budget.options.token || !budget.options.siteUrl) return;
  try {
    const base = budgetBase(budget.options.siteUrl);
    const token = budget.options.token;
    const tracker = new ProgressTracker(config.scraping.accountsToScrape.filter((a) => a.active !== false).map((a) => a.key));
    let lastSent = 0;
    events.onAny((eventName, data) => {
      tracker.onEvent(String(eventName), data as { message?: string; percent?: number });
      const now = Date.now();
      if (now - lastSent < 2000 && eventName !== 'EXPORT_PROCESS_START') return;
      lastSent = now;
      call(base, token, 'sync-report', { status: 'progress', ...tracker.snapshot() }).catch(() => undefined);
    });
  } catch (e) {
    logAppEvent('BUDGET_APP_REPORT_FAILED', { errorMessage: (e as Error).message });
  }
}

// סריקה שהופעלה מהכפתור "הפעל" בתוך התוכנה מדווחת לדף התקציב, כדי שיציג שהסנכרון עודכן ולא יתחיל סנכרון מיותר
export async function reportAppRun(
  config: Awaited<ReturnType<typeof getConfig>>,
  state: 'running' | { problems: number; total: number; message: string },
) {
  const budget = config.outputVendors.budget;
  if (!budget?.active || !budget.options.token || !budget.options.siteUrl) return;
  try {
    const base = budgetBase(budget.options.siteUrl);
    const body =
      state === 'running'
        ? { status: 'running' }
        : { status: state.problems === 0 ? 'ok' : state.problems >= state.total ? 'error' : 'partial', message: state.message };
    await call(base, budget.options.token, 'sync-report', body);
  } catch (e) {
    logAppEvent('BUDGET_APP_REPORT_FAILED', { errorMessage: (e as Error).message });
  }
}
