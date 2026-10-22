import { exportDiagnostics } from '#preload';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Alert, Stack } from 'react-bootstrap';
import HelpModal from '../topBar/HelpModal';
import NavButton from './NavButton';
import TransactionsViewer from '../topBar/TransactionsViewer';
import { useAppInfoStore } from '../../store';

function SyncTools() {
  const appInfoStore = useAppInfoStore();
  const [showHelp, setShowHelp] = useState(false);
  const [showData, setShowData] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const saveDiagnostics = async () => {
    setSaveFailed(false);
    try {
      const result = await exportDiagnostics();
      if (result) setSavedPath(result.filePath);
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <>
      <Stack direction="horizontal" gap={4} className="flex-wrap justify-content-center">
        <NavButton onClick={() => setShowData(true)} text="הנתונים שלי" />
        <NavButton onClick={() => setShowHelp(true)} text="עזרה והסברים" />
        <NavButton onClick={saveDiagnostics} text="שמירת קובץ אבחון" />
        {appInfoStore.appInfo?.currentVersion && <span className="mz-version">גרסה {appInfoStore.appInfo.currentVersion}</span>}
      </Stack>
      {savedPath && (
        <Alert variant="success" dismissible onClose={() => setSavedPath(null)} className="m-2">
          קובץ האבחון נשמר: <span dir="ltr">{savedPath}</span>. אפשר לשלוח אותו לצורך טיפול בבעיה. הוא אינו כולל סיסמאות.
        </Alert>
      )}
      {saveFailed && (
        <Alert variant="danger" dismissible onClose={() => setSaveFailed(false)} className="m-2">
          שמירת קובץ האבחון נכשלה. נסה שוב, או בחר תיקייה אחרת.
        </Alert>
      )}
      <TransactionsViewer show={showData} onClose={() => setShowData(false)} />
      <HelpModal show={showHelp} onClose={() => setShowHelp(false)} />
    </>
  );
}

export default observer(SyncTools);
