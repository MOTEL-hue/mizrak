import { App, userDataPath } from '@/app-globals';
import { Browser, detectBrowserPlatform, getInstalledBrowsers } from '@puppeteer/browsers';
import { ERROR_RULES, explainText } from '@/backend/import/hebrewErrors';
import { getConfig } from '@/backend/configManager/configManager';
import { getLastLines, getLogsFolder } from '@/logging/logger';
import { app, dialog, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

const MAX_LOG_LINES = 5000;

export const getErrorGuideHandler = () => ERROR_RULES.map(({ title, text }) => ({ title, text }));

// סיכום ההגדרות בלי שום סיסמה או מפתח: רק מה פעיל ומאיזה סוג
async function describeConfig(): Promise<string> {
  try {
    const config = await getConfig();
    const importers = (config.scraping.accountsToScrape ?? []).map(
      (a) => `  - ${a.key}: ${a.active === false ? 'כבוי' : 'פעיל'} (${Object.keys(a.loginFields ?? {}).length} שדות מולאו)`,
    );
    const exporters = Object.entries(config.outputVendors ?? {}).map(
      ([name, vendor]) => `  - ${name}: ${(vendor as { active?: boolean })?.active ? 'פעיל' : 'כבוי'}`,
    );
    return [
      `ימים אחורה: ${config.scraping.numDaysBack}`,
      'חשבונות בנק וכרטיסי אשראי:',
      ...(importers.length ? importers : ['  (אין)']),
      'יעדי ייצוא:',
      ...exporters,
    ].join('\n');
  } catch (e) {
    return `לא ניתן לקרוא את ההגדרות: ${(e as Error).message}`;
  }
}

// מה שדף המשכנתאות של פאג"י הציג כשהמשיכה נכשלה (מספרים ארוכים מוסתרים)
async function mortgageDiagnostic(): Promise<string> {
  try {
    const text = await fs.promises.readFile(path.join(userDataPath, 'pagi-mortgage-diagnostic.txt'), 'utf8');
    return text.replace(/\s+/g, ' ').slice(0, 9000);
  } catch {
    return '(אין)';
  }
}

export async function buildDiagnosticsReport(): Promise<string> {
  let logs = '';
  try {
    logs = getLastLines(MAX_LOG_LINES);
  } catch (e) {
    logs = `לא ניתן לקרוא את הלוג: ${(e as Error).message}`;
  }
  const explanations = explainText(logs);
  return [
    '===== קובץ אבחון של מזרק =====',
    'הקובץ אינו כולל סיסמאות או מפתחות. אפשר לשלוח אותו לצורך טיפול בבעיה.',
    '',
    '== פרטי התוכנה והמחשב ==',
    `גרסה: ${App.getVersion()}`,
    `זמן: ${new Date().toISOString()}`,
    `מערכת הפעלה: ${os.type()} ${os.release()} (${os.arch()})`,
    `Electron: ${process.versions.electron}, Chrome: ${process.versions.chrome}, Node: ${process.versions.node}`,
    `שפת המערכת: ${app.getLocale()}`,
    '',
    '== הגדרות (ללא סודות) ==',
    await describeConfig(),
    '',
    '== בעיות שזוהרו בלוג ==',
    ...(explanations.length ? explanations : ['לא זוהתה בעיה מוכרת.']),
    '',
    '== מה דף המשכנתאות הציג בכשל האחרון ==',
    await mortgageDiagnostic(),
    '',
    `== הלוג (${MAX_LOG_LINES} השורות האחרונות) ==`,
    logs,
  ].join('\n');
}

// שמירה בלחיצה אחת: קובץ בשולחן העבודה, והתיקייה נפתחת
export const exportDiagnosticsHandler = async () => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const defaultPath = path.join(app.getPath('desktop'), `mizrak-diagnostics-${stamp}.txt`);
  const { filePath } = await dialog.showSaveDialog({ defaultPath, filters: [{ name: 'Text', extensions: ['txt'] }] });
  if (!filePath) return null;
  await fs.promises.writeFile(filePath, await buildDiagnosticsReport(), 'utf8');
  shell.showItemInFolder(filePath);
  return { filePath, logsFolder: getLogsFolder() };
};

// האם הדפדפן של התוכנה כבר הורד (כדי לא להציג הודעת הורדה בלי צורך)
export const isBrowserInstalledHandler = async () => {
  try {
    const platform = detectBrowserPlatform();
    if (!platform) return false;
    const installed = await getInstalledBrowsers({ cacheDir: userDataPath });
    return installed.some((b) => b.browser === Browser.CHROMIUM && b.platform === platform && fs.existsSync(b.executablePath));
  } catch {
    return false;
  }
};
