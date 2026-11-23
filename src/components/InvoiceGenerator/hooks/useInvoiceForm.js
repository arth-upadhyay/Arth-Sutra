import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { INVOICE_TYPES, getDefaultUnitForMode, getCountryConfig, validateTaxId } from '../../../utils';
import { getPrintSettings } from '../../../utils/printSettings';
import { getNextInvoiceNumber, getTermsTemplates, getInvoiceDisplayOptions, saveInvoiceDisplayOptions } from '../../../store';

export const DRAFT_KEY = 'gst_invoiceDraft';
export const OPTIONS_STORAGE_KEY = 'arthsutra_invoiceOptions';

export const DEFAULT_OPTIONS = {
  showGST: true,
  showState: true,
  showGSTIN: true,
  showPlaceOfSupply: true,
  showHSN: true,
  showDiscount: true,
  showBankDetails: true,
  showUPI: true,
  showLogo: true,
  showSignature: true,
  showTerms: true,
  showNotes: true,
  showAmountWords: true,
  showDueDate: true,
  showItemQty: true,
  showRoundOff: false,
  invoiceMode: 'goods',
  paperSize: 'a4',
  thermalFontSize: 'medium',
  thermalCompact: false,
  thermalCutMark: true,
  recurring: null,
  showCess: false,
  reverseCharge: false,
  showTDS: false,
  tdsSection: '194Q',
  tdsRate: 0.1,
  tdsCumulativeThisYear: 0,
  showTCS: false,
  tcsSection: '206C(1H)',
  tcsRate: 0.1,
  tcsCumulativeThisYear: 0,
  customTitle: '',
  currency: 'INR',
  exchangeRate: '',
  selectedAccountId: null,
  showAccountLabel: false,
  accentColor: '',
  pdfStyle: 'classic',
  invoiceDiscountValue: 0,
  invoiceDiscountType: 'fixed',
  autoApplyClientCredit: false,
  layoutFormat: 'pharma',
};

export const EMPTY_CLIENT = {
  name: '', address: '', city: '', pin: '', state: '', gstin: '',
  country: '', email: '', phone: '', isSEZ: false, licence: '',
};

export const createEmptyDetails = () => ({
  invoiceNumber: '',
  poNumber: '',
  invoiceDate: new Date().toISOString().split('T')[0],
  dueDate: '',
  placeOfSupply: '',
  originalInvoiceRef: '',
  shipToSameAsBilling: true,
  shippingAddress: '',
  shippingCity: '',
  shippingPin: '',
  shippingState: '',
  sellerLicence: '',
});

export const createLineItem = (overrides = {}) => ({
  id: Date.now().toString(),
  name: '', hsn: '', quantity: 1, unit: 'Nos', rate: 0, discount: 0,
  taxPercent: 18, cessPercent: 0, batch: '', expiry: '', omrp: 0, mrp: 0, pkg: '',
  ...overrides,
});

export function loadDraft() {
  try {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
}

export function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* sandboxed */ }
}

