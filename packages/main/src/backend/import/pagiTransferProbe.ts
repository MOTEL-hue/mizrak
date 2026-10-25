import fs from 'node:fs';
import path from 'node:path';
import { type Browser, type Page } from 'puppeteer-core';
import { userDataPath } from '@/app-globals';
import { logAppEvent } from '/@/logging/operationLogger';
import { clickByText, PORTAL_URL } from './pagiMortgages';

// בדיקה חד-פעמית: בפאג"י תנועת העברה מופיעה כ"העברה מהחשבון" בלי שם המעביר או המקבל. כאן נשמר מה שהאתר מציג
// בכל שלב (דף התנועות, ואחרי לחיצה על תנועת העברה), כדי לדעת איפה הפרטים נמצאים. הקובץ נכנס לקובץ האבחון.
export const TRANSFER_DIAGNOSTIC_FILE = 'pagi-transfer-diagnostic-3.txt';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TRANSACTIONS_URL = `${PORTAL_URL.split('#')[0]}#/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;

// אחרי ניווט ההקשר של הדף נהרס באמצע הקריאה: מנסים שוב אחרי שהדף נרגע
async function snapshot(page: Page, title: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await snapshotOnce(page, title);
    } catch {
      await sleep(3000);
    }
  }
  return `## ${title}\n(לא נקלט)`;
}

async function snapshotOnce(page: Page, title: string) {
  const parts = await Promise.all(
    page.frames().filter((f) => !/netfree/i.test(f.url())).map(async (frame) => {
      const text = await frame.evaluate(() => document.body?.innerText ?? '');
      return text.trim() ? `[${frame.url().split('?')[0].slice(-80)}] ${text.replace(/\s+/g, ' ').slice(0, 6000)}` : '';
    }),
  );
  return `## ${title}\n${parts.filter(Boolean).join('\n')}`.replace(/[\d-]{7,}/g, '###');
}

export function transferProbeDone() {
  return fs.existsSync(path.join(userDataPath, TRANSFER_DIAGNOSTIC_FILE));
}

export async function probePagiTransfers(browser: Browser, timeout: number) {
  let page: Page | undefined;
  const stages: string[] = [];
  const work = async () => {
    page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    // דף "תנועות בחשבון" המלא (אותו דף שהסורק קורא ממנו)
    await page.goto(TRANSACTIONS_URL, { waitUntil: 'domcontentloaded' });
    await sleep(12000);
    stages.push(await snapshot(page, 'אחרי לחיצה על "לכל התנועות"'));
    await clickByText(page, '^העברה');
    await sleep(5000);
    stages.push(await snapshot(page, 'אחרי לחיצה על תנועת העברה'));
    await clickByText(page, '^(פרטים|פרטים נוספים|הצג פרטים|לפרטים|פרטי התנועה)$');
    await sleep(4000);
    stages.push(await snapshot(page, 'אחרי לחיצה על פרטים'));
  };
  try {
    await Promise.race([work(), sleep(100_000)]);
  } catch (e) {
    stages.push(`שגיאה: ${(e as Error).message}`);
  } finally {
    await page?.close().catch(() => undefined);
    try {
      fs.writeFileSync(path.join(userDataPath, TRANSFER_DIAGNOSTIC_FILE), stages.join('\n\n') || '(לא נקלט דבר)');
      logAppEvent('PAGI_TRANSFER_PROBE_DONE', { stages: stages.length });
    } catch {
      // אבחון בלבד
    }
  }
}
