// scripts/verify-sqlite.js
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'arth-sutra.sqlite');

const db = new Database(DB_PATH, { readonly: true });

console.log('--- Arth-Sutra SQLite Verification ---');

const tables = ['bills', 'clients', 'products', 'purchases', 'expenses', 'receipts', 'profiles', 'templates', 'recurring', 'meta'];

for (const table of tables) {
  const count = db.prepare(`SELECT count(*) as count FROM ${table}`).get().count;
  console.log(`Table ${table.padEnd(12)}: ${count} rows`);
}

const activeBills = db.prepare('SELECT count(*) as count FROM bills WHERE is_trashed = 0').get().count;
const trashedBills = db.prepare('SELECT count(*) as count FROM bills WHERE is_trashed = 1').get().count;
console.log(`\nActive bills : ${activeBills}`);
console.log(`Trashed bills: ${trashedBills}`);

// Verify a sample bill
const sampleBillRow = db.prepare('SELECT * FROM bills WHERE is_trashed = 0 LIMIT 1').get();
if (sampleBillRow) {
  const parsedData = JSON.parse(sampleBillRow.data);
  console.log(`\nSample Bill ID: ${sampleBillRow.id}`);
  console.log(`Sample Bill Client: ${sampleBillRow.client_name}`);
  console.log(`Sample Bill Total: ${sampleBillRow.total_amount}`);
  console.log(`Sample Bill Parsed Items Count: ${parsedData?.data?.items?.length || 0}`);
}

// Verify a sample product
const sampleProduct = db.prepare('SELECT * FROM products LIMIT 1').get();
if (sampleProduct) {
  console.log(`\nSample Product: ${sampleProduct.name} (Stock: ${sampleProduct.stock}, Rate: ${sampleProduct.rate})`);
}

// Verify meta keys
const metaRows = db.prepare('SELECT key FROM meta').all();
console.log(`\nMeta keys: ${metaRows.map(r => r.key).join(', ')}`);

db.close();
console.log('\n--- Verification Script Completed Successfully ---');
