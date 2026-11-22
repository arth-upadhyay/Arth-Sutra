// plugins/tally-export.js
// Tally ERP XML Export Plugin for Arth-Sutra
// Generates Tally-compatible XML (Sales Voucher) for import into TallyPrime and Tally.ERP 9.

import { db, sqlite, bills } from '../db/index.js';
import { eq } from 'drizzle-orm';

function escapeXml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDateForTally(dateStr) {
  if (!dateStr) {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }
  const clean = String(dateStr).trim().split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[0]}${parts[1].padStart(2, '0')}${parts[2].padStart(2, '0')}`;
  }
  return clean.replace(/-/g, '');
}

export function generateTallyXml(bill) {
  const invoiceNo = escapeXml(bill.invoiceNumber || 'INV-001');
  const invoiceDate = formatDateForTally(bill.invoiceDate);
  const partyName = escapeXml(bill.clientName || 'Cash / Counter Sale');
  const placeOfSupply = escapeXml(bill.clientState || bill.placeOfSupply || 'State');
  const gstin = escapeXml(bill.clientGstin || '');
  const totalAmount = Number(bill.totalAmount || 0).toFixed(2);
  const totalTax = Number(bill.totalTaxAmount || 0).toFixed(2);
  const taxableAmount = (Number(totalAmount) - Number(totalTax)).toFixed(2);

  // Compute CGST, SGST, IGST breakdown if available
  const cgstAmount = Number(bill.cgstAmount || (Number(bill.cgst) || 0)).toFixed(2);
  const sgstAmount = Number(bill.sgstAmount || (Number(bill.sgst) || 0)).toFixed(2);
  const igstAmount = Number(bill.igstAmount || (Number(bill.igst) || 0)).toFixed(2);

  const items = Array.isArray(bill.items) ? bill.items : [];

  let inventoryEntriesXml = '';
  if (items.length > 0) {
    inventoryEntriesXml = items.map((item, idx) => {
      const itemName = escapeXml(item.name || `Item ${idx + 1}`);
      const qty = Number(item.quantity || item.qty || 1);
      const unit = escapeXml(item.unit || 'NOS');
      const rate = Number(item.rate || item.price || 0).toFixed(2);
      const amount = Number(item.amount || (qty * rate)).toFixed(2);

      return `
              <ALLINVENTORYENTRIES.LIST>
                <STOCKITEMNAME>${itemName}</STOCKITEMNAME>
                <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                <RATE>${rate}/${unit}</RATE>
                <ACTUALQTY>${qty} ${unit}</ACTUALQTY>
                <BILLEDQTY>${qty} ${unit}</BILLEDQTY>
                <AMOUNT>${amount}</AMOUNT>
                <BATCHALLOCATIONS.LIST>
                  <GODOWNNAME>Main Location</GODOWNNAME>
                  <BATCHNAME>${escapeXml(item.batch || 'Primary')}</BATCHNAME>
                  <AMOUNT>${amount}</AMOUNT>
                  <ACTUALQTY>${qty} ${unit}</ACTUALQTY>
                  <BILLEDQTY>${qty} ${unit}</BILLEDQTY>
                </BATCHALLOCATIONS.LIST>
              </ALLINVENTORYENTRIES.LIST>`;
    }).join('');
  }

  // Tax ledgers XML
  let taxLedgersXml = '';
  if (Number(cgstAmount) > 0) {
    taxLedgersXml += `
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>CGST Input/Output</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${cgstAmount}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`;
  }
  if (Number(sgstAmount) > 0) {
    taxLedgersXml += `
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>SGST Input/Output</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${sgstAmount}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`;
  }
  if (Number(igstAmount) > 0) {
    taxLedgersXml += `
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>IGST Input/Output</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${igstAmount}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${partyName}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <DATE>${invoiceDate}</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${invoiceNo}</VOUCHERNUMBER>
            <PARTYLEDGERNAME>${partyName}</PARTYLEDGERNAME>
            <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
            <BASICBUYERNAME>${partyName}</BASICBUYERNAME>
            <PLACEOFSUPPLY>${placeOfSupply}</PLACEOFSUPPLY>
            <PARTYGSTIN>${gstin}</PARTYGSTIN>
            <NARRATION>Generated via Arth-Sutra GST Billing - Bill #${invoiceNo}</NARRATION>
            
            <!-- Party Ledger Entry (Debit) -->
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${partyName}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${totalAmount}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>

            <!-- Sales Account Ledger Entry (Credit) -->
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Sales Account</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${taxableAmount}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            ${taxLedgersXml}
            ${inventoryEntriesXml}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

export default {
  name: 'tally-export',
  displayName: 'Tally ERP Exporter',
  description: 'Export sales invoices to Tally ERP 9 / TallyPrime XML format for direct accounting ledger synchronization.',
  version: '1.0.0',
  author: 'ArthSutra',
  endpoints: [
    { method: 'GET', path: '/api/plugins/tally/:billId', description: 'Download invoice as Tally XML voucher' }
  ],
  ui: {
    badge: 'Accounting',
    icon: 'FileCode2',
    actionText: 'Export to Tally XML',
    component: 'TallyExporter',
  },
  registerRoutes(app, context = {}) {
    const activeDb = context.db || db;
    const activeSqlite = context.sqlite || sqlite;
    const activeBills = context.bills || bills;

    app.get('/api/plugins/tally/:billId', async (req, res) => {
      try {
        const rawBillId = req.params.billId;
        if (!rawBillId) {
          return res.status(400).json({ error: 'Bill ID is required' });
        }
        const billId = decodeURIComponent(rawBillId).trim();

        let billRecord = null;
        if (activeDb && activeBills) {
          // Look up by ID or invoice number
          const rows = activeDb.select().from(activeBills).where(eq(activeBills.id, billId)).all();
          billRecord = rows[0];
          if (!billRecord) {
            const byInvoice = activeDb.select().from(activeBills).where(eq(activeBills.invoiceNumber, billId)).all();
            billRecord = byInvoice[0];
          }
        } else if (activeSqlite) {
          billRecord = activeSqlite.prepare('SELECT * FROM bills WHERE id = ? OR invoice_number = ?').get(billId, billId);
        }

        if (!billRecord) {
          return res.status(404).json({ error: `Invoice with ID "${billId}" not found.` });
        }

        let billData = {};
        try {
          billData = typeof billRecord.data === 'string' ? JSON.parse(billRecord.data) : (billRecord.data || {});
        } catch {
          billData = {};
        }

        // Merge column values into billData for complete info
        const completeBill = {
          ...billRecord,
          ...billData,
        };

        const xml = generateTallyXml(completeBill);
        const filename = `tally-${completeBill.invoiceNumber || billId}.xml`;

        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(xml);
      } catch (err) {
        console.error('[tally-export plugin error]:', err);
        return res.status(500).json({ error: 'Failed to generate Tally XML: ' + err.message });
      }
    });
  }
};
