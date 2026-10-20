import { isScrapeRunning, scrapeAndUpdateOutputVendors } from '@/backend';
import { getConfig } from '@/backend/configManager/configManager';
import { BudgetTrackingEventEmitter, EventNames } from '@/backend/eventEmitters/EventEmitter';
import { budgetBase } from '@/backend/export/outputVendors/budget/budget';
import { toHebrewError } from '@/backend/import/hebrewErrors';
import { summarizeFailures } from './bridgeFormat';
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
    const { pending, due } = (await poll.json()) as { pending?: boolean; due?: boolean };
    if (!pending && !due) return;

    busy = true;
    logAppEvent('BUDGET_SYNC_START', { reason: pending ? 'manual' : 'auto' });
    await call(base, token, 'sync-report', { status: 'running' });

    const failures: { company: string; message: string }[] = [];
    const events = new BudgetTrackingEventEmitter();
    events.on(EventNames.IMPORTER_ERROR, (event) => {
      failures.push({ company: String(event.vendorId ?? ''), message: event.message });
    });
    try {
      await scrapeAndUpdateOutputVendors(config, events);
      const summary = summarizeFailures(failures);
      await call(base, token, 'sync-report', { status: summary ? 'error' : 'ok', message: summary });
      logAppEvent('BUDGET_SYNC_DONE', { failed: failures.length });
    } catch (e) {
      await call(base, token, 'sync-report', { status: 'error', message: toHebrewError((e as Error).message) });
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
