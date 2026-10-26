import { app, Menu, nativeImage, Tray } from 'electron';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { budgetTick, startBudgetBridge } from '@/backend/budgetBridge';
import { isScrapeRunning } from '@/backend';
import { startAutoUpdate } from './handlers/updater';
import { backupBudgetDocsIfDue } from './backend/budgetDocs/docBackup';
import { restoreOrCreateWindow } from '/@/mainWindow';
import { logAppEvent } from './logging/operationLogger';
import { setQuitting } from './quitState';

// פעולה ברקע: סמל ליד השעון, פתיחה אוטומטית עם Windows, וסנכרון לפי בקשה מדף התקציב.
let tray: Tray | null = null;

const prefPath = () => path.join(app.getPath('userData'), 'autostart.json');

async function readAutostartPref(): Promise<boolean | undefined> {
  try {
    if (!existsSync(prefPath())) return undefined;
    return JSON.parse(await fs.readFile(prefPath(), 'utf8')).enabled as boolean;
  } catch {
    return undefined;
  }
}

async function setAutostart(enabled: boolean) {
  app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] });
  await fs.writeFile(prefPath(), JSON.stringify({ enabled }), 'utf8').catch(() => undefined);
  logAppEvent('AUTOSTART_CHANGED', { enabled });
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'פתיחת תקציב', click: () => void restoreOrCreateWindow() },
    { label: 'סנכרון עכשיו', click: () => void budgetTick() },
    { type: 'separator' },
    {
      label: 'הפעלה אוטומטית עם Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => void setAutostart(item.checked),
    },
    { type: 'separator' },
    {
      label: 'יציאה (הסנכרון ברקע יפסק)',
      click: () => {
        setQuitting();
        app.quit();
      },
    },
  ]);
}

export async function startBackgroundMode() {
  // בפעם הראשונה: פתיחה אוטומטית עם Windows, כדי שהסנכרון ימשיך גם בלי לפתוח את התוכנה
  if (app.isPackaged && (await readAutostartPref()) === undefined) {
    await setAutostart(true);
  }

  try {
    const icon = await app.getFileIcon(process.execPath);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('תקציב - פועל ברקע ומסנכרן את התקציב');
    tray.setContextMenu(buildMenu());
    tray.on('click', () => void restoreOrCreateWindow());
    tray.on('right-click', () => tray?.setContextMenu(buildMenu()));
  } catch (e) {
    logAppEvent('TRAY_FAILED', { errorMessage: (e as Error).message });
  }

  startBudgetBridge();
  const backup = () =>
    void backupBudgetDocsIfDue()
      .then((name) => name && logAppEvent('BUDGET_BACKUP_DONE', { name }))
      .catch((e) => logAppEvent('BUDGET_BACKUP_FAILED', { errorMessage: (e as Error).message }));
  backup();
  setInterval(backup, 24 * 60 * 60 * 1000);
  if (app.isPackaged) startAutoUpdate(isScrapeRunning, () => void restoreOrCreateWindow());
}
