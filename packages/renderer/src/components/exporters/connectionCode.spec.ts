import { describe, expect, it } from 'vitest';
import { parseConnectionCode } from './connectionCode';

const encode = (obj: object) =>
  'MZ1.' + Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('parseConnectionCode', () => {
  const key = 'mz_' + 'a'.repeat(40);
  it('מפענח כתובת ומפתח', () => {
    expect(parseConnectionCode(encode({ u: 'https://example.com/', k: key }))).toEqual({
      siteUrl: 'https://example.com',
      token: key,
    });
  });
  it('דוחה קוד לא תקין', () => {
    expect(parseConnectionCode('abc')).toBeNull();
    expect(parseConnectionCode('MZ1.@@@')).toBeNull();
    expect(parseConnectionCode(encode({ u: 'http://example.com', k: key }))).toBeNull();
    expect(parseConnectionCode(encode({ u: 'https://example.com', k: 'bad' }))).toBeNull();
  });
});
