import { describe, it, expect } from 'vitest';
import { computeInvoiceTotals, resolveLineDiscount } from './utils';

describe('Financial Math: resolveLineDiscount', () => {
  it('should calculate a fixed amount discount correctly', () => {
    const item = { quantity: 2, rate: 500, discount: 100, discountType: 'fixed', discountBase: 'net' };
    expect(resolveLineDiscount(item)).toBe(100);
  });

  it('should calculate a percentage discount correctly', () => {
    const item = { quantity: 2, rate: 500, discount: 10, discountType: 'percent', discountBase: 'net' };
    // 10% of (2 * 500) = 100
    expect(resolveLineDiscount(item)).toBe(100);
  });

  it('should return 0 if discount values are missing or negative', () => {
    const item = { quantity: 1, rate: 100, discount: -50, discountType: 'fixed' };
    expect(resolveLineDiscount(item)).toBe(0);
    
    const missingItem = { quantity: 1, rate: 100 };
    expect(resolveLineDiscount(missingItem)).toBe(0);
  });
});

describe('Financial Math: computeInvoiceTotals', () => {
  it('should calculate standard exclusive GST correctly (Intra-state)', () => {
    const items = [
      { quantity: 1, rate: 1000, taxPercent: 18, discount: 0 }
    ];
    // Mocking intra-state transaction (same state triggers CGST/SGST split)
    const profile = { state: 'Madhya Pradesh' };
    const client = { state: 'Madhya Pradesh' };
    
    const result = computeInvoiceTotals({ items, profile, client, showGST: true, taxInclusive: false, invoiceOptions: {} });
    
    expect(result.subtotal).toBe(1000);
    expect(result.cgst).toBe(90);
    expect(result.sgst).toBe(90);
    expect(result.igst).toBe(0);
    expect(result.totalTaxAmount).toBe(180);
    expect(result.total).toBe(1180);
  });

  it('should route tax to IGST for Inter-state transactions', () => {
    const items = [
      { quantity: 1, rate: 1000, taxPercent: 18, discount: 0 }
    ];
    // Different states trigger IGST
    const profile = { state: 'Madhya Pradesh' };
    const client = { state: 'Maharashtra' };
    
    const result = computeInvoiceTotals({ items, profile, client, showGST: true, taxInclusive: false, invoiceOptions: {} });
    
    expect(result.cgst).toBe(0);
    expect(result.sgst).toBe(0);
    expect(result.igst).toBe(180);
    expect(result.total).toBe(1180);
  });

  it('should reverse-calculate inclusive GST correctly', () => {
    const items = [
      { quantity: 1, rate: 1180, taxPercent: 18, discount: 0 }
    ];
    const profile = { state: 'Madhya Pradesh' };
    const client = { state: 'Madhya Pradesh' };

    const result = computeInvoiceTotals({ items, profile, client, showGST: true, taxInclusive: true, invoiceOptions: {} });
    
    // 1180 inclusive of 18% means base is 1000, tax is 180
    expect(result.subtotal).toBeCloseTo(1000, 2);
    expect(result.totalTaxAmount).toBeCloseTo(180, 2);
    expect(result.total).toBe(1180);
  });

  it('should handle round-off correctly when enabled in invoiceOptions', () => {
    const items = [
      { quantity: 1, rate: 1000.40, taxPercent: 0, discount: 0 }
    ];
    const result = computeInvoiceTotals({ items, showGST: false, taxInclusive: false, invoiceOptions: { showRoundOff: true } });
    
    expect(result.subtotal).toBe(1000.40);
    expect(result.roundOff).toBeCloseTo(-0.40, 2);
    expect(result.total).toBe(1000);
  });
});