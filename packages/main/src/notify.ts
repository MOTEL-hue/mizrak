import { Notification } from 'electron';
import { restoreOrCreateWindow } from '/@/mainWindow';

// הודעת מערכת (Windows) על בעיה, בעברית. לחיצה עליה פותחת את התוכנה
export function notifyProblem(title: string, body: string) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body: body.slice(0, 250) });
  notification.on('click', () => void restoreOrCreateWindow());
  notification.show();
}
