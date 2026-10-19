import { getErrorGuide } from '#preload';
import { useEffect, useState } from 'react';
import { Accordion, Modal } from 'react-bootstrap';
import { HELP_SECTIONS } from './helpContent';

interface HelpModalProps {
  show: boolean;
  onClose: () => void;
}

function HelpModal({ show, onClose }: HelpModalProps) {
  const [errors, setErrors] = useState<{ title: string; text: string }[]>([]);

  useEffect(() => {
    if (show) getErrorGuide().then(setErrors).catch(() => setErrors([]));
  }, [show]);

  return (
    <Modal show={show} onHide={onClose} size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>עזרה והסברים</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Accordion defaultActiveKey="0">
          {HELP_SECTIONS.map((section, index) => (
            <Accordion.Item eventKey={String(index)} key={section.title}>
              <Accordion.Header>{section.title}</Accordion.Header>
              <Accordion.Body>
                <ul>
                  {section.items.map((item) => (
                    <li key={item.name}>
                      <strong>{item.name}:</strong> {item.text}
                    </li>
                  ))}
                </ul>
              </Accordion.Body>
            </Accordion.Item>
          ))}
          <Accordion.Item eventKey="errors">
            <Accordion.Header>שגיאות נפוצות ומה לעשות</Accordion.Header>
            <Accordion.Body>
              <ul>
                {errors.map((error) => (
                  <li key={error.title}>
                    <strong>{error.title}:</strong> {error.text}
                  </li>
                ))}
              </ul>
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>
      </Modal.Body>
    </Modal>
  );
}

export default HelpModal;
