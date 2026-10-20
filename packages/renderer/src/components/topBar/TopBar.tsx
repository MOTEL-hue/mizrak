import { exportDiagnostics } from '#preload';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Alert, Container, Stack } from 'react-bootstrap';
import NavBar from 'react-bootstrap/Navbar';
import logo from '../../assets/logos/logoFishOnly.svg';
import HelpModal from './HelpModal';
import NavButton from './NavButton';
import TransactionsViewer from './TransactionsViewer';
import styles from './TopBar.module.css';
import { useAppInfoStore } from '../../store';

function TopBar() {
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
      <NavBar className={styles.topNavBar} style={{ borderBottom: '1px solid #C4C4C4' }}>
        <Container fluid>
          <NavBar.Brand>
            <Stack direction="horizontal" gap={3}>
              <div
                style={{
                  backgroundImage: `url(${logo})`,
                  width: 50,
                  height: 50,
                  borderRadius: '50%',
                }}
              ></div>
              <div>
                מזרק
                {appInfoStore.appInfo?.currentVersion && (
                  <div className="mz-version">גרסה {appInfoStore.appInfo.currentVersion}</div>
                )}
              </div>
            </Stack>
          </NavBar.Brand>
          <Stack direction="horizontal" gap={5}>
            <NavButton onClick={() => setShowData(true)} text="הנתונים שלי" />
            <NavButton onClick={() => setShowHelp(true)} text="עזרה והסברים" />
            <NavButton onClick={saveDiagnostics} text="שמירת קובץ אבחון" />
          </Stack>
        </Container>
      </NavBar>
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

export default observer(TopBar);
