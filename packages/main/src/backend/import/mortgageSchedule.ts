import fs from 'node:fs';
import path from 'node:path';
import { userDataPath } from '@/app-globals';

// קריאת המשכנתא מפאג"י איטית (לפעמים עשרות דקות) והנתונים משתנים לאט, ולכן היא לא נקראת בכל סנכרון:
// ברירת המחדל פעם בחודש, ואפשר גם רק ידנית (כפתור "קרא משכנתא עכשיו") או בכל סנכרון.
export type MortgageMode = 'manual' | 'monthly' | 'always';
export interface MortgageSchedule {
  mode: MortgageMode;
  lastOkAt?: number;
  lastTryAt?: number;
}

const file = () => path.join(userDataPath, 'mortgage-schedule.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

export function getMortgageSchedule(): MortgageSchedule {
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<MortgageSchedule>;
    const mode = data.mode === 'manual' || data.mode === 'always' ? data.mode : 'monthly';
    return { mode, lastOkAt: data.lastOkAt, lastTryAt: data.lastTryAt };
  } catch {
    return { mode: 'monthly' };
  }
}

const save = (schedule: MortgageSchedule) => {
  try {
    fs.writeFileSync(file(), JSON.stringify(schedule));
  } catch {
    // לא קריטי: בפעם הבאה ייקרא שוב
  }
};

export function setMortgageMode(mode: MortgageMode) {
  save({ ...getMortgageSchedule(), mode });
}

export const markMortgageTry = () => save({ ...getMortgageSchedule(), lastTryAt: Date.now() });
export const markMortgageOk = () => save({ ...getMortgageSchedule(), lastOkAt: Date.now() });

// בקשה ידנית מהכפתור: קוראים בלי קשר להגדרה
let forced = false;
export const setMortgageForced = (value: boolean) => {
  forced = value;
};

export function shouldReadMortgage(now = Date.now()): boolean {
  if (forced) return true;
  const { mode, lastOkAt, lastTryAt } = getMortgageSchedule();
  if (mode === 'manual') return false;
  if (mode === 'always') return true;
  // פעם בחודש; אחרי כישלון מנסים שוב רק אחרי יום, כדי לא לעכב כל סנכרון
  if (lastTryAt && now - lastTryAt < DAY_MS && !(lastOkAt && lastOkAt >= lastTryAt)) return false;
  return !lastOkAt || now - lastOkAt > MONTH_MS;
}
