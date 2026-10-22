import { BrowserWindow, Notification } from 'electron';
import electronUpdater from 'electron-updater';
import logger from '../logging/logger';
import { setQuitting } from '../quitState';

const { autoUpdater } = electronUpdater;

export interface UpdateInfo {
  version: string;
}

autoUpdater.logger = logger;
autoUpdater.autoDownload = false;
// בהתקנת עדכון התוכנה חייבת להיסגר באמת, ולא רק להסתתר ברקע
autoUpdater.on('before-quit-for-update', setQuitting);
// הורדה דיפרנציאלית נתקעת ב-100% ולא מסתיימת, ולכן מורידים את הקובץ המלא (ההתקדמות מוצגת עד 100)
autoUpdater.disableDifferentialDownload = true;

// אחוזי ההורדה מוצגים בחלון, כדי שלא יהיה רק סימן מסתובב
autoUpdater.on('download-progress', (progress) => {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('updateProgress', Math.min(100, Math.max(0, Math.round(progress.percent)))));
});

export const checkForUpdate = async () =>
  new Promise<UpdateInfo | false>((resolve, reject) => {
    autoUpdater.once('error', reject);
    autoUpdater.once('update-available', (info: UpdateInfo) => resolve(info));
    autoUpdater.once('update-not-available', () => resolve(false));
    autoUpdater.checkForUpdates();
  });

export const downloadUpdate = async () =>
  new Promise<electronUpdater.UpdateDownloadedEvent>((resolve, reject) => {
    autoUpdater.once('error', reject);
    autoUpdater.once('update-downloaded', resolve);
    autoUpdater.downloadUpdate();
  });

export const quitAndInstall = () => {
  logger.info('Quitting and installing update');
  setImmediate(() => autoUpdater.quitAndInstall());
};

// עדכון ברקע: בודק כל כמה שעות אם יש גרסה חדשה, ומציג הודעה. ההורדה וההתקנה מתחילות רק אחרי אישור (לחיצה על ההודעה),
// ואז החלון נפתח, מציג את ההתקדמות, והתוכנה מותקנת ונפתחת מחדש.
let autoUpdateBusy = false;
let notifiedVersion = '';
const AUTO_UPDATE_EVERY_MS = 4 * 60 * 60 * 1000;

async function approveAndInstall(openWindow: () => void) {
  openWindow();
  autoUpdateBusy = true;
  try {
    await downloadUpdate();
    quitAndInstall();
  } catch (e) {
    logger.info(`Approved update failed: ${(e as Error).message}`);
    notifiedVersion = '';
  } finally {
    autoUpdateBusy = false;
  }
}

async function autoUpdateOnce(isScrapeRunning: () => boolean, openWindow: () => void) {
  if (autoUpdateBusy || isScrapeRunning()) return;
  autoUpdateBusy = true;
  try {
    const info = await checkForUpdate();
    if (!info || info.version === notifiedVersion || !Notification.isSupported()) return;
    notifiedVersion = info.version;
    const note = new Notification({
      title: 'תקציב: יש גרסה חדשה',
      body: `גרסה ${info.version} זמינה. לחץ כאן כדי להוריד ולהתקין (התוכנה תיפתח מחדש).`,
    });
    note.on('click', () => void approveAndInstall(openWindow));
    note.show();
  } catch (e) {
    logger.info(`Auto update check failed: ${(e as Error).message}`);
  } finally {
    autoUpdateBusy = false;
  }
}

export function startAutoUpdate(isScrapeRunning: () => boolean, openWindow: () => void) {
  autoUpdater.autoInstallOnAppQuit = false;
  setTimeout(() => void autoUpdateOnce(isScrapeRunning, openWindow), 90_000);
  setInterval(() => void autoUpdateOnce(isScrapeRunning, openWindow), AUTO_UPDATE_EVERY_MS);
}
