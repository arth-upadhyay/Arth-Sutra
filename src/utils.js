// ========== Number to Words (Indian Format) ==========
export const numberToWords = (num) => {
  if (num === 0) return 'Zero Rupees Only';

  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const convertToWords = (n) => {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
  };

  const getIndianFormatString = (n) => {
    let res = '';
    const crore = Math.floor(n / 10000000);
    n -= crore * 10000000;
    const lakh = Math.floor(n / 100000);
    n -= lakh * 100000;
    const thousand = Math.floor(n / 1000);
    n -= thousand * 1000;
    const hundred = Math.floor(n / 100);
    n -= hundred * 100;

    if (crore > 0) res += convertToWords(crore) + ' Crore ';
    if (lakh > 0) res += convertToWords(lakh) + ' Lakh ';
    if (thousand > 0) res += convertToWords(thousand) + ' Thousand ';
    if (hundred > 0) res += convertToWords(hundred) + ' Hundred ';
    if (n > 0) res += (res !== '' ? 'and ' : '') + convertToWords(n);
    return res.trim();
  };

  const roundedNum = Math.round(num * 100) / 100;
  const rupees = Math.floor(roundedNum);
  const paise = Math.round((roundedNum - rupees) * 100);

  let result = getIndianFormatString(rupees) + ' Rupees';
  if (paise > 0) {
    result += ' and ' + getIndianFormatString(paise) + ' Paise';
  }
  return result + ' Only';
};

export const formatCurrency = (amount, currency = 'INR') => {
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency || 'INR',
    minimumFractionDigits: 2
  }).format(amount || 0);
};

const finiteNonNeg = (n) => {
  const x = Number(n);
  return isFinite(x) && x > 0 ? x : 0;
};

export const resolveLineDiscount = (item = {}) => {
  const qty = finiteNonNeg(item.quantity);
  const rate = finiteNonNeg(item.rate);
  const net = qty * rate;
  const raw = finiteNonNeg(item.discount);
  if (raw <= 0 || net <= 0) return 0;

  if (item.discountType === 'percent') {
    return Math.min(net, (net * Math.min(raw, 100)) / 100);
  }

  const base = item.discountBase || 'net';
  if (base === 'unit') {
    return Math.min(net, qty * raw);
  }
  if (base === 'with-tax') {
    const taxRate = finiteNonNeg(item.taxPercent);
    const divisor = 1 + taxRate / 100;
    return Math.min(net, divisor > 0 ? raw / divisor : raw);
  }
  return Math.min(net, raw);
};

export const calculateLineItemTax = (item = {}, taxInclusive = false) => {
  const qty = finiteNonNeg(item.quantity);
  const rate = finiteNonNeg(item.rate);
  const discount = resolveLineDiscount(item);
  const taxRate = finiteNonNeg(item.taxPercent);
  const amount = qty * rate;
  const grossAfterDiscount = Math.max(0, amount - discount);
  if (taxInclusive && taxRate > 0) {
    const afterDiscount = grossAfterDiscount / (1 + taxRate / 100);
    const taxAmount = grossAfterDiscount - afterDiscount;
    return { amount, discount, afterDiscount, taxAmount, total: grossAfterDiscount };
  }
  const afterDiscount = grossAfterDiscount;
  const taxAmount = (afterDiscount * taxRate) / 100;
  return { amount, discount, afterDiscount, taxAmount, total: afterDiscount + taxAmount };
};

export const TDS_TCS_THRESHOLD = 5_000_000;

