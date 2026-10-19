import { checkForUpdate, downloadUpdate, onUpdateProgress, quitAndInstall } from '#preload';
import { useEffect, useState } from 'react';
import { Button, ProgressBar, Spinner } from 'react-bootstrap';

const UPDATE_STATES = {
  INIT: 'INIT',
  CHECKING: 'CHECKING',
  ERROR: 'ERROR',
  NEW_VERSION_AVAILABLE: 'NEW_VERSION_AVAILABLE',
  DOWNLOADING: 'DOWNLOADING',
  NO_NEW_VERSION: 'NO_NEW_VERSION',
  READY_TO_INSTALL: 'READY_TO_INSTALL',
};

interface UpdateInfo {
  version: string;
}

function CheckForUpdates() {
  const [updateState, setUpdateState] = useState(UPDATE_STATES.INIT);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>();
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    onUpdateProgress(setPercent);
  }, []);

  const checkForUpdates = async () => {
    setUpdateState(UPDATE_STATES.CHECKING);
    try {
      const info = await checkForUpdate();
      setUpdateInfo(info);
      setUpdateState(info ? UPDATE_STATES.NEW_VERSION_AVAILABLE : UPDATE_STATES.NO_NEW_VERSION);
    } catch (error) {
      console.error(error);
      setUpdateState(UPDATE_STATES.ERROR);
    }
  };

  const downloadNewVersion = async () => {
    setPercent(0);
    setUpdateState(UPDATE_STATES.DOWNLOADING);
    try {
      await downloadUpdate();
      setUpdateState(UPDATE_STATES.READY_TO_INSTALL);
    } catch (error) {
      console.error(error);
      setUpdateState(UPDATE_STATES.ERROR);
    }
  };

  return (
    <div className="d-flex flex-column align-items-center gap-2 w-100">
      {updateState === UPDATE_STATES.INIT && (
        <Button variant="dark" size="sm" onClick={checkForUpdates}>
          בדיקת עדכונים
        </Button>
      )}
      {updateState === UPDATE_STATES.CHECKING && (
        <div className="d-flex align-items-center gap-2">
          <Spinner animation="border" size="sm" role="status" />
          <span>בודק אם יש גרסה חדשה...</span>
        </div>
      )}
      {updateState === UPDATE_STATES.NO_NEW_VERSION && <div>התוכנה מעודכנת, אין גרסה חדשה.</div>}
      {updateState === UPDATE_STATES.NEW_VERSION_AVAILABLE && (
        <>
          <div>נמצאה גרסה חדשה: {updateInfo?.version}</div>
          <Button variant="dark" size="sm" onClick={downloadNewVersion}>
            הורדת הגרסה החדשה
          </Button>
        </>
      )}
      {updateState === UPDATE_STATES.DOWNLOADING && (
        <>
          <div>מוריד את הגרסה החדשה... אל תסגור את התוכנה.</div>
          <ProgressBar now={percent} label={`${percent}%`} className="w-50" />
        </>
      )}
      {updateState === UPDATE_STATES.READY_TO_INSTALL && (
        <>
          <div>ההורדה הסתיימה. לחץ כדי להתקין, והתוכנה תיפתח מחדש.</div>
          <Button variant="dark" size="sm" onClick={quitAndInstall}>
            יציאה והתקנה
          </Button>
        </>
      )}
      {updateState === UPDATE_STATES.ERROR && (
        <>
          <div>בדיקת העדכון נכשלה. בדוק את החיבור לאינטרנט ונסה שוב.</div>
          <Button variant="dark" size="sm" onClick={checkForUpdates}>
            ניסיון נוסף
          </Button>
        </>
      )}
    </div>
  );
}

export default CheckForUpdates;
