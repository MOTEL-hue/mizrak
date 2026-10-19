import { isBrowserInstalled } from '#preload';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { Alert, ProgressBar } from 'react-bootstrap';
import { useConfigStore } from '../store/ConfigStore';

const READY_KEY = 'mizrakBrowserReady';

const wasReady = () => {
  try {
    return localStorage.getItem(READY_KEY) === '1';
  } catch {
    return false;
  }
};

const markReady = () => {
  try {
    localStorage.setItem(READY_KEY, '1');
  } catch {
    // בלי שמירה, ההודעה פשוט תוצג שוב
  }
};

const ChromeDownloadProgress = () => {
  const configStore = useConfigStore();
  const percent = configStore.chromeDownloadPercent;
  const [ready, setReady] = useState(wasReady);
  const [wasScraping, setWasScraping] = useState(false);

  // אם הדפדפן כבר קיים במחשב, אין צורך להציג את ההודעה
  useEffect(() => {
    isBrowserInstalled()
      .then((installed) => {
        if (installed) {
          markReady();
          setReady(true);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (percent === 100) {
      markReady();
      setReady(true);
    }
  }, [percent]);

  // סריקה שהסתיימה פירושה שהדפדפן כבר מוכן
  useEffect(() => {
    if (configStore.isScraping) {
      setWasScraping(true);
    } else if (wasScraping) {
      markReady();
      setReady(true);
    }
  }, [configStore.isScraping, wasScraping]);

  const label = percent === 100 ? 'ההורדה הסתיימה' : `מוריד דפדפן ${percent}%`;

  return (
    <>
      {!ready && (
        <Alert variant="info" className="w-100 text-center">
          <strong>בהפעלה הראשונה בלבד</strong> התוכנה צריכה להוריד דפדפן (כ-150MB). זה יכול לקחת כמה דקות.
          <br />
          לחץ על &quot;הפעל&quot; פעם אחת, והמתן עד שההורדה מסתיימת. אל תסגור את התוכנה. רק אחר כך הסריקה מתחילה.
        </Alert>
      )}
      {!!percent && <ProgressBar now={percent} label={label} className="w-100" />}
    </>
  );
};

export default observer(ChromeDownloadProgress);
