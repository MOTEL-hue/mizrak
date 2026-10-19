import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Button, Card, Form, Image } from 'react-bootstrap';
import type { BudgetConfig, Exporter } from '/@/types';
import styles from './EditFileExporter.module.css';

interface EditBudgetExporterProps {
  handleSave: (exporter: Exporter) => Promise<void>;
  exporter: Exporter;
}

const EditBudgetExporter = ({ handleSave, exporter }: EditBudgetExporterProps) => {
  const [exporterConfig, setExporterConfig] = useState<Exporter>(exporter);
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
              <Form.Label>מפתח גישה (עם הרשאת ייבוא תקציב)</Form.Label>
              <Form.Control
                dir="ltr"
                type="password"
                value={options.token}
                onChange={(e) => updateOption({ token: e.currentTarget.value })}
              />
            </Form.Group>
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
