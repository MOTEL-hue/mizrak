import { budgetDocsAll, budgetDocsBatch, budgetRates } from '#preload';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Modal } from 'react-bootstrap';
import CheckForUpdates from '../CheckForUpdates';
import { type ConfigStore, useConfigStore } from '../../store/ConfigStore';
import { getSyncInfo, startSync, watchSyncResults } from '../sync/syncState';

// דף התקציב רץ בתוך מסגרת (iframe) ומדבר עם המסמכים המקומיים במקום עם האתר.
// כל הקריאות לכתובת /__local/ נתפסות כאן. מה שדורש אינטרנט (ריבית, בינה, סמיט) עונה "לא זמין", והדף מציג הודעה.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function localApi(path: string, init: RequestInit | undefined, store: ConfigStore): Promise<Response> {
  if (path === 'all') return json(await budgetDocsAll());
  if (path === 'batch') return json(await budgetDocsBatch(JSON.parse(String(init?.body ?? '{}')).ops ?? []));
  if (path === 'sync-state') return json(getSyncInfo(store));
  if (path === 'sync-request') {
    await startSync(store, JSON.parse(String(init?.body ?? '{}')).mode === 'all' ? 'all' : undefined);
    return json({ ...getSyncInfo(store), status: 'running' });
  }
  if (path === 'rates') return json(await budgetRates());
  return json({ error: 'לא זמין בתוכנה' }, 404);
}

// התקציב הוא התוכנה כולה. לשונית "סנכרון" שבתפריט שלו פותחת את דף הסנכרון מעל תוכן הדף (התפריט נשאר גלוי)
function BudgetPage({ sync }: { sync: ReactNode }) {
  const store = useConfigStore();
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => watchSyncResults(store), [store]);
  const [syncOpen, setSyncOpen] = useState(false);
  const [navHeight, setNavHeight] = useState(58);
  const [ready, setReady] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const m = e.data as { type?: string; id?: number; path?: string; body?: string; tab?: string; height?: number } | null;
      if (!m || e.source !== frame.current?.contentWindow) return;
      if (m.type === 'budget-diag') {
        // eslint-disable-next-line no-console
        console.info(`BUDGET_FRAME ${(m as { stage?: string }).stage}: ${(m as { detail?: string }).detail}`);
        return;
      }
      if (m.type === 'budget-update') setUpdateOpen(true);
      if (m.type === 'budget-tab') setSyncOpen(m.tab === 'sync');
      if (m.type === 'budget-nav' && m.height) {
        setNavHeight(m.height);
        setReady(true);
      }
      if (m.type === 'budget-api') {
        const response = await localApi(String(m.path), { body: m.body }, store).catch(() => json({ error: 'שגיאה' }, 500));
        frame.current?.contentWindow?.postMessage({ type: 'budget-api-reply', id: m.id, status: response.status, body: await response.text() }, '*');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [store]);

  // אם התקציב לא עלה תוך כמה שניות, מציגים הודעה ברורה במקום מסך ריק (והפרטים בקובץ האבחון)
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!ready) {
        // eslint-disable-next-line no-console
        console.error('BUDGET_FRAME_NOT_READY: התקציב לא עלה תוך 12 שניות');
        setFailed(true);
      }
    }, 12000);
    return () => clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'budget-sync-active', active: syncOpen }, '*');
  }, [syncOpen]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <iframe ref={frame} title="תקציב" src="budget/frame.html" style={{ width: '100%', height: '100%', border: 0, display: 'block' }} />
      <Modal show={updateOpen} onHide={() => setUpdateOpen(false)} centered dir="rtl">
        <Modal.Header closeButton>
          <Modal.Title>עדכון התוכנה</Modal.Title>
        </Modal.Header>
        <Modal.Body>{updateOpen && <CheckForUpdates autoCheck />}</Modal.Body>
      </Modal>
      {failed && !ready && (
        <div style={{ position: 'absolute', top: 40, left: 20, right: 20, padding: 16, background: '#fff', border: '2px solid #b3261e', borderRadius: 12, textAlign: 'right', direction: 'rtl' }}>
          <b>דף התקציב לא עלה.</b> אפשר לסגור ולפתוח את התוכנה מחדש. אם זה חוזר, שמור קובץ אבחון (בדף הסנכרון) ושלח אותו.
          <br />
          <button onClick={() => setSyncOpen(true)}>פתח את דף הסנכרון</button>
        </div>
      )}
      {syncOpen && (
        <div style={{ position: 'absolute', top: navHeight, bottom: 0, left: 0, right: 0, overflow: 'auto', background: '#f6f3ec' }}>{sync}</div>
      )}
    </div>
  );
}

export default BudgetPage;
