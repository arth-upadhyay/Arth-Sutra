import { WebSocket } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT_FILE = path.join(process.cwd(), 'data', 'port.txt');
let port = 47380;
try {
  if (fs.existsSync(PORT_FILE)) {
    port = parseInt(fs.readFileSync(PORT_FILE, 'utf-8').trim(), 10) || 47380;
  }
} catch { /* ignore */ }

console.log(`Testing against server at port ${port}...`);

async function runTests() {
  // Test 1: WebSocket connection
  console.log('\n--- TEST 1: WebSocket Connection & Real-Time Sync ---');
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);

  const eventsReceived = [];

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket connection timed out')), 5000);
    ws.on('open', () => {
      console.log('✓ Connected to WebSocket server');
    });
    ws.on('message', (msg) => {
      const parsed = JSON.parse(msg.toString());
      console.log('  WS Message Received:', parsed.type);
      eventsReceived.push(parsed);
      if (parsed.type === 'CONNECTED') {
        clearTimeout(timeout);
        resolve();
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Test 2: Trigger mutation and check if WebSocket event is received
  console.log('\n--- TEST 2: Trigger Bill Creation and Verify WS Broadcast ---');
  const testBill = {
    id: 'test_ws_' + Date.now(),
    invoiceNumber: 'WS-INV-' + Math.floor(Math.random() * 10000),
    invoiceDate: '2026-11-23',
    clientName: 'WebSocket Test Client',
    totalAmount: 1180,
    totalTaxAmount: 180,
    items: [
      { name: 'Testing Item', quantity: 1, rate: 1000, taxPercent: 18 }
    ],
  };

  const billCreatedPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Bill created broadcast timed out')), 5000);
    const handler = (msg) => {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'BILL_CREATED' && parsed.data?.id === testBill.id) {
        console.log(`✓ Received BILL_CREATED broadcast for ${testBill.id}`);
        clearTimeout(timeout);
        ws.off('message', handler);
        resolve(parsed);
      }
    };
    ws.on('message', handler);
  });

  // Post invoice to API
  const createRes = await fetch(`http://127.0.0.1:${port}/api/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testBill),
  });
  const createJson = await createRes.json();
  if (!createJson.success) throw new Error('Failed to create bill: ' + JSON.stringify(createJson));
  console.log('✓ Bill created via API');

  await billCreatedPromise;

  // Cleanup test bill
  await fetch(`http://127.0.0.1:${port}/api/bills/${testBill.id}?permanent=1`, {
    method: 'DELETE',
  });
  console.log('✓ Cleaned up test bill');

  // Test 3: GSTR-2B Reconciliation API
  console.log('\n--- TEST 3: AI-Powered GSTR-2B Reconciliation API ---');

  // First create a purchase record to test matching
  const testPurchase = {
    id: 'pur_recon_' + Date.now(),
    invoiceNumber: 'INV/2026/901',
    supplierGstin: '27AABCU9603R1ZM',
    supplierName: 'Tata Electronics Ltd',
    date: '2026-10-15',
    totalAmount: 59000,
    totalTax: 9000,
    taxableAmount: 50000,
    items: [{ name: 'Components', quantity: 50, rate: 1000, taxPercent: 18 }],
  };

  await fetch(`http://127.0.0.1:${port}/api/purchases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testPurchase),
  });
  console.log('✓ Seeded local purchase for recon');

  // Sample GSTR-2B JSON payload
  const sampleGstr2b = {
    gstin: '27ABCDE1234F1Z5',
    fp: '102026',
    data: {
      docdata: {
        b2b: [
          {
            ctin: '27AABCU9603R1ZM',
            trdnm: 'Tata Electronics Private Limited',
            inv: [
              {
                // Fuzzy variation: "INV-2026-901" vs "INV/2026/901"
                inum: 'INV-2026-901',
                dt: '15-10-2026',
                val: 59000,
                itcavl: 'Y',
                items: [
                  { txval: 50000, igst: 9000, cgst: 0, sgst: 0, cess: 0 }
                ]
              },
              {
                // In 2B but missing in our books
                inum: 'INV-EXTRA-002',
                dt: '20-10-2026',
                val: 11800,
                itcavl: 'Y',
                items: [
                  { txval: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0 }
                ]
              }
            ]
          }
        ]
      }
    }
  };

  const reconRes = await fetch(`http://127.0.0.1:${port}/api/recon/gstr2b`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sampleGstr2b),
  });

  const reconData = await reconRes.json();
  console.log('Recon summary:', JSON.stringify(reconData.summary, null, 2));

  if (!reconData.success) throw new Error('Reconciliation API failed');
  if (reconData.buckets.perfectMatch.length === 0) {
    throw new Error('Expected at least 1 perfectMatch from fuzzy matching');
  }
  console.log('✓ Fuzzy matched purchase:', reconData.buckets.perfectMatch[0].invoiceNumber, 'matched with book:', reconData.buckets.perfectMatch[0].bookInvoiceNumber);

  if (reconData.buckets.missingInOurBooks.length === 0) {
    throw new Error('Expected missingInOurBooks item');
  }
  console.log('✓ Identified missing in books:', reconData.buckets.missingInOurBooks[0].invoiceNumber);

  // Clean up test purchase
  await fetch(`http://127.0.0.1:${port}/api/purchases/${testPurchase.id}`, {
    method: 'DELETE',
  });
  console.log('✓ Cleaned up test purchase');

  ws.close();
  console.log('\n ALL BACKEND TESTS PASSED SUCCESSFULLY! \n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
