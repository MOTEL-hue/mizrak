import { budgetDocsAll, budgetDocsBatch, budgetRates } from '#preload';
import { useEffect } from 'react';

// דף התקציב רץ בתוך מסגרת (iframe) ומדבר עם המסמכים המקומיים במקום עם האתר.
// כל הקריאות לכתובת /__local/ נתפסות כאן. מה שדורש אינטרנט (ריבית, בינה, סמיט) עונה "לא זמין", והדף מציג הודעה.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function localApi(path: string, init?: RequestInit): Promise<Response> {
  if (path === 'all') return json(await budgetDocsAll());
  if (path === 'batch') return json(await budgetDocsBatch(JSON.parse(String(init?.body ?? '{}')).ops ?? []));
  if (path === 'rates') return json(await budgetRates());
  return json({ error: 'לא זמין בתוכנה' }, 404);
}

const FRAME = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link rel="stylesheet" href="budget/base.css"><link rel="stylesheet" href="budget/budget.css">
<style>#app{padding:4rem 0 1rem}#app .bud-nav{top:0;bottom:auto;border-top:0;border-bottom:1px solid var(--border);box-shadow:none}#app .fab{bottom:1rem}</style></head><body>
<div id="app"></div>
<script>
window.BUDGET_API = '/__local/'; window.BUDGET_CSRF = 'local'; window.BUDGET_SUMIT = []; window.BUDGET_EXIT = '';
window.BUDGET_ROLE = 'admin'; window.BUDGET_PEOPLE = ''; window.BUDGET_CAN_WIPE = false;
const realFetch = window.fetch.bind(window);
window.fetch = (url, init) => String(url).startsWith('/__local/') ? parent.__budgetLocalApi(String(url).slice(9), init) : realFetch(url, init);
</script>
<script src="budget/budget.js"></script></body></html>`;

function BudgetPage() {
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__budgetLocalApi = localApi;
  }, []);
  return <iframe title="תקציב" srcDoc={FRAME} style={{ width: '100%', height: 'calc(100vh - 76px)', border: 0, display: 'block' }} />;
}

export default BudgetPage;
