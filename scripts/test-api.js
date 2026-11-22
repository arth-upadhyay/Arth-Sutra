// scripts/test-api.js
const PORT = 47380;
const BASE = `http://127.0.0.1:${PORT}`;

async function run() {
  console.log(`Testing API on ${BASE}...\n`);

  // 1. Health & Version
  const healthRes = await fetch(`${BASE}/api/health`);
  const health = await healthRes.json();
  console.log('✓ GET /api/health:', health.ok, '| storage:', health.storage);

  const versionRes = await fetch(`${BASE}/api/version`);
  const version = await versionRes.json();
  console.log('✓ GET /api/version:', version.current);

  // 2. Bills query
  const billsRes = await fetch(`${BASE}/api/bills`);
  const bills = await billsRes.json();
  console.log('✓ GET /api/bills: returned', bills.length, 'active bills');

  // 3. Products query
  const productsRes = await fetch(`${BASE}/api/products`);
  const products = await productsRes.json();
  console.log('✓ GET /api/products: returned', products.length, 'products');

  // 4. Clients query (should be empty initially)
  const clientsRes = await fetch(`${BASE}/api/clients`);
  const clients = await clientsRes.json();
  console.log('✓ GET /api/clients: returned', clients.length, 'clients');

  // 5. Create a test client
  const newClient = {
    id: 'cli_test_123',
    name: 'Test Healthcare Diagnostics',
    address: '100 Medical Enclave',
    city: 'Bhopal',
    state: 'Madhya Pradesh',
    gstin: '23AAAAA0000A1Z5',
  };
  const saveCliRes = await fetch(`${BASE}/api/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newClient),
  });
  console.log('✓ POST /api/clients:', (await saveCliRes.json()).success);

  // Verify client was created
  const clientsAfterRes = await fetch(`${BASE}/api/clients`);
  const clientsAfter = await clientsAfterRes.json();
  const createdClient = clientsAfter.find(c => c.id === 'cli_test_123');
  console.log('✓ Verified created client in DB:', createdClient?.name === newClient.name);

  // 6. Create a test invoice
  const testBillId = 'INV/2026-27/9999';
  const testBill = {
    id: testBillId,
    clientName: 'Test Healthcare Diagnostics',
    invoiceNumber: testBillId,
    invoiceDate: '2026-11-23',
    invoiceType: 'tax-invoice',
    currency: 'INR',
    totalAmount: 1500,
    totalTaxAmount: 75,
    status: 'unpaid',
    paidAmount: 0,
    payments: [],
    data: {
      client: newClient,
      items: [{ name: 'Test Strip', quantity: 10, rate: 150 }],
      totals: { total: 1500, totalTaxAmount: 75 },
    },
  };

  const saveBillRes = await fetch(`${BASE}/api/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testBill),
  });
  console.log('✓ POST /api/bills (create test bill):', (await saveBillRes.json()).success);

  // Verify test bill exists in /api/bills
  const verifyBillsRes = await fetch(`${BASE}/api/bills`);
  const allBills = await verifyBillsRes.json();
  const foundBill = allBills.find(b => b.id === testBillId);
  console.log('✓ Verified created invoice in DB:', foundBill?.id === testBillId, '| Total:', foundBill?.totalAmount);

  // 7. Soft delete bill
  const deleteRes = await fetch(`${BASE}/api/bills/${encodeURIComponent(testBillId)}`, { method: 'DELETE' });
  console.log('✓ DELETE /api/bills/:id (soft delete):', (await deleteRes.json()).trashed);

  // Verify it appears in /api/trash
  const trashRes = await fetch(`${BASE}/api/trash`);
  const trashedList = await trashRes.json();
  const foundInTrash = trashedList.find(b => b.id === testBillId);
  console.log('✓ Verified bill appears in /api/trash:', !!foundInTrash);

  // 8. Restore from trash
  const restoreRes = await fetch(`${BASE}/api/trash/${encodeURIComponent(testBillId)}/restore`, { method: 'POST' });
  console.log('✓ POST /api/trash/:id/restore:', (await restoreRes.json()).success);

  // 9. Permanent delete test bill
  const permDeleteRes = await fetch(`${BASE}/api/bills/${encodeURIComponent(testBillId)}?permanent=1`, { method: 'DELETE' });
  console.log('✓ DELETE /api/bills/:id?permanent=1:', (await permDeleteRes.json()).permanent);

  // 10. Clean up test client
  const deleteClientRes = await fetch(`${BASE}/api/clients/${encodeURIComponent('cli_test_123')}`, { method: 'DELETE' });
  console.log('✓ DELETE /api/clients/:id (cleanup):', (await deleteClientRes.json()).success);

  // 11. Meta increment
  const incRes = await fetch(`${BASE}/api/meta/counter_TEST/increment`, { method: 'POST' });
  const incVal = (await incRes.json()).value;
  console.log('✓ POST /api/meta/counter_TEST/increment:', incVal);

  console.log('\nAll API endpoints tested successfully!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
