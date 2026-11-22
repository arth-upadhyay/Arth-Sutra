// scripts/migrate-json-to-sqlite.js
// ─────────────────────────────────────────────────────────────────────────────
// One-shot migration: reads every JSON file from data/ and inserts it into the
// SQLite database.  The ENTIRE migration runs inside a single SQLite
// transaction — if anything fails, the database is untouched and the original
// JSON files remain the source of truth.
//
// SAFETY:  Before touching anything, copies data/ → data_backup_<timestamp>/
//          so the user can always roll back manually.
//
// Usage:   node scripts/migrate-json-to-sqlite.js
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'arth-sutra.sqlite');

// ── Helpers ────────────────────────────────────────────────────────────────

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readAllJSON(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.json'))
    .map(f => readJSON(path.join(dirPath, f)))
    .filter(Boolean);
}

function copyDirRecursive(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ── Step 1: Backup ─────────────────────────────────────────────────────────

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP_DIR = path.join(PROJECT_ROOT, `data_backup_${timestamp}`);

console.log(`\n  ╔═══════════════════════════════════════════════════╗`);
console.log(`  ║   ArthSutra — JSON → SQLite Migration Script     ║`);
console.log(`  ╚═══════════════════════════════════════════════════╝\n`);

console.log(`  [1/3] Backing up data/ → ${path.basename(BACKUP_DIR)}/`);

// Only backup if data dir has content beyond the sqlite db
if (fs.existsSync(DATA_DIR)) {
  copyDirRecursive(DATA_DIR, BACKUP_DIR);
  console.log(`        ✓ Backup complete (${BACKUP_DIR})`);
} else {
  console.log(`        ⚠ No data/ directory found — nothing to migrate.`);
  process.exit(0);
}

// ── Step 2: Initialise SQLite ──────────────────────────────────────────────

console.log(`\n  [2/3] Initialising SQLite database...`);

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('foreign_keys = ON');

// Create tables (same SQL as db/index.js)
sqlite.exec(`
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
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '', pin TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '', is_sez INTEGER NOT NULL DEFAULT 0, licence TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', hsn TEXT NOT NULL DEFAULT '',
  purchase_price REAL NOT NULL DEFAULT 0, selling_price REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0, mrp REAL NOT NULL DEFAULT 0,
  tax_percent REAL NOT NULL DEFAULT 0, cess_percent REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '', stock REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '', pkg TEXT NOT NULL DEFAULT '',
  batches TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY, date TEXT NOT NULL DEFAULT '', supplier_name TEXT NOT NULL DEFAULT '',
  supplier_address TEXT NOT NULL DEFAULT '', supplier_gstin TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL DEFAULT '', total_amount REAL NOT NULL DEFAULT 0,
  total_tax REAL NOT NULL DEFAULT 0, taxable_amount REAL NOT NULL DEFAULT 0,
  apply_round_off INTEGER NOT NULL DEFAULT 0, round_off REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'Unpaid', interstate INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', items TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY, date TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0,
  gst_amount REAL NOT NULL DEFAULT 0, gst_percent REAL NOT NULL DEFAULT 0,
  vendor_name TEXT NOT NULL DEFAULT '', vendor_gstin TEXT NOT NULL DEFAULT '',
  invoice_no TEXT NOT NULL DEFAULT '', payment_mode TEXT NOT NULL DEFAULT '',
  interstate INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY, date TEXT NOT NULL DEFAULT '', receipt_no TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '', client_address TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0, payment_mode TEXT NOT NULL DEFAULT '',
  reference_no TEXT NOT NULL DEFAULT '', against_invoice TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'INR',
  source TEXT NOT NULL DEFAULT '', bill_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, business_name TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '', pin TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '', gstin TEXT NOT NULL DEFAULT '', pan TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '', account_number TEXT NOT NULL DEFAULT '',
  ifsc TEXT NOT NULL DEFAULT '', swift TEXT NOT NULL DEFAULT '',
  logo TEXT NOT NULL DEFAULT '', signature TEXT NOT NULL DEFAULT '',
  upi_id TEXT NOT NULL DEFAULT '', google_client_id TEXT NOT NULL DEFAULT '',
  google_drive_folder TEXT NOT NULL DEFAULT 'GST Billing Invoices',
  payment_accounts TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS recurring (
  id TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1, client_name TEXT NOT NULL DEFAULT '',
  invoice_type TEXT NOT NULL DEFAULT 'tax-invoice', next_date TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL DEFAULT 'monthly', data TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_bills_invoice_date ON bills(invoice_date);
CREATE INDEX IF NOT EXISTS idx_bills_is_trashed ON bills(is_trashed);
CREATE INDEX IF NOT EXISTS idx_bills_client_name ON bills(client_name);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date);
CREATE INDEX IF NOT EXISTS idx_recurring_active ON recurring(active);
CREATE INDEX IF NOT EXISTS idx_recurring_next_date ON recurring(next_date);
`);

console.log(`        ✓ Tables created at ${DB_PATH}`);

// ── Step 3: Migrate data inside a single transaction ───────────────────────

console.log(`\n  [3/3] Migrating JSON data into SQLite (single transaction)...\n`);

// Prepare all INSERT statements (using INSERT OR REPLACE for idempotency)
const insertBill = sqlite.prepare(`
  INSERT OR REPLACE INTO bills
    (id, client_name, invoice_number, invoice_date, invoice_type, currency,
     total_amount, total_tax_amount, status, paid_amount, printed_count,
     last_printed_at, generated_from, auto_generated, auto_generated_at,
     is_trashed, trashed_at, data)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertClient = sqlite.prepare(`
  INSERT OR REPLACE INTO clients
    (id, name, address, city, pin, state, gstin, country, email, phone, is_sez, licence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertProduct = sqlite.prepare(`
  INSERT OR REPLACE INTO products
    (id, name, hsn, purchase_price, selling_price, rate, mrp,
     tax_percent, cess_percent, unit, stock, description, pkg, batches)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertPurchase = sqlite.prepare(`
  INSERT OR REPLACE INTO purchases
    (id, date, supplier_name, supplier_address, supplier_gstin,
     invoice_number, total_amount, total_tax, taxable_amount,
     apply_round_off, round_off, payment_status, interstate, note, items)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertExpense = sqlite.prepare(`
  INSERT OR REPLACE INTO expenses
    (id, date, description, category, amount, gst_amount, gst_percent,
     vendor_name, vendor_gstin, invoice_no, payment_mode, interstate, note)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertReceipt = sqlite.prepare(`
  INSERT OR REPLACE INTO receipts
    (id, date, receipt_no, client_name, client_address, amount,
     payment_mode, reference_no, against_invoice, note, currency, source, bill_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertProfile = sqlite.prepare(`
  INSERT OR REPLACE INTO profiles
    (id, business_name, address, city, pin, state, country, gstin, pan,
     email, phone, bank_name, account_number, ifsc, swift, logo, signature,
     upi_id, google_client_id, google_drive_folder, payment_accounts)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertTemplate = sqlite.prepare(`
  INSERT OR REPLACE INTO templates (id, name, content) VALUES (?, ?, ?)
`);

const insertRecurring = sqlite.prepare(`
  INSERT OR REPLACE INTO recurring (id, active, client_name, invoice_type, next_date, frequency, data)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertMeta = sqlite.prepare(`
  INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)
`);

// ── Wrap the entire migration in a single transaction ──────────────────────

const counts = {
  bills: 0, trashedBills: 0, clients: 0, products: 0, purchases: 0,
  expenses: 0, receipts: 0, profiles: 0, templates: 0, recurring: 0, meta: 0,
};

const migrateAll = sqlite.transaction(() => {

  // ── Trashed Bills (processed first so active bills take precedence) ─
  const trashDir = path.join(DATA_DIR, 'trash');
  if (fs.existsSync(trashDir)) {
    for (const f of fs.readdirSync(trashDir).filter(n => n.endsWith('.json'))) {
      const filePath = path.join(trashDir, f);
      const bill = readJSON(filePath);
      if (!bill || !bill.id) continue;
      // Get file mtime for trashedAt
      let trashedAt = null;
      try {
        const stat = fs.statSync(filePath);
        trashedAt = stat.mtime.toISOString();
      } catch { /* ignore */ }
      insertBill.run(
        bill.id,
        bill.clientName || '',
        bill.invoiceNumber || bill.id,
        bill.invoiceDate || '',
        bill.invoiceType || 'tax-invoice',
        bill.currency || 'INR',
        bill.totalAmount || 0,
        bill.totalTaxAmount || 0,
        bill.status || 'unpaid',
        bill.paidAmount || 0,
        bill.printedCount || 0,
        bill.lastPrintedAt || null,
        bill.generatedFrom || null,
        bill.autoGenerated ? 1 : 0,
        bill.autoGeneratedAt || null,
        1, // isTrashed = true
        trashedAt,
        JSON.stringify(bill),
      );
      counts.trashedBills++;
    }
  }

  // ── Bills (active - authoritative, overwrites any stale trashed versions) ──
  for (const bill of readAllJSON(path.join(DATA_DIR, 'bills'))) {
    if (!bill.id) continue;
    insertBill.run(
      bill.id,
      bill.clientName || '',
      bill.invoiceNumber || bill.id,
      bill.invoiceDate || '',
      bill.invoiceType || 'tax-invoice',
      bill.currency || 'INR',
      bill.totalAmount || 0,
      bill.totalTaxAmount || 0,
      bill.status || 'unpaid',
      bill.paidAmount || 0,
      bill.printedCount || 0,
      bill.lastPrintedAt || null,
      bill.generatedFrom || null,
      bill.autoGenerated ? 1 : 0,
      bill.autoGeneratedAt || null,
      0, // isTrashed = false
      null, // trashedAt
      JSON.stringify(bill),
    );
    counts.bills++;
  }

  // ── Clients ──────────────────────────────────────────────────────────
  for (const c of readAllJSON(path.join(DATA_DIR, 'clients'))) {
    if (!c.id) continue;
    insertClient.run(
      c.id, c.name || '', c.address || '', c.city || '', c.pin || '',
      c.state || '', c.gstin || '', c.country || '', c.email || '',
      c.phone || '', c.isSEZ ? 1 : 0, c.licence || '',
    );
    counts.clients++;
  }

  // ── Products ─────────────────────────────────────────────────────────
  for (const p of readAllJSON(path.join(DATA_DIR, 'products'))) {
    if (!p.id) continue;
    insertProduct.run(
      p.id, p.name || '', p.hsn || '',
      p.purchasePrice || 0, p.sellingPrice || 0, p.rate || 0, p.mrp || 0,
      p.taxPercent || 0, p.cessPercent || 0, p.unit || '',
      p.stock || 0, p.description || '', p.pkg || '',
      JSON.stringify(p.batches || []),
    );
    counts.products++;
  }

  // ── Purchases ────────────────────────────────────────────────────────
  for (const p of readAllJSON(path.join(DATA_DIR, 'purchases'))) {
    if (!p.id) continue;
    insertPurchase.run(
      p.id, p.date || '', p.supplierName || '', p.supplierAddress || '',
      p.supplierGstin || '', p.invoiceNumber || '',
      p.totalAmount || 0, p.totalTax || 0, p.taxableAmount || 0,
      p.applyRoundOff ? 1 : 0, p.roundOff || 0,
      p.paymentStatus || 'Unpaid', p.interstate ? 1 : 0, p.note || '',
      JSON.stringify(p.items || []),
    );
    counts.purchases++;
  }

  // ── Expenses ─────────────────────────────────────────────────────────
  for (const e of readAllJSON(path.join(DATA_DIR, 'expenses'))) {
    if (!e.id) continue;
    insertExpense.run(
      e.id, e.date || '', e.description || '', e.category || '',
      e.amount || 0, e.gstAmount || 0, e.gstPercent || 0,
      e.vendorName || '', e.vendorGstin || '', e.invoiceNo || '',
      e.paymentMode || '', e.interstate ? 1 : 0, e.note || '',
    );
    counts.expenses++;
  }

  // ── Receipts ─────────────────────────────────────────────────────────
  for (const r of readAllJSON(path.join(DATA_DIR, 'receipts'))) {
    if (!r.id) continue;
    insertReceipt.run(
      r.id, r.date || '', r.receiptNo || '', r.clientName || '',
      r.clientAddress || '', r.amount || 0, r.paymentMode || '',
      r.referenceNo || '', r.againstInvoice || '', r.note || '',
      r.currency || 'INR', r.source || '', r.billId || '',
    );
    counts.receipts++;
  }

  // ── Profiles (multi-business) ────────────────────────────────────────
  for (const p of readAllJSON(path.join(DATA_DIR, 'profiles'))) {
    if (!p.id) continue;
    insertProfile.run(
      p.id, p.businessName || '', p.address || '', p.city || '',
      p.pin || '', p.state || '', p.country || '', p.gstin || '',
      p.pan || '', p.email || '', p.phone || '', p.bankName || '',
      p.accountNumber || '', p.ifsc || '', p.swift || '', p.logo || '',
      p.signature || '', p.upiId || '', p.googleClientId || '',
      p.googleDriveFolder || 'GST Billing Invoices',
      JSON.stringify(p.paymentAccounts || []),
    );
    counts.profiles++;
  }

  // ── Default Profile (singleton profile.json → meta table) ────────────
  const defaultProfile = readJSON(path.join(DATA_DIR, 'profile.json'));
  if (defaultProfile) {
    insertMeta.run('profile', JSON.stringify(defaultProfile));
    counts.meta++;
  }

  // ── Templates ────────────────────────────────────────────────────────
  for (const t of readAllJSON(path.join(DATA_DIR, 'templates'))) {
    if (!t.id) continue;
    insertTemplate.run(t.id, t.name || '', t.content || '');
    counts.templates++;
  }

  // ── Recurring ────────────────────────────────────────────────────────
  for (const r of readAllJSON(path.join(DATA_DIR, 'recurring'))) {
    if (!r.id) continue;
    insertRecurring.run(
      r.id,
      r.active !== false ? 1 : 0,
      r.clientName || '',
      r.invoiceType || 'tax-invoice',
      r.nextDate || '',
      r.frequency || 'monthly',
      JSON.stringify(r),
    );
    counts.recurring++;
  }

  // ── Meta (counters + settings from meta.json) ────────────────────────
  const metaObj = readJSON(path.join(DATA_DIR, 'meta.json'));
  if (metaObj) {
    for (const [key, value] of Object.entries(metaObj)) {
      // Store each top-level key as a separate row
      insertMeta.run(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      counts.meta++;
    }
  }
});

// ── Execute the transaction ────────────────────────────────────────────────
try {
  migrateAll();
  console.log(`        ✓ Migration successful!`);
  console.log(`\n  ┌─────────────────────────────────────────┐`);
  console.log(`  │  Bills (active):   ${String(counts.bills).padStart(5)}                │`);
  console.log(`  │  Bills (trashed):  ${String(counts.trashedBills).padStart(5)}                │`);
  console.log(`  │  Clients:          ${String(counts.clients).padStart(5)}                │`);
  console.log(`  │  Products:         ${String(counts.products).padStart(5)}                │`);
  console.log(`  │  Purchases:        ${String(counts.purchases).padStart(5)}                │`);
  console.log(`  │  Expenses:         ${String(counts.expenses).padStart(5)}                │`);
  console.log(`  │  Receipts:         ${String(counts.receipts).padStart(5)}                │`);
  console.log(`  │  Profiles:         ${String(counts.profiles).padStart(5)}                │`);
  console.log(`  │  Templates:        ${String(counts.templates).padStart(5)}                │`);
  console.log(`  │  Recurring:        ${String(counts.recurring).padStart(5)}                │`);
  console.log(`  │  Meta keys:        ${String(counts.meta).padStart(5)}                │`);
  console.log(`  └─────────────────────────────────────────┘`);
  console.log(`\n  Database: ${DB_PATH}`);
  console.log(`  Backup:   ${BACKUP_DIR}\n`);
} catch (err) {
  console.error(`\n  ✗ Migration FAILED — database was NOT modified.`);
  console.error(`    Error: ${err.message}`);
  console.error(`    Your JSON data is intact in: ${DATA_DIR}`);
  console.error(`    Backup copy at: ${BACKUP_DIR}\n`);
  process.exit(1);
} finally {
  sqlite.close();
}
