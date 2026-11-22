// utils/crypto.js
// ─────────────────────────────────────────────────────────────────────────────
// AES-256-GCM Encryption / Decryption Utility
// Compliant with NIST SP 800-38D (12-byte IV + 16-byte GCM authentication tag)
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

function getEncryptionKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || typeof keyHex !== 'string') {
    throw new Error('FATAL: ENCRYPTION_KEY environment variable is missing.');
  }
  const trimmed = keyHex.trim();
  if (trimmed.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      `FATAL: ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes). Received length: ${trimmed.length}`
    );
  }
  return Buffer.from(trimmed, 'hex');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: iv:authTag:ciphertext (all in hex).
 */
export function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') {
    return '';
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // NIST recommended 96-bit IV for AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string (format: iv:authTag:ciphertext).
 * Returns the original plaintext or original string if not encrypted.
 */
export function decrypt(encryptedStr) {
  if (!encryptedStr || typeof encryptedStr !== 'string') {
    return '';
  }
  if (!isEncrypted(encryptedStr)) {
    return encryptedStr; // Return as-is if not encrypted
  }

  const key = getEncryptionKey();
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) {
    return encryptedStr;
  }

  const [ivHex, authTagHex, cipherHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Returns true if the string matches the AES-GCM iv:authTag:ciphertext format.
 */
export function isEncrypted(str) {
  if (typeof str !== 'string') return false;
  const parts = str.split(':');
  if (parts.length !== 3) return false;
  const [iv, tag, cipher] = parts;
  return (
    iv.length === 24 && // 12 bytes = 24 hex chars
    tag.length === 32 && // 16 bytes = 32 hex chars
    /^[0-9a-fA-F]+$/.test(iv) &&
    /^[0-9a-fA-F]+$/.test(tag) &&
    /^[0-9a-fA-F]+$/.test(cipher)
  );
}

/**
 * Encrypts sensitive bank fields in a business profile object.
 * Encrypts: accountNumber, ifsc, swift, upiId, and items in paymentAccounts array.
 */
export function encryptProfileBankDetails(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const cloned = { ...profile };

  if (cloned.accountNumber && !isEncrypted(cloned.accountNumber)) {
    cloned.accountNumber = encrypt(cloned.accountNumber);
  }
  if (cloned.ifsc && !isEncrypted(cloned.ifsc)) {
    cloned.ifsc = encrypt(cloned.ifsc);
  }
  if (cloned.swift && !isEncrypted(cloned.swift)) {
    cloned.swift = encrypt(cloned.swift);
  }
  if (cloned.upiId && !isEncrypted(cloned.upiId)) {
    cloned.upiId = encrypt(cloned.upiId);
  }

  // Encrypt paymentAccounts array if present
  let accounts = cloned.paymentAccounts;
  if (typeof accounts === 'string') {
    try { accounts = JSON.parse(accounts); } catch { accounts = []; }
  }
  if (Array.isArray(accounts)) {
    const encryptedAccounts = accounts.map((acc) => ({
      ...acc,
      accountNumber: acc.accountNumber && !isEncrypted(acc.accountNumber) ? encrypt(acc.accountNumber) : (acc.accountNumber || ''),
      ifsc: acc.ifsc && !isEncrypted(acc.ifsc) ? encrypt(acc.ifsc) : (acc.ifsc || ''),
      swift: acc.swift && !isEncrypted(acc.swift) ? encrypt(acc.swift) : (acc.swift || ''),
      upiId: acc.upiId && !isEncrypted(acc.upiId) ? encrypt(acc.upiId) : (acc.upiId || ''),
    }));
    cloned.paymentAccounts = Array.isArray(cloned.paymentAccounts) ? encryptedAccounts : JSON.stringify(encryptedAccounts);
  }

  return cloned;
}

/**
 * Decrypts sensitive bank fields in a business profile object.
 */
export function decryptProfileBankDetails(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const cloned = { ...profile };

  if (cloned.accountNumber) cloned.accountNumber = decrypt(cloned.accountNumber);
  if (cloned.ifsc) cloned.ifsc = decrypt(cloned.ifsc);
  if (cloned.swift) cloned.swift = decrypt(cloned.swift);
  if (cloned.upiId) cloned.upiId = decrypt(cloned.upiId);

  let accounts = cloned.paymentAccounts;
  const wasString = typeof accounts === 'string';
  if (wasString) {
    try { accounts = JSON.parse(accounts); } catch { accounts = []; }
  }
  if (Array.isArray(accounts)) {
    const decryptedAccounts = accounts.map((acc) => ({
      ...acc,
      accountNumber: acc.accountNumber ? decrypt(acc.accountNumber) : '',
      ifsc: acc.ifsc ? decrypt(acc.ifsc) : '',
      swift: acc.swift ? decrypt(acc.swift) : '',
      upiId: acc.upiId ? decrypt(acc.upiId) : '',
    }));
    cloned.paymentAccounts = wasString ? JSON.stringify(decryptedAccounts) : decryptedAccounts;
  }

  return cloned;
}