const sum = (arr) => arr.reduce((s, n) => s + (Number(n) || 0), 0);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function computeInvoiceTotals(opts) {
  const rawOpts = opts || {};
  const items = rawOpts.items || [];
  const profile = rawOpts.profile || {};
  const client = rawOpts.client || {};
  const details = rawOpts.details || {};
  const showGST = rawOpts.showGST !== false;
  const taxInclusive = !!rawOpts.taxInclusive;
  const invoiceOptions = rawOpts.invoiceOptions || {};

  const warnings = [];
  const isIndia = (profile.country || 'India') === 'India';

  const lines = items.map((item) => {
    const qty = finiteNonNeg(item.quantity);
    const rate = finiteNonNeg(item.rate);
    const rawDisc = resolveLineDiscount(item);
    const taxPct = finiteNonNeg(item.taxPercent);
    const cessPct = finiteNonNeg(item.cessPercent);
    
    let gross = qty * rate;
    let disc = rawDisc;
    const applyTax = !!showGST;

    // Fix: Strip tax out of the base amount if inclusive
    if (applyTax && taxInclusive && taxPct > 0) {
      const divisor = 1 + (taxPct / 100);
      gross = gross / divisor;
      disc = disc / divisor;
    }

    const afterDisc = Math.max(0, gross - disc);
    const taxable = afterDisc;
    const tax = applyTax ? r2(taxable * taxPct / 100) : 0;
    const cess = applyTax ? r2(taxable * cessPct / 100) : 0;
    
    return { qty, rate, disc, taxPct, cessPct, gross, afterDisc, taxable: r2(taxable), tax, cess };
  });

  const subtotal = r2(sum(lines.map(l => l.gross)));
  const totalDiscount = r2(sum(lines.map(l => l.disc)));
  const taxableAmount = r2(sum(lines.map(l => l.taxable)));
  const taxTotal = r2(sum(lines.map(l => l.tax)));
  const cessTotal = r2(sum(lines.map(l => l.cess)));

  const businessState = (profile.state || '').trim();
  const clientState = (client.state || '').trim();
  const placeOfSupplyRaw = (details.placeOfSupply || clientState || '').trim();
  const businessCode = getStateCode(businessState || profile.gstin);
  const posCode = getStateCode(placeOfSupplyRaw || client.gstin);
  const isSEZ = !!client.isSEZ;

  let needsProfileFix = false;
  if (isIndia && showGST && !businessState) {
    warnings.push('Your business state is not set. Interstate/intra-state detection cannot be trusted. Set it in Settings → Company Details before issuing GST invoices.');
    needsProfileFix = true;
  }
  if (isIndia && showGST && !placeOfSupplyRaw) {
    warnings.push('Place of supply is not set. Falling back to client state.');
  }

  const isInterstate = isIndia && (isSEZ || (
    !!businessCode && !!posCode && businessCode !== posCode
  ));

  const isIntraUT = isIndia && !isInterstate && !!businessCode &&
    businessCode === posCode &&
    isUnionTerritoryWithoutLegislature(businessCode);

  const half = r2(taxTotal / 2);
  const cgst = isIndia && !isInterstate ? half : 0;
  const sgst = isIndia && !isInterstate && !isIntraUT ? half : 0;
  const utgst = isIndia && isIntraUT ? half : 0;
  const igst = isIndia ? (isInterstate ? taxTotal : 0) : taxTotal;

  const isReverseCharge = !!invoiceOptions.reverseCharge && !!showGST;

  // Fix: Simplified baseTotal since taxableAmount is strictly pre-tax now
  const baseTotal = isReverseCharge 
    ? taxableAmount 
    : (taxableAmount + taxTotal);

  const tcsCumBefore = Number(invoiceOptions.tcsCumulativeThisYear) || 0;
  const tdsCumBefore = Number(invoiceOptions.tdsCumulativeThisYear) || 0;

  const receiptIncludingGst = r2(taxableAmount + taxTotal + cessTotal);

  const marginalTcsBase = tcsCumBefore >= TDS_TCS_THRESHOLD
    ? receiptIncludingGst
    : Math.max(0, (tcsCumBefore + receiptIncludingGst) - TDS_TCS_THRESHOLD);
  const marginalTdsBase = tdsCumBefore >= TDS_TCS_THRESHOLD
    ? receiptIncludingGst
    : Math.max(0, (tdsCumBefore + receiptIncludingGst) - TDS_TCS_THRESHOLD);

  const tcsRate = Number(invoiceOptions.tcsRate) || 0;
  const tdsRate = Number(invoiceOptions.tdsRate) || 0;
  const tcsAmount = invoiceOptions.showTCS && tcsRate > 0
    ? r2(marginalTcsBase * tcsRate / 100) : 0;
  const tdsAmount = invoiceOptions.showTDS && tdsRate > 0
    ? r2(marginalTdsBase * tdsRate / 100) : 0;

  const invDiscValue = finiteNonNeg(invoiceOptions.invoiceDiscountValue);
  const invDiscType = invoiceOptions.invoiceDiscountType === 'percent' ? 'percent' : 'fixed';
  const cessOnInvoice = isReverseCharge ? 0 : cessTotal;
  const preInvDiscTotal = baseTotal + tcsAmount + cessOnInvoice;
  const invoiceDiscountAmount = invDiscType === 'percent'
    ? Math.min(preInvDiscTotal, r2(preInvDiscTotal * Math.min(invDiscValue, 100) / 100))
    : Math.min(preInvDiscTotal, r2(invDiscValue));

  const totalBeforeRound = preInvDiscTotal - invoiceDiscountAmount;
  const roundOff = invoiceOptions.showRoundOff
    ? r2(Math.round(totalBeforeRound) - totalBeforeRound)
    : 0;
  const total = r2(totalBeforeRound + roundOff);

  const zeroTaxOnTotals = isReverseCharge;

  const totalTaxAmount = r2(
    (zeroTaxOnTotals ? 0 : cgst) +
    (zeroTaxOnTotals ? 0 : sgst) +
    (zeroTaxOnTotals ? 0 : utgst) +
    (zeroTaxOnTotals ? 0 : igst) +
    (zeroTaxOnTotals ? 0 : cessTotal)
  );

  const result = {
    subtotal, totalDiscount, taxableAmount,
    cgst: zeroTaxOnTotals ? 0 : cgst,
    sgst: zeroTaxOnTotals ? 0 : sgst,
    utgst: zeroTaxOnTotals ? 0 : utgst,
    igst: zeroTaxOnTotals ? 0 : igst,
    cess: cessTotal,
    tcsAmount, tdsAmount, roundOff,
    invoiceDiscountAmount, invoiceDiscountType: invDiscType, invoiceDiscountValue: invDiscValue,
    total,
    netReceivable: r2(total - tdsAmount),
    totalTaxAmount,
    isInterstate, isIntraUT, isUnionTerritory: isIntraUT,
    taxInclusive: !!(taxInclusive && showGST),
    warnings, needsProfileFix,
    lines,
  };

  if (isReverseCharge) {
    result.rcmTaxCgst = cgst;
    result.rcmTaxSgst = sgst;
    result.rcmTaxUtgst = utgst;
    result.rcmTaxIgst = igst;
    result.rcmTaxTotal = r2(cgst + sgst + utgst + igst);
  }

  return result;
}

