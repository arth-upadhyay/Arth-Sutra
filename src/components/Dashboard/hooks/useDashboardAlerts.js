import { useCallback, useEffect, useMemo, useState } from 'react';

// 1. Step up 3 levels to reach the main src/ folder (../../..)
import { getProfile, getAllClients, getAllProducts, getStockAlertSettings } from '../../../store';
import { formatCurrency } from '../../../utils';
import { openWhatsAppShare } from '../../../utils/share';

// 2. Step up 2 levels to reach the shared global components folder (../..)
import { toast } from '../../Toast';

// 3. Step up 1 level to reach the local Dashboard folder (..)
import { resolveClientPhone } from '../constants';

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests).
// ---------------------------------------------------------------------------

/**
 * Upcoming Indian GST return deadlines.
 * GSTR-1 is due the 11th and GSTR-3B the 20th of the following month.
 * Returns { next, upcoming } sorted by due date; `now` is injectable.
 */
export function computeGstDeadlines(now = new Date()) {
  const candidates = [];
  for (let offset = 0; offset <= 1; offset++) {
    const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    candidates.push({ form: 'GSTR-1', due: new Date(base.getFullYear(), base.getMonth(), 11), kind: 'gst' });
    candidates.push({ form: 'GSTR-3B', due: new Date(base.getFullYear(), base.getMonth(), 20), kind: 'gst' });
  }
  const upcoming = candidates
    .filter(c => c.due >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
    .sort((a, b) => a.due - b.due);
  return { next: upcoming[0] || null, upcoming };
}

/**
 * Recurring invoices due for generation within the next `windowDays` days.
 *
 * FIX: `new Date("YYYY-MM-DD")` parses as UTC midnight. For IST users a bill
 * due "today" therefore compared as 05:30 behind local `now`, so it was
 * silently skipped until mid-morning. We now pin the parsed date to
 * end-of-day local time so comparisons are made in the same timezone as
 * `now` and `horizon`.
 */
export function computeRecurringDue(bills = [], now = new Date(), windowDays = 7) {
  const horizon = new Date(now.getTime() + windowDays * 86400000);
  return bills.filter(b => {
    if (!b.data?.details?.recurring || b.status === 'paid') return false;
    const due = b.data?.details?.dueDate;
    if (!due) return false;
    const d = new Date(due);
    d.setHours(23, 59, 59, 999); // end-of-day local, not UTC midnight
    return d >= now && d <= horizon;
  });
}

/**
 * Aggregates every notification the dashboard surfaces into one list:
 *   { id, kind: 'danger'|'warn'|'info', title, detail }
 */
export function aggregateAlerts({ overdueBills = [], overdueStr = '', lowStockProducts = [], gstDeadlines = null, recurringDue = [] }) {
  const list = [];
  if (overdueBills.length > 0) {
    list.push({
      id: 'overdue', kind: 'danger',
      title: `${overdueBills.length} overdue invoice${overdueBills.length > 1 ? 's' : ''}`,
      detail: `${overdueStr} outstanding`,
    });
  }
  if (lowStockProducts.length > 0) {
    list.push({
      id: 'low-stock', kind: 'warn',
      title: `Low stock: ${lowStockProducts.length} item${lowStockProducts.length > 1 ? 's' : ''}`,
      detail: lowStockProducts.map(p => `${p.name} (${p.stock ?? 0})`).join(', '),
    });
  }
  for (const b of recurringDue) {
    list.push({
      id: `recurring-${b.id}`, kind: 'info',
      title: `Recurring invoice due: ${b.invoiceNumber}`,
      detail: `${b.clientName} · ${b.data?.details?.dueDate ? new Date(b.data.details.dueDate).toLocaleDateString('en-IN') : ''}`,
    });
  }
  if (gstDeadlines?.next) {
    list.push({
      id: 'gst-deadline', kind: 'info',
      title: `${gstDeadlines.next.form} due ${gstDeadlines.next.due.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`,
      detail: 'GST return filing deadline (GST रिटर्न की अंतिम तिथि)',
    });
  }
  return list;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDashboardAlerts(bills, { refreshKey = 0 } = {}) {
  const [profile, setProfile] = useState(null);
  const [clients, setClients] = useState([]);
  const [lowStockProducts, setLowStockProducts] = useState([]);
  const [showRemindAll, setShowRemindAll] = useState(false);

  const refresh = useCallback(async () => {
    getProfile().then(setProfile).catch(() => {});
    getAllClients().then(setClients).catch(() => {});
    try {
      const [prods, cfg] = await Promise.all([
        getAllProducts().catch(() => []),
        getStockAlertSettings().catch(() => ({ enabled: true, threshold: 5 })),
      ]);
      if (cfg?.enabled === false) { setLowStockProducts([]); return; }
      const threshold = Number(cfg?.threshold ?? 5);
      setLowStockProducts(prods.filter(p => (p.stock ?? 0) <= threshold));
    } catch { setLowStockProducts([]); }
  }, []);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  const overdueBills = useMemo(() => bills.filter(b => b.status === 'overdue'), [bills]);

  const overdueByCurrency = useMemo(() => {
    const acc = {};
    for (const b of overdueBills) {
      const cur = b.currency || b.data?.invoiceOptions?.currency || 'INR';
      acc[cur] = (acc[cur] || 0) + (Number(b.totalAmount) || 0) - (Number(b.paidAmount) || 0);
    }
    return acc;
  }, [overdueBills]);

  const overdueStr = useMemo(
    () => Object.entries(overdueByCurrency).map(([cur, amt]) => formatCurrency(amt, cur)).join(' + '),
    [overdueByCurrency]);

  const gstDeadlines = useMemo(() => computeGstDeadlines(), [refreshKey]);
  const recurringDue = useMemo(() => computeRecurringDue(bills), [bills]);

  const alerts = useMemo(
    () => aggregateAlerts({ overdueBills, overdueStr, lowStockProducts, gstDeadlines, recurringDue }),
    [overdueBills, overdueStr, lowStockProducts, gstDeadlines, recurringDue]);

  const getClientPhone = useCallback(
    (bill) => resolveClientPhone(bill, clients),
    [clients]);

  /**
   * Build + open the WhatsApp payment reminder for one bill.
   *
   * FIX: previously this read `bill.clientPhone || bill.data?.client?.phone`
   * inline, which silently missed clients whose phone only existed in the
   * Clients store. We now go through `getClientPhone` (which calls
   * `resolveClientPhone`) so reminders reach every client we can identify.
   */
  const sendReminder = useCallback((bill) => {
    const clientPhone = getClientPhone(bill);
    const clientName = bill.clientName || 'Sir/Madam';
    const dueDate = bill.data?.details?.dueDate ? new Date(bill.data.details.dueDate).toLocaleDateString('en-IN') : 'N/A';
    const businessName = profile?.businessName || 'Our Company';
    const outstanding = (bill.totalAmount || 0) - (bill.paidAmount || 0);
    if (outstanding <= 0.005) {
      toast('This invoice has no outstanding balance — no reminder to send. (इस इनवॉइस पर कोई बाकी राशि नहीं है)', 'info');
      return;
    }
    const outstandingStr = formatCurrency(outstanding, bill.currency);
    const totalStr = formatCurrency(bill.totalAmount || 0, bill.currency);
    const isPartial = (bill.paidAmount || 0) > 0.01 && outstanding > 0.01;
    const isOverdueDate = bill.data?.details?.dueDate && new Date(bill.data.details.dueDate) < new Date();
    const msg = isPartial
      ? `Hi ${clientName}, this is a gentle reminder that a balance of ${outstandingStr} is pending on Invoice ${bill.invoiceNumber} (total ${totalStr}). Kindly clear the remaining amount at your earliest convenience. Thank you! - ${businessName}`
      : isOverdueDate
        ? `Hi ${clientName}, this is a gentle reminder that Invoice ${bill.invoiceNumber} for ${outstandingStr} was due on ${dueDate}. Kindly arrange the payment at your earliest convenience. Thank you! - ${businessName}`
        : `Hi ${clientName}, this is a gentle reminder about the pending payment of ${outstandingStr} on Invoice ${bill.invoiceNumber}. Kindly arrange the payment at your earliest convenience. Thank you! - ${businessName}`;
    openWhatsAppShare(clientPhone, msg);
  }, [profile, getClientPhone]); // FIX: added getClientPhone to deps

  return {
    // side data
    profile, clients, lowStockProducts, refresh,
    // overdue
    overdueBills, overdueByCurrency, overdueStr,
    showRemindAll, setShowRemindAll,
    // aggregated notifications
    gstDeadlines, recurringDue, alerts,
    // helpers
    getClientPhone, sendReminder,
  };
}