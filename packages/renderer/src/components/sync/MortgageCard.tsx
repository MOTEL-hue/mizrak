import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { Button, Form } from 'react-bootstrap';
import { getMortgageSchedule, scrape, setMortgageMode } from '#preload';
import { useConfigStore } from '../../store/ConfigStore';
import styles from './SyncPage.module.css';

type Schedule = Awaited<ReturnType<typeof getMortgageSchedule>>;

// הערך: manual, always, או מספר ימים
const CHOICES: [string, string][] = [
  ['7', 'כל שבוע'],
  ['14', 'כל שבועיים'],
  ['30', 'פעם בחודש (מומלץ)'],
  ['60', 'כל חודשיים'],
  ['manual', 'רק כשאני לוחץ על הכפתור'],
  ['always', 'בכל סנכרון (איטי)'],
];

// קריאת המשכנתא מפאג"י איטית והנתונים משתנים לאט, ולכן לא קוראים אותה בכל סנכרון
function MortgageCard() {
  const configStore = useConfigStore();
  const [schedule, setSchedule] = useState<Schedule>();
  const account = configStore.importers.find((a) => a.companyId === 'pagi' || a.companyId === 'beinleumi');
  const scraping = configStore.isScraping;

  useEffect(() => {
    if (!scraping) void getMortgageSchedule().then(setSchedule);
  }, [scraping]);

  if (!account || !schedule) return null;

  const last = schedule.lastOkAt ? new Date(schedule.lastOkAt).toLocaleDateString('he-IL') : 'עוד לא נקראה';
  const readNow = () => {
    configStore.clearScrapingStatus();
    configStore.beginScrape();
    void scrape(configStore.handleScrapingEvent.bind(configStore), 'all', account.id, 'with');
  };

  return (
    <div className={styles.card}>
      <h2>משכנתא (פאג"י)</h2>
      <Form.Group className={styles.autoRow}>
        <Form.Label htmlFor="mortgage-mode">מתי לקרוא את פירוט המשכנתא</Form.Label>
        <Form.Select
          id="mortgage-mode"
          value={schedule.mode === 'periodic' ? String(schedule.everyDays) : schedule.mode}
          onChange={(e) => {
            const value = e.target.value;
            const days = Number(value);
            const mode: Schedule['mode'] = value === 'manual' || value === 'always' ? value : 'periodic';
            setSchedule({ ...schedule, mode, everyDays: days > 0 ? days : schedule.everyDays });
            void setMortgageMode(mode, days > 0 ? days : undefined);
          }}
        >
          {(CHOICES.some(([v]) => v === String(schedule.everyDays)) || schedule.mode !== 'periodic'
            ? CHOICES
            : [...CHOICES, [String(schedule.everyDays), `כל ${schedule.everyDays} ימים`] as [string, string]]
          ).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
      <p className={styles.note}>נקראה לאחרונה: {last}. הקריאה אורכת כמה דקות והיא מתבצעת באותו סנכרון של פאג"י.</p>
      <Button variant="dark" disabled={scraping} onClick={readNow}>
        קרא משכנתא עכשיו
      </Button>
    </div>
  );
}

export default observer(MortgageCard);