export function useInvoiceForm({ editingBill = null, profile = null } = {}) {
  const [draft] = useState(() => loadDraft());

  const [invoiceType, setInvoiceType] = useState(draft?.invoiceType || 'tax-invoice');
  const [client, setClient] = useState(draft?.client || { ...EMPTY_CLIENT });
  const [details, setDetails] = useState(draft?.details || createEmptyDetails());
  const [items, setItems] = useState(draft?.items || [createLineItem()]);
  const [taxInclusive, setTaxInclusive] = useState(draft?.taxInclusive || false);
  const [selectedTermsId, setSelectedTermsId] = useState(draft?.selectedTermsId || '');
  const [customTerms, setCustomTerms] = useState(draft?.customTerms || '');
  const [customNotes, setCustomNotes] = useState(draft?.customNotes || '');
  const [internalNote, setInternalNote] = useState(draft?.internalNote || '');
  const [extraSections, setExtraSections] = useState(draft?.extraSections || []);
  const [termsTemplates, setTermsTemplates] = useState([]);

  const [invoiceOptions, setInvoiceOptions] = useState(() => {
    try {
      const saved = localStorage.getItem(OPTIONS_STORAGE_KEY);
      const persisted = saved ? JSON.parse(saved) : {};
      delete persisted.paymentAccountSnapshot;
      return { ...DEFAULT_OPTIONS, ...persisted, ...(draft?.invoiceOptions || {}), paperSize: 'a4' };
    } catch { return { ...DEFAULT_OPTIONS, paperSize: 'a4' }; }
  });

  const draftInitialized = useRef(!!draft);
  const isDirty = useRef(false);
  const hasInitialized = useRef(false);
  const numberReserved = useRef(!!editingBill);

  const showGST = !(invoiceType === 'bill-of-supply' || invoiceType === 'composition');

  const sellerCountryConfig = getCountryConfig(profile?.country);
  const baseCountryRates = sellerCountryConfig.taxRates?.length
    ? sellerCountryConfig.taxRates
    : [0, 5, 12, 18, 28];
  const countryTaxRates = useMemo(() => {
    let custom = [];
    try {
      const ps = getPrintSettings();
      custom = Array.isArray(ps.customTaxRates)
        ? ps.customTaxRates.map(Number).filter(n => isFinite(n) && n >= 0 && n <= 100)
        : [];
    } catch { /* settings unavailable */ }
    return [...new Set([...baseCountryRates, ...custom])].sort((a, b) => a - b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCountryRates.join(',')]);
  const taxLabel = sellerCountryConfig.taxLabel || 'GST';

  const clampNonNeg = useCallback((raw) => {
    const n = parseFloat(raw);
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const draftData = {
        invoiceType, client, details, items, customTerms, customNotes,
        internalNote, extraSections, selectedTermsId, invoiceOptions, taxInclusive,
      };
      try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draftData)); } catch { /* quota */ }
    }, 400);
    return () => clearTimeout(t);
  }, [invoiceType, client, details, items, customTerms, customNotes,
      internalNote, extraSections, selectedTermsId, invoiceOptions, taxInclusive]);

  useEffect(() => {
    const t = setTimeout(() => { hasInitialized.current = true; }, 1500);
    return () => clearTimeout(t);
  }, []);

  const optionsPersistTimer = useRef(null);
  useEffect(() => {
    const { paymentAccountSnapshot: _snap, ...persistable } = invoiceOptions;
    try { localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(persistable)); } catch { /* sandboxed */ }
    if (hasInitialized.current) {
      clearTimeout(optionsPersistTimer.current);
      optionsPersistTimer.current = setTimeout(() => {
        saveInvoiceDisplayOptions(persistable).catch(() => {});
      }, 800);
    }
    return () => clearTimeout(optionsPersistTimer.current);
  }, [invoiceOptions]);

  useEffect(() => {
    getInvoiceDisplayOptions().then(serverOpts => {
      if (!serverOpts) return;
      delete serverOpts.paymentAccountSnapshot;
      serverOpts.paperSize = 'a4';
      const merged = { ...DEFAULT_OPTIONS, ...serverOpts };
      setInvoiceOptions(prev => {
        const changed = Object.keys(merged).some(k => merged[k] !== prev[k]);
        if (!changed) return prev;
        const nextOpts = { ...merged, paymentAccountSnapshot: prev.paymentAccountSnapshot };
        const { paymentAccountSnapshot: _skip, ...toPersist } = nextOpts;
        try { localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(toPersist)); } catch { /* ignore */ }
        return nextOpts;
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    getTermsTemplates().then(templates => {
      setTermsTemplates(templates);
      if (templates.length > 0 && !selectedTermsId && !draftInitialized.current) {
        setSelectedTermsId(templates[0].id);
        setCustomTerms(templates[0].content);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateItem = useCallback((id, field, value) => {
    setItems(prev => prev.map(item => (item.id === id ? { ...item, [field]: value } : item)));
  }, []);

  const addItem = useCallback(({ focus = true } = {}) => {
    const defaultUnit = items.length > 0 && items[items.length - 1].unit
      ? items[items.length - 1].unit
      : getDefaultUnitForMode(invoiceOptions.invoiceMode);
    const newId = Date.now().toString();
    setItems(prev => [...prev, createLineItem({
      id: newId,
      unit: defaultUnit,
      taxPercent: showGST ? (countryTaxRates[countryTaxRates.length - 2] ?? 18) : 0,
    })]);
    if (focus) {
      requestAnimationFrame(() => {
        document.querySelector(`[data-item-id="${newId}"] input.form-input`)?.focus();
      });
    }
    return newId;
  }, [items, invoiceOptions.invoiceMode, showGST, countryTaxRates]);

  const removeItem = useCallback((id) => {
    setItems(prev => (prev.length > 1 ? prev.filter(item => item.id !== id) : prev));
  }, []);

  const duplicateLastItem = useCallback(() => {
    setItems(prev => (prev.length === 0
      ? prev
      : [...prev, { ...prev[prev.length - 1], id: Date.now().toString() }]));
  }, []);

  const toggleOption = useCallback((key) => {
    setInvoiceOptions(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setOption = useCallback((key, value) => {
    setInvoiceOptions(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleTermsSelect = useCallback((templateId) => {
    setSelectedTermsId(templateId);
    const tpl = termsTemplates.find(t => t.id === templateId);
    if (tpl) setCustomTerms(tpl.content);
  }, [termsTemplates]);

  const handleTypeChange = useCallback(async (type) => {
    setInvoiceType(type);
    const config = INVOICE_TYPES[type];
    const ps = getPrintSettings();
    const rawOverride = ps.customPrefixes?.[type];
    const overridePrefix = rawOverride && rawOverride.trim();
    const prefix = overridePrefix || config?.prefix || 'INV';
    const num = await getNextInvoiceNumber(prefix, { peek: true, explicitPrefix: !!overridePrefix });
    numberReserved.current = false;
    setDetails(prev => ({ ...prev, invoiceNumber: num }));

    if (type === 'bill-of-supply') {
      setInvoiceOptions(prev => ({ ...prev, showGST: false, showPlaceOfSupply: false }));
    } else if (config) {
      setInvoiceOptions(prev => ({ ...prev, showGST: config.showGST, showPlaceOfSupply: config.showGST }));
    }
  }, []);

  const isMeaningfulInvoice = useCallback(() => {
    if (editingBill) return true;
    if (!client?.name?.trim()) return false;
    return items.some(item => (item.name || '').trim() && (item.quantity || 0) * (item.rate || 0) > 0);
  }, [client?.name, items, editingBill]);

  const validate = useCallback(({ totals } = {}) => {
    const errors = [];
    const warnings = [];

    if (!client?.name?.trim()) {
      errors.push({ field: 'client.name', message: 'Client name is required' });
    }
    const validLines = items.filter(it =>
      (it.name || '').trim() && (Number(it.quantity) || 0) * (Number(it.rate) || 0) > 0);
    if (validLines.length === 0) {
      errors.push({ field: 'items', message: 'Add at least one item with a name and quantity × rate greater than zero' });
    }
    if (!details.invoiceNumber?.trim()) {
      warnings.push({ field: 'details.invoiceNumber', message: 'Invoice number is empty — one will be reserved automatically on save' });
    }
    if (!details.invoiceDate) {
      errors.push({ field: 'details.invoiceDate', message: 'Invoice date is required' });
    }

    const taxIdCheck = validateTaxId(client?.country || profile?.country, client?.gstin);
    if (!taxIdCheck.ok) {
      warnings.push({ field: 'client.gstin', message: taxIdCheck.message });
    }

    if (totals?.needsProfileFix) {
      errors.push({
        field: 'profile.state',
        message: 'Set your business State in Settings — required for correct CGST/SGST vs IGST split.',
      });
    }
    (totals?.warnings || []).forEach(w => warnings.push({ field: 'totals', message: w }));

    return { valid: errors.length === 0, errors, warnings };
  }, [client, items, details, profile]);

  const resetForm = useCallback(() => {
    clearDraft();
    setInvoiceType('tax-invoice');
    setClient({ ...EMPTY_CLIENT });
    setDetails(createEmptyDetails());
    setItems([createLineItem()]);
    setTaxInclusive(false);
    setSelectedTermsId('');
    setCustomTerms('');
    setCustomNotes('');
    setInternalNote('');
    setExtraSections([]);
    isDirty.current = false;
    numberReserved.current = false;
  }, []);

  return {
    invoiceType, setInvoiceType,
    client, setClient,
    details, setDetails,
    items, setItems,
    taxInclusive, setTaxInclusive,
    invoiceOptions, setInvoiceOptions,
    selectedTermsId, setSelectedTermsId,
    customTerms, setCustomTerms,
    customNotes, setCustomNotes,
    internalNote, setInternalNote,
    extraSections, setExtraSections,
    termsTemplates,
    showGST, countryTaxRates, taxLabel, typeConfig: INVOICE_TYPES[invoiceType] || INVOICE_TYPES['tax-invoice'],
    draftInitialized, isDirty, hasInitialized, numberReserved,
    updateItem, addItem, removeItem, duplicateLastItem,
    toggleOption, setOption, handleTermsSelect, handleTypeChange,
    clampNonNeg,
    isMeaningfulInvoice, validate,
    clearDraft, resetForm,
  };
}

export default useInvoiceForm;