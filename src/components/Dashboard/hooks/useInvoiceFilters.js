import { useCallback, useEffect, useMemo, useState } from 'react';
import { getFYOptions, INVOICE_TYPES, formatCurrency } from '../../../utils';
// FIX: local-time date helper (see constants.js).
import { toLocalISODate } from '../constants';

const STORAGE_KEY = 'gst_dashboardColumns';

export const DEFAULT_COLUMNS = {
  date: true, invoice: true, type: true, client: true, amount: true,
  status: true, actions: true, printed: false, currency: false, dueDate: false,
};

export const COLUMN_OPTIONS = [
  ['date', 'Date (तारीख)'], ['invoice', 'Invoice # (इनवॉइस नं.)'], ['type', 'Type (प्रकार)'],
  ['client', 'Client (ग्राहक)'], ['amount', 'Amount (राशि)'], ['currency', 'Currency (मुद्रा)'],
  ['status', 'Status (स्थिति)'], ['dueDate', 'Due date (देय तारीख)'],
  ['printed', 'Print count (प्रिंट)'], ['actions', 'Actions (कार्रवाई)'],
];

function loadColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') return { ...DEFAULT_COLUMNS, ...saved };
  } catch { /* ignore */ }
  return { ...DEFAULT_COLUMNS };
}

/**
 * Apply every active filter to the bill list. Pure + exported for tests.
 * `fyOptions` comes from getFYOptions() (cached in the hook).
 */
export function applyBillFilters(bills = [], {
  search = '', typeFilter = 'all', statusFilter = 'all',
  fyFilter = 'all', dateFrom = '', dateTo = '', fyOptions = [],
} = {}) {
  let result = bills;
  if (search.trim()) {
    const q = search.toLowerCase();
    result = result.filter(b =>
      (b.clientName || '').toLowerCase().includes(q) ||
      (b.invoiceNumber || '').toLowerCase().includes(q));
  }
  if (typeFilter !== 'all') result = result.filter(b => (b.invoiceType || 'tax-invoice') === typeFilter);
  if (statusFilter !== 'all') result = result.filter(b => (b.status || 'unpaid') === statusFilter);
  if (fyFilter !== 'all') {
    const fy = fyOptions.find(f => f.value === fyFilter);
    if (fy) result = result.filter(b => b.invoiceDate >= fy.from && b.invoiceDate <= fy.to);
  }
  if (dateFrom) result = result.filter(b => b.invoiceDate >= dateFrom);
  if (dateTo) result = result.filter(b => b.invoiceDate <= dateTo);
  return result;
}

/**
 * Owns the invoice-table filter state: search, type/status/financial-year
 * dropdowns, date range, the All/This-Month preset, column visibility
 * (persisted to localStorage), and the derived `filtered` list + footer
 * totals.
 */
export function useInvoiceFilters(bills) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fyFilter, setFyFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [visibleColumns, setVisibleColumns] = useState(loadColumns);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const fyOptions = useMemo(() => getFYOptions(), []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleColumns)); } catch { /* ignore */ }
  }, [visibleColumns]);

  const filtered = useMemo(
    () => applyBillFilters(bills, { search, typeFilter, statusFilter, fyFilter, dateFrom, dateTo, fyOptions }),
    [bills, search, typeFilter, statusFilter, fyFilter, dateFrom, dateTo, fyOptions]);

  const hasFilters = useMemo(
    () => Boolean(search || typeFilter !== 'all' || statusFilter !== 'all' || fyFilter !== 'all' || dateFrom || dateTo),
    [search, typeFilter, statusFilter, fyFilter, dateFrom, dateTo]);

  const clearFilters = useCallback(() => {
    setSearch('');
    setTypeFilter('all');
    setStatusFilter('all');
    setFyFilter('all');
    setDateFrom('');
    setDateTo('');
  }, []);

  /**
   * Header preset: 'all' clears the range, 'month' pins to the current month.
   * FIX: use toLocalISODate() — the previous `toISOString().split('T')[0]`
   * produced the wrong month-boundary dates in IST (and any timezone east
   * of UTC), shifting the visible range by a day.
   */
  const setPeriod = useCallback((period) => {
    if (period === 'all') { setDateFrom(''); setDateTo(''); return; }
    const d = new Date();
    setDateFrom(toLocalISODate(new Date(d.getFullYear(), d.getMonth(), 1)));
    setDateTo(toLocalISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0)));
  }, []);

  const toggleColumn = useCallback((key, value) => {
    setVisibleColumns(prev => ({ ...prev, [key]: value }));
  }, []);

  // Footer totals: sum the filtered set, grouped per currency.
  const totals = useMemo(() => {
    const acc = {};
    for (const b of filtered) {
      const cur = b.currency || b.data?.invoiceOptions?.currency || 'INR';
      if (!acc[cur]) acc[cur] = { total: 0, out: 0 };
      acc[cur].total += Number(b.totalAmount) || 0;
      acc[cur].out += Math.max(0, (Number(b.totalAmount) || 0) - (Number(b.paidAmount) || 0));
    }
    return acc;
  }, [filtered]);

  const totalStr = useMemo(
    () => Object.entries(totals).map(([cur, v]) => formatCurrency(v.total, cur)).join(' + ') || '—',
    [totals]);
  const outstandingStr = useMemo(
    () => Object.entries(totals).map(([cur, v]) => formatCurrency(v.out, cur)).join(' + ') || '—',
    [totals]);

  return {
    // filter state
    search, setSearch,
    typeFilter, setTypeFilter,
    statusFilter, setStatusFilter,
    fyFilter, setFyFilter,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    fyOptions,
    INVOICE_TYPES,
    // derived
    filtered,
    hasFilters,
    clearFilters,
    setPeriod,
    // column visibility
    visibleColumns, setVisibleColumns, toggleColumn,
    showColumnPicker, setShowColumnPicker,
    // footer totals
    totals, totalStr, outstandingStr,
  };
}