// ========== Invoice Types & States ==========
export const INVOICE_TYPES = {
  'tax-invoice': { label: 'Tax Invoice', prefix: 'INV', title: 'TAX INVOICE', showGST: true, description: 'Standard GST tax invoice' },
  'proforma': { label: 'Proforma / Estimate', prefix: 'EST', title: 'PROFORMA INVOICE', showGST: true, description: 'Quotation or estimate' },
  'bill-of-supply': { label: 'Bill of Supply (No GST)', prefix: 'BOS', title: 'BILL OF SUPPLY', showGST: false, description: 'For exempt supplies' },
  'composition': { label: 'Composition (Bill of Supply)', prefix: 'COMP', title: 'BILL OF SUPPLY', showGST: false, description: 'For composition dealers' },
  'credit-note': { label: 'Credit Note', prefix: 'CN', title: 'CREDIT NOTE', showGST: true, description: 'Issued for returns or adjustments' },
  'delivery-challan': { label: 'Delivery Challan', prefix: 'DC', title: 'DELIVERY CHALLAN', showGST: false, description: 'For goods transport' },
};

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
];

export const US_STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','District of Columbia'];
export const CANADA_PROVINCES = ['Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland and Labrador','Northwest Territories','Nova Scotia','Nunavut','Ontario','Prince Edward Island','Quebec','Saskatchewan','Yukon'];
export const AUSTRALIA_STATES = ['New South Wales','Victoria','Queensland','South Australia','Western Australia','Tasmania','Australian Capital Territory','Northern Territory'];

export const getStatesForCountry = (countryName) => {
  switch (countryName) {
    case 'India': return INDIAN_STATES;
    case 'United States': return US_STATES;
    case 'Canada': return CANADA_PROVINCES;
    case 'Australia': return AUSTRALIA_STATES;
    default: return [];
  }
};

