import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, Notification } from 'electron';
import electronUpdater from 'electron-updater';
import logger from '../logging/logger';
import { setQuitting } from '../quitState';
import { netFetchRange } from './netFetchRange';
import { downloadResumable, hashFile } from './resumableDownload';

const { autoUpdater } = electronUpdater;

export interface UpdateInfo {
  version: string;
}

autoUpdater.logger = logger;
autoUpdater.autoDownload = false;
// בהתקנת עדכון התוכנה חייבת להיסגר באמת, ולא רק להסתתר ברקע
autoUpdater.on('before-quit-for-update', setQuitting);

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

const progressToWindows = (percent: number) =>
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('updateProgress', Math.min(100, Math.max(0, percent))));

// ההורדה המלאה נעשית כאן (עם המשך מהמקום שנקטע), ואז electron-updater מוצא אותה במטמון, בודק אותה ומתקין
async function preDownloadResumable() {
  const internals = autoUpdater as unknown as {
    updateInfoAndProvider?: {
      info: { version: string };
      provider: { resolveFiles: (info: unknown) => { url: URL; info: { sha512: string } }[] };
    };
    getOrCreateDownloadHelper: () => Promise<{ cacheDirForPendingUpdate: string }>;
  };
  const found = internals.updateInfoAndProvider;
  if (!found) return;
  const files = found.provider.resolveFiles(found.info);
  const file = files.find((f) => /\.exe$/i.test(f.url.pathname)) ?? files[0];
  if (!file) return;
  const pending = (await internals.getOrCreateDownloadHelper()).cacheDirForPendingUpdate;
  fs.mkdirSync(pending, { recursive: true });
  const fileName = path.basename(file.url.pathname);
  const finalFile = path.join(pending, fileName);
  const infoFile = path.join(pending, 'update-info.json');
  const sha512 = file.info.sha512;
  try {
    const cached = JSON.parse(fs.readFileSync(infoFile, 'utf8')) as { sha512?: string };
    if (cached.sha512 === sha512 && fs.existsSync(finalFile) && (await hashFile(finalFile)) === sha512) return;
  } catch {
    // אין עדכון שמור: מורידים
  }
  const partFile = path.join(pending, `${fileName}.${found.info.version}.part`);
  fs.readdirSync(pending)
    .filter((n) => n.endsWith('.part') && n !== path.basename(partFile))
    .forEach((n) => fs.rmSync(path.join(pending, n), { force: true }));
  await downloadResumable({
    fetchRange: netFetchRange(file.url.toString()),
    partFile,
    sha512,
    onProgress: progressToWindows,
    log: (m) => logger.info(`Update download: ${m}`),
  });
  fs.rmSync(finalFile, { force: true });
  fs.renameSync(partFile, finalFile);
  fs.writeFileSync(infoFile, JSON.stringify({ fileName, sha512, isAdminRightsRequired: false }));
}

const DELTA_STALL_MS = 45_000;

// הורדה דיפרנציאלית מורידה רק את מה ששונה (מהיר בהרבה), אבל לפעמים נתקעת. אם אין התקדמות 45 שניות מבטלים וממשיכים בהורדה המלאה
function downloadDifferential() {
  const token = new electronUpdater.CancellationToken();
  return new Promise<electronUpdater.UpdateDownloadedEvent>((resolve, reject) => {
    let stall: NodeJS.Timeout;
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => {
        token.cancel();
        reject(new Error('ההורדה הדיפרנציאלית נתקעה'));
      }, DELTA_STALL_MS);
    };
    const onProgress = () => arm();
    const done = (fn: () => void) => {
      clearTimeout(stall);
      autoUpdater.off('download-progress', onProgress);
      fn();
    };
    arm();
    autoUpdater.on('download-progress', onProgress);
    autoUpdater.once('error', (e) => done(() => reject(e)));
    autoUpdater.once('update-downloaded', (info) => done(() => resolve(info)));
    autoUpdater.downloadUpdate(token).catch((e) => done(() => reject(e)));
  });
}

export const downloadUpdate = async () => {
  autoUpdater.disableDifferentialDownload = false;
  try {
    return await downloadDifferential();
  } catch (e) {
    logger.info(`Differential update download failed: ${(e as Error).message}`);
  }
  autoUpdater.disableDifferentialDownload = true;
  try {
    await preDownloadResumable();
  } catch (e) {
    // אם ההורדה עם ההמשך נכשלה, electron-updater ינסה להוריד בעצמו
    logger.info(`Resumable update download failed: ${(e as Error).message}`);
  }
  return downloadWithUpdater();
};

const downloadWithUpdater = () =>
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
