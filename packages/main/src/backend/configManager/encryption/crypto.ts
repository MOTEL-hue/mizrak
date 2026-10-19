/*
Updated to use modern crypto APIs (createCipheriv/createDecipheriv)
with backward compatibility for configs encrypted with the legacy API.
*/

import crypto from 'crypto';
import SALT from './salt';

const ALGORITHM = 'aes-256-ctr';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits for CTR mode

export function randomHex(characters = 16) {
  return crypto.randomBytes(characters).toString('hex');
}

/**
 * Replicates OpenSSL's EVP_BytesToKey for backward compatibility.
 * This is what the deprecated createCipher/createDecipher used internally.
 */
function legacyDeriveKeyAndIv(password: string): { key: Buffer; iv: Buffer } {
  const totalLen = KEY_LENGTH + IV_LENGTH;
  const result: Buffer[] = [];
  let resultLen = 0;
  let prev = Buffer.alloc(0);

  while (resultLen < totalLen) {
    const hash = crypto.createHash('md5');
    hash.update(prev);
    hash.update(password, 'utf8');
    prev = hash.digest();
    result.push(prev);
    resultLen += prev.length;
  }

  const combined = Buffer.concat(result);
  return {
    key: combined.subarray(0, KEY_LENGTH),
    iv: combined.subarray(KEY_LENGTH, KEY_LENGTH + IV_LENGTH),
  };
}

/**
 * Decrypt using the legacy method (compatible with old createDecipher).
 */
function legacyDecrypt(text: string, salt: string): string {
  const { key, iv } = legacyDeriveKeyAndIv(salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = decipher.update(text, 'hex', 'utf8');
  return decrypted + decipher.final('utf8');
}

/**
 * Modern encryption with random IV prepended to ciphertext.
 * Format: <iv_hex>:<ciphertext_hex>
 */
function modernEncrypt(text: string, salt: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = crypto.scryptSync(salt, 'caspion', KEY_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const crypted = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
  return `v2:${iv.toString('hex')}:${crypted}`;
}

/**
 * Modern decryption expecting IV prepended to ciphertext.
 */
function modernDecrypt(text: string, salt: string): string {
  const parts = text.split(':');
  if (parts.length !== 3 || parts[0] !== 'v2') {
    throw new Error('Invalid modern encrypted format');
  }
  const iv = Buffer.from(parts[1], 'hex');
  const ciphertext = parts[2];
  const key = crypto.scryptSync(salt, 'caspion', KEY_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  return decipher.update(ciphertext, 'hex', 'utf8') + decipher.final('utf8');
}

/**
 * הצפנה עם אימות (AES-256-GCM): אם הקובץ שונה או פגום, הפענוח נכשל.
 * Format: v3:<iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function gcmEncrypt(text: string, salt: string): string {
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(salt, 'mizrak', KEY_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const crypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `v3:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${crypted.toString('hex')}`;
}

export function gcmDecrypt(text: string, salt: string): string {
  const [version, iv, tag, ciphertext] = text.split(':');
  if (version !== 'v3' || !iv || !tag || ciphertext === undefined) {
    throw new Error('Invalid v3 encrypted format');
  }
  const key = crypto.scryptSync(salt, 'mizrak', KEY_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString('utf8');
}

export async function encrypt(text: string) {
  const salt = await SALT(randomHex());
  // נתונים חדשים תמיד נשמרים בהצפנה עם אימות
  return gcmEncrypt(text, salt);
}

export async function decrypt(text: string) {
  try {
    if (!text) {
      console.info('Failed to decrypt an empty string, returning null');
      return null;
    }

    const salt = await SALT();

    if (text.startsWith('v3:')) {
      return gcmDecrypt(text, salt);
    }

    // Try modern format first (starts with "v2:")
    if (text.startsWith('v2:')) {
      return modernDecrypt(text, salt);
    }

    // Fall back to legacy format for backward compatibility
    return legacyDecrypt(text, salt);
  } catch (e) {
    if (!text) {
      console.info('Failed to decrypt an empty string, returning null');
      return null;
    }
    console.error('Failed to decrypt', e);
    throw e;
  }
}
