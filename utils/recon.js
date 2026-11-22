// utils/recon.js
// ─────────────────────────────────────────────────────────────────────────────
// AI-Powered GSTR-2B Reconciliation Engine
// Uses Levenshtein distance fuzzy matching to reconcile portal GSTR-2B data
// against local purchase records stored in SQLite.
// ─────────────────────────────────────────────────────────────────────────────

import levenshtein from 'fast-levenshtein';

/**
 * Normalizes an invoice number: strips whitespace, punctuation (/ - _ #),
 * and converts to uppercase for robust matching.
 */
export function normalizeInvoiceNumber(inv) {
  if (!inv) return '';
  return String(inv).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Normalizes a GSTIN: uppercase and trimmed.
 */
export function normalizeGstin(gstin) {
  if (!gstin) return '';
  return String(gstin).trim().toUpperCase();
}

/**
 * Calculates similarity ratio between two strings using Levenshtein distance.
 * Returns a value between 0.0 (completely different) and 1.0 (identical).
 */
export function calculateSimilarity(str1, str2) {
  const s1 = String(str1 || '');
  const s2 = String(str2 || '');
  if (s1 === s2) return 1.0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshtein.get(s1, s2);
  return 1.0 - (dist / maxLen);
}

/**
 * Determines whether two invoice numbers fuzzy match within 15% tolerance or <= 2 edits.
 */
export function isInvoiceFuzzyMatch(inv1, inv2) {
  const n1 = normalizeInvoiceNumber(inv1);
  const n2 = normalizeInvoiceNumber(inv2);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;

  // Exact substring / prefix / suffix match for common variations (e.g. "619" vs "619/2026-27")
  if (n1.startsWith(n2) || n2.startsWith(n1) || n1.endsWith(n2) || n2.endsWith(n1)) return true;

  const sim = calculateSimilarity(n1, n2);
  const dist = levenshtein.get(n1, n2);

  // Match if similarity >= 85% (15% error margin) or edit distance <= 2
  return sim >= 0.85 || dist <= 2;
}

/**
 * Determines whether two GSTINs match (exact or 1 typo tolerance).
 */
export function isGstinMatch(gstin1, gstin2) {
  const g1 = normalizeGstin(gstin1);
  const g2 = normalizeGstin(gstin2);
  if (!g1 || !g2) return false;
  if (g1 === g2) return true;

  // GSTINs are 15 alphanumeric characters. Allow max 1 character typo (e.g. O vs 0).
  return levenshtein.get(g1, g2) <= 1;
}

/**
 * Extracts a normalized list of invoices from various GSTR-2B JSON formats.
 */
export function extractInvoicesFromGstr2b(gstr2bData) {
  if (!gstr2bData) return [];

  const rawDocData = gstr2bData.data?.docdata || gstr2bData.docdata || gstr2bData;
  const b2bSuppliers = rawDocData.b2b || [];
  const cdnrSuppliers = rawDocData.cdnr || [];

  const invoices = [];

  // B2B Invoices
  for (const sup of b2bSuppliers) {
    const supplierGstin = normalizeGstin(sup.ctin);
    const supplierName = sup.trdnm || sup.lgl_nm || '';

    for (const inv of (sup.inv || [])) {
      const taxable = (inv.items || []).reduce((sum, item) => sum + Number(item.txval || 0), 0);
      const igst = (inv.items || []).reduce((sum, item) => sum + Number(item.igst || 0), 0);
      const cgst = (inv.items || []).reduce((sum, item) => sum + Number(item.cgst || 0), 0);
      const sgst = (inv.items || []).reduce((sum, item) => sum + Number(item.sgst || 0), 0);
      const cess = (inv.items || []).reduce((sum, item) => sum + Number(item.cess || 0), 0);
      const totalTax = igst + cgst + sgst + cess;
      const invoiceValue = Number(inv.val || 0) || (taxable + totalTax);

      invoices.push({
        type: 'B2B',
        supplierGstin,
        supplierName,
        invoiceNumber: String(inv.inum || ''),
        invoiceDate: String(inv.dt || ''),
        taxableAmount: Math.round(taxable * 100) / 100,
        totalTax: Math.round(totalTax * 100) / 100,
        igst: Math.round(igst * 100) / 100,
        cgst: Math.round(cgst * 100) / 100,
        sgst: Math.round(sgst * 100) / 100,
        cess: Math.round(cess * 100) / 100,
        invoiceValue: Math.round(invoiceValue * 100) / 100,
        itcAvailable: inv.itcavl !== 'N',
        source: 'GSTR2B',
        raw: inv,
      });
    }
  }

  // CDNR (Credit/Debit Notes)
  for (const sup of cdnrSuppliers) {
    const supplierGstin = normalizeGstin(sup.ctin);
    const supplierName = sup.trdnm || sup.lgl_nm || '';

    for (const nt of (sup.nt || [])) {
      const taxable = (nt.items || []).reduce((sum, item) => sum + Number(item.txval || 0), 0);
      const totalTax = (nt.items || []).reduce((sum, item) => sum + Number(item.igst || 0) + Number(item.cgst || 0) + Number(item.sgst || 0) + Number(item.cess || 0), 0);
      const noteValue = Number(nt.val || 0);

      invoices.push({
        type: 'CDNR',
        supplierGstin,
        supplierName,
        invoiceNumber: String(nt.nt_num || nt.inum || ''),
        invoiceDate: String(nt.dt || ''),
        taxableAmount: Math.round(taxable * 100) / 100,
        totalTax: Math.round(totalTax * 100) / 100,
        invoiceValue: Math.round(noteValue * 100) / 100,
        itcAvailable: nt.itcavl !== 'N',
        source: 'GSTR2B',
        raw: nt,
      });
    }
  }

  return invoices;
}

/**
 * Parses and computes book values from a local purchase record.
 */
export function parseLocalPurchase(p) {
  let items = [];
  if (typeof p.items === 'string') {
    try { items = JSON.parse(p.items); } catch { items = []; }
  } else if (Array.isArray(p.items)) {
    items = p.items;
  }

  const taxableAmount = Number(p.taxableAmount || 0) || items.reduce((s, it) => s + ((Number(it.quantity) || 0) * (Number(it.rate) || 0)), 0);
  const totalTax = Number(p.totalTax || 0) || items.reduce((s, it) => {
    const lineTotal = (Number(it.quantity) || 0) * (Number(it.rate) || 0);
    const taxPct = Number(it.taxPercent || 0);
    return s + (lineTotal * taxPct / 100);
  }, 0);
  const totalAmount = Number(p.totalAmount || 0) || (taxableAmount + totalTax);

  return {
    id: p.id,
    supplierGstin: normalizeGstin(p.supplierGstin),
    supplierName: p.supplierName || '',
    invoiceNumber: String(p.invoiceNumber || ''),
    invoiceDate: String(p.date || ''),
    taxableAmount: Math.round(taxableAmount * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    totalAmount: Math.round(totalAmount * 100) / 100,
    paymentStatus: p.paymentStatus || 'Unpaid',
    note: p.note || '',
  };
}

/**
 * Reconciles GSTR-2B parsed invoices against local SQLite purchase bills.
 * Categorizes into 4 buckets:
 *  1. perfectMatch: Found and tax difference <= ₹1.00
 *  2. mismatch: Found, but tax difference > ₹1.00
 *  3. missingInOurBooks: In GSTR-2B, but absent in our purchases
 *  4. missingInGstr2b: In our purchases, but absent in GSTR-2B
 */
export function reconcileGstr2b(gstr2bData, localPurchases = []) {
  const portalInvoices = extractInvoicesFromGstr2b(gstr2bData);
  const parsedBooks = localPurchases.map(parseLocalPurchase);

  const perfectMatch = [];
  const mismatch = [];
  const missingInOurBooks = [];

  const matchedBookIds = new Set();

  for (const twoB of portalInvoices) {
    // 1. Try exact match on GSTIN and normalized invoice number
    let matchIndex = parsedBooks.findIndex(b =>
      !matchedBookIds.has(b.id) &&
      isGstinMatch(b.supplierGstin, twoB.supplierGstin) &&
      normalizeInvoiceNumber(b.invoiceNumber) === normalizeInvoiceNumber(twoB.invoiceNumber)
    );

    // 2. If not exact, attempt fuzzy match
    if (matchIndex === -1) {
      matchIndex = parsedBooks.findIndex(b =>
        !matchedBookIds.has(b.id) &&
        isGstinMatch(b.supplierGstin, twoB.supplierGstin) &&
        isInvoiceFuzzyMatch(b.invoiceNumber, twoB.invoiceNumber)
      );
    }

    if (matchIndex !== -1) {
      const book = parsedBooks[matchIndex];
      matchedBookIds.add(book.id);

      const taxDiff = Math.round(Math.abs(twoB.totalTax - book.totalTax) * 100) / 100;
      const valueDiff = Math.round(Math.abs(twoB.invoiceValue - book.totalAmount) * 100) / 100;

      const record = {
        supplierGstin: twoB.supplierGstin || book.supplierGstin,
        supplierName: twoB.supplierName || book.supplierName,
        invoiceNumber: twoB.invoiceNumber,
        bookInvoiceNumber: book.invoiceNumber,
        invoiceDate: twoB.invoiceDate || book.invoiceDate,
        portalValue: twoB.invoiceValue,
        bookValue: book.totalAmount,
        portalTaxable: twoB.taxableAmount,
        bookTaxable: book.taxableAmount,
        portalTax: twoB.totalTax,
        bookTax: book.totalTax,
        taxDifference: taxDiff,
        valueDifference: valueDiff,
        itcAvailable: twoB.itcAvailable,
        bookId: book.id,
      };

      if (taxDiff <= 1.00) {
        perfectMatch.push({ ...record, status: 'perfectMatch' });
      } else {
        mismatch.push({ ...record, status: 'mismatch' });
      }
    } else {
      // In 2B but missing in our books
      missingInOurBooks.push({
        status: 'missingInOurBooks',
        supplierGstin: twoB.supplierGstin,
        supplierName: twoB.supplierName,
        invoiceNumber: twoB.invoiceNumber,
        bookInvoiceNumber: null,
        invoiceDate: twoB.invoiceDate,
        portalValue: twoB.invoiceValue,
        bookValue: 0,
        portalTaxable: twoB.taxableAmount,
        bookTaxable: 0,
        portalTax: twoB.totalTax,
        bookTax: 0,
        taxDifference: twoB.totalTax,
        valueDifference: twoB.invoiceValue,
        itcAvailable: twoB.itcAvailable,
        bookId: null,
      });
    }
  }

  // 4. Missing in GSTR-2B: Book purchases that were never matched to a portal invoice
  const missingInGstr2b = [];
  for (const book of parsedBooks) {
    if (!matchedBookIds.has(book.id)) {
      missingInGstr2b.push({
        status: 'missingInGstr2b',
        supplierGstin: book.supplierGstin,
        supplierName: book.supplierName,
        invoiceNumber: book.invoiceNumber,
        bookInvoiceNumber: book.invoiceNumber,
        invoiceDate: book.invoiceDate,
        portalValue: 0,
        bookValue: book.totalAmount,
        portalTaxable: 0,
        bookTaxable: book.taxableAmount,
        portalTax: 0,
        bookTax: book.totalTax,
        taxDifference: book.totalTax,
        valueDifference: book.totalAmount,
        itcAvailable: false, // Not in 2B yet, cannot claim under Rule 36(4)
        bookId: book.id,
      });
    }
  }

  // Aggregate ITC and Summary Metrics
  const totalPortalITC = portalInvoices.reduce((s, inv) => s + (inv.itcAvailable ? inv.totalTax : 0), 0);
  const totalBookTax = parsedBooks.reduce((s, b) => s + b.totalTax, 0);

  const matchedClaimableITC = perfectMatch
    .filter(r => r.itcAvailable)
    .reduce((s, r) => s + r.portalTax, 0);

  const mismatchedClaimableITC = mismatch
    .filter(r => r.itcAvailable)
    .reduce((s, r) => s + Math.min(r.portalTax, r.bookTax), 0);

  const totalEligibleClaimableITC = Math.round((matchedClaimableITC + mismatchedClaimableITC) * 100) / 100;

  const totalMismatchedTaxDiff = Math.round(
    mismatch.reduce((s, r) => s + r.taxDifference, 0) * 100
  ) / 100;

  const unclaimedInBooksITC = Math.round(
    missingInOurBooks.filter(r => r.itcAvailable).reduce((s, r) => s + r.portalTax, 0) * 100
  ) / 100;

  const pendingSupplierFilingTax = Math.round(
    missingInGstr2b.reduce((s, r) => s + r.bookTax, 0) * 100
  ) / 100;

  return {
    summary: {
      totalPortalInvoices: portalInvoices.length,
      totalBookInvoices: parsedBooks.length,
      perfectMatchCount: perfectMatch.length,
      mismatchCount: mismatch.length,
      missingInBooksCount: missingInOurBooks.length,
      missingInGstr2bCount: missingInGstr2b.length,
      totalPortalITC: Math.round(totalPortalITC * 100) / 100,
      totalBookTax: Math.round(totalBookTax * 100) / 100,
      totalEligibleClaimableITC,
      totalMismatchedTaxDiff,
      unclaimedInBooksITC,
      pendingSupplierFilingTax,
      period: gstr2bData.fp || gstr2bData.rtnprd || gstr2bData.period || 'Unknown',
      filingGstin: gstr2bData.gstin || 'Unknown',
    },
    buckets: {
      perfectMatch,
      mismatch,
      missingInOurBooks,
      missingInGstr2b,
    },
  };
}
