import { BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import logger from '../logging/logger';

const { autoUpdater } = electronUpdater;

export interface UpdateInfo {
  version: string;
}

autoUpdater.logger = logger;
autoUpdater.autoDownload = false;
// בהורדה חלקית האחוזים יכולים לעבור את 100, ולכן מורידים את הקובץ המלא
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
