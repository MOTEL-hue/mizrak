import { describe, expect, it } from 'vitest';
import { gcmDecrypt, gcmEncrypt } from './crypto';

describe('gcm encryption', () => {
  it('מצפין ומפענח, כולל עברית', () => {
    const text = JSON.stringify({ שם: 'בדיקה', n: 1 });
    expect(gcmDecrypt(gcmEncrypt(text, 'salt'), 'salt')).toBe(text);
  });
  it('נכשל כשהקובץ שונה', () => {
    const enc = gcmEncrypt('סוד', 'salt');
    const tampered = enc.slice(0, -2) + (enc.endsWith('00') ? '11' : '00');
    expect(() => gcmDecrypt(tampered, 'salt')).toThrow();
  });
  it('נכשל עם מפתח שגוי', () => {
    expect(() => gcmDecrypt(gcmEncrypt('סוד', 'a'), 'b')).toThrow();
  });
});
