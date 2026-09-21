import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAllBills, getAllReceipts, saveBill } from'../../../store';
import { formatCurrency } from '../../../utils';
import { toast } from '../../../components/Toast';
// FIX: import the shared local-date helper; drop the local UTC-based one.
import { RECEIPT_MODE_MAP, computeStatus, toLocalISODate } from '../constants';

// ---------------------------------------------------------------------------
// Pure helpers — exported so they can be unit-tested without rendering React.
// ---------------------------------------------------------------------------

/** Roll bills up per currency: { total, tax, unpaid, count }. Pure. */
export function summarizeByCurrency(bills = []) {
  const byCurrency = {};
  for (const b of bills) {
    const cur = b.currency || b.data?.invoiceOptions?.currency || 'INR';
    if (!byCurrency[cur]) byCurrency[cur] = { total: 0, tax: 0, unpaid: 0, count: 0 };
    byCurrency[cur].total += Number(b.totalAmount) || 0;
    byCurrency[cur].tax += Number(b.totalTaxAmount) || 0;
    byCurrency[cur].count += 1;
    if (b.status !== 'paid') {
      byCurrency[cur].unpaid += Math.max(0, (Number(b.totalAmount) || 0) - (Number(b.paidAmount) || 0));
    }
  }
  return byCurrency;
}

/**
 * Last `monthCount` months of { key, label, invoiced, received, outstanding }.
 * `now` is injectable for deterministic tests. Pure.
 */
export function computeMonthlySeries(bills = [], now = new Date(), monthCount = 6) {
  const months = [];
  for (let i = monthCount - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-IN', { month: 'short' }),
    });
  }
  return months.map(m => {
    let invoiced = 0, received = 0;
    for (const b of bills) {
      if ((b.invoiceDate || '').startsWith(m.key)) {
        invoiced += Number(b.totalAmount) || 0;
        received += Number(b.paidAmount) || 0;
      }
    }
    return { ...m, invoiced, received, outstanding: Math.max(0, invoiced - received) };
  });
}

/** Percentage change between two periods. Pure. */
export function pctChange(current, previous) {
  if (previous > 0) return ((current - previous) / previous) * 100;
  return current > 0 ? 100 : 0;
}

/** % of invoices that have a GSTIN on file (client or business). Pure. */
export function computeGstCompliance(bills = []) {
  if (!bills.length) return 0;
  const withGstin = bills.filter(b => b.data?.client?.gstin || b.data?.profile?.gstin).length;
  return Math.round((withGstin / bills.length) * 100);
}

// FIX: was `(d) => d.toISOString().split('T')[0]` — swapped for the shared
// local-time helper so prevFrom/prevTo/today are correct in IST (and every
// other non-UTC timezone).
const toISODate = (d) => toLocalISODate(d);

/**
 * Metrics for the currently selected date range, plus the previous period of
 * equal length (when both bounds are set) so the UI can show a range trend.
 * Returns null when no range is selected. Pure.
 */
export function computeRangeStats(bills = [], { dateFrom, dateTo } = {}) {
  if (!dateFrom && !dateTo) return null;
  const inRange = bills.filter(b =>
    (!dateFrom || (b.invoiceDate || '') >= dateFrom) &&
    (!dateTo || (b.invoiceDate || '') <= dateTo));
  const byCurrency = summarizeByCurrency(inRange);

  let prevByCurrency = null;
  if (dateFrom && dateTo) {
    const days = Math.max(1, Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1);
    const prevTo = new Date(new Date(dateFrom).getTime() - 86400000);
    const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
    const prevBills = bills.filter(b => {
      const d = b.invoiceDate || '';
      return d >= toISODate(prevFrom) && d <= toISODate(prevTo);
    });
    prevByCurrency = summarizeByCurrency(prevBills);
  }

  const trend = {};
  for (const cur of Object.keys(byCurrency)) {
    const prev = prevByCurrency?.[cur]?.total || 0;
    trend[cur] = pctChange(byCurrency[cur].total, prev);
  }

  return { count: inRange.length, byCurrency, prevByCurrency, trend };
}

// ---------------------------------------------------------------------------
// Data normalization (side-effecting, kept private).
// ---------------------------------------------------------------------------

/**
 * Merge orphaned receipts (on disk but missing from bill.payments) back into
 * their bills, then auto-flag overdue bills whose due date has passed.
 * Mutates and returns the bill list. Fire-and-forget writes inside.
 */
