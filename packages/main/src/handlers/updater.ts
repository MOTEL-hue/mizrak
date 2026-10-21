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

// עדכון אוטומטי ברקע: בודק כל כמה שעות, מוריד את הגרסה החדשה בלי שמישהו ילחץ, ומתקין לבד בשעות הלילה
// כשאין סריקה. בשעות אחרות מוצגת הודעה "הגרסה מוכנה" ולחיצה עליה מתקינה. אם התוכנה נסגרת, ההתקנה נעשית בסגירה.
let autoUpdateBusy = false;
const AUTO_UPDATE_EVERY_MS = 4 * 60 * 60 * 1000;

async function autoUpdateOnce(isScrapeRunning: () => boolean, openWindow: () => void) {
  if (autoUpdateBusy || isScrapeRunning()) return;
  autoUpdateBusy = true;
  try {
    const info = await checkForUpdate();
    if (!info) return;
    await downloadUpdate();
    const hour = new Date().getHours();
    if (hour >= 2 && hour < 6 && !isScrapeRunning()) {
      quitAndInstall();
      return;
    }
    if (Notification.isSupported()) {
      const note = new Notification({ title: 'מזרק: גרסה חדשה מוכנה', body: `גרסה ${info.version} ירדה. לחץ כאן כדי להתקין עכשיו.` });
      note.on('click', () => {
        openWindow();
        quitAndInstall();
      });
      note.show();
    }
  } catch (e) {
    logger.info(`Auto update failed: ${(e as Error).message}`);
  } finally {
    autoUpdateBusy = false;
  }
}

export function startAutoUpdate(isScrapeRunning: () => boolean, openWindow: () => void) {
  autoUpdater.autoInstallOnAppQuit = true;
  setTimeout(() => void autoUpdateOnce(isScrapeRunning, openWindow), 90_000);
  setInterval(() => void autoUpdateOnce(isScrapeRunning, openWindow), AUTO_UPDATE_EVERY_MS);
}
