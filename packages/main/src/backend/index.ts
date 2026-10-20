import { type Config } from '@/backend/commonTypes';
import { saveScrapedTransactions } from '@/backend/localStore';
import { createTransactionsInExternalVendors } from '@/backend/export/exportTransactions';
import { scrapeFinancialAccountsAndFetchTransactions } from '@/backend/import/importTransactions';
import { initProxyIfNeeded, tearDownProxy } from '@/backend/proxyConfig';
import moment from 'moment';
import * as configManager from './configManager/configManager';
import * as Events from './eventEmitters/EventEmitter';
import { EventNames } from './eventEmitters/EventEmitter';
import outputVendors from './export/outputVendors';
import { createOperationLogger, logAppEvent } from '../logging/operationLogger';

export { CompanyTypes } from 'israeli-bank-scrapers-core';
export { Events, configManager, outputVendors };

let intervalId: NodeJS.Timeout | null = null;
let scrapeRunning = false;

/** האם סריקה כבר רצה (מהחלון או מהסנכרון ברקע), כדי לא להריץ שתיים יחד. */
export const isScrapeRunning = () => scrapeRunning;

export async function setPeriodicScrapingIfNeeded(config: Config, optionalEventPublisher?: Events.EventPublisher) {
  const hoursInterval = config.scraping.periodicScrapingIntervalHours;
  optionalEventPublisher = optionalEventPublisher ?? new Events.BudgetTrackingEventEmitter();

  stopPeriodicScraping();

  if (hoursInterval) {
    const nextScrapeTime = moment().add(hoursInterval, 'hours').format('YYYY-MM-DD HH:mm');
    logAppEvent('PERIODIC_SCRAPING_ENABLED', {
      intervalHours: hoursInterval,
      nextScrapeAt: nextScrapeTime,
    });

    await optionalEventPublisher.emit(EventNames.LOG, {
      message: `Setting up periodic scraping every ${hoursInterval} hours`,
    });
    intervalId = setInterval(
      async () => {
        logAppEvent('PERIODIC_SCRAPING_TRIGGERED');
        await scrapeAndUpdateOutputVendors(config, optionalEventPublisher);
      },
      hoursInterval * 1000 * 60 * 60,
    );
  }
}

export function stopPeriodicScraping() {
  if (intervalId) {
    logAppEvent('PERIODIC_SCRAPING_STOPPED');
    clearInterval(intervalId);
  }
}

export async function scrapeAndUpdateOutputVendors(config: Config, optionalEventPublisher?: Events.EventPublisher) {
  if (scrapeRunning) {
    throw new Error('סריקה כבר רצה כרגע. יש להמתין שתסתיים.');
  }
  scrapeRunning = true;
  try {
    return await runScrapeAndExport(config, optionalEventPublisher);
  } finally {
    scrapeRunning = false;
  }
}

async function runScrapeAndExport(config: Config, optionalEventPublisher?: Events.EventPublisher) {
  const eventPublisher = optionalEventPublisher ?? new Events.BudgetTrackingEventEmitter();

  // Create a shared operation logger for the entire scrape + export flow
  const opLog = createOperationLogger('scrape');

  const startDate = moment().subtract(config.scraping.numDaysBack, 'days').startOf('day').toDate();

  const nextAutomaticScrapeDate: Date | null = config.scraping.periodicScrapingIntervalHours
    ? moment().add(config.scraping.periodicScrapingIntervalHours, 'hours').toDate()
    : null;

  await eventPublisher.emit(
    EventNames.IMPORT_PROCESS_START,
    new Events.ImportStartEvent(`Starting to scrape from ${startDate} to today`, nextAutomaticScrapeDate),
  );

  try {
    // Initialize proxy at the start - ensures proxy is available for
    // downloading chromium, scraping, and export (YNAB API calls)
    await initProxyIfNeeded();

    const companyIdToTransactions = await scrapeFinancialAccountsAndFetchTransactions(
      config.scraping,
      startDate,
      eventPublisher,
      opLog,
    );

    // עותק מקומי לצפייה בתוכנה, גם אם הייצוא נכשל
    await saveScrapedTransactions(companyIdToTransactions, config.scraping.accountsToScrape).catch((e) =>
      opLog.error('LOCAL_STORE_FAILED', e as Error),
    );

    // Create export logger that shares context with scrape
    const exportLog = createOperationLogger('export');

    try {
      return await createTransactionsInExternalVendors(
        config.outputVendors,
        companyIdToTransactions,
        startDate,
        eventPublisher,
        exportLog,
      );
    } catch (e) {
      const error = e as Error;
      exportLog.error('FAILED', error);
      await eventPublisher.emit(
        EventNames.GENERAL_ERROR,
        new Events.BudgetTrackingEvent({
          message: error.message,
          error: error,
        }),
      );
      throw e;
    }
  } finally {
    // Tear down proxy after scraping and export complete
    // This also clears cache so next run starts fresh
    tearDownProxy();
  }
}
