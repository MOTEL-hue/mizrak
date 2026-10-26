import fs from 'node:fs';
import path from 'node:path';
import { userDataPath } from '@/app-globals';

// קריאת המשכנתא מפאג"י איטית (לפעמים עשרות דקות) והנתונים משתנים לאט, ולכן היא לא נקראת בכל סנכרון:
// ברירת המחדל פעם בחודש, ואפשר לבחור תדירות אחרת, רק ידנית (כפתור "קרא משכנתא עכשיו") או בכל סנכרון.
export type MortgageMode = 'manual' | 'periodic' | 'always';
export interface MortgageSchedule {
  mode: MortgageMode;
  everyDays: number;
  lastOkAt?: number;
  lastTryAt?: number;
}

const file = () => path.join(userDataPath, 'mortgage-schedule.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;

export function getMortgageSchedule(): MortgageSchedule {
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<MortgageSchedule>;
    const mode = data.mode === 'manual' || data.mode === 'always' ? data.mode : 'periodic';
    const everyDays = Number(data.everyDays) > 0 ? Math.min(365, Number(data.everyDays)) : DEFAULT_DAYS;
    return { mode, everyDays, lastOkAt: data.lastOkAt, lastTryAt: data.lastTryAt };
  } catch {
    return { mode: 'periodic', everyDays: DEFAULT_DAYS };
  }
}

const save = (schedule: MortgageSchedule) => {
  try {
    fs.writeFileSync(file(), JSON.stringify(schedule));
  } catch {
    // לא קריטי: בפעם הבאה ייקרא שוב
  }
};

export function setMortgageMode(mode: MortgageMode, everyDays?: number) {
  const current = getMortgageSchedule();
  save({ ...current, mode, everyDays: everyDays && everyDays > 0 ? Math.min(365, Math.round(everyDays)) : current.everyDays });
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
  const { mode, everyDays, lastOkAt, lastTryAt } = getMortgageSchedule();
  if (mode === 'manual') return false;
  if (mode === 'always') return true;
  // לפי התדירות שנבחרה; אחרי כישלון מנסים שוב רק אחרי יום, כדי לא לעכב כל סנכרון
  if (lastTryAt && now - lastTryAt < DAY_MS && !(lastOkAt && lastOkAt >= lastTryAt)) return false;
  return !lastOkAt || now - lastOkAt > everyDays * DAY_MS;
}
