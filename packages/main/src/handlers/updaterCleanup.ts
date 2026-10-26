import fs from 'node:fs';
import path from 'node:path';

// ניקוי שאריות של עדכונים בתיקיית המטמון של המעדכן (mizrak-updater): קובץ התקנה של 100 מגה ויותר נשאר שם אחרי כל עדכון,
// וגם הורדות שנקטעו או נפגמו. מנקים אחרי מעבר לגרסה חדשה, וקבצים זמניים שלא נגעו בהם יותר מיום.
const DAY_MS = 24 * 60 * 60 * 1000;
const isTemporary = (name: string) => name.startsWith('temp-') || name.includes('.part');

export function cleanUpdaterLeftovers(opts: {
  updaterDir: string;
  markerFile: string;
  version: string;
  now?: number;
}): number {
  const { updaterDir, markerFile, version, now = Date.now() } = opts;
  const pending = path.join(updaterDir, 'pending');
  let freed = 0;
  const remove = (file: string) => {
    try {
      const size = fs.statSync(file).size;
      fs.rmSync(file, { force: true });
      freed += size;
    } catch {
      // קובץ בשימוש או כבר נמחק: משאירים
    }
  };

  let previous = '';
  try {
    previous = fs.readFileSync(markerFile, 'utf8').trim();
  } catch {
    // פעם ראשונה
  }
  const versionChanged = previous !== '' && previous !== version;

  if (fs.existsSync(pending)) {
    for (const name of fs.readdirSync(pending)) {
      const file = path.join(pending, name);
      // אחרי מעבר גרסה כל מה שבתיקייה כבר הותקן; אחרת מוחקים רק זמניים ישנים
      if (versionChanged || (isTemporary(name) && now - fs.statSync(file).mtimeMs > DAY_MS)) remove(file);
    }
  }
  if (versionChanged) remove(path.join(updaterDir, 'installer.exe'));

  try {
    fs.writeFileSync(markerFile, version);
  } catch {
    // לא קריטי
  }
  return freed;
}
