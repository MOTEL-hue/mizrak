import { copyToClipboard } from '#preload';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Alert, Button, Card, Form, Image } from 'react-bootstrap';
import type { BudgetConfig, Exporter } from '/@/types';
import styles from './EditFileExporter.module.css';

interface EditBudgetExporterProps {
  handleSave: (exporter: Exporter) => Promise<void>;
  exporter: Exporter;
}

// מפתח חיבור אקראי (mz_ ואחריו 40 תווים). נוצר כאן, ומודבק באתר התקציב
const createConnectionKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  const text = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `mz_${text}`;
};

const EditBudgetExporter = ({ handleSave, exporter }: EditBudgetExporterProps) => {
  const [exporterConfig, setExporterConfig] = useState<Exporter>(exporter);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const options = exporterConfig.options as BudgetConfig['options'];

  const updateOption = (optionUpdates: Partial<BudgetConfig['options']>) => {
    setExporterConfig({ ...exporterConfig, options: { ...options, ...optionUpdates } });
  };

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <Image className={styles.logo} src={exporterConfig.logo} roundedCircle width={100} height={100} />
        <Card.Body className={styles.cardBody}>
          <Form>
            <Form.Group controlId="budgetSiteUrl" className="mb-3">
              <Form.Label>כתובת האתר (מתחילה ב-https://)</Form.Label>
              <Form.Control
                dir="ltr"
                value={options.siteUrl}
                placeholder="https://..."
                onChange={(e) => updateOption({ siteUrl: e.currentTarget.value })}
              />
            </Form.Group>
            <Form.Group controlId="budgetToken" className="mb-3">
              <Form.Label>מפתח החיבור</Form.Label>
              <Form.Control
                dir="ltr"
                type={showKey ? 'text' : 'password'}
                value={options.token}
                onChange={(e) => updateOption({ token: e.currentTarget.value })}
              />
            </Form.Group>
            <Form.Check
              type="checkbox"
              id="showBudgetKey"
              className="mb-2"
              label="הצגת המפתח (אפשר גם לסמן ולהעתיק ידנית)"
              checked={showKey}
              onChange={() => setShowKey(!showKey)}
            />
            <div className="mb-3 d-flex gap-2 flex-wrap">
              <Button
                variant="outline-primary"
                size="sm"
                onClick={() => {
                  updateOption({ token: createConnectionKey() });
                  setCopied(false);
                }}
              >
                יצירת מפתח חיבור חדש
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                disabled={!options.token}
                onClick={() => copyToClipboard(options.token).then(() => setCopied(true))}
              >
                {copied ? 'הועתק' : 'העתקת המפתח'}
              </Button>
            </div>
            <Alert variant="info" className="small">
              איך מחברים: 1) לוחצים "יצירת מפתח חיבור חדש" ו"שמור". 2) מעתיקים את המפתח. 3) באתר התקציב נכנסים להגדרות,
              "חיבור לתוכנת מזרק", ומדביקים אותו. 4) מסמנים "פעיל". מעכשיו כל הפעלה שולחת את התנועות לתקציב.
            </Alert>
            <Form.Group controlId="exporterActive">
              <Form.Check
                type="switch"
                label="פעיל"
                checked={exporterConfig.active}
                onChange={() => setExporterConfig({ ...exporterConfig, active: !exporterConfig.active })}
              />
            </Form.Group>
          </Form>
          <div className={styles.actionButtonsWrapper}>
            <Button variant="primary" onClick={() => handleSave(exporterConfig)}>
              שמור
            </Button>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default observer(EditBudgetExporter);
