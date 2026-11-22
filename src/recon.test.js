import { describe, it, expect } from 'vitest';
import {
  normalizeInvoiceNumber,
  normalizeGstin,
  calculateSimilarity,
  isInvoiceFuzzyMatch,
  isGstinMatch,
  extractInvoicesFromGstr2b,
  reconcileGstr2b,
} from '../utils/recon.js';

describe('AI-Powered GST Reconciliation Engine', () => {
  describe('Normalization & Similarity', () => {
    it('normalizes invoice numbers by removing punctuation and converting to uppercase', () => {
      expect(normalizeInvoiceNumber('inv-001/2026-27')).toBe('INV001202627');
      expect(normalizeInvoiceNumber('INV # 994')).toBe('INV994');
      expect(normalizeInvoiceNumber(null)).toBe('');
    });

    it('normalizes GSTINs', () => {
      expect(normalizeGstin('  27aabct3518q1zv ')).toBe('27AABCT3518Q1ZV');
    });

    it('calculates string similarity ratio using Levenshtein distance', () => {
      expect(calculateSimilarity('ABC', 'ABC')).toBe(1.0);
      expect(calculateSimilarity('ABCD', 'ABCE')).toBe(0.75);
    });

    it('matches invoice numbers with fuzzy variations', () => {
      // Punctuation variation
      expect(isInvoiceFuzzyMatch('INV-001', 'INV/001')).toBe(true);
      // Suffix / financial year addition (prefix/suffix match)
      expect(isInvoiceFuzzyMatch('619', '619/2026-27')).toBe(true);
      // Minor typo (1 char edit)
      expect(isInvoiceFuzzyMatch('INV-2026-091', 'INV-2026-092')).toBe(true);
      // Completely different
      expect(isInvoiceFuzzyMatch('INV-100', 'PUR-999')).toBe(false);
    });

    it('matches GSTINs with 1 typo tolerance', () => {
      expect(isGstinMatch('27AABCU9603R1ZM', '27AABCU9603R1ZM')).toBe(true);
      // 'O' instead of '0'
      expect(isGstinMatch('27AABCU96O3R1ZM', '27AABCU9603R1ZM')).toBe(true);
      // Completely different GSTIN
      expect(isGstinMatch('27AABCU9603R1ZM', '29AAACH7409R1ZX')).toBe(false);
    });
  });

  describe('GSTR-2B Ingestion & Reconcile Buckets', () => {
    const mockGstr2b = {
      gstin: '27AABCT3518Q1ZV',
      fp: '102026',
      data: {
        docdata: {
          b2b: [
            {
              ctin: '27AABCU9603R1ZM',
              trdnm: 'Supplier Alpha',
              inv: [
                {
                  inum: 'INV/2026/101',
                  dt: '01-10-2026',
                  val: 11800,
                  itcavl: 'Y',
                  items: [{ txval: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0 }],
                },
                {
                  inum: 'INV/2026/102',
                  dt: '05-10-2026',
                  val: 23600,
                  itcavl: 'Y',
                  items: [{ txval: 20000, igst: 3600, cgst: 0, sgst: 0, cess: 0 }],
                },
                {
                  inum: 'INV/2026/103',
                  dt: '10-10-2026',
                  val: 5900,
                  itcavl: 'Y',
                  items: [{ txval: 5000, igst: 900, cgst: 0, sgst: 0, cess: 0 }],
                },
              ],
            },
          ],
        },
      },
    };

    const mockLocalPurchases = [
      // Exact / fuzzy match with equal tax -> perfectMatch
      {
        id: 'pur_1',
        supplierGstin: '27AABCU9603R1ZM',
        supplierName: 'Supplier Alpha',
        invoiceNumber: 'INV-2026-101', // fuzzy match to INV/2026/101
        date: '2026-10-01',
        taxableAmount: 10000,
        totalTax: 1800,
        totalAmount: 11800,
      },
      // Matched invoice with rate mismatch (> 1 rupee) -> mismatch
      {
        id: 'pur_2',
        supplierGstin: '27AABCU9603R1ZM',
        supplierName: 'Supplier Alpha',
        invoiceNumber: 'INV/2026/102',
        date: '2026-10-05',
        taxableAmount: 20000,
        totalTax: 2400, // 12% in books vs 18% (3600) in 2B
        totalAmount: 22400,
      },
      // Local purchase not in GSTR-2B -> missingInGstr2b
      {
        id: 'pur_4',
        supplierGstin: '27AABCU9603R1ZM',
        supplierName: 'Supplier Alpha',
        invoiceNumber: 'INV/2026/999',
        date: '2026-10-25',
        taxableAmount: 15000,
        totalTax: 2700,
        totalAmount: 17700,
      },
    ];

    it('correctly parses and extracts invoices from GSTR-2B payload', () => {
      const extracted = extractInvoicesFromGstr2b(mockGstr2b);
      expect(extracted).toHaveLength(3);
      expect(extracted[0].invoiceNumber).toBe('INV/2026/101');
      expect(extracted[0].totalTax).toBe(1800);
    });

    it('categorizes invoices into all 4 reconciliation buckets', () => {
      const result = reconcileGstr2b(mockGstr2b, mockLocalPurchases);

      // Bucket 1: perfectMatch
      expect(result.buckets.perfectMatch).toHaveLength(1);
      expect(result.buckets.perfectMatch[0].bookInvoiceNumber).toBe('INV-2026-101');
      expect(result.buckets.perfectMatch[0].taxDifference).toBe(0);

      // Bucket 2: mismatch
      expect(result.buckets.mismatch).toHaveLength(1);
      expect(result.buckets.mismatch[0].invoiceNumber).toBe('INV/2026/102');
      expect(result.buckets.mismatch[0].taxDifference).toBe(1200);

      // Bucket 3: missingInOurBooks (INV/2026/103 was in 2B but not in our purchases)
      expect(result.buckets.missingInOurBooks).toHaveLength(1);
      expect(result.buckets.missingInOurBooks[0].invoiceNumber).toBe('INV/2026/103');

      // Bucket 4: missingInGstr2b (INV/2026/999 was in purchases but not in 2B)
      expect(result.buckets.missingInGstr2b).toHaveLength(1);
      expect(result.buckets.missingInGstr2b[0].invoiceNumber).toBe('INV/2026/999');

      // Check summary totals
      expect(result.summary.totalPortalInvoices).toBe(3);
      expect(result.summary.totalBookInvoices).toBe(3);
      expect(result.summary.perfectMatchCount).toBe(1);
      expect(result.summary.mismatchCount).toBe(1);
      expect(result.summary.missingInBooksCount).toBe(1);
      expect(result.summary.missingInGstr2bCount).toBe(1);
      // Eligible ITC = 1800 (from match) + 2400 (min of 3600 & 2400 from mismatch) = 4200
      expect(result.summary.totalEligibleClaimableITC).toBe(4200);
      expect(result.summary.totalMismatchedTaxDiff).toBe(1200);
    });
  });
});
