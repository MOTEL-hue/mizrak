import { observer } from 'mobx-react-lite';
import { Form } from 'react-bootstrap';
import { useConfigStore } from '../../store/ConfigStore';
import Body from '../Body';
import styles from './SyncPage.module.css';
import SyncTools from './SyncTools';

const INTERVALS: [number, string][] = [
  [0, 'כבוי (רק בלחיצה על "הפעל")'],
  [1, 'כל שעה'],
  [3, 'כל 3 שעות'],
  [6, 'כל 6 שעות'],
  [12, 'כל 12 שעות'],
  [24, 'פעם ביום'],
];

// דף הסנכרון בתוך התקציב: משיכת תנועות מהבנקים וחברות האשראי (מזרק) והגדרת סנכרון אוטומטי
function SyncPage() {
  const configStore = useConfigStore();
  const current = Number(configStore.config?.scraping?.periodicScrapingIntervalHours) || 0;
  const options = INTERVALS.some(([hours]) => hours === current) ? INTERVALS : [...INTERVALS, [current, `כל ${current} שעות`] as [number, string]];
  const next = configStore.nextAutomaticScrapeDate && current ? new Date(configStore.nextAutomaticScrapeDate).toLocaleString('he-IL') : null;

  return (
    <div className={styles.page} dir="rtl">
      <div className={styles.hero}>
        <h1>סנכרון</h1>
        <p>משיכת התנועות מהבנקים וחברות האשראי אל התקציב. הנתונים נשמרים אצלך במחשב, ומתגבים באתר כשיש חיבור לאינטרנט.</p>
      </div>
      <div className={styles.card}>
        <h2>סנכרון אוטומטי</h2>
        <Form.Group className={styles.autoRow}>
          <Form.Label htmlFor="auto-sync">לסנכרן לבד</Form.Label>
          <Form.Select id="auto-sync" value={current} onChange={(e) => configStore.setPeriodicScrapingIntervalHours(Number(e.target.value))}>
            {options.map(([hours, label]) => (
              <option key={hours} value={hours}>
                {label}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <p className={styles.note}>
          {next ? `הסנכרון הבא: ${next}. ` : ''}התוכנה צריכה להיות פתוחה (גם ברקע) כדי לסנכרן.
        </p>
      </div>
      <div className={styles.card}>
        <Body />
      </div>
      <SyncTools />
    </div>
  );
}

export default observer(SyncPage);
