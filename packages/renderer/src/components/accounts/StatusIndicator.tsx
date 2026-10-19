import Spinner from 'react-bootstrap/Spinner';
import successIcon from '../../assets/check-circle-fill.svg';
import errorIcon from '../../assets/exclamation-circle.svg';
import pendingIcon from '../../assets/hourglass-top.svg';
import { AccountStatus } from '../../types';

interface StatusIndicatorProps {
  status?: AccountStatus;
}

export default function StatusIndicator({ status }: StatusIndicatorProps) {
  switch (status) {
    case AccountStatus.PENDING:
      return <img src={pendingIcon} alt="בתהליך" />;
    case AccountStatus.IN_PROGRESS:
      return <Spinner style={{ width: '20px', height: '20px' }} animation="border" variant="primary" />;
    case AccountStatus.DONE:
      return <img src={successIcon} alt="הצליח" />;
    case AccountStatus.ERROR:
      return <img src={errorIcon} alt="נכשל" />;
    default:
      return null;
  }
}
