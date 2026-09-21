
 import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { saveBill, getAllBills, getNextInvoiceNumber, saveRecurring } from '../../../store';
import { INVOICE_TYPES, getAccountById, formatCurrency } from '../../../utils';
import { getPrintSettings } from '../../../utils/printSettings';
import { getClientCredit, planCreditApplication } from '../../../utils/clientCredit';
import { toast } from '../../Toast';
import { DEFAULT_OPTIONS, OPTIONS_STORAGE_KEY } from './useInvoiceForm';

const resolvePrefix = (type) => {
  const ps = getPrintSettings();
  const rawOverride = ps.customPrefixes?.[type];
  const overridePrefix = rawOverride && rawOverride.trim();
  return {
    prefix: overridePrefix || INVOICE_TYPES[type]?.prefix || 'INV',
    explicitPrefix: !!overridePrefix,
  };
};

export function useInvoicePersistence({
  form,                          // return value of useInvoiceForm (required)
  totals,                        // totals object from useInvoiceTotals (required)
  profile = null,
  editingBill = null,
  syncStock = null,              // async (items) => void — from useProductSearch
  clientSearch = null,           // return value of useClientSearch (optional)
} = {}) {
  const [saving, setSaving] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const [allBills, setAllBills] = useState([]);
  const [creditToApply, setCreditToApply] = useState(0);

  const autoSaveTimer = useRef(null);
  const hasBeenSaved = useRef(!!editingBill);
  const lastAutoAppliedClient = useRef(null);

  const refreshBills = useCallback(() => {
    getAllBills().then(setAllBills).catch(() => {});
  }, []);

  useEffect(() => { refreshBills(); }, [refreshBills]);

  // ---- Client credit (amount available from overpayments / credit notes) ------
  const clientCredit = useMemo(() => {
    const name = form.client?.name;
    if (!name?.trim()) return { available: 0, sources: [] };
    const otherBills = editingBill ? allBills.filter(b => b.id !== editingBill.id) : allBills;
    return getClientCredit(name, otherBills);
  }, [form.client?.name, allBills, editingBill]);

  // Auto-apply available credit once per client when the option is on.
  useEffect(() => {
    if (editingBill) return;
    if (!form.invoiceOptions.autoApplyClientCredit) {
      lastAutoAppliedClient.current = null;
      return;
    }
    const name = form.client?.name?.trim() || '';
    if (!name || lastAutoAppliedClient.current === name) return;
    lastAutoAppliedClient.current = name;
    const cap = Math.min(clientCredit.available, Number(totals.total) || 0);
    setCreditToApply(cap > 0.005 ? cap : 0);
  }, [form.client?.name, clientCredit.available, form.invoiceOptions.autoApplyClientCredit, editingBill, totals.total]);

  // ---- LOAD / DUPLICATE / CONVERT ----------------------------------------------
  useEffect(() => {
    // A sessionStorage draft was restored by useInvoiceForm — it wins over the
    // (possibly stale) editingBill for this mount.
    if (form.draftInitialized.current) {
      form.draftInitialized.current = false;
      return;
    }

    if (editingBill?.data) {
      const d = editingBill.data;
      form.setClient(d.client);
      form.setItems(d.items);
      form.setInvoiceType(d.invoiceType || 'tax-invoice');
      if (d.customTerms !== undefined) form.setCustomTerms(d.customTerms);
      if (d.customNotes !== undefined) form.setCustomNotes(d.customNotes);
      if (d.internalNote !== undefined) form.setInternalNote(d.internalNote);
      if (d.extraSections) form.setExtraSections(d.extraSections);
      if (d.taxInclusive !== undefined) form.setTaxInclusive(d.taxInclusive);

      if (d.invoiceOptions) {
        let mergedOpts;
        try {
          const saved = localStorage.getItem(OPTIONS_STORAGE_KEY);
          const persisted = saved ? JSON.parse(saved) : {};
          delete persisted.paymentAccountSnapshot;
          mergedOpts = { ...DEFAULT_OPTIONS, ...persisted, ...d.invoiceOptions };
        } catch { mergedOpts = { ...DEFAULT_OPTIONS, ...d.invoiceOptions }; }

        // Repair a stale/missing payment-account snapshot from the bill's profile.
        const billSnap = d.invoiceOptions.paymentAccountSnapshot;
        const billSelId = d.invoiceOptions.selectedAccountId;
        const snapshotIsStale = billSnap && billSelId && billSnap.id && billSnap.id !== billSelId;
        if ((!billSnap || snapshotIsStale) && d.profile) {
          const snap = getAccountById(d.profile, billSelId);
          if (snap) mergedOpts.paymentAccountSnapshot = snap;
        }
        form.setInvoiceOptions(mergedOpts);
      }

      if (editingBill._isDuplicate) {
        // DUPLICATE / CONVERT — keep the data, mint a fresh number + date.
        const convertType = editingBill._convertToType;
        const type = convertType || d.invoiceType || 'tax-invoice';
        if (convertType) {
          form.setInvoiceType(convertType);
          const config = INVOICE_TYPES[convertType];
          if (config) {
            form.setInvoiceOptions(prev => ({ ...prev, showGST: config.showGST, showPlaceOfSupply: config.showGST }));
          }
        }
        const { prefix, explicitPrefix } = resolvePrefix(type);
        getNextInvoiceNumber(prefix, { peek: true, explicitPrefix }).then(num => {
          form.setDetails({ ...d.details, invoiceNumber: num, invoiceDate: new Date().toISOString().split('T')[0] });
          form.numberReserved.current = false;
        });
      } else {
        form.setDetails(d.details);
      }
    } else if (!form.details.invoiceNumber) {
      // NEW INVOICE — preview the next number without reserving it.
      const { prefix, explicitPrefix } = resolvePrefix(form.invoiceType);
      getNextInvoiceNumber(prefix, { peek: true, explicitPrefix }).then(num => {
        form.setDetails(prev => ({ ...prev, invoiceNumber: num }));
        form.numberReserved.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingBill]);

  // ---- SAVE -----------------------------------------------------------------------
  /**
   * Persist the invoice. Returns the saved bill on success, null on a handled
   * failure (e.g. unrecoverable 409); unexpected errors are rethrown.
   *
   * @param {boolean} skipStockDeduction  true for auto-save — stock only moves
   *                                      on explicit Save / Save & Download.
   * @param {object}  extraPatch          e.g. { printedCount, lastPrintedAt }
   */
  const saveInvoice = async (skipStockDeduction = false, extraPatch = {}) => {
    const {
      invoiceType, client, details, items, customTerms, customNotes,
      internalNote, extraSections, invoiceOptions, taxInclusive,
    } = form;

    let finalInvoiceNumber = details.invoiceNumber;

    // 1. Atomically reserve the number on FIRST save (the displayed number was
    //    only peeked — concurrent users must not receive the same one).
    if (!editingBill && !form.numberReserved.current) {
      try {
        const { prefix, explicitPrefix } = resolvePrefix(invoiceType);
        finalInvoiceNumber = await getNextInvoiceNumber(prefix, { explicitPrefix });
        form.setDetails(prev => ({ ...prev, invoiceNumber: finalInvoiceNumber }));
        form.numberReserved.current = true;
      } catch { /* fall through with peeked number */ }
    }

    // 2. Snapshot the payment account so this invoice's PDF keeps rendering the
    //    same bank/UPI details even if the profile is edited later.
    const priorSnapshot = invoiceOptions.paymentAccountSnapshot;
    const priorMatchesSelection = priorSnapshot && priorSnapshot.id === invoiceOptions.selectedAccountId;
    const snapAccount = priorMatchesSelection
      ? priorSnapshot
      : getAccountById(profile, invoiceOptions.selectedAccountId);
    const invoiceOptionsWithSnapshot = { ...invoiceOptions, paymentAccountSnapshot: snapAccount || null };

    // 3. Plan client-credit application (new bills only).
    const creditPlan = (!editingBill && creditToApply > 0.005)
      ? planCreditApplication(client.name, allBills, creditToApply, finalInvoiceNumber)
      : null;

    // 4. Merge payments recorded server-side since this edit session opened
    //    (deduped by receiptNo / id / amount+date+mode fingerprint).
    const seedPayments = editingBill?.payments ? [...editingBill.payments] : [];
    if (editingBill?.id) {
      try {
        const serverBills = await getAllBills();
        const fresh = serverBills.find(b => b.id === editingBill.id);
        const freshPayments = Array.isArray(fresh?.payments) ? fresh.payments : [];
        for (const fp of freshPayments) {
          const dup = seedPayments.some(p =>
            (fp.receiptNo && p.receiptNo === fp.receiptNo)
            || (fp.id && p.id === fp.id)
            || (Math.abs((Number(p.amount) || 0) - (Number(fp.amount) || 0)) < 0.005
              && p.date === fp.date
              && (p.mode || '') === (fp.mode || '')));
          if (!dup) seedPayments.push(fp);
        }
      } catch { /* offline — keep local payments */ }
    }
    if (creditPlan?.targetEntry) seedPayments.push(creditPlan.targetEntry);

    // 5. Payment status from merged payments vs grand total.
    const seedPaidAmount = seedPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const billTotalForStatus = Number(totals.total) || 0;
    const computedStatus = seedPaidAmount >= billTotalForStatus - 0.005 && billTotalForStatus > 0
      ? 'paid'
      : (seedPaidAmount > 0.005 ? 'partial' : 'unpaid');
    const seedStatus = (computedStatus === 'unpaid' && editingBill?.status === 'overdue')
      ? 'overdue'
      : computedStatus;

    // 6. Assemble the bill record (shape consumed by Dashboard / GSTReturns / Reports).
    const bill = {
      id: finalInvoiceNumber,
      clientName: client.name,
      invoiceNumber: finalInvoiceNumber,
      invoiceDate: details.invoiceDate,
      invoiceType,
      currency: invoiceOptions.currency || 'INR',
      totalAmount: totals.total,
      totalTaxAmount: totals.totalTaxAmount
        ?? (totals.cgst + totals.sgst + (totals.utgst || 0) + totals.igst + (totals.cess || 0)),
      status: seedStatus,
      paidAmount: seedPaidAmount,
      payments: seedPayments,
      printedCount: extraPatch.printedCount ?? editingBill?.printedCount ?? 0,
      lastPrintedAt: extraPatch.lastPrintedAt ?? editingBill?.lastPrintedAt ?? null,
      data: {
        profile, client,
        details: { ...details, invoiceNumber: finalInvoiceNumber },
        items, totals, invoiceType, customTerms, customNotes, internalNote,
        extraSections, invoiceOptions: invoiceOptionsWithSnapshot, taxInclusive,
      },
    };

    const shouldOverwrite = !!editingBill || hasBeenSaved.current;

    // 7. Persist — with duplicate-invoice-number recovery for brand-new bills.
    try {
      await saveBill(bill, { overwrite: shouldOverwrite });

      // Patch the source bills the credit was consumed from.
      if (creditPlan?.sourcePatches?.length) {
        try {
          for (const { updatedBill } of creditPlan.sourcePatches) {
            await saveBill(updatedBill, { overwrite: true });
          }
          const applied = creditPlan.amountApplied;
          const from = creditPlan.consumedFrom.map(c => c.invoiceNumber).join(', ');
          toast(`${formatCurrency(applied, invoiceOptions.currency || 'INR')} credit applied from ${from}`, 'success');
          refreshBills();
          setCreditToApply(0);
        } catch (creditErr) {
          console.error('Source-bill credit patch failed:', creditErr);
          toast('Credit applied on this bill, but source bill update failed. Please review Client ledger.', 'warning');
        }
      }

      // Remember the client's preferred paper size / currency for next time.
      if (clientSearch?.selectedClientId) {
        const cli = clientSearch.savedClients.find(c => c.id === clientSearch.selectedClientId);
        if (cli) {
          const nextPaperSize = invoiceOptions.paperSize || 'a4';
          const nextCurrency = invoiceOptions.currency || 'INR';
          if (cli.preferredPaperSize !== nextPaperSize || cli.preferredCurrency !== nextCurrency) {
            clientSearch.patchClient(cli, { preferredPaperSize: nextPaperSize, preferredCurrency: nextCurrency });
          }
        }
      }

      hasBeenSaved.current = true;
      form.isDirty.current = false;
    } catch (err) {
      if (err?.status === 409) {
        if (!editingBill && !shouldOverwrite) {
          // Someone else took the number between peek and save — walk forward.
          const { prefix, explicitPrefix } = resolvePrefix(invoiceType);
          let nextNum = bill.id;
          let success = false;
          for (let i = 0; i < 20; i++) {
            try {
              nextNum = await getNextInvoiceNumber(prefix, { explicitPrefix });
              const retryBill = { ...bill, id: nextNum, invoiceNumber: nextNum };
              retryBill.data = { ...retryBill.data, details: { ...retryBill.data.details, invoiceNumber: nextNum } };
              await saveBill(retryBill, { overwrite: false });
              success = true;
              form.setDetails(prev => ({ ...prev, invoiceNumber: nextNum }));
              hasBeenSaved.current = true;
              form.isDirty.current = false;
              if (nextNum !== bill.id) {
                toast(`Invoice number ${bill.id} was already used — saved as ${nextNum} instead.`, 'info');
              }
              break;
            } catch (retryErr) {
              if (retryErr?.status !== 409) throw retryErr;
            }
          }
          if (!success) {
            toast('Could not find a free invoice number after 20 attempts. Please change the number manually.', 'error');
            return null;
          }
        } else {
          toast(`Invoice number ${bill.id} already exists. Change it before saving.`, 'error');
          return null;
        }
      } else {
        throw err;
      }
    }

    // 8. Recurring template (auto-generates future copies of this invoice).
    if (invoiceOptions.recurring?.enabled) {
      try {
        const rec = invoiceOptions.recurring;
        const templateId = `tpl_${details.invoiceNumber}`;
        await saveRecurring({
          id: templateId,
          sourceInvoiceId: details.invoiceNumber,
          active: true,
          frequency: rec.frequency || 'monthly',
          interval: rec.interval || 1,
          nextDate: rec.nextDate,
          endMode: rec.endMode || 'never',
          endDate: rec.endDate || '',
          maxOccurrences: rec.maxOccurrences || null,
          occurrencesCreated: 0,
          createdAt: new Date().toISOString(),
          lastGenerated: null,
          clientName: client.name,
          clientState: client.state,
          clientGstin: client.gstin,
          clientAddress: client.address,
          clientCountry: client.country,
          clientCity: client.city,
          clientPin: client.pin,
          clientEmail: client.email,
          clientPhone: client.phone,
          isSEZ: client.isSEZ,
          invoiceType,
          profileId: profile?.id || null,
          profileBusinessName: profile?.businessName || null,
          items: items.map(i => ({ ...i })),
          customTerms,
          customNotes,
          extraSections,
          taxInclusive,
          invoiceOptions: { ...invoiceOptions, recurring: null },
        });
      } catch (err) {
        console.error('Failed to save recurring template:', err);
        toast('Invoice saved, but recurring template failed to save', 'warning');
      }
    }

    // 9. Inventory ledger — revert previous state, apply current (see useProductSearch).
    if (!skipStockDeduction && syncStock) {
      await syncStock(items);
    }

    return bill;
  };

  // Keep a live ref so the debounced auto-save always calls the latest closure.
  const saveInvoiceRef = useRef(saveInvoice);
  saveInvoiceRef.current = saveInvoice;

  // ---- AUTO-SAVE (2s debounce, meaningful invoices only, no stock movement) ------
  useEffect(() => {
    if (!form.hasInitialized.current) return;
    form.isDirty.current = true;
    if (!form.details.invoiceNumber) return;
    if (!form.isMeaningfulInvoice()) {
      setAutoSaveStatus(s => (s === 'saved' ? 'idle' : s));
      return;
    }
    // Brand-new unsaved bill: the sessionStorage draft is enough until the
    // user explicitly saves (keeps invoice numbers gapless).
    if (!editingBill && !hasBeenSaved.current) {
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus(s => (s === 'saved' ? 'idle' : s)), 2000);
      return;
    }
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try {
        setAutoSaveStatus('saving');
        await saveInvoiceRef.current(true);
        setAutoSaveStatus('saved');
        form.isDirty.current = false;
        setTimeout(() => setAutoSaveStatus(s => (s === 'saved' ? 'idle' : s)), 2000);
      } catch (err) {
        console.error('Auto-save failed:', err);
        setAutoSaveStatus('idle');
      }
    }, 2000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [
    form.invoiceType, form.client, form.details, form.items, form.customTerms,
    form.customNotes, form.internalNote, form.extraSections, form.invoiceOptions,
    form.isMeaningfulInvoice, editingBill,
  ]);

  return {
    saveInvoice,
    saving, setSaving,
    autoSaveStatus,
    hasBeenSaved,
    // client credit
    clientCredit,
    creditToApply, setCreditToApply,
    // data
    allBills,
    refreshBills,
  };
}

export default useInvoicePersistence;