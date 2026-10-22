import { budgetDocsAll, scrape } from '#preload';
import { reaction } from 'mobx';
import { type ConfigStore } from '../../store/ConfigStore';
import { AccountStatus } from '../../types';

// מצב הסנכרון כפי שדף התקציב מצפה לו (אותו מבנה כמו שהאתר מחזיר), מחושב מהסריקה שרצה בתוך התוכנה
export interface SyncInfo {
  online: boolean;
  status: string;
  pending: boolean;
  message: string;
  last_added: number;
  run_finished_at: string;
  auto_hours: number;
  progress?: { percent: number; text: string; steps: { name: string; status: string; detail?: string }[] };
}

const last = { status: '', message: '', last_added: 0, run_finished_at: '' };
let txBefore = 0;
let starting = false;

const txCount = async () => ((await budgetDocsAll().catch(() => ({}))) as { tx?: unknown[] }).tx?.length ?? 0;

const STEP_STATUS: Record<string, string> = {
  [AccountStatus.DONE]: 'done',
  [AccountStatus.ERROR]: 'error',
  [AccountStatus.IN_PROGRESS]: 'running',
};

export function getSyncInfo(store: ConfigStore): SyncInfo {
  const accounts = store.importers.filter((a) => a.active);
  const running = starting || store.isScraping;
  const done = accounts.filter((a) => a.status === AccountStatus.DONE || a.status === AccountStatus.ERROR).length;
  return {
    online: true,
    status: running ? 'running' : last.status,
    pending: false,
    message: last.message,
    last_added: last.last_added,
    run_finished_at: last.run_finished_at,
    auto_hours: Number(store.config?.scraping?.periodicScrapingIntervalHours) || 0,
    progress: running
      ? {
          percent: accounts.length ? Math.round((done / accounts.length) * 100) : 0,
          text: accounts.find((a) => a.status === AccountStatus.IN_PROGRESS)?.displayName ?? 'מתחיל',
          steps: accounts.map((a) => ({ name: a.displayName, status: STEP_STATUS[a.status ?? ''] ?? 'waiting' })),
        }
      : undefined,
  };
}

// הפעלת סריקה מדף התקציב: אם בשעה האחרונה חלק מהחשבונות כבר הצליחו, ברירת המחדל היא רק מה שלא הצליח
export async function startSync(store: ConfigStore, mode?: 'all') {
  starting = true;
  txBefore = await txCount();
  store.clearScrapingStatus();
  await scrape(store.handleScrapingEvent.bind(store), mode);
  setTimeout(() => {
    starting = false;
  }, 3000);
}

// מסכם סריקה שהסתיימה: כמה תנועות נוספו ומה נכשל
export function watchSyncResults(store: ConfigStore) {
  let wasRunning = false;
  return reaction(
    () => store.isScraping,
    async (running) => {
      if (running) {
        wasRunning = true;
        return;
      }
      if (!wasRunning) return;
      wasRunning = false;
      const accounts = store.importers.filter((a) => a.active);
      const failed = accounts.filter((a) => a.status === AccountStatus.ERROR);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      last.status = failed.length === 0 ? 'ok' : failed.length >= accounts.length ? 'error' : 'partial';
      last.message = failed.map((a) => a.displayName).join(', ');
      last.last_added = Math.max(0, (await txCount()) - txBefore);
      last.run_finished_at = new Date().toISOString();
    },
  );
}
