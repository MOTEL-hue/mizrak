import { userDataPath } from '@/app-globals';
import { promises as fs } from 'fs';
import path from 'path';
import { type MortgageTrack } from './pagiMortgages';

// עותק מקומי של פירוט המשכנתא האחרון, כדי להציג אותו בתוכנה (הנתונים שלי) גם בלי חיבור לתקציב
const filePath = () => path.join(userDataPath, 'mortgages.json');

export interface StoredMortgages {
  savedAt: string;
  tracks: MortgageTrack[];
}

export async function saveMortgages(tracks: MortgageTrack[]) {
  const data: StoredMortgages = { savedAt: new Date().toISOString(), tracks };
  await fs.writeFile(filePath(), JSON.stringify(data));
}

export async function loadMortgages(): Promise<StoredMortgages | null> {
  try {
    return JSON.parse(await fs.readFile(filePath(), 'utf8')) as StoredMortgages;
  } catch {
    return null;
  }
}