export const COUNTRIES = [
  { name: 'India', code: 'IN', currency: 'INR', currencySymbol: '₹', taxLabel: 'GST', taxIdLabel: 'GSTIN', taxIdPlaceholder: '22AAAAA0000A1Z5', bankLabel: 'IFSC Code', postalLabel: 'PIN Code', stateLabel: 'State', hasStates: true, taxRates: [0, 0.1, 0.25, 3, 5, 12, 18, 28], taxIdRegex: /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z\d]$/ },
  { name: 'United Arab Emirates', code: 'AE', currency: 'AED', currencySymbol: 'AED', taxLabel: 'VAT', taxIdLabel: 'TRN', taxIdPlaceholder: '100123456700003', bankLabel: 'IBAN', postalLabel: 'Postal Code', stateLabel: 'Emirate', hasStates: false, taxRates: [0, 5], taxIdRegex: /^\d{15}$/ },
  { name: 'United States', code: 'US', currency: 'USD', currencySymbol: '$', taxLabel: 'Sales Tax', taxIdLabel: 'EIN / TIN', taxIdPlaceholder: '12-3456789', bankLabel: 'Routing Number', postalLabel: 'ZIP Code', stateLabel: 'State', hasStates: false, taxRates: [0, 4, 6, 7, 8, 9, 10], taxIdRegex: /^\d{2}-?\d{7}$/ },
  { name: 'United Kingdom', code: 'GB', currency: 'GBP', currencySymbol: '£', taxLabel: 'VAT', taxIdLabel: 'VAT Number', taxIdPlaceholder: 'GB123456789', bankLabel: 'Sort Code', postalLabel: 'Postcode', stateLabel: 'County', hasStates: false, taxRates: [0, 5, 20], taxIdRegex: /^GB\d{9}(\d{3})?$/i },
  { name: 'Australia', code: 'AU', currency: 'AUD', currencySymbol: 'A$', taxLabel: 'GST', taxIdLabel: 'ABN', taxIdPlaceholder: '12 345 678 901', bankLabel: 'BSB Number', postalLabel: 'Postcode', stateLabel: 'State/Territory', hasStates: false, taxRates: [0, 10], taxIdRegex: /^\d{2}\s?\d{3}\s?\d{3}\s?\d{3}$/ },
  { name: 'Canada', code: 'CA', currency: 'CAD', currencySymbol: 'CA$', taxLabel: 'GST/HST', taxIdLabel: 'GST/HST Number', taxIdPlaceholder: '123456789 RT 0001', bankLabel: 'Transit Number', postalLabel: 'Postal Code', stateLabel: 'Province', hasStates: false, taxRates: [0, 5, 13, 15], taxIdRegex: /^\d{9}\s?(RT)\s?\d{4}$/i },
  { name: 'Singapore', code: 'SG', currency: 'SGD', currencySymbol: 'S$', taxLabel: 'GST', taxIdLabel: 'GST Reg No.', taxIdPlaceholder: 'M12345678X', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'Region', hasStates: false, taxRates: [0, 9], taxIdRegex: /^[MTFG]\d{7,8}[A-Z]$/i },
  { name: 'Malaysia', code: 'MY', currency: 'MYR', currencySymbol: 'RM', taxLabel: 'SST', taxIdLabel: 'SST No.', taxIdPlaceholder: 'W10-1234-56789012', bankLabel: 'Bank Code', postalLabel: 'Postcode', stateLabel: 'State', hasStates: false, taxRates: [0, 6, 8, 10] },
  { name: 'Germany', code: 'DE', currency: 'EUR', currencySymbol: '€', taxLabel: 'MwSt', taxIdLabel: 'USt-IdNr.', taxIdPlaceholder: 'DE123456789', bankLabel: 'IBAN', postalLabel: 'PLZ', stateLabel: 'Bundesland', hasStates: false, taxRates: [0, 7, 19], taxIdRegex: /^DE\d{9}$/i },
  { name: 'France', code: 'FR', currency: 'EUR', currencySymbol: '€', taxLabel: 'TVA', taxIdLabel: 'N° TVA', taxIdPlaceholder: 'FR12345678901', bankLabel: 'IBAN', postalLabel: 'Code Postal', stateLabel: 'Région', hasStates: false, taxRates: [0, 5.5, 10, 20], taxIdRegex: /^FR[A-Z\d]{2}\d{9}$/i },
  { name: 'Netherlands', code: 'NL', currency: 'EUR', currencySymbol: '€', taxLabel: 'BTW', taxIdLabel: 'BTW-nummer', taxIdPlaceholder: 'NL123456789B01', bankLabel: 'IBAN', postalLabel: 'Postcode', stateLabel: 'Provincie', hasStates: false, taxRates: [0, 9, 21], taxIdRegex: /^NL\d{9}B\d{2}$/i },
  { name: 'South Africa', code: 'ZA', currency: 'ZAR', currencySymbol: 'R', taxLabel: 'VAT', taxIdLabel: 'VAT Number', taxIdPlaceholder: '4123456789', bankLabel: 'Branch Code', postalLabel: 'Postal Code', stateLabel: 'Province', hasStates: false, taxRates: [0, 15], taxIdRegex: /^4\d{9}$/ },
  { name: 'Nigeria', code: 'NG', currency: 'NGN', currencySymbol: '₦', taxLabel: 'VAT', taxIdLabel: 'TIN', taxIdPlaceholder: '12345678-0001', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'State', hasStates: false, taxRates: [0, 7.5] },
  { name: 'Kenya', code: 'KE', currency: 'KES', currencySymbol: 'KSh', taxLabel: 'VAT', taxIdLabel: 'KRA PIN', taxIdPlaceholder: 'A123456789Z', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'County', hasStates: false, taxRates: [0, 8, 16], taxIdRegex: /^[A-Z]\d{9}[A-Z]$/i },
  { name: 'Saudi Arabia', code: 'SA', currency: 'SAR', currencySymbol: 'SAR', taxLabel: 'VAT', taxIdLabel: 'VAT Number', taxIdPlaceholder: '300012345600003', bankLabel: 'IBAN', postalLabel: 'Postal Code', stateLabel: 'Region', hasStates: false, taxRates: [0, 15], taxIdRegex: /^3\d{14}$/ },
  { name: 'Nepal', code: 'NP', currency: 'NPR', currencySymbol: 'Rs', taxLabel: 'VAT', taxIdLabel: 'PAN/VAT No.', taxIdPlaceholder: '123456789', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'Province', hasStates: false, taxRates: [0, 13] },
  { name: 'Bangladesh', code: 'BD', currency: 'BDT', currencySymbol: '৳', taxLabel: 'VAT', taxIdLabel: 'BIN', taxIdPlaceholder: '123456789-0101', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'Division', hasStates: false, taxRates: [0, 5, 7.5, 10, 15] },
  { name: 'Sri Lanka', code: 'LK', currency: 'LKR', currencySymbol: 'Rs', taxLabel: 'VAT', taxIdLabel: 'VAT Reg No.', taxIdPlaceholder: '123456789-7000', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'Province', hasStates: false, taxRates: [0, 18] },
  { name: 'Pakistan', code: 'PK', currency: 'PKR', currencySymbol: 'Rs', taxLabel: 'GST', taxIdLabel: 'NTN', taxIdPlaceholder: '1234567-8', bankLabel: 'Bank Code', postalLabel: 'Postal Code', stateLabel: 'Province', hasStates: false, taxRates: [0, 5, 10, 17, 18] },
  { name: 'Philippines', code: 'PH', currency: 'PHP', currencySymbol: '₱', taxLabel: 'VAT', taxIdLabel: 'TIN', taxIdPlaceholder: '123-456-789-000', bankLabel: 'Bank Code', postalLabel: 'ZIP Code', stateLabel: 'Region', hasStates: false, taxRates: [0, 12] },
  { name: 'Indonesia', code: 'ID', currency: 'IDR', currencySymbol: 'Rp', taxLabel: 'PPN', taxIdLabel: 'NPWP', taxIdPlaceholder: '12.345.678.9-012.000', bankLabel: 'Bank Code', postalLabel: 'Kode Pos', stateLabel: 'Provinsi', hasStates: false, taxRates: [0, 11, 12] },
  { name: 'New Zealand', code: 'NZ', currency: 'NZD', currencySymbol: 'NZ$', taxLabel: 'GST', taxIdLabel: 'GST Number', taxIdPlaceholder: '123-456-789', bankLabel: 'Bank Branch', postalLabel: 'Postcode', stateLabel: 'Region', hasStates: false, taxRates: [0, 15] },
  { name: 'Other', code: 'XX', currency: 'USD', currencySymbol: '$', taxLabel: 'Tax', taxIdLabel: 'Tax ID', taxIdPlaceholder: 'Your tax registration number', bankLabel: 'Bank Routing', postalLabel: 'Postal Code', stateLabel: 'State/Region', hasStates: false, taxRates: [0, 5, 10, 15, 20] },
];

