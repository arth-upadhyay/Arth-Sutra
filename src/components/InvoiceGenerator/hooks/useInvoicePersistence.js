import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { saveBill, getAllBills, getNextInvoiceNumber, saveRecurring, getAllProducts } from '../../../store';
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

// Snapshot the current purchase price of each product onto the line items of a
// bill before saving. Once stamped, `costAtSale` never changes — so profit
// computed later on old bills stays stable even if the product's purchase
// price is edited in Inventory.
async function stampCostAtSale(items) {
  if (!Array.isArray(items) || items.length === 0) return items;
  let products = [];
  try { products = await getAllProducts(); } catch { /* offline — skip stamp */ }
  const byId = new Map(products.map(p => [p.id, p]));
  const byName = new Map(products.map(p => [(p.name || '').trim().toLowerCase(), p]));

  return items.map(it => {
    if (it == null) return it;
    // Already stamped (e.g. editing a bill saved after this shipped) — leave it.
    if (Number.isFinite(Number(it.costAtSale)) && Number(it.costAtSale) > 0) return it;
    const prod = (it.productId && byId.get(it.productId))
      || byName.get((it.name || '').trim().toLowerCase());
    const cost = Number(prod?.purchasePrice);
    if (!Number.isFinite(cost) || cost <= 0) return it;
    return { ...it, costAtSale: cost };
  });
}

export function useInvoicePersistence({
  form,
  totals,
  profile = null,
  editingBill = null,
  syncStock = null,
  clientSearch = null,
} = {}) {
  const [saving, setSaving] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle');
  const [allBills, setAllBills] = useState([]);
  const [creditToApply, setCreditToApply] = useState(0);

  const autoSaveTimer = useRef(null);
  const hasBeenSaved = useRef(!!editingBill);
  const lastAutoAppliedClient = useRef(null);

  const refreshBills = useCallback(() => {
    getAllBills().then(setAllBills).catch(() => {});
  }, []);

  useEffect(() => { refreshBills(); }, [refreshBills]);

  const clientCredit = useMemo(() => {
    const name = form.client?.name;
    if (!name?.trim()) return { available: 0, sources: [] };
    const otherBills = editingBill ? allBills.filter(b => b.id !== editingBill.id) : allBills;
    return getClientCredit(name, otherBills);
  }, [form.client?.name, allBills, editingBill]);

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

  useEffect(() => {
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
      const { prefix, explicitPrefix } = resolvePrefix(form.invoiceType);
      getNextInvoiceNumber(prefix, { peek: true, explicitPrefix }).then(num => {
        form.setDetails(prev => ({ ...prev, invoiceNumber: num }));
        form.numberReserved.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingBill]);

  const saveInvoice = async (skipStockDeduction = false, extraPatch = {}) => {
    const {
      invoiceType, client, details, items, customTerms, customNotes,
      internalNote, extraSections, invoiceOptions, taxInclusive,
    } = form;

    let finalInvoiceNumber = details.invoiceNumber;

    if (!editingBill && !form.numberReserved.current) {
      try {
        const { prefix, explicitPrefix } = resolvePrefix(invoiceType);
        finalInvoiceNumber = await getNextInvoiceNumber(prefix, { explicitPrefix });
        form.setDetails(prev => ({ ...prev, invoiceNumber: finalInvoiceNumber }));
        form.numberReserved.current = true;
      } catch { /* fall through */ }
    }

    // NEW: stamp costAtSale BEFORE assembling the bill. For auto-saves we skip
    // this — the price snapshot only needs to be correct at final save time,
    // and skipping saves a products round-trip on every debounce tick.
    const itemsWithCost = skipStockDeduction
      ? items
      : await stampCostAtSale(items);

    const priorSnapshot = invoiceOptions.paymentAccountSnapshot;
    const priorMatchesSelection = priorSnapshot && priorSnapshot.id === invoiceOptions.selectedAccountId;
    const snapAccount = priorMatchesSelection
      ? priorSnapshot
      : getAccountById(profile, invoiceOptions.selectedAccountId);
    const invoiceOptionsWithSnapshot = { ...invoiceOptions, paymentAccountSnapshot: snapAccount || null };

    const creditPlan = (!editingBill && creditToApply > 0.005)
      ? planCreditApplication(client.name, allBills, creditToApply, finalInvoiceNumber)
      : null;

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
      } catch { /* offline */ }
    }
    if (creditPlan?.targetEntry) seedPayments.push(creditPlan.targetEntry);

    const seedPaidAmount = seedPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const billTotalForStatus = Number(totals.total) || 0;
    const computedStatus = seedPaidAmount >= billTotalForStatus - 0.005 && billTotalForStatus > 0
      ? 'paid'
      : (seedPaidAmount > 0.005 ? 'partial' : 'unpaid');
    const seedStatus = (computedStatus === 'unpaid' && editingBill?.status === 'overdue')
      ? 'overdue'
      : computedStatus;

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
        items: itemsWithCost,     // ← stamped items go into the bill
        totals, invoiceType, customTerms, customNotes, internalNote,
        extraSections, invoiceOptions: invoiceOptionsWithSnapshot, taxInclusive,
      },
    };

    const shouldOverwrite = !!editingBill || hasBeenSaved.current;

    try {
      await saveBill(bill, { overwrite: shouldOverwrite });

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
          items: itemsWithCost.map(i => ({ ...i })),
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

    if (!skipStockDeduction && syncStock) {
      await syncStock(items);
    }

    return bill;
  };

  const saveInvoiceRef = useRef(saveInvoice);
  saveInvoiceRef.current = saveInvoice;

  useEffect(() => {
    if (!form.hasInitialized.current) return;
    form.isDirty.current = true;
    if (!form.details.invoiceNumber) return;
    if (!form.isMeaningfulInvoice()) {
      setAutoSaveStatus(s => (s === 'saved' ? 'idle' : s));
      return;
    }
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
    clientCredit,
    creditToApply, setCreditToApply,
    allBills,
    refreshBills,
  };
}

export default useInvoicePersistence;