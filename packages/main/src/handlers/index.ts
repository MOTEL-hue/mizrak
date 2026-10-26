import { applyBatch, getAll } from '@/backend/budgetDocs/docApi';
import { getRates } from '@/backend/budgetDocs/rates';
import { type BatchOp } from '@/backend/budgetDocs/docView';
import { pullMortgagesInApp, reportAppProgress, reportAppRun } from '@/backend/budgetBridge';
import { getMortgageSchedule, setMortgageForced, setMortgageMode, type MortgageMode } from '@/backend/import/mortgageSchedule';
import { loadMortgages } from '@/backend/import/mortgageStore';
import { clearResume, loadResumeInfo } from '@/backend/import/resumeStore';
import { App } from '@/app-globals';
import { scrapeAndUpdateOutputVendors, setPeriodicScrapingIfNeeded, stopPeriodicScraping } from '@/backend';
import { type Credentials } from '@/backend/commonTypes';
import { getConfig } from '@/backend/configManager/configManager';
import { BudgetTrackingEventEmitter, EventNames } from '@/backend/eventEmitters/EventEmitter';
import { displayName } from '@/backend/bridgeFormat';
import { toHebrewError } from '@/backend/import/hebrewErrors';
import { notifyProblem } from '../notify';
import electronGoogleOAuth2Connector from '@/backend/export/outputVendors/googleSheets/electronGoogleOAuth2Connector';
import { createClient, validateToken } from '@/backend/export/outputVendors/googleSheets/googleAuth';
import { createSpreadsheet } from '@/backend/export/outputVendors/googleSheets/googleSheets';
import { getAllSpreadsheets } from '@/backend/export/outputVendors/googleSheets/googleSheetsInternalAPI';
import { getYnabAccountData } from '@/manual/setupHelpers';
import { clipboard, dialog, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import Sentry from '../logging/sentry';
import { getConfigHandler, updateConfigHandler } from './configHandlers';
import { loadWithSeed } from '@/backend/localStore';
import { exportDiagnosticsHandler, getErrorGuideHandler, isBrowserInstalledHandler } from './diagnostics';
import { getLogsInfoHandler } from './logsHandlers';
import { checkForUpdate, downloadUpdate, quitAndInstall } from './updater';

type Listener<T = unknown> = (
  event: IpcMainInvokeEvent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => Promise<T> | T;

const functions: Record<string, Listener> = {
  showSaveDialog: async () => {
    const dir = await dialog.showSaveDialog({});
    return dir.filePath;
  },
  checkForUpdate,
  downloadUpdate,
  quitAndInstall,
  getConfig: getConfigHandler,
  updateConfig: updateConfigHandler as Listener<void>,
  getYnabAccountData,
  getLogsInfo: getLogsInfoHandler,
  exportDiagnostics: exportDiagnosticsHandler,
  getErrorGuide: getErrorGuideHandler,
  copyTextToClipboard: (_: unknown, text: string) => {
    clipboard.writeText(String(text));
    return true;
  },
  getLocalTransactions: async () => loadWithSeed(await getConfig()),
  getLocalMortgages: loadMortgages,
  getResumeInfo: loadResumeInfo,
  getMortgageSchedule: () => getMortgageSchedule(),
  setMortgageMode: (_: unknown, mode: MortgageMode, everyDays?: number) => setMortgageMode(mode, everyDays),
  isBrowserInstalled: isBrowserInstalledHandler,
  stopPeriodicScraping,
  getAppInfo: async () => {
    return {
      sourceCommitShort: import.meta.env.VITE_SOURCE_COMMIT_SHORT,
      currentVersion: App.getVersion(),
    };
  },
  sentryUserReportProblem: (
    _: unknown,
    title: string,
    body: string,
    logs: string,
    email: string,
    extra: Record<string, unknown>,
  ) => Sentry.userReportProblem(title, body, logs, email, extra),
  // דף התקציב שבתוך התוכנה
  budgetDocsAll: () => getAll(),
  budgetRates: () => getRates(),
  budgetDocsBatch: (_: unknown, ops: BatchOp[]) => applyBatch(ops),
  // Google Sheets
  getAllUserSpreadsheets: (_: unknown, credentials: Credentials) => getAllSpreadsheets(createClient(credentials)),
  validateToken: (_: unknown, credentials: Credentials) => validateToken(credentials),
  electronGoogleOAuth2Connector,
  createSpreadsheet: (_, spreadsheetTitle: string, credentials: Credentials) =>
    createSpreadsheet(spreadsheetTitle, credentials),
};

export const registerHandlers = () => {
  Object.keys(functions).forEach((funcName: keyof typeof functions) => {
    ipcMain.removeHandler(funcName);
    ipcMain.handle(funcName, functions[funcName]); // Add index signature
  });

  ipcMain.removeAllListeners('scrape');
  ipcMain.on('scrape', async (event: IpcMainEvent, mode?: string, onlyAccountId?: string, forceMortgage?: boolean) => {
    setMortgageForced(!!forceMortgage);
    if (mode === 'all' || onlyAccountId) await clearResume();
    const fullConfig = await getConfig();
    // סנכרון חשבון אחד: שאר החשבונות לא נסרקים בהרצה הזו (ההגדרה השמורה לא משתנה)
    const config = onlyAccountId
      ? {
          ...fullConfig,
          scraping: {
            ...fullConfig.scraping,
            accountsToScrape: fullConfig.scraping.accountsToScrape.map((a) => ({ ...a, active: a.id === onlyAccountId })),
          },
        }
      : fullConfig;
    const eventSubscriber = new BudgetTrackingEventEmitter();
    eventSubscriber.onAny((eventName, eventData) => {
      event.reply('scrapingProgress', JSON.stringify({ eventName, eventData }));
    });
    const problems: { name: string; message: string }[] = [];
    const collect = (data: { vendorId?: string; message: string }) =>
      problems.push({ name: displayName(String(data.vendorId ?? '')), message: data.message });
    eventSubscriber.on(EventNames.IMPORTER_ERROR, collect);
    // ניסיון חוזר או מסייע שהצליח מבטל את השגיאה שדווחה קודם לאותו חשבון
    eventSubscriber.on(EventNames.IMPORTER_END, (data: { vendorId?: string }) => {
      const name = displayName(String(data.vendorId ?? ''));
      for (let i = problems.length - 1; i >= 0; i--) if (problems[i].name === name) problems.splice(i, 1);
    });
    eventSubscriber.on(EventNames.EXPORTER_ERROR, collect);
    await setPeriodicScrapingIfNeeded(config, eventSubscriber);
    await reportAppRun(config, 'running');
    reportAppProgress(config, eventSubscriber);
    try {
      await scrapeAndUpdateOutputVendors(config, eventSubscriber);
      const mortgageError = await pullMortgagesInApp(config);
      if (mortgageError) problems.push({ name: 'משכנתא (פאג"י)', message: mortgageError });
    } catch (e) {
      problems.push({ name: 'הסריקה', message: toHebrewError((e as Error).message) });
    } finally {
      setMortgageForced(false);
    }
    await reportAppRun(config, {
      problems: problems.length,
      total: config.scraping.accountsToScrape.filter((a) => a.active !== false).length,
      message: problems.map((x) => `${x.name}: ${x.message}`).join(' | '),
    });
    event.reply('scrapingDone', JSON.stringify({ problems: problems.length }));
    if (problems.length > 0) {
      // הודעה בעברית גם מחוץ לחלון, וגם בתוך החלון עם הסבר
      event.reply('scrapingSummary', JSON.stringify(problems));
      notifyProblem(
        'תקציב: הסריקה הסתיימה עם שגיאות',
        problems.map((x) => `${x.name}: ${x.message}`).join(' | '),
      );
    }
  });

  ipcMain.removeAllListeners('getYnabAccountData');
  ipcMain.on('getYnabAccountData', async (event, _event, ynabExporterOptions) => {
    const ynabAccountData = await getYnabAccountData(_event, ynabExporterOptions);
    event.reply('getYnabAccountData', ynabAccountData);
  });
};
