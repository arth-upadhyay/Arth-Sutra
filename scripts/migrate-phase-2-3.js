// scripts/migrate-phase-2-3.js
// ─────────────────────────────────────────────────────────────────────────────
// Migration script for Feature #5 & Feature #6:
// 1. Creates `request_logs` and `users` tables if not present.
// 2. Seeds default admin user (`admin` / `admin123` hashed with bcryptjs).
// 3. Encrypts existing plaintext bank details in `profiles` and `meta` ('profile').
// ─────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { hashPasswordSync } from '../utils/auth.js';
import { encryptProfileBankDetails } from '../utils/crypto.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', 'data', 'arth-sutra.sqlite');

console.log('Connecting to database:', DB_PATH);
const sqlite = new Database(DB_PATH);

try {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS request_logs (
      key       TEXT PRIMARY KEY,
      response  TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'CLERK',
      created_at    TEXT NOT NULL
    );
  `);
  console.log('✓ Tables request_logs and users confirmed.');

  // 1. Seed Default Admin only if users table is empty
  const userCount = sqlite.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount && Number(userCount.count) === 0) {
    const hash = hashPasswordSync('admin123');
    sqlite.prepare(`
      INSERT INTO users (username, password_hash, role, created_at)
      VALUES (?, ?, ?, ?)
    `).run('admin', hash, 'ADMIN', new Date().toISOString());
    console.log('✓ Seeded default Admin user (admin / admin123).');
  } else {
    console.log('• Users table already populated, skipping admin seed.');
  }

  // 2. Encrypt existing profiles bank credentials
  const profileRows = sqlite.prepare('SELECT * FROM profiles').all();
  let profilesEncryptedCount = 0;
  for (const row of profileRows) {
    const encrypted = encryptProfileBankDetails(row);
    sqlite.prepare(`
      UPDATE profiles
      SET account_number = ?, ifsc = ?, swift = ?, upi_id = ?, payment_accounts = ?
      WHERE id = ?
    `).run(
      encrypted.accountNumber || '',
      encrypted.ifsc || '',
      encrypted.swift || '',
      encrypted.upiId || '',
      typeof encrypted.paymentAccounts === 'string' ? encrypted.paymentAccounts : JSON.stringify(encrypted.paymentAccounts || []),
      row.id
    );
    profilesEncryptedCount++;
  }
  console.log(`✓ Encrypted bank details for ${profilesEncryptedCount} profile(s).`);

  // 3. Encrypt singleton profile in meta table
  const metaProfileRow = sqlite.prepare("SELECT value FROM meta WHERE key = 'profile'").get();
  if (metaProfileRow && metaProfileRow.value) {
    try {
      const parsed = JSON.parse(metaProfileRow.value);
      const encryptedMeta = encryptProfileBankDetails(parsed);
      sqlite.prepare("UPDATE meta SET value = ? WHERE key = 'profile'").run(
        JSON.stringify(encryptedMeta)
      );
      console.log('✓ Encrypted singleton profile bank details in meta table.');
    } catch (err) {
      console.warn('Warning: could not parse meta.profile JSON:', err.message);
    }
  }

  console.log('\nMigration completed successfully!\n');
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
} finally {
  sqlite.close();
}
