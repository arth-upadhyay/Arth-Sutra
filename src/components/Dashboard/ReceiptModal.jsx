import React from 'react';
import { X, Printer } from 'lucide-react';
import { RECEIPT_PAPERS } from './hooks/useReceiptModal';

/**
 * Payment receipt modal — printable voucher for one payment against one
 * invoice. Purely presentational: all data comes pre-shaped from
 * formatReceiptData(), printing from useReceiptModal().printReceipt().
 */
export default function ReceiptModal({ data, paper, onPaperChange, onPrint, onClose }) {
  if (!data) return null;
  const {
    businessName, businessAddress, businessGstin, businessPhone, businessEmail,
    clientName, clientAddress, clientPhone,
    receiptNo, invoiceNumber, paymentDate, paymentModeLabel, note,
    amountFormatted, amountInWords,
    totalFormatted, totalPaidFormatted,
    overpaid, balanceFormatted, balanceLabel, balanceColor,
    recordedAtLabel,
  } = data;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="fgsb-receipt-noprint" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 className="section-title" style={{ margin: 0 }}>Payment Receipt (भुगतान रसीद)</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <select
              className="erp-input"
              value={paper}
              onChange={e => onPaperChange(e.target.value)}
              title="Receipt paper size (रसीद का पेपर साइज़)">
              {Object.entries(RECEIPT_PAPERS).map(([key, p]) => (
                <option key={key} value={key}>{p.label}</option>
              ))}
            </select>
            <button className="icon-btn" onClick={onClose} title="Close (बंद करें)"><X size={18} /></button>
          </div>
        </div>
        <div className="fgsb-receipt-page" style={{
          background: '#fff', color: '#111', padding: '1.5rem 1.75rem',
          border: '1px solid #e5e7eb', borderRadius: 6, fontFamily: 'Helvetica, Arial, sans-serif',
        }}>
          <div style={{ textAlign: 'center', borderBottom: '2px solid #0f172a', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, letterSpacing: '0.05em' }}>{businessName}</div>
            {businessAddress && <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: 3 }}>{businessAddress}</div>}
            <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 3 }}>
              {businessGstin && <>GSTIN: <strong>{businessGstin}</strong> · </>}
              {businessPhone && <>Ph: {businessPhone} · </>}
              {businessEmail}
            </div>
          </div>
          <div style={{ textAlign: 'center', fontSize: '1.05rem', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
            PAYMENT RECEIPT / भुगतान रसीद
          </div>
          <table style={{ width: '100%', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            <tbody>
              <tr><td style={{ padding: '3px 0', color: '#475569' }}>Receipt No. (रसीद नंबर)</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{receiptNo}</td></tr>
              <tr><td style={{ padding: '3px 0', color: '#475569' }}>Payment Date (भुगतान तारीख)</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{paymentDate}</td></tr>
              <tr><td style={{ padding: '3px 0', color: '#475569' }}>Against Invoice (इनवॉइस के विरुद्ध)</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{invoiceNumber}</td></tr>
              <tr><td style={{ padding: '3px 0', color: '#475569' }}>Payment Mode (भुगतान का तरीका)</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{paymentModeLabel}</td></tr>
              {note && <tr><td style={{ padding: '3px 0', color: '#475569' }}>Ref / Note (संदर्भ / नोट)</td><td style={{ textAlign: 'right' }}>{note}</td></tr>}
            </tbody>
          </table>
          <div style={{ border: '1px solid #cbd5e1', borderRadius: 4, padding: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.75rem', color: '#475569' }}>Received with thanks from (निम्न से प्राप्त हुआ)</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, marginTop: 3 }}>{clientName}</div>
            {clientAddress && <div style={{ fontSize: '0.72rem', color: '#475569' }}>{clientAddress}</div>}
            {clientPhone && <div style={{ fontSize: '0.72rem', color: '#475569' }}>Ph: {clientPhone}</div>}
          </div>
          <div style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 4, padding: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '0.85rem', color: '#334155' }}>Amount Received (प्राप्त राशि)</span>
              <span style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>{amountFormatted}</span>
            </div>
            {amountInWords && (
              <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: 4, fontStyle: 'italic' }}>
                In words / शब्दों में: {amountInWords}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#334155', marginBottom: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span>Invoice Total (इनवॉइस कुल): <strong>{totalFormatted}</strong></span>
            <span>Total Paid (कुल भुगतान): <strong>{totalPaidFormatted}</strong></span>
            <span>
              {overpaid
                ? <>{balanceLabel}: <strong style={{ color: '#059669' }}>{balanceFormatted}</strong></>
                : <>{balanceLabel}: <strong style={{ color: balanceColor }}>{balanceFormatted}</strong></>}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem', fontSize: '0.75rem', color: '#475569' }}>
            <div><div style={{ borderTop: '1px solid #94a3b8', paddingTop: 4, minWidth: 140, textAlign: 'center' }}>Customer Signature (ग्राहक के हस्ताक्षर)</div></div>
            <div><div style={{ borderTop: '1px solid #94a3b8', paddingTop: 4, minWidth: 140, textAlign: 'center' }}>For {businessName}</div></div>
          </div>
          <div style={{ fontSize: '0.68rem', color: '#94a3b8', textAlign: 'center', marginTop: '0.75rem' }}>
            This is a computer-generated receipt / यह एक कंप्यूटर जनित रसीद है। Recorded on {recordedAtLabel}.
          </div>
        </div>
        <div className="fgsb-receipt-noprint" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>Close (बंद करें)</button>
          <button className="btn btn-primary" onClick={onPrint}><Printer size={16} /> Print Receipt (रसीद प्रिंट करें)</button>
        </div>
      </div>
    </div>
  );
}