export const getCountryConfig = (countryName) => {
  if (!countryName) return COUNTRIES[0];
  return COUNTRIES.find(c => c.name === countryName) || COUNTRIES.find(c => c.code === countryName) || COUNTRIES[COUNTRIES.length - 1];
};

export const getCountriesForRegion = (regionMode = 'both') => {
  if (regionMode === 'india') {
    return COUNTRIES.filter(c => c.name === 'India' || c.name === 'Other');
  }
  if (regionMode === 'international') {
    return COUNTRIES.filter(c => c.name !== 'India');
  }
  return COUNTRIES;
};

const GST_STATE_CODES = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03',
  'chandigarh': '04', 'uttarakhand': '05', 'haryana': '06',
  'delhi': '07', 'rajasthan': '08', 'uttar pradesh': '09',
  'bihar': '10', 'sikkim': '11', 'arunachal pradesh': '12',
  'nagaland': '13', 'manipur': '14', 'mizoram': '15',
  'tripura': '16', 'meghalaya': '17', 'assam': '18',
  'west bengal': '19', 'jharkhand': '20', 'odisha': '21',
  'chhattisgarh': '22', 'madhya pradesh': '23', 'gujarat': '24',
  'dadra and nagar haveli and daman and diu': '26', 'maharashtra': '27',
  'andhra pradesh': '37', 'karnataka': '29', 'goa': '30',
  'lakshadweep': '31', 'kerala': '32', 'tamil nadu': '33',
  'puducherry': '34', 'andaman and nicobar islands': '35',
  'telangana': '36', 'ladakh': '38',
};

const LEGACY_STATE_CODE_MAP = { '28': '37', '25': '26' };

export const getStateCode = (stateOrGstin) => {
  if (!stateOrGstin) return '';
  const s = stateOrGstin.trim();
  if (/^\d{2}[A-Z0-9]{13}$/i.test(s)) {
    const prefix = s.substring(0, 2);
    return LEGACY_STATE_CODE_MAP[prefix] || prefix;
  }
  const code = GST_STATE_CODES[s.toLowerCase()] || '';
  return LEGACY_STATE_CODE_MAP[code] || code;
};

const UTS_WITHOUT_LEGISLATURE = new Set(['04', '26', '31', '35', '38']);
export const isUnionTerritoryWithoutLegislature = (stateCode) => {
  if (!stateCode) return false;
  return UTS_WITHOUT_LEGISLATURE.has(String(stateCode).padStart(2, '0'));
};

export const formatDateGST = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

export const generateEWayBillJSON = (profile, client, details, items, totals, invoiceType, opts = {}) => {
  if (profile?.country && profile.country !== 'India') {
    throw new Error('E-Way Bill is an Indian GST portal feature. Set business country to "India" in Settings to enable it.');
  }
  const taxInclusive = !!opts.taxInclusive;
  const fromStateCode = getStateCode(profile.state || profile.gstin);
  const toStateCode = getStateCode(client.state || client.gstin);
  const isInterstate = fromStateCode && toStateCode && fromStateCode !== toStateCode;

  const extractPin = (obj) => {
    const direct = String(obj?.pin || obj?.pincode || '').replace(/\D/g, '');
    if (direct.length === 6) return Number(direct);
    const fromAddr = String(obj?.address || '').match(/\b(\d{6})\b/);
    return fromAddr ? Number(fromAddr[1]) : 0;
  };
  const fromPincode = extractPin(profile);
  const toPincode = extractPin(client);
  if (!fromPincode) throw new Error('Your business PIN code is required for the E-Way Bill. Set it in Settings → Company Details.');
  if (!toPincode) throw new Error("Client PIN code is required for the E-Way Bill. Add it in the client's address.");

  const itemList = items.map((item, idx) => {
    const gross = (Number(item.quantity) || 0) * (Number(item.rate) || 0) - resolveLineDiscount(item);
    const taxRate = Number(item.taxPercent) || 0;
    const cessRate = Number(item.cessPercent) || 0;
    const taxable = taxInclusive && taxRate > 0
      ? gross / (1 + taxRate / 100)
      : gross;
    return {
      itemNo: idx + 1,
      productName: item.name || '',
      productDesc: item.name || '',
      hsnCode: Number(item.hsn) || 0,
      quantity: item.quantity || 0,
      qtyUnit: getUnitUQC(item.unit),
      taxableAmount: Math.round(taxable * 100) / 100,
      cgstRate: isInterstate ? 0 : taxRate / 2,
      sgstRate: isInterstate ? 0 : taxRate / 2,
      igstRate: isInterstate ? taxRate : 0,
      cessRate,
    };
  });

  return {
    version: '1.0.1221',
    billLists: [{
      userGstin: profile.gstin || '',
      supplyType: 'O',
      subSupplyType: 1,
      docType: invoiceType === 'delivery-challan' ? 'CHL' : 'INV',
      docNo: details.invoiceNumber || '',
      docDate: formatDateGST(details.invoiceDate),
      fromGstin: profile.gstin || '',
      fromAddr1: (profile.address || '').substring(0, 120),
      fromPlace: profile.city || profile.state || '',
      fromPincode: fromPincode,
      fromStateCode: Number(fromStateCode) || 0,
      toGstin: client.gstin || 'URP',
      toAddr1: (client.address || '').substring(0, 120),
      toPlace: client.city || client.state || '',
      toPincode: toPincode,
      toStateCode: Number(toStateCode) || 0,
      totalValue: Math.round(((totals.taxableAmount != null ? totals.taxableAmount : (totals.subtotal - totals.totalDiscount))) * 100) / 100,
      cgstValue: Math.round((totals.cgst || 0) * 100) / 100,
      sgstValue: Math.round(((totals.sgst || 0) + (totals.utgst || 0)) * 100) / 100,
      igstValue: Math.round((totals.igst || 0) * 100) / 100,
      cessValue: Math.round((totals.cess || 0) * 100) / 100,
      totInvValue: Math.round(totals.total * 100) / 100,
      transMode: 1,
      transDistance: Math.max(1, Number(opts.distance) || 1),
      transporterName: '',
      transporterId: '',
      transDocNo: '',
      transDocDate: '',
      vehicleNo: '',
      vehicleType: 'R',
      itemList: itemList,
    }]
  };
};

