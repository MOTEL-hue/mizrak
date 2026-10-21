import { getLocalMortgages, getLocalTransactions, type LocalMortgages } from '#preload';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Col, Form, Modal, Row, Table } from 'react-bootstrap';
import accountMetadata from '../../accountMetadata';

type Transaction = Awaited<ReturnType<typeof getLocalTransactions>>[number];

interface TransactionsViewerProps {
  show: boolean;
  onClose: () => void;
}

const ALL = 'all';
const PAGE_SIZE = 200;

const money = (n: number) => n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const companyName = (key: string) =>
  (accountMetadata as Record<string, { companyName: string }>)[key]?.companyName ?? (key || 'לא ידוע');
const accountLabel = (t: Transaction) => `${companyName(t.companyKey)} - ${t.accountNumber}`;
const dateOf = (t: Transaction) => String(t.date).slice(0, 10);
const dateText = (iso: string) => iso.split('-').reverse().join('/');

function TransactionsViewer({ show, onClose }: TransactionsViewerProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mortgages, setMortgages] = useState<LocalMortgages | null>(null);
  const [account, setAccount] = useState(ALL);
  const [month, setMonth] = useState(ALL);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!show) return;
    getLocalMortgages()
      .then(setMortgages)
      .catch(() => setMortgages(null));
    getLocalTransactions()
      .then(setTransactions)
      .catch(() => setTransactions([]))
      .finally(() => setLoaded(true));
  }, [show]);

  const accounts = useMemo(() => [...new Set(transactions.map(accountLabel))].sort(), [transactions]);
  const months = useMemo(
    () => [...new Set(transactions.map((t) => dateOf(t).slice(0, 7)))].sort().reverse(),
    [transactions],
  );

  const filtered = useMemo(() => {
    const q = search.trim();
    return transactions.filter(
      (t) =>
        (account === ALL || accountLabel(t) === account) &&
        (month === ALL || dateOf(t).startsWith(month)) &&
        (!q || `${t.description} ${t.memo ?? ''} ${t.category ?? ''}`.includes(q)),
    );
  }, [transactions, account, month, search]);

  const income = filtered.filter((t) => t.chargedAmount > 0).reduce((sum, t) => sum + t.chargedAmount, 0);
  const expense = filtered.filter((t) => t.chargedAmount < 0).reduce((sum, t) => sum + t.chargedAmount, 0);

  return (
    <Modal show={show} onHide={onClose} size="xl" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>הנתונים שלי</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {mortgages && mortgages.tracks.length > 0 && (
          <div className="mb-4">
            <h5>משכנתא (פאג"י)</h5>
            <Table striped size="sm" responsive>
              <thead>
                <tr>
                  <th>מסלול</th>
                  <th>יתרת קרן</th>
                  <th>ריבית שנתית</th>
                  <th>החזר חודשי</th>
                  <th>סוג</th>
                </tr>
              </thead>
              <tbody>
                {mortgages.tracks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.id}</td>
                    <td>{money(t.balance)} ₪</td>
                    <td>{t.rate}%</td>
                    <td>{money(t.payment)} ₪</td>
                    <td>{t.prime ? 'פריים' : 'אחר'}</td>
                  </tr>
                ))}
                <tr>
                  <th>סה"כ</th>
                  <th>{money(mortgages.tracks.reduce((sum, t) => sum + t.balance, 0))} ₪</th>
                  <th />
                  <th>{money(mortgages.tracks.reduce((sum, t) => sum + t.payment, 0))} ₪</th>
                  <th />
                </tr>
              </tbody>
            </Table>
            <small className="text-muted">עודכן: {new Date(mortgages.savedAt).toLocaleString('he-IL')}</small>
          </div>
        )}
        {loaded && transactions.length === 0 ? (
          <p>עוד אין נתונים. לחץ "הפעל" כדי למשוך תנועות מהבנקים וחברות האשראי, והן יופיעו כאן.</p>
        ) : (
          <>
            <Row className="g-2 mb-3">
              <Col md={4}>
                <Form.Label>חשבון</Form.Label>
                <Form.Select value={account} onChange={(e) => setAccount(e.target.value)}>
                  <option value={ALL}>כל החשבונות ביחד</option>
                  {accounts.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={3}>
                <Form.Label>חודש</Form.Label>
                <Form.Select value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value={ALL}>כל התקופה</option>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {m.split('-').reverse().join('/')}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={5}>
                <Form.Label>חיפוש</Form.Label>
                <Form.Control
                  placeholder="תיאור, הערה או קטגוריה"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </Col>
            </Row>
            <div className="d-flex gap-3 mb-3 flex-wrap">
              <Badge bg="success">הכנסות: {money(income)} ₪</Badge>
              <Badge bg="danger">הוצאות: {money(Math.abs(expense))} ₪</Badge>
              <Badge bg="secondary">הפרש: {money(income + expense)} ₪</Badge>
              <Badge bg="light" text="dark">
                {filtered.length} תנועות
              </Badge>
            </div>
            <Table striped hover size="sm" responsive>
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>חשבון</th>
                  <th>תיאור</th>
                  <th>קטגוריה</th>
                  <th>סכום</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, PAGE_SIZE).map((t) => (
                  <tr key={t.hash}>
                    <td>{dateText(dateOf(t))}</td>
                    <td>{accountLabel(t)}</td>
                    <td>
                      {t.description}
                      {t.memo ? <div className="text-muted small">{t.memo}</div> : null}
                    </td>
                    <td>{t.category ?? ''}</td>
                    <td style={{ color: t.chargedAmount < 0 ? '#b91c1c' : '#15803d', whiteSpace: 'nowrap' }} dir="ltr">
                      {money(t.chargedAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {filtered.length > PAGE_SIZE && (
              <p className="text-muted">
                מוצגות {PAGE_SIZE} התנועות האחרונות מתוך {filtered.length}. צמצם לפי חשבון, חודש או חיפוש כדי לראות את
                השאר.
              </p>
            )}
          </>
        )}
      </Modal.Body>
    </Modal>
  );
}

export default TransactionsViewer;
