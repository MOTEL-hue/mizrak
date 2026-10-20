import { onScrapingSummary } from '#preload';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { Alert } from 'react-bootstrap';
import { useConfigStore } from '../store/ConfigStore';

// הסבר בעברית על כל שגיאה שהתרחשה בסריקה האחרונה, ומה לעשות
const ProblemsAlert = () => {
  const configStore = useConfigStore();

  useEffect(() => {
    onScrapingSummary((problems) => configStore.setProblems(problems));
  }, [configStore]);

  if (configStore.problems.length === 0) return null;

  return (
    <Alert variant="danger" dismissible onClose={() => configStore.setProblems([])} className="w-100">
      <Alert.Heading as="h6">⚠️ הסריקה הסתיימה עם שגיאות</Alert.Heading>
      <ul className="mb-2">
        {configStore.problems.map((problem, index) => (
          <li key={`${problem.name}-${index}`}>
            <strong>{problem.name}:</strong> {problem.message}
          </li>
        ))}
      </ul>
      <div className="small">
        אם הבעיה נמשכת: לחץ למעלה על &quot;שמירת קובץ אבחון&quot; ושלח את הקובץ, או פתח &quot;עזרה והסברים&quot; לפרטים על כל שגיאה.
      </div>
    </Alert>
  );
};

export default observer(ProblemsAlert);
