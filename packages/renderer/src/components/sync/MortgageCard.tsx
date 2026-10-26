import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { Button, Form } from 'react-bootstrap';
import { getMortgageSchedule, scrape, setMortgageMode } from '#preload';
import { useConfigStore } from '../../store/ConfigStore';
import styles from './SyncPage.module.css';

type Schedule = Awaited<ReturnType<typeof getMortgageSchedule>>;

const MODES: [Schedule['mode'], string][] = [
  ['monthly', 'פעם בחודש (מומלץ)'],
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
    void scrape(configStore.handleScrapingEvent.bind(configStore), 'all', account.id, true);
  };

  return (
    <div className={styles.card}>
      <h2>משכנתא (פאג"י)</h2>
      <Form.Group className={styles.autoRow}>
        <Form.Label htmlFor="mortgage-mode">מתי לקרוא את פירוט המשכנתא</Form.Label>
        <Form.Select
          id="mortgage-mode"
          value={schedule.mode}
          onChange={(e) => {
            const mode = e.target.value as Schedule['mode'];
            setSchedule({ ...schedule, mode });
            void setMortgageMode(mode);
          }}
        >
          {MODES.map(([value, label]) => (
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
