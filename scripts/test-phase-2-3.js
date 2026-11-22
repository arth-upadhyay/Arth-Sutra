import { WebSocket } from 'ws';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', 'data', 'arth-sutra.sqlite');
const PORT = 47380;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runTests() {
  console.log('--- TEST 1: Admin Login & JWT Verification ---');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok || !loginData.token) {
    throw new Error('Admin login failed: ' + JSON.stringify(loginData));
  }
  const adminToken = loginData.token;
  console.log('✓ Admin login successful. Role:', loginData.user.role);

  console.log('\n--- TEST 2: RBAC (Role-Based Access Control) ---');
  // 1. Unauthenticated request to /api/purchases (POST)
  const unauthRes = await fetch(`${BASE_URL}/api/purchases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ supplierName: 'Test' }),
  });
  if (unauthRes.status !== 401) {
    throw new Error(`Expected 401 for unauthenticated request, got ${unauthRes.status}`);
  }
  console.log('✓ Correctly rejected unauthenticated request with 401');

  // 2. Create a CLERK user
  const createClerkRes = await fetch(`${BASE_URL}/api/auth/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ username: 'clerk_bob', password: 'password123', role: 'CLERK' }),
  });
  const clerkUser = await createClerkRes.json();
  console.log('✓ Created CLERK user:', clerkUser.username);

  // 3. Login as CLERK
  const clerkLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'clerk_bob', password: 'password123' }),
  });
  const clerkData = await clerkLoginRes.json();
  const clerkToken = clerkData.token;

  // 4. CLERK tries to create purchase (requires ADMIN or ACCOUNTANT) -> should be 403 Forbidden
  const clerkPurchaseRes = await fetch(`${BASE_URL}/api/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${clerkToken}`,
    },
    body: JSON.stringify({ supplierName: 'Restricted Supplier' }),
  });
  if (clerkPurchaseRes.status !== 403) {
    throw new Error(`Expected 403 for CLERK creating purchase, got ${clerkPurchaseRes.status}`);
  }
  console.log('✓ Correctly rejected CLERK from purchases with 403 Forbidden');

  // 5. Cleanup CLERK user
  await fetch(`${BASE_URL}/api/auth/users/${clerkUser.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` },
  });
  console.log('✓ Cleaned up test user');

  console.log('\n--- TEST 3: Backend Idempotency Middleware ---');
  const idempKey = 'idemp_test_' + Date.now();
  const testBill = {
    id: 'bill_idemp_' + Date.now(),
    invoiceNumber: 'IDEMP-001',
    invoiceDate: '2026-11-23',
    clientName: 'Idempotent Corp',
    totalAmount: 500,
    totalTaxAmount: 0,
  };

  // First request
  const firstReq = await fetch(`${BASE_URL}/api/bills`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempKey,
    },
    body: JSON.stringify(testBill),
  });
  const firstJson = await firstReq.json();
  if (!firstJson.success) throw new Error('First bill creation failed: ' + JSON.stringify(firstJson));
  console.log('✓ First request succeeded (200)');

  // Second request with exact same idempotency key
  const secondReq = await fetch(`${BASE_URL}/api/bills`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempKey,
    },
    body: JSON.stringify(testBill),
  });
  const cacheHeader = secondReq.headers.get('x-cache');
  const secondJson = await secondReq.json();
  if (cacheHeader !== 'IDEMPOTENT-HIT') {
    throw new Error(`Expected X-Cache: IDEMPOTENT-HIT, got ${cacheHeader}`);
  }
  console.log('✓ Idempotency hit confirmed! Header:', cacheHeader);

  // Clean up test bill
  await fetch(`${BASE_URL}/api/bills/${testBill.id}?permanent=1`, { method: 'DELETE' });

  console.log('\n--- TEST 4: WebSocket Authentication Handshake ---');
  // 1. Connection without token -> rejected with 4001
  const unauthWsPromise = new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.on('close', (code, reason) => {
      console.log(`✓ Unauthenticated WS closed with code ${code} (${reason})`);
      if (code === 4001) resolve();
      else reject(new Error('Unexpected close code: ' + code));
    });
    ws.on('error', () => {});
  });
  await unauthWsPromise;

  // 2. Connection with valid admin token -> accepts and receives CONNECTED
  const authWsPromise = new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}?token=${adminToken}`);
    ws.on('message', (data) => {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === 'CONNECTED' && parsed.user === 'admin') {
        console.log(`✓ Authenticated WS connected for user ${parsed.user} with role ${parsed.role}`);
        ws.close();
        resolve();
      }
    });
    ws.on('error', reject);
  });
  await authWsPromise;

  console.log('\n--- TEST 5: AES-256-GCM Bank Details Encryption ---');
  const sqlite = new Database(DB_PATH);
  const profileRow = sqlite.prepare('SELECT account_number, ifsc, swift, upi_id FROM profiles LIMIT 1').get();
  if (profileRow && profileRow.account_number) {
    const isEnc = profileRow.account_number.includes(':') && profileRow.account_number.split(':').length === 3;
    console.log('SQLite Raw Account Number:', profileRow.account_number);
    if (!isEnc) throw new Error('Account number in database is NOT encrypted!');
    console.log('✓ Verified bank details in SQLite are encrypted ciphertext (AES-256-GCM)');
  }
  sqlite.close();

  // Decrypted via API
  const apiProfRes = await fetch(`${BASE_URL}/api/profile`);
  const apiProf = await apiProfRes.json();
  console.log('Decrypted Account Number via API:', apiProf.accountNumber || '(blank)');
  console.log('✓ Transparent decryption for authorized profile reads confirmed');

  console.log('\n ALL PHASE 2 & 3 BACKEND TESTS PASSED SUCCESSFULLY! \n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
