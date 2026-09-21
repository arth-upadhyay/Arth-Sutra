

import { useMemo, useCallback } from 'react';
import { computeInvoiceTotals, calculateRoundOff } from '../../../utils';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function useInvoiceTotals({
  items = [],
  profile = null,
  client = {},
  details = {},
  showGST = true,
  taxInclusive = false,
  invoiceOptions = {},
  setInvoiceOptions = null, // optional — enables the round-off toggle helper
} = {}) {
  const totals = useMemo(() => computeInvoiceTotals({
    items, profile, client, details, showGST, taxInclusive, invoiceOptions,
  }), [
    items,
    client?.state, client?.isSEZ,
    profile?.state, profile?.country,
    showGST, taxInclusive,
    invoiceOptions?.showRoundOff,
    invoiceOptions?.showTDS, invoiceOptions?.tdsRate, invoiceOptions?.tdsCumulativeThisYear,
    invoiceOptions?.showTCS, invoiceOptions?.tcsRate, invoiceOptions?.tcsCumulativeThisYear,
    invoiceOptions?.reverseCharge,
    invoiceOptions?.invoiceDiscountValue, invoiceOptions?.invoiceDiscountType,
    details?.placeOfSupply,
  ]);

  // ---- Round-off helpers -------------------------------------------------------
  const roundOffEnabled = !!invoiceOptions?.showRoundOff;

  // What the round-off line WOULD be on the current (possibly already rounded)
  // total — used by the Customize panel to preview before enabling.
  const previewRoundOff = useCallback(
    () => calculateRoundOff(totals.total),
    [totals.total],
  );

  // The grand total if the round-off toggle were flipped right now.
  const totalIfRoundOffToggled = roundOffEnabled
    ? r2(totals.total - totals.roundOff)                       // back to unrounded
    : r2(totals.total + calculateRoundOff(totals.total));      // with round-off applied

  const setRoundOffEnabled = useCallback((on) => {
    setInvoiceOptions?.(prev => ({ ...prev, showRoundOff: !!on }));
  }, [setInvoiceOptions]);

  return {
    totals,

    // Base composition
    subtotal: totals.subtotal,
    totalDiscount: totals.totalDiscount,
    taxableAmount: totals.taxableAmount,

    // Tax breakdown (zeros under Reverse Charge — see rcmTax* on `totals`)
    cgst: totals.cgst,
    sgst: totals.sgst,
    utgst: totals.utgst,
    igst: totals.igst,
    cess: totals.cess,
    totalTaxAmount: totals.totalTaxAmount,

    // Additions / deductions on top
    tcsAmount: totals.tcsAmount,
    tdsAmount: totals.tdsAmount,
    invoiceDiscountAmount: totals.invoiceDiscountAmount,
    roundOff: totals.roundOff,

    // Grand totals
    total: totals.total,
    netReceivable: totals.netReceivable,

    // Meta flags for the UI (interstate badge, compliance warnings, save blocker)
    isInterstate: totals.isInterstate,
    isIntraUT: totals.isIntraUT,
    warnings: totals.warnings || [],
    needsProfileFix: totals.needsProfileFix,

    // Round-off controls
    roundOffEnabled,
    previewRoundOff,
    totalIfRoundOffToggled,
    setRoundOffEnabled,
  };
}

export default useInvoiceTotals;