export const getUpcomingFilings = (today = new Date()) => {
  const out = [];
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const push = (label, dueDate) => {
    const diff = Math.round((dueDate - t) / 86400000);
    if (diff >= 0 && diff <= 60) out.push({ label, dueDate: dueDate.toISOString().split('T')[0], daysAway: diff });
  };
  for (let i = 0; i < 3; i++) {
    const nextMonth = new Date(t.getFullYear(), t.getMonth() + i, 1);
    const m = nextMonth.getMonth();
    const y = nextMonth.getFullYear();
    push(`GSTR-1 (${nextMonth.toLocaleString('en-IN', { month: 'short', year: 'numeric' })})`, new Date(y, m + 1, 11));
    push(`GSTR-3B (${nextMonth.toLocaleString('en-IN', { month: 'short', year: 'numeric' })})`, new Date(y, m + 1, 20));
    const quarterEnd = m % 3 === 2;
    if (quarterEnd) {
      push(`Form 26Q (TDS Q ending ${nextMonth.toLocaleString('en-IN', { month: 'short' })})`, new Date(y, m + 2, 0));
      push(`Form 27EQ (TCS Q ending ${nextMonth.toLocaleString('en-IN', { month: 'short' })})`, new Date(y, m + 1, 15));
    }
  }

  const advDates = [
    { label: 'Advance Tax Installment 1 (15% cumulative)', date: new Date(t.getFullYear(), 5, 15) },
    { label: 'Advance Tax Installment 2 (45% cumulative)', date: new Date(t.getFullYear(), 8, 15) },
    { label: 'Advance Tax Installment 3 (75% cumulative)', date: new Date(t.getFullYear(), 11, 15) },
    { label: 'Advance Tax Installment 4 (100% — final)',    date: new Date(t.getFullYear() + (t.getMonth() >= 2 ? 1 : 0), 2, 15) },
  ];
  advDates.forEach(a => push(a.label, a.date));

  const itrYear = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
  push('ITR filing (non-audit) — due', new Date(itrYear + 1, 6, 31));
  push('ITR filing (audit / §44AB) — due', new Date(itrYear + 1, 9, 31));

  return out.sort((a, b) => a.daysAway - b.daysAway);
};

// A4 is the only supported paper size. Any saved value is ignored —
// every invoice renders at A4 portrait (210×297mm), matching Indian
// GST invoice expectations.
export const PAPER_SIZES = {
  a4: { label: 'A4 Portrait', hint: 'Standard business invoice', widthMm: 210, heightMm: 297, jsPdfFormat: 'a4', jsPdfOrientation: 'portrait', cssClass: 'paper-a4', kind: 'sheet' },
};

export const getPaperSize = () => PAPER_SIZES.a4;

export const getFYOptions = (n = 5, today = new Date()) => {
  const currentYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const options = [];
  for (let i = 0; i < n; i++) {
    const y = currentYear - i;
    options.push({
      value: `${y}-${y + 1}`,
      label: `FY ${y}-${String(y + 1).slice(-2)}`,
      from: `${y}-04-01`,
      to: `${y + 1}-03-31`,
    });
  }
  return options;
};

