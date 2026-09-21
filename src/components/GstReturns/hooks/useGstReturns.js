import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getAllBills, getAllExpenses, getAllPurchases, getProfile } from '../../../store';
import {
  formatCurrency, INVOICE_TYPES, getStateCode, formatDateGST,
  getFilingPeriod, getUnitUQC, getFYOptions,
} from '../../../utils';
import { toast } from '../../Toast';
import { GST_TYPES, QUARTERS } from '../constants';
import {
  downloadCSV, round2, computeItemTaxSplit, getTaxableAmount,
  buildReconciliation, billIsInterstate, billIsIntraUT,
} from '../utils/gstHelpers';

export function useGstReturns() {
  // ========== State ==========
  const [bills, setBills] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [profile, setProfile] = useState({});
  const [filterMode, setFilterMode] = useState('month');
  const [fyFilter, setFyFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [quarterFilter, setQuarterFilter] = useState('Q1');
  const [activeTab, setActiveTab] = useState('gstr1');
  const [gstr2bData, setGstr2bData] = useState(null);
  const [gstr2bFilter, setGstr2bFilter] = useState('all');
  const gstr2bInputRef = useRef(null);
  const [guideTab, setGuideTab] = useState('regular');
  const [filingStatus, setFilingStatus] = useState(() => {
    try { return JSON.parse(localStorage.getItem('gst_filing_status') || '{}'); } catch { return {}; }
  });

  // ========== Derived options ==========
  const fyOptions = useMemo(() => getFYOptions(), []);
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const out = [];
    for (let y = currentYear; y >= currentYear - 5; y--) out.push(y);
    return out;
  }, []);

  // ========== GSTR-2B import ==========
  const handleImport2B = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const root = json?.data || json;
      if (!root?.docdata && !root?.b2b) {
        toast("That doesn't look like a GSTR-2B JSON. Expected docdata.b2b array.", 'error');
        return;
      }
      setGstr2bData(root);
      const supplierCount = (root.docdata?.b2b || root.b2b || []).length;
      toast(`Imported GSTR-2B for ${root.gstin || '?'} — ${supplierCount} suppliers`, 'success');
    } catch (err) {
      console.error(err);
      toast('Failed to parse GSTR-2B JSON', 'error');
    }
    if (gstr2bInputRef.current) gstr2bInputRef.current.value = '';
  }, []);

  // ========== Data loading ==========
  const loadData = useCallback(async () => {
    try {
      const [b, e, p] = await Promise.all([getAllBills(), getAllExpenses(), getProfile()]);
      setBills(b); setExpenses(e); setProfile(p || {});
      // Purchases endpoint may not exist on older server versions
      try {
        const pur = await getAllPurchases();
        setPurchases(pur || []);
      } catch { /* ignore — older servers don't have this endpoint */ }
    } catch { toast('Failed to load data', 'error'); }
  }, []);

  useEffect(() => {
    const now = new Date();
    const fy = fyOptions[0];
    if (fy) setFyFilter(fy.value);
    setYearFilter(String(now.getFullYear()));
    setMonthFilter(String(now.getMonth()));
    const m = now.getMonth();
    const q = QUARTERS.find(qq => qq.months.includes(m));
    if (q) setQuarterFilter(q.id);
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========== Period filtering ==========
  const filterByPeriod = useCallback((date) => {
    if (!date) return false;
    if (filterMode === 'fy') {
      const fy = fyOptions.find(f => f.value === fyFilter);
      return fy ? date >= fy.from && date <= fy.to : true;
    } else if (filterMode === 'quarter') {
      const d = new Date(date);
      const q = QUARTERS.find(qq => qq.id === quarterFilter);
      if (!q) return false;
      const yr = parseInt(yearFilter);
      return q.months.includes(d.getMonth()) && d.getFullYear() === yr;
    } else {
      const d = new Date(date);
      return d.getFullYear() === parseInt(yearFilter) && d.getMonth() === parseInt(monthFilter);
    }
  }, [filterMode, fyFilter, quarterFilter, yearFilter, monthFilter, fyOptions]);

  // v1.10.4 — audit H13. Memoized on the same deps used by filterByPeriod.
  const filteredBills = useMemo(() => bills.filter(bill => {
    const type = bill.invoiceType || 'tax-invoice';
    if (!GST_TYPES.includes(type)) return false;
    if (!bill.data) return false;
    return filterByPeriod(bill.invoiceDate);
  }), [bills, filterByPeriod]);

  const allFilteredBills = useMemo(
    () => bills.filter(bill => bill.data && filterByPeriod(bill.invoiceDate)),
    [bills, filterByPeriod]);

  const filteredExpenses = useMemo(
    () => expenses.filter(exp => filterByPeriod(exp.date)),
    [expenses, filterByPeriod]);

  const filteredPurchases = useMemo(
    () => purchases.filter(p => filterByPeriod(p.date)),
    [purchases, filterByPeriod]);

  // ========== Classification ==========
  const creditNotes = useMemo(
    () => filteredBills.filter(b => (b.invoiceType || 'tax-invoice') === 'credit-note'),
    [filteredBills]);
  const regularBills = useMemo(
    () => filteredBills.filter(b => (b.invoiceType || 'tax-invoice') !== 'credit-note'),
    [filteredBills]);
  const b2bRegular = useMemo(() => regularBills.filter(b => b.data?.client?.gstin), [regularBills]);
  const b2cRegular = useMemo(() => regularBills.filter(b => !b.data?.client?.gstin), [regularBills]);
  const b2cLarge = useMemo(() => b2cRegular.filter(b => {
    const isInter = billIsInterstate(b);
    return isInter && (b.totalAmount || 0) > 250000;
  }), [b2cRegular]);
  const b2cSmall = useMemo(() => b2cRegular.filter(b => {
    const isInter = billIsInterstate(b);
    return !(isInter && (b.totalAmount || 0) > 250000);
  }), [b2cRegular]);
  const b2cBills = useMemo(
    () => filteredBills.filter(b => !b.data?.client?.gstin),
    [filteredBills]);

  // ========== B2B Rows ==========
  // v1.10.31 — GST-C2: read totals.utgst (was ignored). GST-C3: expose cess.
  const b2bRows = useMemo(() => b2bRegular.map(bill => {
    const { client, totals, details } = bill.data;
    const isInterState = billIsInterstate(bill);
    const pos = getStateCode(details?.placeOfSupply || client?.state || '');
    // UTGST goes into SGST bucket for GSTR-1 payload compat (GSTN schema
    // has no separate utgst field; `samt` covers both).
    const sgstBucket = isInterState ? 0 : ((totals?.sgst || 0) + (totals?.utgst || 0));
    return {
      gstin: client.gstin, clientName: client.name || bill.clientName || '',
      invoiceNo: bill.invoiceNumber || '', date: bill.invoiceDate || '', pos,
      supplyType: isInterState ? 'Inter' : 'Intra',
      taxable: getTaxableAmount(totals),
      cgst: isInterState ? 0 : (totals?.cgst || 0),
      sgst: sgstBucket,
      igst: isInterState ? (totals?.igst || 0) : 0,
      cess: totals?.cess || 0,
      total: totals?.total || 0,
    };
  }), [b2bRegular]);

  // ========== B2C by Rate ==========
  const b2cByRate = useMemo(() => {
    const out = {};
    b2cBills.forEach(bill => {
      const { items } = bill.data;
      const isInterState = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      (items || []).forEach(item => {
        const rate = item.taxPercent || 0;
        if (!out[rate]) out[rate] = { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
        const split = computeItemTaxSplit(item, isInterState, !!bill.data?.taxInclusive, isIntraUT);
        out[rate].taxable += split.taxable;
        out[rate].cgst += split.cgst;
        // GST-C2: UTGST folded into SGST bucket for GSTR-1 payload compat.
        out[rate].sgst += split.sgst + split.utgst;
        out[rate].igst += split.igst;
        out[rate].cess += split.cess;
        out[rate].total += split.taxable + split.cgst + split.sgst + split.utgst + split.igst + split.cess;
      });
    });
    return out;
  }, [b2cBills]);

  const b2cRates = useMemo(
    () => Object.keys(b2cByRate).map(Number).sort((a, b) => a - b),
    [b2cByRate]);

  // ========== HSN Summary ==========
  // v1.10.31 — GST-H3: key by hsn+rate+uqc so same HSN with different UQCs
  // doesn't sum quantities nonsensically. GST-C3 + C2: include cess + UTGST.
  const hsnRows = useMemo(() => {
    const hsnMap = {};
    filteredBills.forEach(bill => {
      const { items } = bill.data;
      const isInterState = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      (items || []).forEach(item => {
        const hsn = item.hsn || 'N/A';
        const rate = item.taxPercent || 0;
        const uqc = item.unit || 'OTH';
        const key = `${hsn}|${rate}|${uqc}`;
        if (!hsnMap[key]) hsnMap[key] = { hsn, rate, uqc, description: item.name || '', quantity: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, totalTax: 0 };
        const split = computeItemTaxSplit(item, isInterState, !!bill.data?.taxInclusive, isIntraUT);
        hsnMap[key].quantity += item.quantity || 0;
        hsnMap[key].taxable += split.taxable;
        hsnMap[key].cgst += split.cgst;
        hsnMap[key].sgst += split.sgst + split.utgst;
        hsnMap[key].igst += split.igst;
        hsnMap[key].cess += split.cess;
        hsnMap[key].totalTax += split.cgst + split.sgst + split.utgst + split.igst + split.cess;
        if (item.name && hsnMap[key].description && !hsnMap[key].description.includes(item.name)) {
          hsnMap[key].description += ` | ${item.name}`;
        }
      });
    });
    return Object.values(hsnMap).sort((a, b) => (a.hsn || '').localeCompare(b.hsn || ''));
  }, [filteredBills]);

  // ========== Totals ==========
  // v1.10.31 — GST-C3: sumRows carries cess. GST-H2: credit notes netted
  // from grandTotals so GSTR-3B outward supply table reflects actual liability.
  const sumRows = (rows) => rows.reduce((acc, r) => ({
    taxable: acc.taxable + r.taxable, cgst: acc.cgst + r.cgst, sgst: acc.sgst + r.sgst,
    igst: acc.igst + r.igst, cess: acc.cess + (r.cess || 0), total: acc.total + r.total,
  }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 });

  const b2bTotals = useMemo(() => sumRows(b2bRows), [b2bRows]);

  const b2cTotals = useMemo(() => b2cRates.reduce((acc, rate) => {
    const d = b2cByRate[rate];
    return {
      taxable: acc.taxable + d.taxable, cgst: acc.cgst + d.cgst, sgst: acc.sgst + d.sgst,
      igst: acc.igst + d.igst, cess: acc.cess + (d.cess || 0), total: acc.total + d.total,
    };
  }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 }), [b2cRates, b2cByRate]);

  // v1.10.31 — GST-H2: subtract credit note totals from outward supply.
  const cnTotals = useMemo(() => (creditNotes || []).reduce((acc, b) => {
    const t = b.data?.totals || {};
    const isInter = billIsInterstate(b);
    return {
      taxable: acc.taxable + (getTaxableAmount(t) || 0),
      cgst: acc.cgst + (isInter ? 0 : (t.cgst || 0)),
      sgst: acc.sgst + (isInter ? 0 : ((t.sgst || 0) + (t.utgst || 0))),
      igst: acc.igst + (isInter ? (t.igst || 0) : 0),
      cess: acc.cess + (t.cess || 0),
      total: acc.total + (t.total || 0),
    };
  }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 }), [creditNotes]);

  const grandTotals = useMemo(() => ({
    taxable: Math.max(0, b2bTotals.taxable + b2cTotals.taxable - cnTotals.taxable),
    cgst: Math.max(0, b2bTotals.cgst + b2cTotals.cgst - cnTotals.cgst),
    sgst: Math.max(0, b2bTotals.sgst + b2cTotals.sgst - cnTotals.sgst),
    igst: Math.max(0, b2bTotals.igst + b2cTotals.igst - cnTotals.igst),
    cess: Math.max(0, b2bTotals.cess + b2cTotals.cess - cnTotals.cess),
    total: b2bTotals.total + b2cTotals.total - cnTotals.total, // signed — CN nets down
    cnTotals,
  }), [b2bTotals, b2cTotals, cnTotals]);

  // ========== GSTR-3B ==========
  const outputTax = useMemo(
    () => ({ cgst: grandTotals.cgst, sgst: grandTotals.sgst, igst: grandTotals.igst }),
    [grandTotals]);

  // ITC from expenses — P1 #15 fix: route to IGST when the expense is
  // interstate. Legacy expense records without the field default to
  // intrastate (safest — preserves pre-v1.6.8 behaviour).
  const itcFromExpensesOnly = useMemo(() => filteredExpenses.reduce((acc, e) => {
    const gst = e.gstAmount || 0;
    if (e.interstate) {
      return { cgst: acc.cgst, sgst: acc.sgst, igst: acc.igst + gst };
    }
    const half = Math.round((gst / 2) * 100) / 100;
    return { cgst: acc.cgst + half, sgst: acc.sgst + (gst - half), igst: acc.igst };
  }, { cgst: 0, sgst: 0, igst: 0 }), [filteredExpenses]);

  // ITC from purchases — route to IGST when the purchase is interstate.
  const itcFromPurchases = useMemo(() => filteredPurchases.reduce((acc, p) => {
    const tax = p.totalTax || (p.items || []).reduce(
      (s, i) => s + ((i.quantity || 0) * (i.rate || 0) * (i.taxPercent || 0)) / 100, 0);
    if (p.interstate) {
      return { cgst: acc.cgst, sgst: acc.sgst, igst: acc.igst + tax };
    }
    const half = Math.round((tax / 2) * 100) / 100;
    return { cgst: acc.cgst + half, sgst: acc.sgst + (tax - half), igst: acc.igst };
  }, { cgst: 0, sgst: 0, igst: 0 }), [filteredPurchases]);

  // Combined ITC
  const itcFromExpenses = useMemo(() => ({
    cgst: itcFromExpensesOnly.cgst + itcFromPurchases.cgst,
    sgst: itcFromExpensesOnly.sgst + itcFromPurchases.sgst,
    igst: itcFromExpensesOnly.igst + itcFromPurchases.igst,
  }), [itcFromExpensesOnly, itcFromPurchases]);

  const netTax = useMemo(() => ({
    cgst: Math.max(0, outputTax.cgst - itcFromExpenses.cgst),
    sgst: Math.max(0, outputTax.sgst - itcFromExpenses.sgst),
    igst: Math.max(0, outputTax.igst - itcFromExpenses.igst),
  }), [outputTax, itcFromExpenses]);

  // ========== Document Summary ==========
  const docSummary = useMemo(() => {
    const out = {};
    allFilteredBills.forEach(bill => {
      const type = bill.invoiceType || 'tax-invoice';
      const prefix = INVOICE_TYPES[type]?.prefix || 'INV';
      if (!out[prefix]) out[prefix] = {
        type: INVOICE_TYPES[type]?.label || type,
        from: bill.invoiceNumber, to: bill.invoiceNumber, total: 0,
      };
      out[prefix].total++;
      if (bill.invoiceNumber < out[prefix].from) out[prefix].from = bill.invoiceNumber;
      if (bill.invoiceNumber > out[prefix].to) out[prefix].to = bill.invoiceNumber;
    });
    return out;
  }, [allFilteredBills]);

  // ========== Validation Warnings ==========
  const warnings = useMemo(() => {
    const out = [];
    filteredBills.forEach(bill => {
      const { client, items } = bill.data;
      // GSTIN: 2 digit state + 5 letters + 4 digits + 1 letter + 1 digit + 1 letter + 1 alphanumeric
      if (client?.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z\d]$/.test(client.gstin)) {
        out.push({ type: 'error', msg: `Invoice ${bill.invoiceNumber}: Invalid client GSTIN format — ${client.gstin}` });
      }
      (items || []).forEach(item => {
        if (!item.hsn || item.hsn === 'N/A') {
          out.push({ type: 'warning', msg: `Invoice ${bill.invoiceNumber}: Item "${item.name || 'Unnamed'}" has no HSN/SAC code` });
        }
      });
      if (client?.gstin && !client?.state) {
        out.push({ type: 'warning', msg: `Invoice ${bill.invoiceNumber}: Client ${client.name} has GSTIN but no State — Place of Supply may be wrong` });
      }
    });
    if (!profile.gstin) {
      out.push({ type: 'error', msg: 'Your business GSTIN is not set. Go to Settings → Company Details to add it.' });
    }
    return out;
  }, [filteredBills, profile]);

  // ========== Filing Period Key ==========
  const periodKey = useMemo(() => {
    if (filterMode === 'month') return `${monthFilter}_${yearFilter}`;
    if (filterMode === 'quarter') return `${quarterFilter}_${yearFilter}`;
    return fyFilter;
  }, [filterMode, monthFilter, yearFilter, quarterFilter, fyFilter]);

  const periodFiling = useMemo(
    () => filingStatus[periodKey] || {},
    [filingStatus, periodKey]);

  // v1.10.18 — pills toggle on click so a mistaken Mark Filed can be reverted.
  const toggleFiled = useCallback((returnType) => {
    const next = !periodFiling[returnType];
    const updated = {
      ...filingStatus,
      [periodKey]: {
        ...periodFiling,
        [returnType]: next,
        [`${returnType}Date`]: next ? new Date().toISOString() : null,
      },
    };
    setFilingStatus(updated);
    try { localStorage.setItem('gst_filing_status', JSON.stringify(updated)); } catch { /* localStorage full */ }
    toast(`${returnType.toUpperCase()} marked as ${next ? 'filed' : 'pending'} for this period`, 'success');
  }, [filingStatus, periodFiling, periodKey]);

  const markFiled = useCallback((returnType) => {
    const updated = {
      ...filingStatus,
      [periodKey]: {
        ...periodFiling,
        [returnType]: true,
        [`${returnType}Date`]: new Date().toISOString(),
      },
    };
    setFilingStatus(updated);
    localStorage.setItem('gst_filing_status', JSON.stringify(updated));
    toast(`${returnType.toUpperCase()} marked as filed for this period`, 'success');
  }, [filingStatus, periodFiling, periodKey]);

  const isNilReturn = filteredBills.length === 0 && filteredExpenses.length === 0;

  // ========== CSV Exports ==========
  const exportB2B = () => {
    if (b2bRows.length === 0) { toast('No B2B data to export', 'warning'); return; }
    downloadCSV('GSTR1_B2B_Invoices.csv',
      ['GSTIN/UIN', 'Receiver Name', 'Invoice Number', 'Invoice Date', 'Invoice Value', 'Place of Supply', 'Reverse Charge', 'Invoice Type', 'Supply Type', 'Taxable Value', 'CGST Amount', 'SGST Amount', 'IGST Amount'],
      b2bRegular.map(bill => {
        const { client, totals, details } = bill.data;
        const isInter = billIsInterstate(bill);
        const pos = getStateCode(details?.placeOfSupply || client?.state || '');
        return [
          client.gstin, client.name || bill.clientName || '', bill.invoiceNumber || '',
          formatDateGST(bill.invoiceDate), (totals?.total || 0).toFixed(2), pos, 'N', 'Regular',
          isInter ? 'Inter State' : 'Intra State', getTaxableAmount(totals).toFixed(2),
          isInter ? 0 : (totals?.cgst || 0).toFixed(2),
          isInter ? 0 : (totals?.sgst || 0).toFixed(2),
          isInter ? (totals?.igst || 0).toFixed(2) : 0,
        ];
      }));
    toast('B2B CSV downloaded — matches GSTR-1 Table 4A format', 'success');
  };

  const exportB2C = () => {
    if (b2cRates.length === 0 && b2cLarge.length === 0) { toast('No B2C data to export', 'warning'); return; }
    const b2csData = {};
    b2cSmall.forEach(bill => {
      const { profile: prof, client, items, details } = bill.data;
      const isInter = billIsInterstate(bill);
      const pos = getStateCode(details?.placeOfSupply || client?.state || prof?.state || '');
      const splyType = isInter ? 'INTER' : 'INTRA';
      (items || []).forEach(item => {
        const rate = item.taxPercent || 0;
        const key = `${splyType}_${pos}_${rate}`;
        if (!b2csData[key]) b2csData[key] = { splyType, pos, rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive);
        b2csData[key].taxable += split.taxable;
        b2csData[key].cgst += split.cgst;
        b2csData[key].sgst += split.sgst;
        b2csData[key].igst += split.igst;
      });
    });
    downloadCSV('GSTR1_B2C_Small.csv',
      ['Type', 'Place of Supply', 'Rate', 'Taxable Value', 'CGST Amount', 'SGST Amount', 'IGST Amount', 'Cess Amount'],
      Object.values(b2csData).map(d => [
        d.splyType === 'INTER' ? 'Inter State' : 'Intra State', d.pos, d.rate + '%',
        d.taxable.toFixed(2), d.cgst.toFixed(2), d.sgst.toFixed(2), d.igst.toFixed(2), '0.00',
      ]));
    if (b2cLarge.length > 0) {
      downloadCSV('GSTR1_B2C_Large.csv',
        ['Invoice Number', 'Invoice Date', 'Invoice Value', 'Place of Supply', 'Taxable Value', 'IGST Amount', 'Cess Amount'],
        b2cLarge.map(bill => {
          const { client, totals, details } = bill.data;
          const pos = getStateCode(details?.placeOfSupply || client?.state || '');
          return [
            bill.invoiceNumber, formatDateGST(bill.invoiceDate), (totals?.total || 0).toFixed(2),
            pos, getTaxableAmount(totals).toFixed(2), (totals?.igst || 0).toFixed(2), '0.00',
          ];
        }));
    }
    toast('B2C CSV downloaded', 'success');
  };

  const exportHSN = () => {
    if (hsnRows.length === 0) { toast('No HSN data', 'warning'); return; }
    // v1.10.31 — GST-H3: key by hsn+rate+uqc. GST-C3: cess included. GST-C2: UTGST folded.
    const hsnDetailed = {};
    filteredBills.forEach(bill => {
      const { items } = bill.data;
      const isInter = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      (items || []).forEach(item => {
        const hsn = item.hsn || 'N/A';
        const rate = item.taxPercent || 0;
        const uqc = getUnitUQC(item.unit) || 'NOS';
        const key = `${hsn}|${rate}|${uqc}`;
        if (!hsnDetailed[key]) hsnDetailed[key] = { hsn, desc: item.name || '', uqc, qty: 0, rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, totalValue: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, isIntraUT);
        hsnDetailed[key].qty += item.quantity || 0;
        hsnDetailed[key].taxable += split.taxable;
        hsnDetailed[key].cgst += split.cgst;
        hsnDetailed[key].sgst += split.sgst + split.utgst;
        hsnDetailed[key].igst += split.igst;
        hsnDetailed[key].cess += split.cess;
        hsnDetailed[key].totalValue += split.taxable + split.cgst + split.sgst + split.utgst + split.igst + split.cess;
      });
    });
    // Column order + header labels match the GSTR-1 offline utility's Table 12
    // CSV template (v3.1.6+). Prior order put "Total Value" LAST and used
    // "Rate %" — the portal importer rejected those with "Invalid file format".
    downloadCSV(
      'GSTR1_HSN_Summary.csv',
      ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'],
      Object.values(hsnDetailed).map(r => [
        r.hsn, r.desc, r.uqc, r.qty, r.totalValue.toFixed(2), r.rate,
        r.taxable.toFixed(2), r.igst.toFixed(2), r.cgst.toFixed(2), r.sgst.toFixed(2), r.cess.toFixed(2),
      ])
    );
    toast('HSN CSV downloaded — GSTR-1 Table 12 format', 'success');
  };

  const exportCDNR = () => {
    const cdnrBills = creditNotes.filter(b => b.data?.client?.gstin);
    const cdnurBills = creditNotes.filter(b => !b.data?.client?.gstin);
    if (cdnrBills.length === 0 && cdnurBills.length === 0) { toast('No Credit Notes', 'warning'); return; }
    if (cdnrBills.length > 0) {
      downloadCSV('GSTR1_CDNR.csv',
        ['GSTIN/UIN', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place of Supply', 'Reverse Charge', 'Note Value', 'Taxable Value', 'IGST Amount', 'CGST Amount', 'SGST Amount'],
        cdnrBills.map(bill => {
          const { client, totals } = bill.data;
          const isInter = billIsInterstate(bill);
          const pos = getStateCode(bill.data.details?.placeOfSupply || client?.state || '');
          return [
            client.gstin, client.name || bill.clientName, bill.invoiceNumber,
            formatDateGST(bill.invoiceDate), 'C', pos, 'N', (totals?.total || 0).toFixed(2),
            getTaxableAmount(totals).toFixed(2),
            isInter ? (totals?.igst || 0).toFixed(2) : '0.00',
            isInter ? '0.00' : (totals?.cgst || 0).toFixed(2),
            isInter ? '0.00' : (totals?.sgst || 0).toFixed(2),
          ];
        }));
    }
    if (cdnurBills.length > 0) {
      downloadCSV('GSTR1_CDNUR.csv',
        ['Note Number', 'Note Date', 'Note Type', 'Place of Supply', 'Note Value', 'Taxable Value', 'IGST Amount', 'Cess Amount'],
        cdnurBills.map(bill => {
          const { client, totals } = bill.data;
          const pos = getStateCode(bill.data.details?.placeOfSupply || client?.state || '');
          return [
            bill.invoiceNumber, formatDateGST(bill.invoiceDate), 'C', pos,
            (totals?.total || 0).toFixed(2), getTaxableAmount(totals).toFixed(2),
            (totals?.igst || 0).toFixed(2), '0.00',
          ];
        }));
    }
    toast('Credit Notes exported', 'success');
  };

  const exportDocSummary = () => {
    if (Object.keys(docSummary).length === 0) { toast('No documents', 'warning'); return; }
    downloadCSV('GSTR1_Doc_Summary.csv',
      ['Document Type', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'],
      Object.entries(docSummary).map(([, d]) => [d.type, d.from, d.to, d.total, 0]));
    toast('Document Summary CSV downloaded', 'success');
  };

  const exportGSTR3B = () => {
    downloadCSV('GSTR3B_Summary.csv',
      ['Description', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Total'],
      [
        ['3.1(a) Outward taxable supplies', grandTotals.taxable.toFixed(2), grandTotals.igst.toFixed(2), grandTotals.cgst.toFixed(2), grandTotals.sgst.toFixed(2), (grandTotals.igst + grandTotals.cgst + grandTotals.sgst).toFixed(2)],
        ['4(A) ITC Available', '', itcFromExpenses.igst.toFixed(2), itcFromExpenses.cgst.toFixed(2), itcFromExpenses.sgst.toFixed(2), (itcFromExpenses.igst + itcFromExpenses.cgst + itcFromExpenses.sgst).toFixed(2)],
        ['6.1 Tax Payable', '', netTax.igst.toFixed(2), netTax.cgst.toFixed(2), netTax.sgst.toFixed(2), (netTax.igst + netTax.cgst + netTax.sgst).toFixed(2)],
      ]);
    toast('GSTR-3B summary CSV downloaded', 'success');
  };

  // ========== GSTR-3B JSON Export (GSTN offline tool format, schema v1.7) ==========
  const exportGSTR3BJSON = () => {
    if (filteredBills.length === 0 && filteredExpenses.length === 0) {
      toast('No data to export for this period', 'warning');
      return;
    }
    const gstin = profile.gstin || '';
    const ret_period = filterMode === 'month'
      ? String(parseInt(monthFilter) + 1).padStart(2, '0') + yearFilter
      : getFilingPeriod(filteredBills[0]?.invoiceDate || filteredExpenses[0]?.date || new Date().toISOString());

    const sup_details = {
      osup_det: {
        // v1.10.31 — GST-C3: cess populated (was hardcoded 0 → GSTR-1 emitted
        // cess but GSTR-3B did not → Section 61 mismatch for cess goods).
        txval: round2(grandTotals.taxable),
        iamt: round2(grandTotals.igst),
        camt: round2(grandTotals.cgst),
        samt: round2(grandTotals.sgst),
        csamt: round2(grandTotals.cess),
      },
      osup_zero: { txval: 0, iamt: 0, csamt: 0 },
      osup_nil_exmp: { txval: 0 },
      // v1.10.31 — GST-M10: RCM inward supplies populated from purchases
      // flagged as reverse-charge (was hardcoded 0 → self-remit RCM liability
      // never reported → interest u/s 50).
      isup_rev: (() => {
        const rcmPurchases = (purchases || []).filter(p => !!p.reverseCharge);
        if (rcmPurchases.length === 0) return { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        const t = rcmPurchases.reduce((acc, p) => ({
          txval: acc.txval + (Number(p.taxableAmount) || 0),
          iamt: acc.iamt + (p.interstate ? (Number(p.totalTax) || 0) : 0),
          camt: acc.camt + (p.interstate ? 0 : (Number(p.totalTax) || 0) / 2),
          samt: acc.samt + (p.interstate ? 0 : (Number(p.totalTax) || 0) / 2),
          csamt: acc.csamt + (Number(p.totalCess) || 0),
        }), { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
        return {
          txval: round2(t.txval), iamt: round2(t.iamt),
          camt: round2(t.camt), samt: round2(t.samt), csamt: round2(t.csamt),
        };
      })(),
      osup_nongst: { txval: 0 },
    };

    const itc_elg = {
      itc_avl: [
        { ty: 'IMPG', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'IMPS', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'ISRC', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'ISD',  iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'OTH',
          iamt: round2(itcFromExpenses.igst),
          camt: round2(itcFromExpenses.cgst),
          samt: round2(itcFromExpenses.sgst),
          csamt: 0,
        },
      ],
      itc_inelg: [
        { ty: 'RUL', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'OTH', iamt: 0, camt: 0, samt: 0, csamt: 0 },
      ],
    };

    const inward_sup = {
      isup_details: [
        { ty: 'GST',    inter: 0, intra: 0 },
        { ty: 'NONGST', inter: 0, intra: 0 },
      ],
    };

    // v1.10.43 — GSTR-3B root schema fields required by the offline
    // utility. Missing → portal rejected with "Error in JSON structure
    // validation" before any per-section check ran.
    const gstr3b = {
      gstin, ret_period,
      version: 'GST3.0.4',
      hash: 'hash',
      sup_details, itc_elg, inward_sup,
    };
    const blob = new Blob([JSON.stringify(gstr3b, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR3B_${gstin || 'export'}_${ret_period}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('GSTR-3B JSON exported — upload to GST portal offline tool', 'success');
  };

  // ========== GSTR-1 Pre-flight Validation ==========
  // v1.10.43 — See comments in the original export for the schema rules
  // validated here (RET191106 / RET191113 / RET191115 / RET191175 etc.).
  const GST_STANDARD_RATES = [0, 0.25, 3, 5, 12, 18, 28];
  const INUM_REGEX = /^[A-Za-z0-9\-/]{1,16}$/;
  const validateGSTR1 = (list) => {
    const blocked = [];
    const warns = [];
    const aatoAbove5Cr = !!profile.aatoAbove5Cr;
    const minHsnDigits = aatoAbove5Cr ? 6 : 4;

    const badInums = list.filter(b => !INUM_REGEX.test(b.invoiceNumber || ''));
    if (badInums.length > 0) {
      blocked.push(`${badInums.length} invoice number(s) violate portal rules (≤16 chars, only letters, digits, "-" or "/"). First: ${badInums.slice(0, 3).map(b => b.invoiceNumber).join(', ')}`);
    }

    const badRates = new Set();
    let badRateItemCount = 0;
    list.forEach(bill => {
      (bill.data?.items || []).forEach(item => {
        const rate = Number(item.taxPercent) || 0;
        if (!GST_STANDARD_RATES.includes(rate)) {
          badRates.add(rate);
          badRateItemCount += 1;
        }
      });
    });
    if (badRateItemCount > 0) {
      blocked.push(`${badRateItemCount} item(s) use non-standard tax rate(s) [${Array.from(badRates).sort().join(', ')}%]. Portal accepts only ${GST_STANDARD_RATES.join(', ')}%.`);
    }

    let missingHsnItemCount = 0;
    let shortHsnItemCount = 0;
    list.forEach(bill => {
      (bill.data?.items || []).forEach(item => {
        const hsn = String(item.hsn || '').trim();
        if (!hsn || hsn === 'N/A') missingHsnItemCount += 1;
        else if (hsn.replace(/\D/g, '').length < minHsnDigits) shortHsnItemCount += 1;
      });
    });
    if (missingHsnItemCount > 0) {
      warns.push(`${missingHsnItemCount} item(s) have no HSN — dropped from HSN summary. GSTR-1 Table 12 requires an HSN per item.`);
    }
    if (shortHsnItemCount > 0) {
      warns.push(`${shortHsnItemCount} item(s) have HSN shorter than ${minHsnDigits} digits (required for ${aatoAbove5Cr ? '>' : '≤'}₹5 Cr AATO). Portal may reject.`);
    }

    return { blocked, warnings: warns };
  };

  // ========== GSTR-1 JSON Export ==========
  const exportGSTR1JSON = () => {
    if (filteredBills.length === 0) { toast('No invoices to export', 'warning'); return; }

    const { blocked, warnings: preflightWarns } = validateGSTR1(filteredBills);
    if (blocked.length > 0) {
      toast(`GSTR-1 export blocked — fix these first: ${blocked.join(' · ')}`, 'error', 12000);
      return;
    }

    const gstin = profile.gstin || '';
    const fp = filterMode === 'month'
      ? String(parseInt(monthFilter) + 1).padStart(2, '0') + yearFilter
      : getFilingPeriod(filteredBills[0]?.invoiceDate);

    const b2bMap = {};
    b2bRegular.forEach(bill => {
      const { client, totals, items, details } = bill.data;
      const ctin = client.gstin;
      if (!b2bMap[ctin]) b2bMap[ctin] = { ctin, inv: [] };
      const isInter = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      const isRcm = !!bill.data?.invoiceOptions?.reverseCharge;
      const pos = getStateCode(details?.placeOfSupply || client?.state || '');
      const rateMap = {};
      (items || []).forEach(item => {
        const rate = item.taxPercent || 0;
        if (!rateMap[rate]) rateMap[rate] = { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        // v1.10.31 — GST-C2/H7: pass isIntraUT so UTGST folds into SGST bucket.
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, isIntraUT);
        rateMap[rate].txval += split.taxable;
        rateMap[rate].iamt += split.igst;
        rateMap[rate].camt += split.cgst;
        rateMap[rate].samt += split.sgst + split.utgst;
        rateMap[rate].csamt += split.cess;
      });
      const rchrg = isRcm ? 'Y' : 'N';
      const isSEZ = !!client?.isSEZ;
      // v1.10.31 — GST-M3 + L5: `isLUT` uses explicit flag first, term-
      // scanning fallback for legacy bills.
      const isLUT = !!bill.data?.invoiceOptions?.isLUT
        || /\bLUT\b|Letter of Undertaking/i.test(bill.data?.customTerms || '');
      const invType = isRcm
        ? 'R'
        : (isSEZ ? (isLUT ? 'SEWOP' : 'SEWP') : 'R');
      // v1.10.31 — GST-C1: for RCM, `val` must reconcile with per-rate sums.
      const rateTotal = Object.values(rateMap).reduce((s, d) => s + d.txval + d.iamt + d.camt + d.samt + d.csamt, 0);
      const val = isRcm ? round2(rateTotal) : round2((totals?.total || 0) - (totals?.roundOff || 0));
      b2bMap[ctin].inv.push({
        inum: bill.invoiceNumber, idt: formatDateGST(bill.invoiceDate), val, pos, rchrg, inv_typ: invType,
        itms: Object.entries(rateMap).map(([rt, d], i) => ({
          num: i + 1,
          itm_det: {
            rt: Number(rt), txval: round2(d.txval), iamt: round2(d.iamt),
            camt: round2(d.camt), samt: round2(d.samt), csamt: round2(d.csamt),
          },
        })),
      });
    });

    const b2csMap = {};
    b2cSmall.forEach(bill => {
      const { profile: prof, client, items, details } = bill.data;
      const isInter = billIsInterstate(bill);
      const isIntraUT = billIsIntraUT(bill);
      const pos = getStateCode(details?.placeOfSupply || client?.state || prof?.state || '');
      const splyTy = isInter ? 'INTER' : 'INTRA';
      (items || []).forEach(item => {
        const rate = item.taxPercent || 0;
        const key = `${splyTy}_${pos}_${rate}`;
        if (!b2csMap[key]) b2csMap[key] = { sply_ty: splyTy, pos, rt: rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive, isIntraUT);
        b2csMap[key].txval += split.taxable;
        b2csMap[key].iamt += split.igst;
        b2csMap[key].camt += split.cgst;
        b2csMap[key].samt += split.sgst + split.utgst; // v1.10.31 — UTGST folded
        b2csMap[key].csamt += split.cess;
      });
    });
    const b2csArr = Object.values(b2csMap).map(d => ({
      ...d, txval: round2(d.txval), iamt: round2(d.iamt), camt: round2(d.camt),
      samt: round2(d.samt), csamt: round2(d.csamt),
    }));

    const b2clMap = {};
    b2cLarge.forEach(bill => {
      const { client, totals, items, details } = bill.data;
      const pos = getStateCode(details?.placeOfSupply || client?.state || '');
      if (!b2clMap[pos]) b2clMap[pos] = { pos, inv: [] };
      const rateMap = {};
      (items || []).forEach(item => {
        const rate = item.taxPercent || 0;
        if (!rateMap[rate]) rateMap[rate] = { txval: 0, iamt: 0, csamt: 0 };
        // P1 #23: pass taxInclusive as 3rd arg.
        const split = computeItemTaxSplit(item, true, !!bill.data?.taxInclusive);
        rateMap[rate].txval += split.taxable;
        rateMap[rate].iamt += split.igst;
        const cessPct = Number(item.cessPercent) || 0;
        if (cessPct > 0) rateMap[rate].csamt += split.taxable * cessPct / 100;
      });
      b2clMap[pos].inv.push({
        inum: bill.invoiceNumber, idt: formatDateGST(bill.invoiceDate),
        val: round2(totals?.total || 0),
        itms: Object.entries(rateMap).map(([rt, d], i) => ({
          num: i + 1,
          itm_det: { rt: Number(rt), txval: round2(d.txval), iamt: round2(d.iamt), csamt: round2(d.csamt) },
        })),
      });
    });

    const cdnrMap = {};
    creditNotes.filter(b => b.data?.client?.gstin).forEach(bill => {
      const { client, totals, items, details } = bill.data;
      const ctin = client.gstin;
      if (!cdnrMap[ctin]) cdnrMap[ctin] = { ctin, nt: [] };
      const isInter = billIsInterstate(bill);
      const pos = getStateCode(details?.placeOfSupply || client?.state || '');
      const rateMap = {};
      (items || []).forEach(item => {
        const rate = item.taxPercent || 0;
        if (!rateMap[rate]) rateMap[rate] = { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive);
        rateMap[rate].txval += split.taxable;
        rateMap[rate].iamt += split.igst;
        rateMap[rate].camt += split.cgst;
        rateMap[rate].samt += split.sgst;
        const cessPct = Number(item.cessPercent) || 0;
        if (cessPct > 0) rateMap[rate].csamt += split.taxable * cessPct / 100;
      });
      const rchrg = bill.data?.invoiceOptions?.reverseCharge ? 'Y' : 'N';
      const isSEZ = !!client?.isSEZ;
      const isLUT = /LUT|Letter of Undertaking|zero.?rated/i.test(bill.data?.customTerms || '')
        || !!bill.data?.invoiceOptions?.isLUT;
      const invType = isSEZ ? (isLUT ? 'SEWOP' : 'SEWP') : 'R';
      cdnrMap[ctin].nt.push({
        ntty: 'C', nt_num: bill.invoiceNumber, nt_dt: formatDateGST(bill.invoiceDate),
        val: round2(totals?.total || 0), pos, rchrg, inv_typ: invType,
        itms: Object.entries(rateMap).map(([rt, d], i) => ({
          num: i + 1,
          itm_det: {
            rt: Number(rt), txval: round2(d.txval), iamt: round2(d.iamt),
            camt: round2(d.camt), samt: round2(d.samt), csamt: round2(d.csamt),
          },
        })),
      });
    });

    const hsnJsonMap = {};
    let unknownUnitCount = 0;
    filteredBills.forEach(bill => {
      const { items } = bill.data;
      const isInter = billIsInterstate(bill);
      (items || []).forEach(item => {
        // v1.10.43 — HSN Table 12 rule: portal rejects `hsn_sc: 'N/A'` or empty.
        const hsnRaw = String(item.hsn || '').trim();
        if (!hsnRaw || hsnRaw === 'N/A') return;
        const hsn = hsnRaw;
        const rate = item.taxPercent || 0;
        const key = `${hsn}_${rate}`;
        const uqc = getUnitUQC(item.unit);
        if (uqc === 'OTH' && item.unit) unknownUnitCount += 1;
        if (!hsnJsonMap[key]) hsnJsonMap[key] = { hsn_sc: hsn, desc: item.name || '', uqc, qty: 0, rt: rate, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        const split = computeItemTaxSplit(item, isInter, !!bill.data?.taxInclusive);
        hsnJsonMap[key].qty += item.quantity || 0;
        hsnJsonMap[key].txval += split.taxable;
        hsnJsonMap[key].iamt += split.igst;
        hsnJsonMap[key].camt += split.cgst;
        hsnJsonMap[key].samt += split.sgst;
        const cessPct = Number(item.cessPercent) || 0;
        if (cessPct > 0) hsnJsonMap[key].csamt += split.taxable * cessPct / 100;
      });
    });

    const docDet = Object.entries(docSummary).map(([, d], i) => ({
      doc_num: i + 1,
      docs: [{ num: 1, from: d.from, to: d.to, totnum: d.total, cancel: 0, net_issue: d.total }],
    }));

    // v1.10.43 — aggregate turnover fields required by portal schema.
    const gt = Number(profile?.prevFYTurnover) || 0;
    const cur_gt = Number(profile?.currentFYTurnover) || 0;

    const gstr1 = {
      gstin, fp, gt, cur_gt,
      version: 'GST3.1.6',
      hash: 'hash',
      b2b: Object.values(b2bMap), b2cs: b2csArr,
      ...(Object.keys(b2clMap).length > 0 ? { b2cl: Object.values(b2clMap) } : {}),
      ...(Object.keys(cdnrMap).length > 0 ? { cdnr: Object.values(cdnrMap) } : {}),
      hsn: {
        data: Object.values(hsnJsonMap).map((r, i) => ({
          num: i + 1, ...r,
          txval: round2(r.txval), iamt: round2(r.iamt), camt: round2(r.camt),
          samt: round2(r.samt), csamt: round2(r.csamt),
        })),
      },
      doc_issue: { doc_det: docDet },
    };

    const blob = new Blob([JSON.stringify(gstr1, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1_${gstin || 'export'}_${fp}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const postWarnings = [...preflightWarns];
    if (unknownUnitCount > 0) {
      postWarnings.push(`${unknownUnitCount} item(s) used a custom unit and were exported as UQC 'OTH'.`);
    }
    if (postWarnings.length > 0) {
      toast(`GSTR-1 JSON exported. ⚠ ${postWarnings.join(' · ')}`, 'warning', 10000);
    } else {
      toast('GSTR-1 JSON exported — upload to GST portal offline tool', 'success');
    }
  };

  // ========== Inter-state B2C rows for GSTR-3B Table 3.2 ==========
  const interStateB2CRows = useMemo(() => {
    const interStateB2C = {};
    b2cBills.forEach(bill => {
      const { client, items, details } = bill.data;
      const isInter = billIsInterstate(bill);
      if (!isInter) return;
      const pos = getStateCode(details?.placeOfSupply || client?.state || '');
      const posName = client?.state || pos;
      (items || []).forEach(item => {
        if (!interStateB2C[posName]) interStateB2C[posName] = { pos: posName, taxable: 0, igst: 0 };
        const split = computeItemTaxSplit(item, true);
        interStateB2C[posName].taxable += split.taxable;
        interStateB2C[posName].igst += split.igst;
      });
    });
    return Object.values(interStateB2C);
  }, [b2cBills]);

  // ========== Summary scalars ==========
  const totalTax = grandTotals.cgst + grandTotals.sgst + grandTotals.igst;
  const netPayable = netTax.igst + netTax.cgst + netTax.sgst;

  return {
    // State
    filterMode, setFilterMode,
    fyFilter, setFyFilter,
    monthFilter, setMonthFilter,
    yearFilter, setYearFilter,
    quarterFilter, setQuarterFilter,
    activeTab, setActiveTab,
    guideTab, setGuideTab,
    gstr2bData, setGstr2bData,
    gstr2bFilter, setGstr2bFilter,
    gstr2bInputRef,
    // Derived options
    fyOptions, yearOptions,
    // Raw data
    profile, purchases,
    // Filtered
    filteredBills, allFilteredBills, filteredExpenses, filteredPurchases,
    // Classification
    creditNotes, regularBills, b2bRegular, b2cRegular, b2cLarge, b2cSmall, b2cBills,
    // Computed
    b2bRows, b2bTotals,
    b2cByRate, b2cRates, b2cTotals,
    hsnRows,
    cnTotals, grandTotals,
    outputTax, itcFromExpenses, netTax,
    docSummary,
    warnings,
    interStateB2CRows,
    // Summary scalars
    totalTax, netPayable,
    // Filing
    periodFiling, toggleFiled, markFiled,
    isNilReturn,
    // Actions
    handleImport2B,
    exportB2B, exportB2C, exportHSN, exportCDNR, exportDocSummary,
    exportGSTR3B, exportGSTR3BJSON, exportGSTR1JSON,
  };
}