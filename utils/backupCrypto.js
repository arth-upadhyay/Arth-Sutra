// utils/backupCrypto.js
// ─────────────────────────────────────────────────────────────────────────────
// Password-protected portable backup envelope (.arthbackup)
// Uses PBKDF2-HMAC-SHA256 + gzip + AES-256-GCM so backups stored on Google
// Drive, OneDrive, or USB drives remain private AND restore on any new PC
// without needing the old machine's .env or .encryption-key file.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import zlib from 'zlib';

const PBKDF2_ITERATIONS = 210000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export function isEncryptedBackup(input) {
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch { return false; }
  }
  return Boolean(
    obj &&
    typeof obj === 'object' &&
    obj.__arthsutra_encrypted_backup === true &&
    typeof obj.ciphertext === 'string' &&
    typeof obj.salt === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.authTag === 'string'
  );
}

/**
 * Encrypts a backup object or JSON string with a user-chosen recovery password.
 * Returns a JSON string formatted for `.arthbackup` files.
 */
export function encryptBackupBundle(backupPayload, password) {
  if (!password || typeof password !== 'string' || password.length < 4) {
    throw new Error('Recovery password must be at least 4 characters long.');
  }

  const obj = typeof backupPayload === 'string' ? JSON.parse(backupPayload) : backupPayload;
  if (!obj || typeof obj !== 'object') {
    throw new Error('Invalid backup payload.');
  }

  const jsonBuf = Buffer.from(JSON.stringify(obj), 'utf8');
  const compressed = zlib.gzipSync(jsonBuf, { level: 6 });

  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_BYTES, 'sha256');

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const envelope = {
    __arthsutra_encrypted_backup: true,
    formatVersion: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    compression: 'gzip',
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted.toString('base64'),
    createdAt: new Date().toISOString(),
    summary: {
      version: obj.version || null,
      exportedAt: obj.exportedAt || null,
      billCount: Array.isArray(obj.bills) ? obj.bills.length : 0,
      clientCount: Array.isArray(obj.clients) ? obj.clients.length : 0,
      productCount: Array.isArray(obj.products) ? obj.products.length : 0,
      hasUsers: Array.isArray(obj.users) && obj.users.length > 0,
    },
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Decrypts a `.arthbackup` envelope back to the parsed backup object.
 */
export function decryptBackupBundle(envelopeOrString, password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Recovery password is required to unlock this backup.');
  }

  let env = envelopeOrString;
  if (typeof env === 'string') {
    try { env = JSON.parse(env); } catch {
      throw new Error('Backup file is not valid JSON.');
    }
  }

  if (!isEncryptedBackup(env)) {
    throw new Error('File is not an encrypted ArthSutra recovery backup.');
  }

  const iterations = Number(env.iterations) || PBKDF2_ITERATIONS;
  const salt = Buffer.from(env.salt, 'hex');
  const iv = Buffer.from(env.iv, 'hex');
  const authTag = Buffer.from(env.authTag, 'hex');
  const ciphertext = Buffer.from(env.ciphertext, 'base64');

  const key = crypto.pbkdf2Sync(password, salt, iterations, KEY_BYTES, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let plaintextBuf;
  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    plaintextBuf = env.compression === 'gzip' ? zlib.gunzipSync(decrypted) : decrypted;
  } catch {
    throw new Error('Incorrect recovery password or corrupted backup file.');
  }

  try {
    return JSON.parse(plaintextBuf.toString('utf8'));
  } catch {
    throw new Error('Decrypted backup payload is corrupted.');
  }
}