async function normalizeBills(data) {
  const today = toLocalISODate();

  // --- Orphaned-payment reconciliation ---
  let reconciled = 0;
  try {
    const receipts = await getAllReceipts().catch(() => []);
    const receiptsByBillKey = new Map();
    for (const r of receipts) {
      const key = r.billId || r.againstInvoice;
      if (!key) continue;
      if (!receiptsByBillKey.has(key)) receiptsByBillKey.set(key, []);
      receiptsByBillKey.get(key).push(r);
    }
    const reconcileWrites = [];
    for (const bill of data) {
      const rcpts = receiptsByBillKey.get(bill.id) || receiptsByBillKey.get(bill.invoiceNumber) || [];
      if (!rcpts.length) continue;
      const currentPayments = Array.isArray(bill.payments) ? bill.payments : [];
      const missing = rcpts.filter(r =>
        !currentPayments.some(p =>
          (r.receiptNo && p.receiptNo === r.receiptNo)
          || (Math.abs((Number(p.amount) || 0) - (Number(r.amount) || 0)) < 0.005
              && p.date === r.date
              && (p.mode || '').toLowerCase() === (r.paymentMode || '').toLowerCase().replace(' ', '-'))
        )
      );
      if (!missing.length) continue;
      const merged = [...currentPayments, ...missing.map(r => ({
        id: r.id || ('pay_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        amount: Number(r.amount) || 0,
        date: r.date,
        mode: RECEIPT_MODE_MAP[r.paymentMode] || (r.paymentMode || 'other').toLowerCase().replace(' ', '-'),
        note: r.note || (r.receiptNo ? `Reconciled from receipt ${r.receiptNo}` : 'Reconciled from orphaned receipt'),
        recordedAt: r.recordedAt || new Date().toISOString(),
        receiptNo: r.receiptNo,
      }))];
      const totalPaid = merged.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const billTotal = Number(bill.totalAmount) || 0;
      bill.payments = merged;
      bill.paidAmount = totalPaid;
      bill.status = computeStatus(totalPaid, billTotal);
      reconciled += missing.length;
      reconcileWrites.push(saveBill(bill, { overwrite: true }).catch(() => null));
    }
    if (reconcileWrites.length) await Promise.allSettled(reconcileWrites);
  } catch { /* non-fatal */ }
  if (reconciled > 0) {
    toast(`Reconciled ${reconciled} orphaned payment${reconciled === 1 ? '' : 's'} against ${reconciled === 1 ? 'its' : 'their'} invoice${reconciled === 1 ? '' : 's'}`, 'success', 6000);
  }

  // --- Auto-detect overdue ---
  const dirty = data.filter(bill => {
    const dueDate = bill.data?.details?.dueDate;
    return dueDate && dueDate < today && bill.status !== 'paid' && bill.status !== 'overdue';
  });
  if (dirty.length > 0) {
    const updates = dirty.map(bill => { bill.status = 'overdue'; return saveBill(bill, { overwrite: true }); });
    await Promise.allSettled(updates);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Owns the bill list (loading, receipt reconciliation, overdue detection) and
 * every derived financial metric shown on the dashboard:
 *   - stats / multiCurrency   — lifetime totals per currency
 *   - monthlySeries           — last 6 months invoiced/received/outstanding
 *   - deltas                  — month-over-month % change per KPI
 *   - gstCompliance           — % of invoices with GSTIN on file
 *
 * FIX: this hook no longer takes `{ dateFrom, dateTo }` or returns `rangeStats`.
 * The range is owned by useInvoiceFilters (which itself needs `bills` from this
 * hook), so computing rangeStats here created a dead-code loop. The Dashboard
 * now calls the exported `computeRangeStats(bills, { dateFrom, dateTo })` pure
 * helper directly.
 */
export function useDashboardMetrics() {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadBills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await getAllBills();
      const data = await normalizeBills(raw);
      setBills(data);
    } catch (err) {
      setError(err);
      toast('Failed to load invoices (इनवॉइस लोड नहीं हो सके)', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBills(); }, [loadBills]);

  const stats = useMemo(
    () => ({ byCurrency: summarizeByCurrency(bills), count: bills.length }),
    [bills]);
  const multiCurrency = Object.keys(stats.byCurrency).length > 1;

  const monthlySeries = useMemo(() => computeMonthlySeries(bills), [bills]);
  const curMonth = monthlySeries[monthlySeries.length - 1] || { invoiced: 0, received: 0, outstanding: 0 };
  const prevMonth = monthlySeries[monthlySeries.length - 2] || curMonth;

  const deltas = useMemo(() => ({
    sales: pctChange(curMonth.invoiced, prevMonth.invoiced),
    outstanding: pctChange(curMonth.outstanding, prevMonth.outstanding),
    // proxy — per-month tax isn't stored, so receipts stand in for the trend
    tax: pctChange(curMonth.received, prevMonth.received),
  }), [curMonth, prevMonth]);

  const gstCompliance = useMemo(() => computeGstCompliance(bills), [bills]);

  return {
    bills,
    loadBills,
    reload: loadBills,
    loading,
    error,
    stats,
    multiCurrency,
    monthlySeries,
    curMonth,
    prevMonth,
    deltas,
    gstCompliance,
  };
}

/** Convenience: format a per-currency map as a "₹X + $Y" string. */
export function formatCurrencyMap(map, key = 'total') {
  const str = Object.entries(map || {})
    .map(([cur, v]) => formatCurrency(v[key] ?? v ?? 0, cur))
    .join(' + ');
  return str || '—';
}