export const getFilingPeriod = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${mm}${d.getFullYear()}`;
};

export const BUILTIN_UNITS = [
  { label: 'Pcs',     uqc: 'PCS', kind: 'goods' },
  { label: 'Nos',     uqc: 'NOS', kind: 'both' },
  { label: 'Kg',      uqc: 'KGS', kind: 'goods' },
  { label: 'g',       uqc: 'GMS', kind: 'goods' },
  { label: 'Tonne',   uqc: 'TON', kind: 'goods' },
  { label: 'Ltr',     uqc: 'LTR', kind: 'goods' },
  { label: 'ml',      uqc: 'MLT', kind: 'goods' },
  { label: 'Mtr',     uqc: 'MTR', kind: 'goods' },
  { label: 'cm',      uqc: 'CMS', kind: 'goods' },
  { label: 'Ft',      uqc: 'FTS', kind: 'goods' },
  { label: 'In',      uqc: 'INS', kind: 'goods' },
  { label: 'Sq.ft',   uqc: 'SQF', kind: 'both'  },
  { label: 'Sq.m',    uqc: 'SQM', kind: 'both'  },
  { label: 'Hrs',     uqc: 'HRS', kind: 'services' },
  { label: 'Day',     uqc: 'DAY', kind: 'services' },
  { label: 'Week',    uqc: 'OTH', kind: 'services' },
  { label: 'Month',   uqc: 'OTH', kind: 'services' },
  { label: 'Year',    uqc: 'OTH', kind: 'services' },
  { label: 'Visit',   uqc: 'OTH', kind: 'services' },
  { label: 'Session', uqc: 'OTH', kind: 'services' },
  { label: 'Project', uqc: 'OTH', kind: 'services' },
  { label: 'Word',    uqc: 'OTH', kind: 'services' },
  { label: 'Page',    uqc: 'OTH', kind: 'services' },
  { label: 'Box',     uqc: 'BOX', kind: 'goods' },
  { label: 'Dozen',   uqc: 'DOZ', kind: 'goods' },
  { label: 'Pair',    uqc: 'PRS', kind: 'goods' },
  { label: 'Set',     uqc: 'SET', kind: 'goods' },
  { label: 'Bag',     uqc: 'BAG', kind: 'goods' },
  { label: 'Roll',    uqc: 'ROL', kind: 'goods' },
  { label: 'Bottle',  uqc: 'BTL', kind: 'goods' },
];

export const getDefaultUnitForMode = (mode) => {
  if (mode === 'services') return 'Hrs';
  if (mode === 'mixed') return 'Nos';
  return 'Nos';
};

export const filterUnitsByMode = (units, mode) => {
  if (mode === 'mixed' || !mode) return units;
  return units.filter(u => u.kind === mode || u.kind === 'both' || u.custom);
};

const CUSTOM_UNITS_KEY = 'gst_customUnits';

export const getCustomUnits = () => {
  try {
    const raw = localStorage.getItem(CUSTOM_UNITS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(u => u && typeof u.label === 'string') : [];
  } catch { return []; }
};

export const addCustomUnit = (label) => {
  const trimmed = (label || '').trim();
  if (!trimmed || trimmed.length > 20) return false;
  const existing = getCustomUnits();
  if (existing.some(u => u.label.toLowerCase() === trimmed.toLowerCase())) return false;
  if (BUILTIN_UNITS.some(u => u.label.toLowerCase() === trimmed.toLowerCase())) return false;
  const next = [...existing, { label: trimmed, uqc: 'OTH', custom: true }];
  try { localStorage.setItem(CUSTOM_UNITS_KEY, JSON.stringify(next)); } catch { return false; }
  return true;
};

export const removeCustomUnit = (label) => {
  const next = getCustomUnits().filter(u => u.label !== label);
  try { localStorage.setItem(CUSTOM_UNITS_KEY, JSON.stringify(next)); } catch { }
};

export const getAllUnits = () => [...BUILTIN_UNITS, ...getCustomUnits()];

export const getUnitUQC = (label) => {
  const u = getAllUnits().find(x => x.label === label);
  return u?.uqc || 'OTH';
};

export const validateTaxId = (countryName, value) => {
  if (!value || !value.trim()) return { ok: true, message: '' };
  const cc = getCountryConfig(countryName);
  if (!cc.taxIdRegex) return { ok: true, message: '' };
  const ok = cc.taxIdRegex.test(value.trim().toUpperCase());
  return ok
    ? { ok: true, message: '' }
    : { ok: false, message: `${cc.taxIdLabel} format looks unusual. Expected like: ${cc.taxIdPlaceholder}` };
};

export const detectCountryFromBrowser = () => {
  try {
    const locale = (navigator?.language || 'en-IN').split('-');
    const region = locale[1]?.toUpperCase() || '';
    const match = COUNTRIES.find(c => c.code === region);
    return match?.name || 'India';
  } catch { return 'India'; }
};

export const formatExchangeRateLine = (currency, rate, baseCurrency = 'INR') => {
  if (!rate || !currency || currency === baseCurrency) return '';
  return `1 ${currency} = ${Number(rate).toFixed(4)} ${baseCurrency}`;
};

const newAccountId = () => `acc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const getPaymentAccounts = (profile) => {
  if (!profile) return [];
  if (Array.isArray(profile.paymentAccounts) && profile.paymentAccounts.length > 0) {
    return profile.paymentAccounts;
  }
  const hasLegacy = profile.bankName || profile.accountNumber || profile.ifsc || profile.swift || profile.upiId;
  if (!hasLegacy) return [];
  return [{
    id: 'legacy',
    label: profile.bankName ? `${profile.bankName}` : 'Default account',
    bankName: profile.bankName || '',
    accountNumber: profile.accountNumber || '',
    ifsc: profile.ifsc || '',
    swift: profile.swift || '',
    upiId: profile.upiId || '',
    isDefault: true,
    notes: '',
  }];
};

export const getDefaultAccount = (profile) => {
  const accounts = getPaymentAccounts(profile);
  return accounts.find(a => a.isDefault) || accounts[0] || null;
};

export const getAccountById = (profile, id) => {
  if (!id) return getDefaultAccount(profile);
  const accounts = getPaymentAccounts(profile);
  return accounts.find(a => a.id === id) || getDefaultAccount(profile);
};

export const createEmptyAccount = (label = 'New account') => ({
  id: newAccountId(),
  label,
  bankName: '',
  accountHolderName: '',
  accountNumber: '',
  accountType: '',
  ifsc: '',
  swift: '',
  upiId: '',
  isDefault: false,
  isActive: true,
  notes: '',
});

export const getActiveAccounts = (profile) =>
  getPaymentAccounts(profile).filter(a => a.isActive !== false);

export const maskAccountNumber = (n) => {
  const s = String(n || '').trim();
  if (s.length <= 4) return s;
  return '••••' + s.slice(-4);
};

