// ---------------------------------------------------------------------------
// Pure GST helpers — no React, no store, no side effects except downloadCSV.
// Imported by both the useGstReturns hook and the GstReturns UI.
// ---------------------------------------------------------------------------
import { calculateLineItemTax } from '../../../utils';

/** Save a CSV blob to the user's Downloads folder. */
export function downloadCSV(filename, headers, rows) {
  const escape = (val) => {
    const s = String(val ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };
  const lines = [headers.map(escape).join(',')];
  rows.forEach(row => lines.push(row.map(escape).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function round2(n) { return Math.round(n * 100) / 100; }

/**
 * v1.10.31 — Cess (GST-C3) and UTGST (GST-C2 / H7) flow through this helper
 * so every downstream summary, CSV, and JSON payload gets them. Symmetric
 * half-split for CGST/SGST (GST-H4/M6) — floor + ceil vs the prior
 * asymmetric round-then-subtract which produced 1-paise portal mismatches.
 */
export function computeItemTaxSplit(item, isInterState, taxInclusive = false, isIntraUT = false) {
  const { afterDiscount, taxAmount } = calculateLineItemTax(item, taxInclusive);
  const cessPct = Number(item.cessPercent) || 0;
  const cess = round2(afterDiscount * cessPct / 100);
  if (isInterState) return { taxable: afterDiscount, cgst: 0, sgst: 0, utgst: 0, igst: taxAmount, cess };
  const halfPaise = Math.round(taxAmount * 100) / 2;
  const cgst = Math.floor(halfPaise) / 100;
  const half2 = round2((Math.ceil(halfPaise) / 100));
  if (isIntraUT) {
    return { taxable: afterDiscount, cgst, sgst: 0, utgst: half2, igst: 0, cess };
  }
  return { taxable: afterDiscount, cgst, sgst: half2, utgst: 0, igst: 0, cess };
}

export function getTaxableAmount(totals) {
  return totals?.taxableAmount ?? ((totals?.subtotal || 0) - (totals?.totalDiscount || 0));
}

// ========== GSTR-2B reconciliation helpers ==========
// Normalises an invoice number for fuzzy matching: uppercase, strip non-alphanumeric.
export function normInv(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/**
 * Given the raw GSTR-2B JSON `data` block and the user's purchase records,
 * return a flat array of reconciliation rows with status:
 * matched | amount_mismatch | book_only | twob_only.
 */
export function buildReconciliation(twoBData, purchases) {
  if (!twoBData) return [];
  const twoBSuppliers = twoBData.docdata?.b2b || twoBData.b2b || [];
  const rows = [];

  const bookByKey = new Map();
  (purchases || []).forEach(p => {
    const key = `${(p.supplierGstin || '').toUpperCase()}::${normInv(p.invoiceNumber)}`;
    bookByKey.set(key, p);
  });

  const matchedBookKeys = new Set();

  twoBSuppliers.forEach(sup => {
    const ctin = (sup.ctin || '').toUpperCase();
    const supName = sup.trdnm || '';
    (sup.inv || []).forEach(inv => {
      const key = `${ctin}::${normInv(inv.inum)}`;
      const book = bookByKey.get(key);
      const twoBVal = Number(inv.val || 0);
      const twoBTaxable = (inv.items || []).reduce((s, it) => s + Number(it.txval || 0), 0);
      const twoBIgst = (inv.items || []).reduce((s, it) => s + Number(it.igst || 0), 0);
      const twoBCgst = (inv.items || []).reduce((s, it) => s + Number(it.cgst || 0), 0);
      const twoBSgst = (inv.items || []).reduce((s, it) => s + Number(it.sgst || 0), 0);

      if (!book) {
        rows.push({
          status: 'twob_only',
          supplier: supName, ctin,
          invoiceNumber: inv.inum, date: inv.dt,
          twoBVal, twoBTaxable, twoBIgst, twoBCgst, twoBSgst,
          bookVal: 0, bookTaxable: 0, bookIgst: 0, bookCgst: 0, bookSgst: 0,
          itcAvailable: inv.itcavl !== 'N',
        });
        return;
      }
      matchedBookKeys.add(key);

      const bookTotals = (book.items || []).reduce((acc, it) => {
        const amount = (it.quantity || 0) * (it.rate || 0);
        const tax = amount * (it.taxPercent || 0) / 100;
        return { taxable: acc.taxable + amount, tax: acc.tax + tax, total: acc.total + amount + tax };
      }, { taxable: 0, tax: 0, total: 0 });
      // P1 #22: include round-off so 2B matching doesn't flag every rounded
      // supplier bill as amount_mismatch.
      if (book.applyRoundOff && typeof book.roundOff === 'number') {
        bookTotals.total += book.roundOff;
      }
      const bookIgst = book.interstate ? bookTotals.tax : 0;
      const bookCgst = book.interstate ? 0 : bookTotals.tax / 2;
      const bookSgst = book.interstate ? 0 : bookTotals.tax / 2;

      const valDiff = Math.abs(twoBVal - bookTotals.total);
      const taxableDiff = Math.abs(twoBTaxable - bookTotals.taxable);
      const status = (valDiff <= 1 && taxableDiff <= 1) ? 'matched' : 'amount_mismatch';

      rows.push({
        status,
        supplier: supName || book.supplierName || '',
        ctin,
        invoiceNumber: inv.inum, date: inv.dt,
        twoBVal, twoBTaxable, twoBIgst, twoBCgst, twoBSgst,
        bookVal: bookTotals.total, bookTaxable: bookTotals.taxable,
        bookIgst, bookCgst, bookSgst,
        itcAvailable: inv.itcavl !== 'N',
        valDiff, taxableDiff,
      });
    });
  });

  // Anything in our books that didn't match a 2B entry — supplier hasn't filed yet.
  (purchases || []).forEach(p => {
    const key = `${(p.supplierGstin || '').toUpperCase()}::${normInv(p.invoiceNumber)}`;
    if (matchedBookKeys.has(key)) return;
    const totals = (p.items || []).reduce((acc, it) => {
      const amount = (it.quantity || 0) * (it.rate || 0);
      const tax = amount * (it.taxPercent || 0) / 100;
      return { taxable: acc.taxable + amount, tax: acc.tax + tax, total: acc.total + amount + tax };
    }, { taxable: 0, tax: 0, total: 0 });
    rows.push({
      status: 'book_only',
      supplier: p.supplierName || '', ctin: (p.supplierGstin || '').toUpperCase(),
      invoiceNumber: p.invoiceNumber, date: p.date,
      twoBVal: 0, twoBTaxable: 0, twoBIgst: 0, twoBCgst: 0, twoBSgst: 0,
      bookVal: totals.total, bookTaxable: totals.taxable,
      bookIgst: p.interstate ? totals.tax : 0,
      bookCgst: p.interstate ? 0 : totals.tax / 2,
      bookSgst: p.interstate ? 0 : totals.tax / 2,
      itcAvailable: false,
    });
  });

  return rows;
}

// Inter-state status of a bill — follows place of supply when set explicitly,
// SEZ supplies always interstate, else compares seller and client state.
export function billIsInterstate(bill) {
  const prof = bill.data?.profile;
  const client = bill.data?.client;
  const details = bill.data?.details;
  if (client?.isSEZ) return true;
  const sellerState = (prof?.state || '').trim().toLowerCase();
  const placeOfSupply = (details?.placeOfSupply || client?.state || '').trim().toLowerCase();
  if (!sellerState || !placeOfSupply) return false;
  return sellerState !== placeOfSupply;
}

// v1.10.31 — Is this bill intra-UT (business + client in same Union Territory
// without legislature)? Prefers the flag from computeInvoiceTotals; falls
// back to false for legacy bills (treated as SGST, which is safe).
export function billIsIntraUT(bill) {
  if (bill?.data?.totals?.isIntraUT) return true;
  return false;
}