import { displayName } from './bridgeFormat';

// התקדמות הסנכרון לדיווח לדף התקציב: אחוזים, מה קורה עכשיו, ומצב כל חשבון
export type StepStatus = 'waiting' | 'running' | 'done' | 'error';

export interface ProgressStep {
  name: string;
  status: StepStatus;
  detail: string;
}

export interface ProgressSnapshot {
  percent: number;
  text: string;
  steps: ProgressStep[];
}

const STAGES: Record<string, { fraction: number; text: string }> = {
  INITIALIZING: { fraction: 0.1, text: 'פותח דפדפן' },
  START_SCRAPING: { fraction: 0.2, text: 'מתחיל' },
  LOGGING_IN: { fraction: 0.35, text: 'מתחבר לאתר' },
  LOGIN_SUCCESS: { fraction: 0.6, text: 'התחבר, מושך תנועות' },
  CHANGE_PASSWORD: { fraction: 0.6, text: 'האתר דורש החלפת סיסמה' },
  END_SCRAPING: { fraction: 0.9, text: 'סיים למשוך' },
  TERMINATING: { fraction: 0.95, text: 'מסיים' },
};

const IMPORT_SHARE = 85; // אחוזי ההתקדמות של כל החשבונות יחד, ואחריהם השליחה לתקציב

export class ProgressTracker {
  private readonly steps: ProgressStep[];

  private fractions: number[];

  private current = -1;

  private text = 'מתכונן';

  private exporting = false;

  private finished = false;

  constructor(accountKeys: string[]) {
    this.steps = accountKeys.map((key) => ({ name: displayName(key), status: 'waiting' as StepStatus, detail: '' }));
    this.fractions = accountKeys.map(() => 0);
  }

  onEvent(eventName: string, data?: { message?: string; percent?: number }) {
    switch (eventName) {
      case 'DOWNLOAD_CHROME':
        this.text = `מוריד דפדפן (${data?.percent ?? 0}%). זה קורה רק בפעם הראשונה`;
        break;
      case 'IMPORTER_START':
        this.current += 1;
        if (this.steps[this.current]) {
          this.steps[this.current].status = 'running';
          this.text = `${this.steps[this.current].name}: מתחיל`;
        }
        break;
      case 'IMPORTER_PROGRESS': {
        const stage = STAGES[data?.message ?? ''];
        const step = this.steps[this.current];
        if (stage && step) {
          this.fractions[this.current] = Math.max(this.fractions[this.current], stage.fraction);
          step.detail = stage.text;
          this.text = `${step.name}: ${stage.text}`;
        }
        break;
      }
      case 'IMPORTER_END':
      case 'IMPORTER_ERROR': {
        const step = this.steps[this.current];
        if (step) {
          this.fractions[this.current] = 1;
          step.status = eventName === 'IMPORTER_END' ? 'done' : 'error';
          step.detail = eventName === 'IMPORTER_END' ? 'הסתיים' : (data?.message ?? 'נכשל').slice(0, 120);
        }
        break;
      }
      case 'EXPORT_PROCESS_START':
        this.exporting = true;
        this.text = 'שולח את התנועות לתקציב וליעדים';
        break;
      case 'EXPORT_PROCESS_END':
        this.finished = true;
        this.text = 'הסתיים';
        break;
      default:
        break;
    }
  }

  snapshot(): ProgressSnapshot {
    const total = Math.max(1, this.steps.length);
    const importPart = (this.fractions.reduce((a, b) => a + b, 0) / total) * IMPORT_SHARE;
    let percent = importPart;
    if (this.exporting) percent = Math.max(percent, IMPORT_SHARE + 5);
    if (this.finished) percent = 100;
    return { percent: Math.min(100, Math.round(percent)), text: this.text, steps: this.steps.map((s) => ({ ...s })) };
  }
}
