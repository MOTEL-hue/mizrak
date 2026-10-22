import { budgetDocsAll, budgetDocsBatch } from '#preload';
import { useEffect, useMemo } from 'react';
import { Modal } from 'react-bootstrap';

interface BudgetPageProps {
  show: boolean;
  onClose: () => void;
}

// דף התקציב רץ בתוך מסגרת (iframe) ומדבר עם המסמכים המקומיים במקום עם האתר.
// כל הקריאות לכתובת /__local/ נתפסות כאן. מה שדורש אינטרנט (ריבית, בינה, סמיט) עונה "לא זמין", והדף מציג הודעה.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function localApi(path: string, init?: RequestInit): Promise<Response> {
  if (path === 'all') return json(await budgetDocsAll());
  if (path === 'batch') return json(await budgetDocsBatch(JSON.parse(String(init?.body ?? '{}')).ops ?? []));
  return json({ error: 'לא זמין בתוכנה' }, 404);
}

const FRAME = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link rel="stylesheet" href="budget/base.css"><link rel="stylesheet" href="budget/budget.css"></head><body>
<div id="app"></div>
<script>
window.BUDGET_API = '/__local/'; window.BUDGET_CSRF = 'local'; window.BUDGET_SUMIT = []; window.BUDGET_EXIT = '';
window.BUDGET_ROLE = 'admin'; window.BUDGET_PEOPLE = ''; window.BUDGET_CAN_WIPE = false;
const realFetch = window.fetch.bind(window);
window.fetch = (url, init) => String(url).startsWith('/__local/') ? parent.__budgetLocalApi(String(url).slice(9), init) : realFetch(url, init);
</script>
<script src="budget/budget.js"></script></body></html>`;

function BudgetPage({ show, onClose }: BudgetPageProps) {
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__budgetLocalApi = localApi;
  }, []);
  const frame = useMemo(() => FRAME, []);
  return (
    <Modal show={show} onHide={onClose} fullscreen dir="rtl">
      <Modal.Header closeButton>
        <Modal.Title>תקציב</Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ padding: 0 }}>
        {show && <iframe title="תקציב" srcDoc={frame} style={{ width: '100%', height: '100%', border: 0 }} />}
      </Modal.Body>
    </Modal>
  );
}

export default BudgetPage;
