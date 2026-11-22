// db/index.js — Initialises better-sqlite3 + Drizzle ORM.
// Exports the `db` instance and all schema tables for use in server.js.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import * as schema from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'arth-sutra.sqlite');

// ── Create the SQLite connection ───────────────────────────────────────────
const sqlite = new Database(DB_PATH);

// Performance pragmas — safe for a single-process desktop app.
sqlite.pragma('journal_mode = WAL');     // Write-Ahead Logging: concurrent reads
sqlite.pragma('synchronous = NORMAL');   // Good balance of speed vs durability
sqlite.pragma('foreign_keys = ON');      // Enforce FK constraints
sqlite.pragma('busy_timeout = 5000');    // Wait 5s on lock contention

// ── Drizzle instance ───────────────────────────────────────────────────────
export const db = drizzle(sqlite, { schema });

// ── Table creation (run once on first start) ───────────────────────────────
// We embed the CREATE TABLE statements rather than relying on drizzle-kit
// push at runtime, so the app is fully self-bootstrapping with zero build
// steps for the user.
const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS bills (
  id               TEXT PRIMARY KEY,
  client_name      TEXT NOT NULL DEFAULT '',
  invoice_number   TEXT NOT NULL DEFAULT '',
  invoice_date     TEXT NOT NULL DEFAULT '',
  invoice_type     TEXT NOT NULL DEFAULT 'tax-invoice',
  currency         TEXT NOT NULL DEFAULT 'INR',
  total_amount     REAL NOT NULL DEFAULT 0,
  total_tax_amount REAL NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'unpaid',
  paid_amount      REAL NOT NULL DEFAULT 0,
  printed_count    INTEGER NOT NULL DEFAULT 0,
  last_printed_at  TEXT,
  generated_from   TEXT,
  auto_generated   INTEGER NOT NULL DEFAULT 0,
  auto_generated_at TEXT,
  is_trashed       INTEGER NOT NULL DEFAULT 0,
  trashed_at       TEXT,
  data             TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS clients (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL DEFAULT '',
  address  TEXT NOT NULL DEFAULT '',
  city     TEXT NOT NULL DEFAULT '',
  pin      TEXT NOT NULL DEFAULT '',
  state    TEXT NOT NULL DEFAULT '',
  gstin    TEXT NOT NULL DEFAULT '',
  country  TEXT NOT NULL DEFAULT '',
  email    TEXT NOT NULL DEFAULT '',
  phone    TEXT NOT NULL DEFAULT '',
  is_sez   INTEGER NOT NULL DEFAULT 0,
  licence  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS products (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT '',
  hsn            TEXT NOT NULL DEFAULT '',
  purchase_price REAL NOT NULL DEFAULT 0,
  selling_price  REAL NOT NULL DEFAULT 0,
  rate           REAL NOT NULL DEFAULT 0,
  mrp            REAL NOT NULL DEFAULT 0,
  tax_percent    REAL NOT NULL DEFAULT 0,
  cess_percent   REAL NOT NULL DEFAULT 0,
  unit           TEXT NOT NULL DEFAULT '',
  stock          REAL NOT NULL DEFAULT 0,
  description    TEXT NOT NULL DEFAULT '',
  pkg            TEXT NOT NULL DEFAULT '',
  batches        TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS purchases (
  id               TEXT PRIMARY KEY,
  date             TEXT NOT NULL DEFAULT '',
  supplier_name    TEXT NOT NULL DEFAULT '',
  supplier_address TEXT NOT NULL DEFAULT '',
  supplier_gstin   TEXT NOT NULL DEFAULT '',
  invoice_number   TEXT NOT NULL DEFAULT '',
  total_amount     REAL NOT NULL DEFAULT 0,
  total_tax        REAL NOT NULL DEFAULT 0,
  taxable_amount   REAL NOT NULL DEFAULT 0,
  apply_round_off  INTEGER NOT NULL DEFAULT 0,
  round_off        REAL NOT NULL DEFAULT 0,
  payment_status   TEXT NOT NULL DEFAULT 'Unpaid',
  interstate       INTEGER NOT NULL DEFAULT 0,
  note             TEXT NOT NULL DEFAULT '',
  items            TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS expenses (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT '',
  amount       REAL NOT NULL DEFAULT 0,
  gst_amount   REAL NOT NULL DEFAULT 0,
  gst_percent  REAL NOT NULL DEFAULT 0,
  vendor_name  TEXT NOT NULL DEFAULT '',
  vendor_gstin TEXT NOT NULL DEFAULT '',
  invoice_no   TEXT NOT NULL DEFAULT '',
  payment_mode TEXT NOT NULL DEFAULT '',
  interstate   INTEGER NOT NULL DEFAULT 0,
  note         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS receipts (
  id               TEXT PRIMARY KEY,
  date             TEXT NOT NULL DEFAULT '',
  receipt_no       TEXT NOT NULL DEFAULT '',
  client_name      TEXT NOT NULL DEFAULT '',
  client_address   TEXT NOT NULL DEFAULT '',
  amount           REAL NOT NULL DEFAULT 0,
  payment_mode     TEXT NOT NULL DEFAULT '',
  reference_no     TEXT NOT NULL DEFAULT '',
  against_invoice  TEXT NOT NULL DEFAULT '',
  note             TEXT NOT NULL DEFAULT '',
  currency         TEXT NOT NULL DEFAULT 'INR',
  source           TEXT NOT NULL DEFAULT '',
  bill_id          TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS profiles (
  id                  TEXT PRIMARY KEY,
  business_name       TEXT NOT NULL DEFAULT '',
  address             TEXT NOT NULL DEFAULT '',
  city                TEXT NOT NULL DEFAULT '',
  pin                 TEXT NOT NULL DEFAULT '',
  state               TEXT NOT NULL DEFAULT '',
  country             TEXT NOT NULL DEFAULT '',
  gstin               TEXT NOT NULL DEFAULT '',
  pan                 TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL DEFAULT '',
  bank_name           TEXT NOT NULL DEFAULT '',
  account_number      TEXT NOT NULL DEFAULT '',
  ifsc                TEXT NOT NULL DEFAULT '',
  swift               TEXT NOT NULL DEFAULT '',
  logo                TEXT NOT NULL DEFAULT '',
  signature           TEXT NOT NULL DEFAULT '',
  upi_id              TEXT NOT NULL DEFAULT '',
  google_client_id    TEXT NOT NULL DEFAULT '',
  google_drive_folder TEXT NOT NULL DEFAULT 'GST Billing Invoices',
  payment_accounts    TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS templates (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS recurring (
  id           TEXT PRIMARY KEY,
  active       INTEGER NOT NULL DEFAULT 1,
  client_name  TEXT NOT NULL DEFAULT '',
  invoice_type TEXT NOT NULL DEFAULT 'tax-invoice',
  next_date    TEXT NOT NULL DEFAULT '',
  frequency    TEXT NOT NULL DEFAULT 'monthly',
  data         TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  action        TEXT NOT NULL,
  payload       TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  current_hash  TEXT NOT NULL,
  timestamp     TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_bills_invoice_date   ON bills(invoice_date);
CREATE INDEX IF NOT EXISTS idx_bills_is_trashed     ON bills(is_trashed);
CREATE INDEX IF NOT EXISTS idx_bills_client_name    ON bills(client_name);
CREATE INDEX IF NOT EXISTS idx_bills_status         ON bills(status);
CREATE INDEX IF NOT EXISTS idx_purchases_date       ON purchases(date);
CREATE INDEX IF NOT EXISTS idx_expenses_date        ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_receipts_date        ON receipts(date);
CREATE INDEX IF NOT EXISTS idx_recurring_active     ON recurring(active);
CREATE INDEX IF NOT EXISTS idx_recurring_next_date  ON recurring(next_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity    ON audit_logs(entity_type, entity_id);
`;

// Execute all CREATE TABLE + CREATE INDEX statements
sqlite.exec(CREATE_TABLES_SQL);

// Re-export schema tables for convenient imports
export {
  bills, clients, products, purchases, expenses,
  receipts, profiles, templates, recurring, meta, auditLogs,
} from './schema.js';

// Export the raw sqlite connection for backup (file copy) operations
export { sqlite, DB_PATH, DATA_DIR };
