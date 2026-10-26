import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import Badge from 'react-bootstrap/Badge';
import Form from 'react-bootstrap/Form';
import piggyBank from '../../assets/piggy-bank.svg';
import { AccountStatus, type Account as AccountType, type ExporterEndEvent } from '../../types';
import styles from './Account.module.css';
import StatusIndicator from './StatusIndicator';

export interface ActionButton {
  icon: string;
  tooltipText: string;
  clickHandler?: () => void;
}

interface AccountProps {
  account: AccountType;
  actionButtons?: ActionButton[];
  onToggleActive?: () => void;
  disabled?: boolean;
}

// הודעות ההתקדמות של הסורק כפי שהן מגיעות, בעברית פשוטה
const STEP_TEXT: Record<string, string> = {
  INITIALIZING: 'מכין את הדפדפן',
  START_SCRAPING: 'מתחיל',
  LOGGING_IN: 'מתחבר לאתר הבנק',
  LOGIN_SUCCESS: 'התחבר, מושך תנועות',
  LOGIN_FAILED: 'ההתחברות נכשלה',
  CHANGE_PASSWORD: 'האתר מבקש להחליף סיסמה',
  END_SCRAPING: 'סיים למשוך תנועות',
  TERMINATING: 'מסיים וסוגר את הדפדפן',
  READING_MORTGAGE: 'קורא את פירוט המשכנתא',
  READING_TRANSFERS: 'קורא שמות מקבלים בהעברות',
};

export function stepText(message?: string) {
  if (!message) return '';
  const transfer = /^READING_TRANSFER:(\d+)\/(\d+)$/.exec(message);
  if (transfer) return `קורא העברה ${transfer[1]} מתוך ${transfer[2]}`;
  return STEP_TEXT[message] ?? '';
}

// observer: השלב הנוכחי נקרא מרשימת הלוגים של החשבון, והיא משתנה בלי שהסטטוס משתנה
function Account({ account, actionButtons, onToggleActive, disabled }: AccountProps) {
  const containerStyles = useMemo(() => {
    const s = [styles.container];
    if (!account.active) s.push(styles.notActive);
    if (!actionButtons) s.push(styles.pointer);
    return s;
  }, [account.active, actionButtons]);

  const badgeNumberLog = useMemo(
    () =>
      account.logs.find(
        (log) => log.originalEvent && (log.originalEvent as ExporterEndEvent).exportedTransactionsNum > 0,
      ),
    [account.logs],
  );

  return (
    <div className={containerStyles.join(' ')}>
      <img src={account.logo || piggyBank} alt={account.displayName} height={29} width={29} />
      <div className={styles.nameWrapper}>
        <div className={styles.name}>{account.displayName}</div>
        {account.status === AccountStatus.IN_PROGRESS && stepText(account.logs.at(-1)?.message) && (
          <div className={styles.step}>{stepText(account.logs.at(-1)?.message)}</div>
        )}
      </div>
      {actionButtons?.map(({ icon, clickHandler, tooltipText }) => (
        <img
          className={styles.logsButton}
          src={icon}
          alt="פעולה"
          onClick={clickHandler}
          key={icon}
          title={tooltipText}
        />
      ))}
      {onToggleActive && (
        <Form.Check
          className={styles.activeToggle}
          type="switch"
          checked={account.active}
          onChange={onToggleActive}
          disabled={disabled}
          title={account.active ? 'פעיל' : 'לא פעיל'}
          aria-label={account.active ? 'פעיל' : 'לא פעיל'}
        />
      )}
      <StatusIndicator status={account.status} />
      {badgeNumberLog?.originalEvent && (
        <Badge className={styles.newTxnsIndicator} bg={'success'}>
          {(badgeNumberLog.originalEvent as ExporterEndEvent).exportedTransactionsNum}
        </Badge>
      )}
    </div>
  );
}

export default observer(Account);
