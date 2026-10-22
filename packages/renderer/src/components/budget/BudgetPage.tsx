import { budgetDocsAll, budgetDocsBatch, budgetRates } from '#preload';
import { useEffect, useRef } from 'react';

// דף התקציב רץ בתוך מסגרת (iframe) ומדבר עם המסמכים המקומיים במקום עם האתר.
// כל הקריאות לכתובת /__local/ נתפסות כאן. מה שדורש אינטרנט (ריבית, בינה, סמיט) עונה "לא זמין", והדף מציג הודעה.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function localApi(path: string, init?: RequestInit): Promise<Response> {
  if (path === 'all') return json(await budgetDocsAll());
  if (path === 'batch') return json(await budgetDocsBatch(JSON.parse(String(init?.body ?? '{}')).ops ?? []));
  if (path === 'rates') return json(await budgetRates());
  return json({ error: 'לא זמין בתוכנה' }, 404);
}

function BudgetPage() {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const m = e.data as { type?: string; id?: number; path?: string; body?: string } | null;
      if (m?.type !== 'budget-api' || e.source !== frame.current?.contentWindow) return;
      const response = await localApi(String(m.path), { body: m.body }).catch(() => json({ error: 'שגיאה' }, 500));
      frame.current?.contentWindow?.postMessage({ type: 'budget-api-reply', id: m.id, status: response.status, body: await response.text() }, '*');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return <iframe ref={frame} title="תקציב" src="budget/frame.html" style={{ width: '100%', height: 'calc(100vh - 76px)', border: 0, display: 'block' }} />;
}

export default BudgetPage;
