import { userDataPath } from '@/app-globals';
import { promises as fs } from 'fs';
import path from 'path';
import { type EnrichedTransaction } from '../commonTypes';

// סריקה שנקטעה באמצע ממשיכה מהחשבון שנעצר: תוצאות חשבונות שכבר הסתיימו נשמרות כאן,
// ובסריקה הבאה (עד שש שעות אחר כך) הן נלקחות מהקובץ במקום לגשת שוב לבנק
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const filePath = () => path.join(userDataPath, 'scrape-resume.json');

type ResumeFile = { savedAt: number; startDate: string; accounts: Record<string, EnrichedTransaction[]> };

export async function loadResume(startDate: Date): Promise<Record<string, EnrichedTransaction[]>> {
  try {
    const data = JSON.parse(await fs.readFile(filePath(), 'utf8')) as ResumeFile;
    const sameStart = data.startDate === startDate.toISOString().slice(0, 10);
    return sameStart && Date.now() - data.savedAt < MAX_AGE_MS ? data.accounts : {};
  } catch {
    return {};
  }
}

export async function saveResume(startDate: Date, accounts: Record<string, EnrichedTransaction[]>) {
  const data: ResumeFile = { savedAt: Date.now(), startDate: startDate.toISOString().slice(0, 10), accounts };
  await fs.writeFile(filePath(), JSON.stringify(data));
}

export async function clearResume() {
  await fs.rm(filePath(), { force: true });
}

// האם בשעה האחרונה כבר הסתיימו חלק מהחשבונות (סריקה חלקית). משמש לשאלה "רק מה שלא הצליח או הכל"
export async function loadResumeInfo(): Promise<{ count: number; savedAt: number } | null> {
  try {
    const data = JSON.parse(await fs.readFile(filePath(), 'utf8')) as ResumeFile;
    const count = Object.keys(data.accounts ?? {}).length;
    return count > 0 && Date.now() - data.savedAt < 60 * 60 * 1000 ? { count, savedAt: data.savedAt } : null;
  } catch {
    return null;
  }
}
