import { useCallback, useMemo, useState } from 'react';
import { formatCurrency, numberToWords } from '../../../utils';
import { paymentModeLabel } from '../constants';

// ---------------------------------------------------------------------------
// Receipt printing papers — controls the injected @page rule at print time.
// ---------------------------------------------------------------------------
export const RECEIPT_PAPERS = {
  a5: { label: 'A5 receipt (रसीद)', pageCss: '@page { size: A5; margin: 12mm; }' },
  thermal80: { label: '80mm thermal (थर्मल)', pageCss: '@page { size: 80mm auto; margin: 3mm; }' },
};

const PRINT_STYLE_ID = 'fgsb-receipt-print-css';

export function ensureReceiptPrintStyles(paper = 'a5') {
  if (typeof document === 'undefined') return;
  let styleEl = document.getElementById(PRINT_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = PRINT_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `
    @media print {
      body * { visibility: hidden !important; }
      .fgsb-receipt-page, .fgsb-receipt-page * { visibility: visible !important; }
      .fgsb-receipt-page { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; background: #fff !important; color: #000 !important; }
      .fgsb-receipt-noprint { display: none !important; }
      ${RECEIPT_PAPERS[paper]?.pageCss || RECEIPT_PAPERS.a5.pageCss}
    }
  `;
}

export function formatReceiptData(target) {
  const { bill, payment, remaining } = target;
  const currency = bill.currency || bill.data?.invoiceOptions?.currency || 'INR';
  const amount = Number(payment.amount) || 0;
  const total = Number(bill.totalAmount) || 0;
  const totalPaid = Number(bill.paidAmount) || 0;
  const overpaid = remaining < -0.005;
  const balance = Math.max(0, remaining);

  return {
    currency,
    businessName: bill.data?.profile?.businessName || 'Your Business',
    businessAddress: bill.data?.profile?.address || '',
    businessGstin: bill.data?.profile?.gstin || '',
    businessPhone: bill.data?.profile?.phone || '',
    businessEmail: bill.data?.profile?.email || '',
    clientName: bill.data?.client?.name || bill.clientName || 'Client',
    clientAddress: bill.data?.client?.address || '',
    clientPhone: bill.data?.client?.phone || '',
    receiptNo: `RCPT-${(payment.id || '').replace('pay_', '').toUpperCase().slice(0, 10)}`,
    invoiceNumber: bill.invoiceNumber || '—',
    paymentDate: payment.date
      ? new Date(payment.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—',
    paymentModeLabel: paymentModeLabel(payment.mode),
    note: payment.note || '',
    amount,
    amountFormatted: formatCurrency(amount, currency),
    amountInWords: currency === 'INR' ? numberToWords(amount) : '',
    totalFormatted: formatCurrency(total, currency),
    totalPaidFormatted: formatCurrency(totalPaid, currency),
    overpaid,
    balance,
    balanceFormatted: formatCurrency(overpaid ? Math.abs(remaining) : balance, currency),
    balanceLabel: overpaid ? 'Overpaid (अधिक भुगतान)' : 'Balance (बाकी राशि)',
    balanceColor: overpaid ? '#059669' : (remaining > 0.005 ? '#dc2626' : '#059669'),
    recordedAtLabel: new Date(payment.recordedAt || Date.now()).toLocaleString('en-IN'),
  };
}

export function useReceiptModal() {
  const [receiptTarget, setReceiptTarget] = useState(null);
  const [paper, setPaper] = useState('a5');

  const openReceipt = useCallback((target) => {
    if (target?.bill && target?.payment) setReceiptTarget(target);
  }, []);

  const openReceiptFor = useCallback((bill, payment) => {
    if (!bill || !payment) return;
    const totalPaid = (bill.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    setReceiptTarget({
      bill,
      payment,
      remaining: (Number(bill.totalAmount) || 0) - totalPaid,
    });
  }, []);

  const closeReceipt = useCallback(() => setReceiptTarget(null), []);

  const printReceipt = useCallback(() => {
    ensureReceiptPrintStyles(paper);
    window.print();
  }, [paper]);

  const receiptData = useMemo(
    () => (receiptTarget ? formatReceiptData(receiptTarget) : null),
    [receiptTarget]);

  return {
    receiptTarget,
    receiptData,
    paper, setPaper,
    openReceipt,
    openReceiptFor,
    closeReceipt,
    printReceipt,
  };
}