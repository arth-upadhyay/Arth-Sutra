import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  isEncryptedBackup,
  encryptBackupBundle,
  decryptBackupBundle,
} from '../utils/backupCrypto.js';
import {
  encrypt,
  safeDecrypt,
  decryptProfileBankDetails,
} from '../utils/crypto.js';
import {
  checkSqliteIntegrity,
  createSafeSqliteSnapshot,
  inspectSqliteBackup,
  restoreSqliteFromFile,
  validateMirrorFolder,
  syncDirectoryIncremental,
  mirrorBackupToFolder,
  detectCloudFolders,
} from '../utils/disasterRecovery.js';

describe('Off-PC Disaster Recovery & Portable Encrypted Backups', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arthsutra-dr-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('encrypts and decrypts portable .arthbackup bundles with PBKDF2 + AES-256-GCM', () => {
    const samplePayload = {
      __arthsutra_backup: true,
      version: '1.2.0',
      exportedAt: '2026-11-27T10:00:00.000Z',
      profile: {
        businessName: 'Shree Medicos',
        accountNumber: '123456789012',
        ifsc: 'HDFC0000123',
        upiId: 'shree@okhdfcbank',
      },
      bills: [{ id: 'INV/001', totalAmount: 5000 }],
      clients: [{ id: 'cli_1', name: 'City Clinic' }],
      products: [{ id: 'prod_1', name: 'Paracetamol', stock: 100 }],
      users: [{ username: 'owner', passwordHash: '$2b$10$hash', role: 'ADMIN' }],
    };

    const encryptedText = encryptBackupBundle(samplePayload, 'ShopSafe@2026');
    expect(isEncryptedBackup(encryptedText)).toBe(true);
    expect(encryptedText).not.toContain('123456789012');
    expect(encryptedText).not.toContain('Shree Medicos');

    const envelope = JSON.parse(encryptedText);
    expect(envelope.summary.billCount).toBe(1);
    expect(envelope.summary.clientCount).toBe(1);
    expect(envelope.summary.hasUsers).toBe(true);

    const decrypted = decryptBackupBundle(encryptedText, 'ShopSafe@2026');
    expect(decrypted.profile.accountNumber).toBe('123456789012');
    expect(decrypted.bills).toHaveLength(1);
    expect(decrypted.users[0].username).toBe('owner');

    expect(() => decryptBackupBundle(encryptedText, 'WrongPassword')).toThrow(
      /Incorrect recovery password/i
    );
  });

  it('safely handles ciphertext from another PC key without crashing decryptProfileBankDetails', () => {
    // Valid hex iv:tag:cipher format that won't match active ENCRYPTION_KEY
    const foreignCipher = `${'a'.repeat(24)}:${'b'.repeat(32)}:${'c'.repeat(16)}`;
    expect(safeDecrypt(foreignCipher, '')).toBe('');

    const ownCipher = encrypt('SBIN0001122');
    const mixedProfile = {
      businessName: 'Test Traders',
      accountNumber: foreignCipher,
      ifsc: ownCipher,
      paymentAccounts: [{ accountNumber: foreignCipher, ifsc: ownCipher }],
    };

    const result = decryptProfileBankDetails(mixedProfile);
    expect(result.businessName).toBe('Test Traders');
    expect(result.accountNumber).toBe('');
    expect(result.ifsc).toBe('SBIN0001122');
    expect(result.paymentAccounts[0].accountNumber).toBe('');
    expect(result.paymentAccounts[0].ifsc).toBe('SBIN0001122');
  });

  it('creates integrity-checked SQLite snapshots and restores across databases', async () => {
    const srcDbPath = path.join(tmpRoot, 'source.sqlite');
    const dstDbPath = path.join(tmpRoot, 'target.sqlite');
    const snapPath = path.join(tmpRoot, 'snapshot.sqlite');

    const schemaSql = `
      CREATE TABLE bills (id TEXT PRIMARY KEY, client_name TEXT, invoice_number TEXT, is_trashed INTEGER DEFAULT 0, data TEXT);
      CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE purchases (id TEXT PRIMARY KEY, supplier_name TEXT);
      CREATE TABLE expenses (id TEXT PRIMARY KEY, description TEXT);
      CREATE TABLE receipts (id TEXT PRIMARY KEY, amount REAL);
      CREATE TABLE profiles (id TEXT PRIMARY KEY, business_name TEXT);
      CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE recurring (id TEXT PRIMARY KEY, client_name TEXT);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_id TEXT, action TEXT, payload TEXT, previous_hash TEXT, current_hash TEXT, timestamp TEXT);
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, role TEXT, created_at TEXT);
    `;

    const srcConn = new Database(srcDbPath);
    srcConn.pragma('journal_mode = WAL');
    srcConn.exec(schemaSql);
    srcConn.prepare("INSERT INTO meta (key, value) VALUES ('profile', ?)").run(
      JSON.stringify({ businessName: 'Apex Pharmacy' })
    );
    srcConn.prepare("INSERT INTO bills (id, client_name, invoice_number, is_trashed, data) VALUES (?, ?, ?, 0, ?)").run(
      'INV-101', 'Alpha Clinic', 'INV-101', JSON.stringify({ id: 'INV-101' })
    );
    srcConn.prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES ('owner', 'hash123', 'ADMIN', '2026-11-27T00:00:00Z')").run();

    const snap = await createSafeSqliteSnapshot(srcConn, snapPath);
    expect(snap.ok).toBe(true);
    expect(snap.integrityOk).toBe(true);

    const info = inspectSqliteBackup(snapPath);
    expect(info.valid).toBe(true);
    expect(info.businessName).toBe('Apex Pharmacy');
    expect(info.counts.bills).toBe(1);
    expect(info.hasUsers).toBe(true);

    // Corrupted file fails integrity check
    const badPath = path.join(tmpRoot, 'corrupt.sqlite');
    fs.writeFileSync(badPath, 'not a sqlite file');
    expect(checkSqliteIntegrity(badPath).ok).toBe(false);

    // Restore into fresh target DB (even if target has an extra schema column!)
    const dstConn = new Database(dstDbPath);
    dstConn.exec(schemaSql);
    dstConn.exec('ALTER TABLE clients ADD COLUMN extra_future_col TEXT DEFAULT ""');

    const restored = await restoreSqliteFromFile(dstConn, dstDbPath, snapPath, {
      backupsDir: path.join(tmpRoot, 'backups'),
    });
    expect(restored.ok).toBe(true);
    expect(restored.billCount).toBe(1);
    expect(restored.userCount).toBe(1);

    const restoredBill = dstConn.prepare('SELECT * FROM bills WHERE id = ?').get('INV-101');
    expect(restoredBill.client_name).toBe('Alpha Clinic');

    srcConn.close();
    dstConn.close();
  });

  it('validates mirror folders and blocks self-referential dataDir paths', () => {
    const dataDir = path.join(tmpRoot, 'app', 'data');
    const appDir = path.join(tmpRoot, 'app');
    const validMirror = path.join(tmpRoot, 'external-drive', 'ArthSutra Backups');

    fs.mkdirSync(dataDir, { recursive: true });
    expect(validateMirrorFolder(path.join(dataDir, 'backups'), { dataDir, appDir }).ok).toBe(false);
    expect(validateMirrorFolder(path.join(appDir, 'sub'), { dataDir, appDir }).ok).toBe(false);

    const validCheck = validateMirrorFolder(validMirror, { dataDir, appDir });
    expect(validCheck.ok).toBe(true);
    expect(fs.existsSync(validCheck.resolvedPath)).toBe(true);
  });

  it('mirrors encrypted/unencrypted snapshots and incremental PDFs to external folder', async () => {
    const dbPath = path.join(tmpRoot, 'live.sqlite');
    const conn = new Database(dbPath);
    conn.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
    conn.prepare("INSERT INTO meta VALUES ('k', 'v')").run();

    const invoicesDir = path.join(tmpRoot, 'Saved Invoices');
    const pdfFolder = path.join(invoicesDir, 'Acme', 'November 2026');
    fs.mkdirSync(pdfFolder, { recursive: true });
    fs.writeFileSync(path.join(pdfFolder, 'INV-001.pdf'), '%PDF-1.4 sample');

    const mirrorDir = path.join(tmpRoot, 'GoogleDriveMock', 'ArthSutra Backups');
    const payload = { __arthsutra_backup: true, version: '1.2.0', bills: [{ id: 'INV-001' }] };

    // 1. Encrypted mirror mode
    const resEnc = await mirrorBackupToFolder({
      mirrorPath: mirrorDir,
      sqliteConn: conn,
      exportPayload: payload,
      recoveryPassword: 'MyCloudPassword!',
      mirrorPdfs: true,
      invoicesDir,
    });
    expect(resEnc.ok).toBe(true);
    expect(resEnc.encrypted).toBe(true);
    expect(fs.existsSync(path.join(mirrorDir, 'latest-backup.arthbackup'))).toBe(true);
    expect(fs.existsSync(path.join(mirrorDir, 'HOW-TO-RESTORE.txt'))).toBe(true);
    expect(fs.existsSync(path.join(mirrorDir, 'Saved Invoices', 'Acme', 'November 2026', 'INV-001.pdf'))).toBe(true);

    // 2. Second PDF sync skips unchanged files
    const pdfRes2 = syncDirectoryIncremental(invoicesDir, path.join(mirrorDir, 'Saved Invoices'));
    expect(pdfRes2.copied).toBe(0);
    expect(pdfRes2.skipped).toBe(1);

    // 3. Plain mirror mode (SQLite + JSON)
    const plainMirrorDir = path.join(tmpRoot, 'UsbDriveMock', 'ArthSutra Backups');
    const resPlain = await mirrorBackupToFolder({
      mirrorPath: plainMirrorDir,
      sqliteConn: conn,
      exportPayload: payload,
      recoveryPassword: '',
      mirrorPdfs: false,
      invoicesDir,
    });
    expect(resPlain.ok).toBe(true);
    expect(resPlain.encrypted).toBe(false);
    expect(fs.existsSync(path.join(plainMirrorDir, 'latest-backup.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(plainMirrorDir, 'latest-backup.json'))).toBe(true);

    conn.close();
  });

  it('detects installed OneDrive / Google Drive folders from env safely', () => {
    const fakeOneDrive = path.join(tmpRoot, 'OneDrive');
    const fakeGDrive = path.join(tmpRoot, 'Google Drive');
    fs.mkdirSync(fakeOneDrive, { recursive: true });
    fs.mkdirSync(fakeGDrive, { recursive: true });

    const detected = detectCloudFolders(
      { USERPROFILE: tmpRoot, OneDrive: fakeOneDrive },
      { skipDriveScan: true }
    );
    expect(detected.hasGoogleDriveDesktop).toBe(true);
    expect(detected.folders.some(f => f.provider === 'Microsoft OneDrive')).toBe(true);
    expect(detected.folders.some(f => f.provider === 'Google Drive for Desktop')).toBe(true);
  });
});
