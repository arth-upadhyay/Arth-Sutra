import React from 'react';
import { Clock, CheckCircle, AlertTriangle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared constants for the dashboard module.
// Status labels — English with Hindi in brackets so Indian business owners
// can read them at a glance. Kept short so the status pills stay compact.
// ---------------------------------------------------------------------------
export const STATUS_CONFIG = {
  unpaid:  { label: 'Unpaid (बाकी)',          icon: Clock,         color: '#d97706', bg: 'rgba(217,119,6,0.12)' },
  partial: { label: 'Partial (आंशिक)',        icon: Clock,         color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' },
  paid:    { label: 'Paid (पूरा भुगतान)',      icon: CheckCircle,   color: '#059669', bg: 'rgba(5,150,105,0.12)' },
  overdue: { label: 'Overdue (देरी से बकाया)', icon: AlertTriangle, color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
};

export const PAYMENT_MODES = [
  ['bank-transfer', 'Bank Transfer (बैंक ट्रांसफर)'],
  ['upi', 'UPI (UPI)'],
  ['cash', 'Cash (नकद)'],
  ['cheque', 'Cheque (चेक)'],
  ['card', 'Card (कार्ड)'],
  ['other', 'Other (अन्य)'],
];

export const PAYMENT_MODE_LABELS = Object.fromEntries(PAYMENT_MODES);

/** Resolve a payment-mode key ("upi") to its display label. */
export function paymentModeLabel(mode) {
  return PAYMENT_MODE_LABELS[mode] || mode || '';
}

/** Shared <select> for payment mode, used by Record/Edit payment modals. */
export function PaymentModeSelect({ value, onChange, className }) {
  return (
    <select className={className || 'form-input'} value={value} onChange={onChange}>
      {PAYMENT_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

/** Map a human receipt paymentMode label back to the internal mode key. */
export const RECEIPT_MODE_MAP = {
  'Bank Transfer': 'bank-transfer',
  'UPI': 'upi',
  'Cash': 'cash',
  'Cheque': 'cheque',
  'Card': 'card',
  'Other': 'other',
};

/** PDF filename prefix per invoice type (used when trashing generated PDFs). */
export const INVOICE_PDF_PREFIX = {
  'tax-invoice': 'INV',
  'proforma': 'PRO',
  'credit-note': 'CN',
  'bill-of-supply': 'BOS',
  'delivery-challan': 'DC',
};

/** Derive invoice status from paid vs total. Pure + testable. */
export function computeStatus(totalPaid, total) {
  if (total > 0 && totalPaid >= total) return 'paid';
  return totalPaid > 0 ? 'partial' : 'unpaid';
}

/** Sum of all payment entries on a bill. Pure + testable. */
export function sumPayments(bill) {
  return (bill?.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

/** Outstanding balance on a bill (never negative). Pure + testable. */
export function outstandingOf(bill) {
  return Math.max(0, (Number(bill?.totalAmount) || 0) - (Number(bill?.paidAmount) || 0));
}

/** Resolve the best-known phone number for a bill's client. Pure + testable. */
export function resolveClientPhone(bill, clients = []) {
  if (bill?.clientPhone) return bill.clientPhone;
  if (bill?.data?.client?.phone) return bill.data.client.phone;
  const savedClient = clients.find(c => c.name === bill?.clientName);
  return savedClient?.phone || '';
}

// FIX (timezone): toISOString() returns UTC. For IST users (UTC+5:30), local
// midnight is 18:30 UTC the *previous* day, so `new Date(2024, 0, 1)
// .toISOString().split('T')[0]` yields "2023-12-31". Every date we hand to
// the UI (payment dates, "this month" range, overdue detection) must be
// formatted in LOCAL time. Use this helper everywhere instead of
// `new Date().toISOString().split('T')[0]`.
/** Format a Date as YYYY-MM-DD using LOCAL time (avoids the IST/UTC off-by-one). */
export function toLocalISODate(d = new Date()) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}