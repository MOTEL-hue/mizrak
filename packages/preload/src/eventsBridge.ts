import electron from 'electron';
import {
  type LocalTransaction,
  type Config,
  type Credentials,
  type HandleScrapingEvent,
  type YnabAccountDataType,
  type YnabConfig,
} from './commonTypes';

export async function getConfig(): Promise<Config> {
  const configStr = await electron.ipcRenderer.invoke('getConfig');
  const { config } = JSON.parse(configStr);
  return config;
}

export async function updateConfig(config: Config) {
  await electron.ipcRenderer.invoke('updateConfig', JSON.stringify(config));
}

export async function getYnabAccountData(ynabOptions: YnabConfig['options']): Promise<YnabAccountDataType> {
  return electron.ipcRenderer.invoke('getYnabAccountData', ynabOptions);
}

let updateProgressCallback: ((percent: number) => void) | undefined;

export function onUpdateProgress(callback: (percent: number) => void) {
  const firstTime = !updateProgressCallback;
  updateProgressCallback = callback;
  if (firstTime) {
    electron.ipcRenderer.on('updateProgress', (_, percent: number) => updateProgressCallback?.(percent));
  }
}

let summaryCallback: ((problems: { name: string; message: string }[]) => void) | undefined;

export function onScrapingSummary(callback: (problems: { name: string; message: string }[]) => void) {
  const firstTime = !summaryCallback;
  summaryCallback = callback;
  if (firstTime) {
    electron.ipcRenderer.on('scrapingSummary', (_, problemsStr: string) => summaryCallback?.(JSON.parse(problemsStr)));
  }
}

let progressListenerDefined = false;

export async function getResumeInfo(): Promise<{ count: number; savedAt: number } | null> {
  return electron.ipcRenderer.invoke('getResumeInfo');
}

export async function scrape(handleScrapingEvent: HandleScrapingEvent, mode?: 'all') {
  console.log('Sending scrape event to main');
  await electron.ipcRenderer.send('scrape', mode);
  if (!progressListenerDefined) {
    electron.ipcRenderer.on('scrapingProgress', (_, progressEventStr) => {
      const progressEvent = JSON.parse(progressEventStr);
      const { eventName, eventData } = progressEvent;
      console.log('Received scraping progress event', eventName, eventData);
      handleScrapingEvent(eventName, eventData);
    });
    progressListenerDefined = true;
  }
}

export async function stopPeriodicScraping() {
  return electron.ipcRenderer.invoke('stopPeriodicScraping');
}

export async function openExternal(url: string) {
  await electron.shell.openExternal(url);
}

export async function openItem(filePath: string) {
  await electron.shell.openPath(filePath);
}

export async function getLogsInfo(numOfLastLines: number) {
  return electron.ipcRenderer.invoke('getLogsInfo', numOfLastLines);
}

export async function exportDiagnostics(): Promise<{ filePath: string; logsFolder: string } | null> {
  return electron.ipcRenderer.invoke('exportDiagnostics');
}

export async function isBrowserInstalled(): Promise<boolean> {
  return electron.ipcRenderer.invoke('isBrowserInstalled');
}

export async function getLocalTransactions(): Promise<LocalTransaction[]> {
  return electron.ipcRenderer.invoke('getLocalTransactions');
}

export interface LocalMortgages {
  savedAt: string;
  tracks: { id: string; balance: number; rate: number; payment: number; prime: boolean }[];
}

export async function getLocalMortgages(): Promise<LocalMortgages | null> {
  return electron.ipcRenderer.invoke('getLocalMortgages');
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  return electron.ipcRenderer.invoke('copyTextToClipboard', text);
}

export async function getErrorGuide(): Promise<{ title: string; text: string }[]> {
  return electron.ipcRenderer.invoke('getErrorGuide');
}

export async function sentryUserReportProblem(reportProblem: object) {
  return electron.ipcRenderer.invoke('sentryUserReportProblem', reportProblem);
}

export async function checkForUpdate() {
  return electron.ipcRenderer.invoke('checkForUpdate');
}

export async function getAppInfo() {
  return electron.ipcRenderer.invoke('getAppInfo');
}

export async function downloadUpdate() {
  return electron.ipcRenderer.invoke('downloadUpdate');
}

export async function showSaveDialog() {
  return electron.ipcRenderer.invoke('showSaveDialog');
}

export async function quitAndInstall() {
  console.log('preload invoking quitAndInstall');
  return electron.ipcRenderer.invoke('quitAndInstall');
}

export function copyToClipboard(text: string) {
  electron.clipboard.writeText(text);
}

// Google Sheets
export async function validateToken(credentials: Credentials): Promise<boolean> {
  return electron.ipcRenderer.invoke('validateToken', credentials);
}
export async function getAllUserSpreadsheets(credentials: Credentials) {
  return electron.ipcRenderer.invoke('getAllUserSpreadsheets', credentials);
}
export async function electronGoogleOAuth2Connector(): Promise<Credentials> {
  return electron.ipcRenderer.invoke('electronGoogleOAuth2Connector');
}
export async function createSpreadsheet(spreadsheetId: string, credentials: Credentials): Promise<string> {
  return electron.ipcRenderer.invoke('createSpreadsheet', spreadsheetId, credentials);
}