export const reorderAccounts = (accounts, fromIdx, toIdx) => {
  if (!Array.isArray(accounts)) return accounts;
  if (fromIdx === toIdx || fromIdx < 0 || fromIdx >= accounts.length) return accounts;
  if (toIdx < 0 || toIdx >= accounts.length) return accounts;
  const next = accounts.slice();
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
};

export const setDefaultAccount = (accounts, accountId) => {
  if (!Array.isArray(accounts) || !accountId) return accounts;
  if (!accounts.some(a => a.id === accountId)) return accounts;
  return accounts.map(a => ({ ...a, isDefault: a.id === accountId }));
};

export const isValidUpiId = (s) => /^[\w.\-]+@[\w.\-]+$/.test(String(s || '').trim());

export const FEATURE_GROUPS = [
  {
    id: 'sales',
    label: 'Sales & Invoicing',
    description: 'Invoice creation, recurring invoices, payment receipts',
    modules: [
      { id: 'invoicing', label: 'Tax invoices, proforma, credit notes', nav: 'new', core: true },
      { id: 'recurring', label: 'Recurring invoices', nav: 'recurring', defaultOn: true },
      { id: 'receipts',  label: 'Payment receipts',  nav: 'receipts',  defaultOn: true },
    ],
  },
  {
    id: 'directory',
    label: 'Directory',
    description: 'Clients and product catalog',
    modules: [
      { id: 'clients',   label: 'Clients',   nav: 'clients', core: true },
      { id: 'inventory', label: 'Products & Services (inventory)', nav: 'inventory', defaultOn: true },
    ],
  },
  {
    id: 'purchases',
    label: 'Purchases & Expenses',
    description: 'Vendor bills, expense tracking, ITC',
    modules: [
      { id: 'expenses',  label: 'Expense tracker', nav: 'expenses',  defaultOn: true },
      { id: 'purchases', label: 'Purchase bills',  nav: 'purchases', defaultOn: true },
      { id: 'gstr2b',    label: 'GSTR-2B reconciliation', nav: null, defaultOn: true, indiaOnly: true },
    ],
  },
  {
    id: 'gst',
    label: 'GST & Tax (India)',
    description: 'GSTR returns, e-Way Bill, TDS/TCS, HSN summaries',
    modules: [
      { id: 'gstReturns', label: 'GSTR-1 / GSTR-3B exports', nav: 'filing', defaultOn: true, indiaOnly: true },
      { id: 'ewayBill',   label: 'E-Way Bill JSON export', nav: null, defaultOn: true, indiaOnly: true },
      { id: 'tdsTcs',     label: 'TDS / TCS on invoices', nav: null, defaultOn: false, indiaOnly: true },
      { id: 'incomeTax',  label: 'Income Tax Helper', nav: 'incometax', defaultOn: true, indiaOnly: true },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Dashboards and financial reports',
    modules: [
      { id: 'dashboard', label: 'Dashboard', nav: 'dashboard', core: true },
      { id: 'reports',   label: 'Reports view', nav: 'reports', defaultOn: true },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Cloud backup and payment QR codes',
    modules: [
      { id: 'googleDrive', label: 'Google Drive backup', nav: null, defaultOn: true },
      { id: 'upiQr',       label: 'UPI QR code on invoices', nav: null, defaultOn: true, indiaOnly: true },
    ],
  },
];

const ALL_MODULES = FEATURE_GROUPS.flatMap(g => g.modules.map(m => ({ ...m, group: g.id })));

export const isModuleEnabled = (moduleId, userMap = {}) => {
  const mod = ALL_MODULES.find(m => m.id === moduleId);
  if (!mod) return true;
  if (mod.core) return true;
  if (Object.prototype.hasOwnProperty.call(userMap, moduleId)) return !!userMap[moduleId];
  return mod.defaultOn !== false;
};

export const TERMS_PRESETS = [
  {
    id: 'generic-sme',
    label: 'Generic SME / Trader',
    region: 'IN',
    body: `<p><strong>Payment Terms</strong></p><ul><li>Payment is due within <strong>15 days</strong> from the date of invoice.</li><li>Goods once sold will not be taken back or exchanged.</li></ul>`,
  },
  {
    id: 'custom-blank',
    label: '— Start from blank —',
    region: '*',
    body: '',
  },
];

export const TDS_SECTIONS = [
  { code: '194Q', label: '194Q — Purchase of goods', rate: 0.1 },
  { code: '194C', label: '194C — Contractor / sub-contractor', rate: 1 },
  { code: '194J', label: '194J — Professional services', rate: 10 },
  { code: '194I', label: '194I — Rent', rate: 10 },
];

export const TCS_SECTIONS = [
  { code: '206C(1H)', label: '206C(1H) — Sale of goods', rate: 0.1 },
  { code: '52',       label: 'CGST 52 — E-commerce operator', rate: 1 },
];

export const calculateRoundOff = (total) => {
  if (typeof total !== 'number' || isNaN(total)) return 0;
  const rounded = Math.round(total);
  return Math.round((rounded - total) * 100) / 100;
};

export const CURRENCY_NAMES = {
  INR: { major: 'Rupees',   minor: 'Paise' },
  USD: { major: 'Dollars',  minor: 'Cents' },
  EUR: { major: 'Euros',    minor: 'Cents' },
  GBP: { major: 'Pounds',   minor: 'Pence' },
};