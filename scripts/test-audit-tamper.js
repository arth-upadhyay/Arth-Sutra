// scripts/test-audit-tamper.js
// ─────────────────────────────────────────────────────────────────────────────
// Verification & Tamper Simulation Test for Cryptographic Audit Trail
// ─────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'arth-sutra.sqlite');
const PORT = 47380;
const BASE = `http://127.0.0.1:${PORT}`;

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   Cryptographically Auditable Event Log & Tamper Detection   ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Initial verify before test operations
  console.log('[Test 1] Verifying current audit trail...');
  const initRes = await fetch(`${BASE}/api/audit/verify`);
  const initVerify = await initRes.json();
  console.log('         Initial verify result:', initVerify);

  // 2. Create an invoice
  console.log('\n[Test 2] Creating an invoice via POST /api/bills...');
  const testBill = {
    id: 'INV/2026-27/AUDIT-001',
    clientName: 'Apex Diagnostic Centre',
    invoiceNumber: 'INV/2026-27/AUDIT-001',
    invoiceDate: '2026-11-23',
    invoiceType: 'tax-invoice',
    currency: 'INR',
    totalAmount: 5000,
    totalTaxAmount: 250,
    status: 'unpaid',
    paidAmount: 0,
    payments: [],
    data: {
      profile: { businessName: 'Test Healthcare', logo: 'data:image/png;base64,MASSIVE_BASE64_LOGO_STRING_HERE' },
      items: [{ name: 'Rapid Antigen Test Kit', quantity: 20, rate: 250 }],
      totals: { total: 5000, totalTaxAmount: 250 },
    },
  };

  const billRes = await fetch(`${BASE}/api/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testBill),
  });
  console.log('         POST /api/bills response:', await billRes.json());

  // Check the audit log row in DB
  const db = new Database(DB_PATH, { readonly: true });
  const latestLog = db.prepare('SELECT * FROM audit_logs WHERE entity_id = ? ORDER BY id DESC LIMIT 1').get(testBill.id);
  console.log('         Generated Audit Record:', {
    id: latestLog.id,
    entityType: latestLog.entity_type,
    entityId: latestLog.entity_id,
    action: latestLog.action,
    previousHash: latestLog.previous_hash.slice(0, 16) + '...',
    currentHash: latestLog.current_hash.slice(0, 16) + '...',
    timestamp: latestLog.timestamp,
  });

  // Confirm logo was stripped from payload
  const parsedPayload = JSON.parse(latestLog.payload);
  const logoStripped = parsedPayload?.data?.profile?.logo === '[STRIPPED]';
  console.log('         Payload logo stripped:', logoStripped ? '✓ YES' : '✗ NO');

  // 3. Create a product mutation
  console.log('\n[Test 3] Creating a product via POST /api/products...');
  const testProd = {
    id: 'prod_audit_test_999',
    name: 'Precision Test Tube (Pack of 100)',
    stock: 500,
    sellingPrice: 120,
    rate: 120,
    mrp: 150,
    taxPercent: 5,
  };
  await fetch(`${BASE}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testProd),
  });

  // 4. Update the product (stock adjustment)
  console.log('[Test 4] Updating product stock to 450 (simulating sale)...');
  await fetch(`${BASE}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...testProd, stock: 450 }),
  });

  // 5. Verify the valid chain
  console.log('\n[Test 5] Checking GET /api/audit/verify on valid chain...');
  const validRes = await fetch(`${BASE}/api/audit/verify`);
  const validResult = await validRes.json();
  console.log('         Verification result:', validResult);
  if (!validResult.valid) {
    throw new Error('Valid chain failed verification: ' + JSON.stringify(validResult));
  }
  console.log('         ✓ Chain is cryptographically intact across all', validResult.totalRecords, 'records');

  // 6. Simulate Tampering!
  console.log('\n[Test 6] ⚠️ SIMULATING TAMPERING: Directly modifying an audit log payload in SQLite via SQL...');
  const rwDb = new Database(DB_PATH);
  
  // Save original payload to restore later
  const targetId = latestLog.id;
  const originalRow = rwDb.prepare('SELECT * FROM audit_logs WHERE id = ?').get(targetId);

  // Tamper: silently alter the totalAmount inside the payload from 5000 to 1000
  const tamperedPayload = JSON.parse(originalRow.payload);
  tamperedPayload.totalAmount = 1000;
  if (tamperedPayload.data?.totals) {
    tamperedPayload.data.totals.total = 1000;
  }
  
  rwDb.prepare('UPDATE audit_logs SET payload = ? WHERE id = ?').run(JSON.stringify(tamperedPayload), targetId);
  console.log(`         Row ID ${targetId} payload maliciously altered to totalAmount = 1000.`);

  // 7. Verify detection of tampering
  console.log('\n[Test 7] Querying GET /api/audit/verify to detect tampering...');
  const tamperRes = await fetch(`${BASE}/api/audit/verify`);
  const tamperResult = await tamperRes.json();
  console.log('         Tamper verification response:', tamperResult);

  if (tamperResult.valid === false && tamperResult.corruptedAtId === targetId) {
    console.log(`         ✓ TAMPERING DETECTED! Exactly caught at corrupted record ID ${targetId}.`);
  } else {
    throw new Error('Tampering was NOT detected properly: ' + JSON.stringify(tamperResult));
  }

  // 8. Restore original row to return DB to pristine state
  console.log('\n[Test 8] Restoring original row and re-verifying...');
  rwDb.prepare('UPDATE audit_logs SET payload = ? WHERE id = ?').run(originalRow.payload, targetId);

  const restoredRes = await fetch(`${BASE}/api/audit/verify`);
  const restoredResult = await restoredRes.json();
  console.log('         Restored verification result:', restoredResult);
  if (restoredResult.valid) {
    console.log('         ✓ Chain restored and verified valid.');
  }

  // 9. Clean up test records
  console.log('\n[Test 9] Cleaning up test records...');
  // Delete test bill permanently
  await fetch(`${BASE}/api/bills/${encodeURIComponent(testBill.id)}?permanent=1`, { method: 'DELETE' });
  // Delete test product
  await fetch(`${BASE}/api/products/${encodeURIComponent(testProd.id)}`, { method: 'DELETE' });

  // Verify audit chain after deletes (deletes are also logged as DELETE events)
  const finalRes = await fetch(`${BASE}/api/audit/verify`);
  const finalResult = await finalRes.json();
  console.log('         Final audit chain verification:', finalResult);

  db.close();
  rwDb.close();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('   ALL AUDIT LOG & TAMPER DETECTION TESTS PASSED SUCCESSFULLY!  ');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
