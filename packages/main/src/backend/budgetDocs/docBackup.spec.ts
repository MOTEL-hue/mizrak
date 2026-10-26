import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { dir } = vi.hoisted(() => ({ dir: `${process.env.TMPDIR ?? '/tmp'}/bk-${process.pid}` }));
vi.mock('@/app-globals', () => ({ userDataPath: dir }));

import { backupBudgetDocsIfDue } from './docBackup';

describe('backupBudgetDocsIfDue', () => {
  fs.mkdirSync(dir, { recursive: true });
  it('מגבה פעם בשבוע ושומר 8 אחרונים', async () => {
    fs.writeFileSync(path.join(dir, 'budget.docs.encrypt'), 'data');
    const first = await backupBudgetDocsIfDue(new Date('2026-01-01T10:00:00Z'));
    expect(first).toBe('budget-docs-2026-01-01.encrypt');
    expect(await backupBudgetDocsIfDue(new Date('2026-01-03T10:00:00Z'))).toBeUndefined();
    for (let week = 1; week <= 10; week++) {
      const when = new Date(Date.parse('2026-01-01T10:00:00Z') + week * 8 * 24 * 3600 * 1000);
      fs.utimesSync(path.join(dir, 'backups', fs.readdirSync(path.join(dir, 'backups')).sort().at(-1)!), when, when);
      await backupBudgetDocsIfDue(new Date(when.getTime() + 8 * 24 * 3600 * 1000 - 1000));
    }
    expect(fs.readdirSync(path.join(dir, 'backups')).length).toBeLessThanOrEqual(8);
  });
});
