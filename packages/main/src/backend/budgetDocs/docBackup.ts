import { userDataPath } from '@/app-globals';
import { existsSync, promises as fs } from 'fs';
import path from 'path';

// גיבוי מקומי של מסמכי התקציב (הקובץ המוצפן כמו שהוא): עותק אחד בשבוע, ושומרים את 8 האחרונים
const source = path.resolve(userDataPath, 'budget.docs.encrypt');
const folder = path.resolve(userDataPath, 'backups');
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP = 8;

export async function backupBudgetDocsIfDue(now = new Date()): Promise<string | undefined> {
  if (!existsSync(source)) return undefined;
  await fs.mkdir(folder, { recursive: true });
  const files = (await fs.readdir(folder)).filter((n) => /^budget-docs-\d{4}-\d{2}-\d{2}\.encrypt$/.test(n)).sort();
  const last = files.at(-1);
  if (last && now.getTime() - (await fs.stat(path.join(folder, last))).mtimeMs < WEEK_MS) return undefined;
  const name = `budget-docs-${now.toISOString().slice(0, 10)}.encrypt`;
  await fs.copyFile(source, path.join(folder, name));
  await Promise.all(
    [...files, name]
      .sort()
      .slice(0, -KEEP)
      .map((n) => fs.rm(path.join(folder, n), { force: true })),
  );
  return name;
}
