import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  isEncrypted,
  encryptProfileBankDetails,
  decryptProfileBankDetails,
} from '../utils/crypto.js';
import {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  ROLES,
} from '../utils/auth.js';

describe('Feature #6: Cryptographic Utilities (AES-256-GCM)', () => {
  it('encrypts plaintext into iv:authTag:ciphertext format', () => {
    const plaintext = '123456789012';
    const ciphertext = encrypt(plaintext);
    expect(isEncrypted(ciphertext)).toBe(true);
    expect(ciphertext).not.toContain(plaintext);
  });

  it('decrypts ciphertext back to original plaintext', () => {
    const original = 'HDFC0001234';
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it('returns empty string or unencrypted strings cleanly', () => {
    expect(encrypt('')).toBe('');
    expect(decrypt('plain-unencrypted-string')).toBe('plain-unencrypted-string');
  });

  it('encrypts and decrypts nested profile bank details', () => {
    const rawProfile = {
      businessName: 'Apex Enterprises',
      accountNumber: '998877665544',
      ifsc: 'SBIN0004567',
      swift: 'SBININBB123',
      upiId: 'apex@oksbi',
      paymentAccounts: [
        { accountNumber: '11223344', ifsc: 'ICIC000999', swift: '', upiId: 'apex2@icici' },
      ],
    };

    const encrypted = encryptProfileBankDetails(rawProfile);
    expect(isEncrypted(encrypted.accountNumber)).toBe(true);
    expect(isEncrypted(encrypted.ifsc)).toBe(true);
    expect(isEncrypted(encrypted.swift)).toBe(true);
    expect(isEncrypted(encrypted.upiId)).toBe(true);
    expect(encrypted.businessName).toBe('Apex Enterprises'); // non-bank details untouched

    const decrypted = decryptProfileBankDetails(encrypted);
    expect(decrypted.accountNumber).toBe('998877665544');
    expect(decrypted.ifsc).toBe('SBIN0004567');
    expect(decrypted.swift).toBe('SBININBB123');
    expect(decrypted.upiId).toBe('apex@oksbi');
  });
});

describe('Feature #6: Authentication & RBAC Utilities', () => {
  it('hashes passwords and verifies them using bcryptjs', async () => {
    const password = 'mySecretPassword99';
    const hash = await hashPassword(password);
    expect(hash).not.toBe(password);
    expect(await comparePassword(password, hash)).toBe(true);
    expect(await comparePassword('wrongPassword', hash)).toBe(false);
  });

  it('signs and verifies JWT tokens with roles', () => {
    const user = { id: 42, username: 'charlie', role: ROLES.ACCOUNTANT };
    const token = generateToken(user);
    expect(typeof token).toBe('string');

    const decoded = verifyToken(token);
    expect(decoded.id).toBe(42);
    expect(decoded.username).toBe('charlie');
    expect(decoded.role).toBe(ROLES.ACCOUNTANT);
  });

  it('fails verification on tampered JWT tokens', () => {
    const user = { id: 1, username: 'admin', role: ROLES.ADMIN };
    const token = generateToken(user);
    const tampered = token.slice(0, -5) + 'xxxxx';
    expect(() => verifyToken(tampered)).toThrow();
  });
});
