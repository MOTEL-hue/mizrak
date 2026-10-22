import { budgetDocsAll, budgetDocsBatch, budgetRates } from '#preload';
import { type ReactNode, useEffect, useRef, useState } from 'react';

// דף התקציב רץ בתוך מסגרת (iframe) ומדבר עם המסמכים המקומיים במקום עם האתר.
// כל הקריאות לכתובת /__local/ נתפסות כאן. מה שדורש אינטרנט (ריבית, בינה, סמיט) עונה "לא זמין", והדף מציג הודעה.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function localApi(path: string, init?: RequestInit): Promise<Response> {
  if (path === 'all') return json(await budgetDocsAll());
  if (path === 'batch') return json(await budgetDocsBatch(JSON.parse(String(init?.body ?? '{}')).ops ?? []));
  if (path === 'rates') return json(await budgetRates());
  return json({ error: 'לא זמין בתוכנה' }, 404);
}

// התקציב הוא התוכנה כולה. לשונית "סנכרון" שבתפריט שלו פותחת את דף הסנכרון מעל תוכן הדף (התפריט נשאר גלוי)
function BudgetPage({ sync }: { sync: ReactNode }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [navHeight, setNavHeight] = useState(58);

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const m = e.data as { type?: string; id?: number; path?: string; body?: string; tab?: string; height?: number } | null;
      if (!m || e.source !== frame.current?.contentWindow) return;
      if (m.type === 'budget-tab') setSyncOpen(m.tab === 'sync');
      if (m.type === 'budget-nav' && m.height) setNavHeight(m.height);
      if (m.type === 'budget-api') {
        const response = await localApi(String(m.path), { body: m.body }).catch(() => json({ error: 'שגיאה' }, 500));
        frame.current?.contentWindow?.postMessage({ type: 'budget-api-reply', id: m.id, status: response.status, body: await response.text() }, '*');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'budget-sync-active', active: syncOpen }, '*');
  }, [syncOpen]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <iframe ref={frame} title="תקציב" src="budget/frame.html" style={{ width: '100%', height: '100%', border: 0, display: 'block' }} />
      {syncOpen && (
        <div style={{ position: 'absolute', top: navHeight, bottom: 0, left: 0, right: 0, overflow: 'auto', background: '#f6f3ec' }}>{sync}</div>
      )}
    </div>
  );
}

export default BudgetPage;
