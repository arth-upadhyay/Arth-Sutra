import { useCallback, useState } from 'react';
import {
  deleteBill, saveBill, saveReceipt, deleteReceipt, getAllProducts, saveProduct,
} from '../../../store';
import { formatCurrency } from '../../../utils';
import { openWhatsAppShare } from '../../../utils/share';
import { toast } from '../../../components/Toast';
import { confirmAction } from '../../../components/ConfirmModal';
// FIX: drop unused `paymentModeLabel`; add local-date helper.
import {
  STATUS_CONFIG, INVOICE_PDF_PREFIX, computeStatus, sumPayments, toLocalISODate,
} from '../constants';

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests).
// ---------------------------------------------------------------------------

/** Build the WhatsApp/email share text for a bill. Pure. */
export function buildShareMessage(bill, profile) {
  const currency = bill.currency || bill.data?.invoiceOptions?.currency || 'INR';
  const fmt = (n) => formatCurrency(Number(n) || 0, currency);
  const total = Number(bill.totalAmount) || 0;
  const paidFromArr = sumPayments(bill);
  const paid = paidFromArr > 0 ? paidFromArr : (Number(bill.paidAmount) || 0);
  const outstanding = total - paid;
  const dueDate = bill.data?.details?.dueDate ? new Date(bill.data.details.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const invDate = bill.invoiceDate ? new Date(bill.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const businessName = profile?.businessName || '';
  const status = (bill.status || 'unpaid').toUpperCase();

  let paymentLine;
  if (outstanding < -0.005) {
    paymentLine = `Paid: ${fmt(paid)}  (Overpaid by ${fmt(Math.abs(outstanding))})`;
  } else if (outstanding <= 0.005) {
    paymentLine = `Paid: ${fmt(paid)}  ✅ FULLY PAID`;
  } else if (paid > 0.005) {
    paymentLine = `Paid: ${fmt(paid)}  ·  *Outstanding: ${fmt(outstanding)}*`;
  } else {
    paymentLine = `*Amount Due: ${fmt(total)}*`;
  }

  const lines = [
    `*Invoice: ${bill.invoiceNumber}*`,
    `Date: ${invDate}${dueDate ? `   ·   Due: ${dueDate}` : ''}`,
    `Client: ${bill.clientName}`,
    `Total: ${fmt(total)}`,
    paymentLine,
    `Status: ${status}`,
  ];
  if (businessName) lines.push('', `— ${businessName}`);
  return lines.join('\n');
}

/** The auto-generated receipt record saved alongside a payment. Pure. */
export function buildPaymentReceiptRecord(bill, payment) {
  return {
    id: payment.id,
    date: payment.date,
    receiptNo: `RCPT-${payment.id.replace('pay_', '').toUpperCase().slice(0, 10)}`,
    clientName: bill.data?.client?.name || bill.clientName || '',
    clientAddress: bill.data?.client?.address || '',
    amount: payment.amount,
    paymentMode: payment.mode,
    referenceNo: payment.note || '',
    againstInvoice: bill.invoiceNumber || bill.id || '',
    note: payment.note || '',
    currency: bill.currency || bill.data?.invoiceOptions?.currency || 'INR',
    source: 'auto-from-payment',
    billId: bill.id,
  };
}

// ---------------------------------------------------------------------------
// PDF generation (module-level; dynamically imports heavy deps on demand).
// ---------------------------------------------------------------------------

/**
 * FIX (multi-page): the old version did `addImage(..., Math.min(h, 297))`,
 * which squished any invoice taller than one A4 page into a single distorted
 * page. We now slice the source canvas into A4-height strips and add one
 * PDF page per strip, preserving aspect ratio end-to-end.
 */
async function generateSingleBillPdfBlob(bill) {
  const data = bill.data || {};
  const { jsPDF } = await import('jspdf');
  const html2canvas = (await import('html2canvas')).default;
  const InvoicePreviewMod = await import('../../../components/InvoicePreview');
  const { createRoot } = await import('react-dom/client');
  const { createElement } = await import('react');
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-99999px;top:0;width:794px;background:#fff;';
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await new Promise((resolve) => {
      root.render(createElement(InvoicePreviewMod.default, {
        profile: data.profile, client: data.client, details: data.details, items: data.items,
        totals: data.totals, invoiceType: data.invoiceType, customTerms: data.customTerms,
        customNotes: data.customNotes, extraSections: data.extraSections, options: data.invoiceOptions,
      }));
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100)));
    });
    const capScale = Math.min(4, Math.max(2, Math.round((window.devicePixelRatio || 1) * 1.2)));
    const canvas = await html2canvas(container.firstElementChild || container, {
      scale: capScale, backgroundColor: '#ffffff', useCORS: false, logging: false,
    });
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    const PAGE_W_MM = 210;
    const PAGE_H_MM = 297;
    const fullH_mm = (canvas.height * PAGE_W_MM) / canvas.width;

    if (fullH_mm <= PAGE_H_MM) {
      // Fits on one page — no slicing needed.
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, PAGE_W_MM, fullH_mm, undefined, 'FAST');
    } else {
      // Slice the canvas into A4-height strips.
      const slicePxH = Math.floor((PAGE_H_MM * canvas.width) / PAGE_W_MM);
      const totalSlices = Math.ceil(canvas.height / slicePxH);
      for (let i = 0; i < totalSlices; i++) {
        const sy = i * slicePxH;
        const sh = Math.min(slicePxH, canvas.height - sy);
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = sh;
        slice.getContext('2d').drawImage(
          canvas, 0, sy, canvas.width, sh,
          0, 0, canvas.width, sh,
        );
        const sliceH_mm = (sh * PAGE_W_MM) / canvas.width;
        if (i > 0) doc.addPage();
        doc.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, PAGE_W_MM, sliceH_mm, undefined, 'FAST');
      }
    }
    return doc.output('blob');
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInvoiceActions({
  bills, filtered, profile, clients, loadBills, openReceipt,
  onEdit, onDuplicate, onConvert,
}) {
  // ---- selection ----
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggleSelect = useCallback((id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);

  const toggleSelectAllVisible = useCallback(() => setSelectedIds(prev => {
    const allVisible = filtered.every(b => prev.has(b.id));
    const next = new Set(prev);
    if (allVisible) filtered.forEach(b => next.delete(b.id));
    else filtered.forEach(b => next.add(b.id));
    return next;
  }), [filtered]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const getSelectedBills = useCallback(
    () => bills.filter(b => selectedIds.has(b.id)),
    [bills, selectedIds]);

  // ---- row actions ----
  const handleView = useCallback((bill) => {
    if (bill.data) onEdit(bill);
    else toast('No editable data saved for this invoice', 'warning');
  }, [onEdit]);

  const duplicateBill = useCallback((bill) => onDuplicate(bill), [onDuplicate]);
  const convertBill = useCallback((bill) => onConvert(bill), [onConvert]);

  const handleDelete = useCallback(async (bill) => {
    const ok = await confirmAction({
      title: 'Delete this invoice? (इनवॉइस हटाएं?)',
      message: `Invoice ${bill.invoiceNumber} for ${bill.clientName} will be soft-deleted (moved to Trash for 30 days). Stock will be restored for any products in this invoice.`,
      confirmLabel: 'Delete (हटाएं)',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      if (bill.data?.items) {
        const products = await getAllProducts();
        for (const item of bill.data.items) {
          if (!item.productId) continue;
          const product = products.find(p => p.id === item.productId);
          if (!product) continue;
          await saveProduct({ ...product, stock: (product.stock || 0) + (item.quantity || 0) });
        }
      }
      await deleteBill(bill.id);

      const prefix = INVOICE_PDF_PREFIX[bill.invoiceType || 'tax-invoice'] || 'INV';
      const pdfName = `${prefix}_${(bill.invoiceNumber || '').replace(/\//g, '-')}.pdf`;
      const clientName = bill.clientName || bill.data?.client?.name || 'General';
      fetch('/api/trash-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: pdfName, clientName }) }).catch(err => console.warn('Could not trash PDF:', err));

      toast('Invoice deleted & stock restored (इनवॉइस हटाया गया)', 'success');
      loadBills();
    } catch { toast('Failed to delete (हटाने में विफल)', 'error'); }
  }, [loadBills]);

  const changeStatus = useCallback(async (bill, newStatus) => {
    const updated = { ...bill, status: newStatus };
    if (newStatus === 'paid') {
      updated.paidAmount = bill.totalAmount;
      const already = sumPayments(bill);
      const outstanding = Math.max(0, Number(bill.totalAmount) - already);
      if (outstanding > 0) {
        updated.payments = [...(bill.payments || []), {
          // FIX: local-time date — UTC version shifted IST users back a day.
          amount: outstanding,
          date: toLocalISODate(),
          mode: 'other',
          note: 'Marked paid',
          recordedAt: new Date().toISOString(),
        }];
      }
    }
    await saveBill(updated, { overwrite: true });
    toast(`Marked as ${STATUS_CONFIG[newStatus].label}`, 'info');
    loadBills();
  }, [loadBills]);

  // ---- payments ----
  const [paymentModal, setPaymentModal] = useState(null);
  const [editPaymentModal, setEditPaymentModal] = useState(null);
  const [paymentInput, setPaymentInput] = useState({ amount: '', date: '', mode: 'bank-transfer', note: '' });

  const openPaymentModal = useCallback((bill) => {
    setPaymentModal(bill);
    // FIX: local-time default date.
    setPaymentInput({ amount: '', date: toLocalISODate(), mode: 'bank-transfer', note: '' });
  }, []);

  const closePaymentModal = useCallback(() => setPaymentModal(null), []);

  const recordPayment = useCallback(async () => {
    const amount = parseFloat(paymentInput.amount);
    if (!isFinite(amount) || amount <= 0) {
      toast('Enter a positive payment amount (सही राशि डालें)', 'warning'); return;
    }
    const bill = paymentModal;
    const billTotal = Number(bill.totalAmount) || 0;
    const alreadyPaid = Number(bill.paidAmount) || 0;
    const outstanding = Math.max(0, billTotal - alreadyPaid);
    if (amount > outstanding + 0.01) {
      const proceed = await confirmAction({
        title: 'Record as overpayment? (अधिक भुगतान के रूप में दर्ज करें?)',
        message: `This payment (${formatCurrency(amount, bill.currency)}) is more than the outstanding balance (${formatCurrency(outstanding, bill.currency)}).\n\nThe extra will be saved as client credit and can be applied to future invoices.`,
        confirmLabel: 'Yes, record overpayment (हां, दर्ज करें)',
        tone: 'warning',
      });
      if (!proceed) return;
    }
    const paymentEntry = {
      id: 'pay_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      amount, date: paymentInput.date, mode: paymentInput.mode,
      note: paymentInput.note, recordedAt: new Date().toISOString(),
    };
    const payments = [...(bill.payments || []), paymentEntry];
    const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const updatedBill = {
      ...bill, payments, paidAmount: totalPaid,
      status: computeStatus(totalPaid, billTotal),
    };
    await saveBill(updatedBill, { overwrite: true });
    try {
      await saveReceipt(buildPaymentReceiptRecord(bill, paymentEntry));
    } catch { /* non-fatal — receipt is still viewable from the invoice's Payment History */ }
    toast(`Payment of ${formatCurrency(amount, bill.currency)} recorded (भुगतान दर्ज हुआ)`, 'success');
    setPaymentModal(null);
    openReceipt({ bill: updatedBill, payment: paymentEntry, remaining: billTotal - totalPaid });
    loadBills();
  }, [paymentInput, paymentModal, openReceipt, loadBills]);

  const deletePaymentAt = useCallback(async (bill, idx) => {
    if (!await confirmAction({
      title: 'Delete this payment? (भुगतान हटाएं?)',
      message: 'The invoice will revert to unpaid/partial if the sum drops below the total.',
      confirmLabel: 'Delete payment (भुगतान हटाएं)',
      tone: 'danger',
    })) return;
    const target = (bill.payments || [])[idx];
    const payments = (bill.payments || []).filter((_, i) => i !== idx);
    const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const total = Number(bill.totalAmount) || 0;
    const updated = { ...bill, payments, paidAmount: totalPaid, status: computeStatus(totalPaid, total) };
    await saveBill(updated, { overwrite: true });
    if (target?.id) {
      try { await deleteReceipt(target.id); } catch { /* ignore */ }
    }
    toast('Payment deleted (भुगतान हटाया गया)', 'success');
    setPaymentModal(updated);
    loadBills();
  }, [loadBills]);

  const editPaymentAt = useCallback((bill, idx) => {
    const target = (bill.payments || [])[idx];
    if (!target) return;
    setEditPaymentModal({
      bill, idx,
      form: {
        amount: String(target.amount || ''),
        // FIX: local-time fallback date.
        date: target.date || toLocalISODate(),
        mode: target.mode || 'bank-transfer',
        note: target.note || '',
      },
    });
  }, []);

  const saveEditedPayment = useCallback(async () => {
    if (!editPaymentModal) return;
    const { bill, idx, form } = editPaymentModal;
    const newAmount = parseFloat(form.amount);
    if (!isFinite(newAmount) || newAmount <= 0) {
      toast('Enter a positive amount (सही राशि डालें)', 'warning'); return;
    }
    const others = (bill.payments || []).filter((_, i) => i !== idx);
    const othersSum = others.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const newTotal = othersSum + newAmount;
    const billTotal = Number(bill.totalAmount) || 0;
    if (newTotal > billTotal + 0.01) {
      const ok = await confirmAction({
        title: 'Save as overpayment? (अधिक भुगतान के रूप में सहेजें?)',
        message: `This edit brings the total received (${formatCurrency(newTotal, bill.currency)}) above the invoice total (${formatCurrency(billTotal, bill.currency)}).`,
        confirmLabel: 'Save overpayment (सहेजें)',
        tone: 'warning',
      });
      if (!ok) return;
    }
    const target = (bill.payments || [])[idx];
    const withId = target.id || ('pay_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const payments = (bill.payments || []).map((p, i) => i === idx
      ? { ...p, id: withId, amount: newAmount, date: form.date, mode: form.mode, note: form.note }
      : p);
    const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const updated = { ...bill, payments, paidAmount: totalPaid, status: computeStatus(totalPaid, billTotal) };
    await saveBill(updated, { overwrite: true });
    try {
      await saveReceipt(buildPaymentReceiptRecord(bill, { ...form, id: withId, amount: newAmount }));
    } catch { /* non-fatal */ }
    toast('Payment updated (भुगतान अपडेट हुआ)', 'success');
    setPaymentModal(updated);
    setEditPaymentModal(null);
    loadBills();
  }, [editPaymentModal, loadBills]);

  // ---- sharing ----
  const shareWhatsApp = useCallback(async (bill) => {
    const msg = buildShareMessage(bill, profile);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        toast('Preparing PDF for share…', 'info', 1500);
        const blob = await generateSingleBillPdfBlob(bill);
        const file = new File([blob], `${bill.invoiceNumber}.pdf`, { type: 'application/pdf' });
        const canShareFile = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
        if (canShareFile) {
          await navigator.share({
            title: `Invoice ${bill.invoiceNumber}`,
            text: msg,
            files: [file],
          });
          return;
        }
      } catch (e) {
        if (e?.name !== 'AbortError') console.warn('Web Share failed, falling back to WhatsApp URL:', e);
        else return;
      }
    }
    try {
      if (!sessionStorage.getItem('fgsb_whatsappDesktopExplained')) {
        toast('Desktop browsers can\'t attach PDF to WhatsApp Web (a browser security rule). Sharing invoice details as text — download PDF and drop it into WhatsApp Web manually if you need the file. On phone the PDF attaches automatically.', 'info', 7000);
        sessionStorage.setItem('fgsb_whatsappDesktopExplained', '1');
      }
    } catch { /* sessionStorage sandboxed — skip */ }
    openWhatsAppShare(bill.clientPhone, msg);
  }, [profile]);

  const shareEmail = useCallback((bill) => {
    const subject = `Invoice ${bill.invoiceNumber} - ${formatCurrency(bill.totalAmount, bill.currency)}`;
    const richBody = buildShareMessage(bill, profile).replace(/\*/g, '');
    const body = `Dear ${bill.clientName},\n\n${richBody}\n\nRegards`;
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
  }, [profile]);

  // ---- bulk operations ----
  const bulkMarkStatus = useCallback(async (newStatus) => {
    const sel = getSelectedBills();
    if (sel.length === 0) return;
    if (!await confirmAction({
      title: `Mark ${sel.length} invoice${sel.length !== 1 ? 's' : ''} as ${STATUS_CONFIG[newStatus].label}?`,
      message: newStatus === 'paid'
        ? 'A synthetic payment will be recorded for each so payment history + cashflow stay consistent.'
        : 'The status change is reversible — you can flip it back any time.',
      confirmLabel: `Mark as ${STATUS_CONFIG[newStatus].label}`,
    })) return;
    setBulkBusy(true);
    try {
      const nowIso = new Date().toISOString();
      // FIX: local-time "today" (was `nowIso.slice(0, 10)`, which is UTC).
      const today = toLocalISODate();
      const updates = sel.map(b => {
        const patch = { ...b, status: newStatus };
        if (newStatus === 'paid') {
          patch.paidAmount = b.totalAmount || 0;
          const already = sumPayments(b);
          const outstanding = Math.max(0, Number(b.totalAmount) - already);
          if (outstanding > 0) {
            patch.payments = [...(b.payments || []), {
              amount: outstanding, date: today, mode: 'other',
              note: 'Marked paid (bulk)', recordedAt: nowIso,
            }];
          }
        }
        return saveBill(patch, { overwrite: true });
      });
      const results = await Promise.allSettled(updates);
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) toast(`${sel.length - failed} updated, ${failed} failed`, 'warning');
      else toast(`Marked ${sel.length} as ${STATUS_CONFIG[newStatus].label}`, 'success');
      clearSelection();
      loadBills();
    } catch (err) { toast('Bulk update failed: ' + err.message, 'error'); }
    setBulkBusy(false);
  }, [getSelectedBills, clearSelection, loadBills]);

  const bulkDelete = useCallback(async () => {
    const sel = getSelectedBills();
    if (sel.length === 0) return;
    if (!await confirmAction({
      title: `Delete ${sel.length} invoice${sel.length !== 1 ? 's' : ''}? (${sel.length} इनवॉइस हटाएं?)`,
      message: 'The invoices will be moved to Trash for 30 days. The PDF copies in Saved Invoices/ stay untouched.',
      confirmLabel: `Delete ${sel.length} (हटाएं)`,
      tone: 'danger',
    })) return;
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(sel.map(b => deleteBill(b.id)));
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) toast(`${sel.length - failed} deleted, ${failed} failed`, 'warning');
      else toast(`Deleted ${sel.length} invoice${sel.length !== 1 ? 's' : ''} (हटा दिए गए)`, 'success');
      clearSelection();
      loadBills();
    } catch (err) { toast('Bulk delete failed: ' + err.message, 'error'); }
    setBulkBusy(false);
  }, [getSelectedBills, clearSelection, loadBills]);

  const bulkExportJSON = useCallback(() => {
    const sel = getSelectedBills();
    if (sel.length === 0) return;
    // ...unchanged (rest of your original bulk export logic)
  }, [getSelectedBills]);

  // ...the rest of the hook is unchanged from your original file.
  return {
    // selection
    selectedIds, toggleSelect, toggleSelectAllVisible, clearSelection, getSelectedBills,
    bulkBusy,
    // row actions
    handleView, duplicateBill, convertBill, handleDelete, changeStatus,
    // payments
    paymentModal, closePaymentModal, paymentInput, setPaymentInput, openPaymentModal, recordPayment,
    editPaymentModal, setEditPaymentModal, editPaymentAt, saveEditedPayment,
    // sharing
    shareWhatsApp, shareEmail,
    // bulk
    bulkMarkStatus, bulkDelete, bulkExportJSON,
  };
}