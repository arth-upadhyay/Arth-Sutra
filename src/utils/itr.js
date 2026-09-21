// ============================================================================
// Indian Income Tax helpers — FY 2025-26 (current filing season).
// Pure math. No React. Callers in components/IncomeTax.jsx consume these.
// ============================================================================

export const CURRENT_FY = '2025-26';

// ─── Slabs ──────────────────────────────────────────────────────────────────

// Old regime, age < 60.
export const OLD_REGIME_SLABS = [
  { upto: 250_000, rate: 0 },
  { upto: 500_000, rate: 0.05 },
  { upto: 1_000_000, rate: 0.20 },
  { upto: Infinity, rate: 0.30 },
];
export const OLD_REGIME_SLABS_SENIOR = [
  { upto: 300_000, rate: 0 },
  { upto: 500_000, rate: 0.05 },
  { upto: 1_000_000, rate: 0.20 },
  { upto: Infinity, rate: 0.30 },
];
export const OLD_REGIME_SLABS_SUPER_SENIOR = [
  { upto: 500_000, rate: 0 },
  { upto: 1_000_000, rate: 0.20 },
  { upto: Infinity, rate: 0.30 },
];

export const NEW_REGIME_SLABS_FY_2024_25 = [
  { upto: 300_000, rate: 0 },
  { upto: 700_000, rate: 0.05 },
  { upto: 1_000_000, rate: 0.10 },
  { upto: 1_200_000, rate: 0.15 },
  { upto: 1_500_000, rate: 0.20 },
  { upto: Infinity, rate: 0.30 },
];
export const NEW_REGIME_SLABS_FY_2025_26 = [
  { upto: 400_000, rate: 0 },
  { upto: 800_000, rate: 0.05 },
  { upto: 1_200_000, rate: 0.10 },
  { upto: 1_600_000, rate: 0.15 },
  { upto: 2_000_000, rate: 0.20 },
  { upto: 2_400_000, rate: 0.25 },
  { upto: Infinity, rate: 0.30 },
];

export function getOldRegimeSlabs(age) {
  const a = Number(age) || 0;
  if (a >= 80) return OLD_REGIME_SLABS_SUPER_SENIOR;
  if (a >= 60) return OLD_REGIME_SLABS_SENIOR;
  return OLD_REGIME_SLABS;
}

export function getNewRegimeSlabs(fy = CURRENT_FY) {
  return fy === '2025-26' ? NEW_REGIME_SLABS_FY_2025_26 : NEW_REGIME_SLABS_FY_2024_25;
}

// ─── Per-FY config ──────────────────────────────────────────────────────────

export function get87AConfig(regime, fy = CURRENT_FY) {
  if (regime === 'old') return { threshold: 500_000, cap: 12_500 };
  return fy === '2025-26'
    ? { threshold: 1_200_000, cap: 60_000 }
    : { threshold: 700_000, cap: 25_000 };
}

// Post-23-Jul-2024 rates (Finance No.2 Act 2024). Pre-transition variant
// supplied for callers that need to split FY 24-25 pre/post that date.
export function getCapitalGainsConfig() {
  return {
    stcgRate: 0.20,
    ltcgRate: 0.125,
    ltcgExemption: 125_000,
    preTransition: { stcgRate: 0.15, ltcgRate: 0.10, ltcgExemption: 100_000 },
  };
}

// ─── Deduction caps ─────────────────────────────────────────────────────────

export const DEDUCTION_CAPS = {
  '80C':     150_000,
  '80CCD1B': 50_000,
  '80D':     100_000,   // MAX — actual cap depends on senior status
  '80TTA':   10_000,
  '80TTB':   50_000,
  '80E':     Infinity,
  '80G':     Infinity,
  '80GG':    60_000,
  '80DDB':   100_000,   // MAX — 40k if self not senior
  '80U':     125_000,
  '24b':     200_000,
};

// Context-sensitive cap. 80D depends on self + parents senior status;
// 80DDB depends on self senior status; everything else uses DEDUCTION_CAPS.
export function effectiveDeductionCap(section, ctx = {}) {
  const s = String(section || '').toUpperCase();
  if (s === '80D') {
    return (ctx.selfSenior ? 50_000 : 25_000) + (ctx.parentsSenior ? 50_000 : 25_000);
  }
  if (s === '80DDB') {
    return ctx.selfSenior ? 100_000 : 40_000;
  }
  return DEDUCTION_CAPS[section] ?? Infinity;
}

// ─── Core math ──────────────────────────────────────────────────────────────

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function formatINR(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }

// Rule 119A: round DOWN to nearest ₹100 before multiplying by 1% per month.
function rule119A(amount) {
  return Math.floor(Math.max(0, Number(amount) || 0) / 100) * 100;
}

export function computeSlabTax(taxableIncome, slabs) {
  if (!Number.isFinite(taxableIncome) || taxableIncome <= 0) return 0;
  let remaining = taxableIncome;
  let lower = 0;
  let tax = 0;
  for (const slab of slabs) {
    const slice = Math.min(remaining, slab.upto - lower);
    if (slice <= 0) break;
    tax += slice * slab.rate;
    remaining -= slice;
    lower = slab.upto;
    if (remaining <= 0) break;
  }
  return round2(tax);
}

// Finance Act 2022: surcharge on §111A / §112A tax is capped at 15%.
// Marginal relief ensures tax+surcharge from crossing a threshold never
// exceeds the extra income beyond it.
export function computeSurcharge(tax, totalIncome, regime = 'new', opts = {}) {
  if (!Number.isFinite(totalIncome) || totalIncome <= 5_000_000) return 0;

  const tier = (income) => {
    if (income <= 10_000_000) return 0.10;
    if (income <= 20_000_000) return 0.15;
    if (income <= 50_000_000) return 0.25;
    return regime === 'new' ? 0.25 : 0.37;
  };
  const specialTax = Math.max(0, Number(opts.specialRateTax) || 0);
  const blended = (income) => {
    const t = tier(income);
    const cappedSpecial = Math.min(t, 0.15);
    return Math.max(0, tax - specialTax) * t + specialTax * cappedSpecial;
  };

  const raw = blended(totalIncome);
  const thresholds = [50_000_000, 20_000_000, 10_000_000, 5_000_000];
  const applicable = thresholds.find(t => totalIncome > t) || 0;
  if (!applicable) return round2(raw);

  const atThreshold = applicable === 5_000_000 ? 0 : blended(applicable - 1);
  const extraIncome = totalIncome - applicable;
  const extraBurden = raw - atThreshold;
  return round2(extraBurden > extraIncome ? atThreshold + extraIncome : raw);
}

// 87A eligibility uses TOTAL income (§2(45)) — includes full 111A / 112A gains.
export function computeRebate87A(totalIncome, tax, regime = 'new', fy = CURRENT_FY) {
  const { threshold, cap } = get87AConfig(regime, fy);
  return totalIncome <= threshold ? Math.min(tax, cap) : 0;
}

export function computeCess(taxAfterRebateAndSurcharge) {
  return round2(Math.max(0, taxAfterRebateAndSurcharge) * 0.04);
}

export function standardDeduction(regime = 'new') {
  return regime === 'new' ? 75_000 : 50_000;
}

// 80CCD(2) — employer NPS — capped at 10% of salary (14% for central govt).
// Available in BOTH regimes. Other Chapter VI-A sections are old-regime only.
export function computeAllowedDeductions(userDeductions = {}, regime = 'old', ctx = {}) {
  const salary = Math.max(0, Number(ctx.salary) || 0);
  const nps2Cap = salary * (ctx.isGovtEmployee ? 0.14 : 0.10);
  const allowedNps2 = Math.min(Number(userDeductions['80CCD2']) || 0, nps2Cap);

  if (regime === 'new') return round2(allowedNps2);

  let total = allowedNps2;
  for (const section of Object.keys(DEDUCTION_CAPS)) {
    const claimed = Number(userDeductions[section]) || 0;
    total += Math.min(claimed, effectiveDeductionCap(section, ctx));
  }
  return round2(total);
}

// ─── End-to-end tax computation ─────────────────────────────────────────────

export function computeTax(inputs) {
  const {
    salary = 0,
    businessIncome = 0,
    housePropertyIncome = 0,
    otherSources = 0,
    stcgAtSpecialRate = 0,
    ltcgAtSpecialRate = 0,
    deductions = {},
    regime = 'new',
    fy = CURRENT_FY,
    age = 0,
    selfSenior = false,
    parentsSenior = false,
    isGovtEmployee = false,
  } = inputs;

  const stdDed = salary > 0 ? Math.min(salary, standardDeduction(regime)) : 0;
  const salaryAfterStd = Math.max(0, salary - stdDed);
  const gti = salaryAfterStd + businessIncome + housePropertyIncome + otherSources;

  const allowedDeductions = computeAllowedDeductions(deductions, regime, {
    selfSenior, parentsSenior, salary, isGovtEmployee,
  });

  const taxableIncome = Math.max(0, gti - allowedDeductions);
  const slabs = regime === 'new' ? getNewRegimeSlabs(fy) : getOldRegimeSlabs(age);
  const slabTax = computeSlabTax(taxableIncome, slabs);

  const cg = getCapitalGainsConfig();
  const stcgTax = round2(stcgAtSpecialRate * cg.stcgRate);
  const ltcgTaxable = Math.max(0, ltcgAtSpecialRate - cg.ltcgExemption);
  const ltcgTax = round2(ltcgTaxable * cg.ltcgRate);
  const specialRateTax = stcgTax + ltcgTax;

  const taxBeforeRebate = slabTax + specialRateTax;
  const totalIncomeForRebate = taxableIncome + stcgAtSpecialRate + ltcgAtSpecialRate;
  const rebate = computeRebate87A(totalIncomeForRebate, slabTax, regime, fy);
  const taxAfterRebate = Math.max(0, taxBeforeRebate - rebate);

  const surcharge = computeSurcharge(taxAfterRebate, totalIncomeForRebate, regime, { specialRateTax });
  const cess = computeCess(taxAfterRebate + surcharge);
  const totalTax = round2(taxAfterRebate + surcharge + cess);

  return {
    fy,
    grossTotalIncome: round2(gti),
    salaryAfterStd: round2(salaryAfterStd),
    standardDeduction: round2(stdDed),
    allowedDeductions: round2(allowedDeductions),
    taxableIncome: round2(taxableIncome),
    slabTax: round2(slabTax),
    stcgTax: round2(stcgTax),
    ltcgTax: round2(ltcgTax),
    specialRateTax: round2(specialRateTax),
    taxBeforeRebate: round2(taxBeforeRebate),
    rebate87A: round2(rebate),
    taxAfterRebate: round2(taxAfterRebate),
    surcharge: round2(surcharge),
    cess: round2(cess),
    totalTax,
    regime,
  };
}

export function compareRegimes(inputs) {
  const old_ = computeTax({ ...inputs, regime: 'old' });
  const new_ = computeTax({ ...inputs, regime: 'new' });
  const savings = new_.totalTax - old_.totalTax;
  return {
    old: old_,
    new: new_,
    savings: round2(Math.abs(savings)),
    recommended: savings > 0.5 ? 'old' : 'new',
  };
}

// ─── Bank statement parsing ─────────────────────────────────────────────────

// Category that a given transaction narration maps to. First match wins.
const AUTO_CATEGORY_RULES = [
  { pattern: /\bsalary|sal\b|payroll/i,                        category: 'salary' },
  { pattern: /\bint\b|interest|savings interest|sb\s*int/i,    category: 'interest' },
  { pattern: /\brent\b|rental/i,                               category: 'rent_received' },
  { pattern: /\bsip\b|mutual fund|elss|mf\b|\bppf|nps\b/i,     category: 'investment' },
  { pattern: /\blic\b|life insurance/i,                        category: 'deduction_80C' },
  { pattern: /health insurance|mediclaim/i,                    category: 'deduction_80D' },
  { pattern: /\bgst\b|cgst|sgst|igst/i,                        category: 'gst_paid' },
  { pattern: /\bemi\b|home loan|housing loan|office rent|rent paid/i, category: 'business_out' },
  { pattern: /electric|utility|broadband|internet|telephone/i, category: 'business_out' },
  { pattern: /aws|amazon web|azure|google cloud|adobe|figma/i, category: 'business_out' },
  { pattern: /amazon|flipkart|swiggy|zomato/i,                 category: 'personal' },
  { pattern: /\batm|cash withdrawal/i,                         category: 'personal' },
  { pattern: /\bimps|neft|rtgs|upi/i,                          category: 'transfer' },
];

export function autoCategorize(description) {
  const d = String(description || '');
  for (const rule of AUTO_CATEGORY_RULES) {
    if (rule.pattern.test(d)) return rule.category;
  }
  return 'transfer';
}

// Bank layouts. `cols` maps the output key → column-header regex. First match
// wins, so order matters — most-specific layout first. `date` with an `altDate`
// fallback covers banks (SBI) that have two date columns.
const BANK_DEFS = [
  {
    name: 'SBI',
    match: h => h.some(x => /Txn Date/i.test(x)) && h.some(x => /Value Date/i.test(x)),
    cols: { date: /Txn Date/i, altDate: /Value Date/i, description: /Description|Narration/i, debit: /Debit/i, credit: /Credit/i, balance: /Balance/i },
  },
  {
    name: 'HDFC',
    match: h => h.some(x => /Narration/i.test(x)) && h.some(x => /Withdrawal Amt/i.test(x)),
    cols: { date: /Date/i, description: /Narration/i, debit: /Withdrawal Amt/i, credit: /Deposit Amt/i, balance: /Closing Balance/i },
  },
  {
    name: 'ICICI',
    match: h => h.some(x => /Transaction Remarks/i.test(x)),
    cols: { date: /Transaction Date|Value Date/i, description: /Transaction Remarks|Description/i, debit: /Withdrawal Amount|Debit/i, credit: /Deposit Amount|Credit/i, balance: /Balance/i },
  },
  {
    name: 'Axis',
    match: h => h.some(x => /Tran Date/i.test(x)) && h.some(x => /Particulars/i.test(x)),
    cols: { date: /Tran Date/i, description: /Particulars/i, debit: /Debit/i, credit: /Credit/i, balance: /Balance/i },
  },
  {
    name: 'Kotak',
    match: h => h.some(x => /Chq\/Ref No/i.test(x)) || h.some(x => /Withdrawal\(Dr\)/i.test(x)),
    cols: { date: /Date/i, description: /Description|Narration/i, debit: /Withdrawal|Debit/i, credit: /Deposit|Credit/i, balance: /Balance/i },
  },
  {
    name: 'PNB',
    match: h => h.some(x => /Chq No/i.test(x)) && h.some(x => /Narration/i.test(x)),
    cols: { date: /Transaction Date|Date/i, description: /Narration/i, debit: /Debit/i, credit: /Credit/i, balance: /Balance/i },
  },
  {
    name: 'Yes Bank',
    match: h => h.some(x => /Chq No\.|Instrument No/i.test(x)) && h.some(x => /Value Date/i.test(x)),
    cols: { date: /Transaction Date|Value Date/i, description: /Description|Narration/i, debit: /Debit/i, credit: /Credit/i, balance: /Balance/i },
  },
  {
    name: 'Generic',
    match: () => true,
    cols: { date: /Date/i, description: /Description|Narration|Particulars|Remarks/i, debit: /Debit|Withdrawal|Dr/i, credit: /Credit|Deposit|Cr/i, balance: /Balance/i },
  },
];

export function parseBankStatement(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) throw new Error('CSV must have a header row and at least one transaction');

  // Some banks prepend account-info lines above the header row.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const r = rows[i];
    if (r.some(c => /date/i.test(c)) && r.some(c => /balance|amount/i.test(c))) {
      headerIdx = i;
      break;
    }
  }
  const headers = rows[headerIdx];
  const def = BANK_DEFS.find(d => d.match(headers));

  const idx = {};
  for (const [key, re] of Object.entries(def.cols)) {
    idx[key] = headers.findIndex(h => re.test(String(h || '').trim()));
  }

  const transactions = rows.slice(headerIdx + 1)
    .filter(r => r.length >= 3 && r.some(c => c && String(c).trim()))
    .map(r => {
      const date = (idx.date >= 0 ? r[idx.date] : '') || (idx.altDate >= 0 ? r[idx.altDate] : '');
      if (!date) return null;
      const description = idx.description >= 0 ? r[idx.description] : '';
      return {
        date,
        description,
        debit: parseAmt(idx.debit >= 0 ? r[idx.debit] : ''),
        credit: parseAmt(idx.credit >= 0 ? r[idx.credit] : ''),
        balance: parseAmt(idx.balance >= 0 ? r[idx.balance] : ''),
        category: autoCategorize(description),
      };
    })
    .filter(Boolean);

  return { bankName: def.name, transactions };
}

// ─── CSV / amount helpers ───────────────────────────────────────────────────

function parseCSV(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else cur += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else cur += c;
      }
    }
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function parseAmt(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/[₹,\s]/g, '').replace(/^-$/, '0'));
  return Number.isFinite(n) ? n : 0;
}

// ─── Presumptive taxation ───────────────────────────────────────────────────

export function compute44AD({ digitalReceipts = 0, cashReceipts = 0, declaredIncome } = {}) {
  const digital = Math.max(0, Number(digitalReceipts) || 0);
  const cash = Math.max(0, Number(cashReceipts) || 0);
  const turnover = digital + cash;
  const cashPct = turnover > 0 ? cash / turnover : 0;
  const threshold = cashPct <= 0.05 ? 30_000_000 : 20_000_000;
  const isEligible = turnover <= threshold;

  const deemed = round2(digital * 0.06 + cash * 0.08);
  const declared = Number(declaredIncome) || 0;
  const presumptiveIncome = Math.max(deemed, declared);

  const notes = [];
  if (!isEligible) {
    notes.push(`Turnover of ${formatINR(turnover)} exceeds the §44AD limit of ${formatINR(threshold)}. Regular books + ITR-3 + audit (§44AB) apply.`);
  }
  if (cashPct > 0.05 && turnover <= 30_000_000) {
    notes.push(`${(cashPct * 100).toFixed(1)}% of turnover is cash — above the 5% threshold. Reduce cash receipts to qualify for the ₹3 Cr limit.`);
  }
  if (declared && declared < deemed) {
    notes.push(`Declared income (${formatINR(declared)}) is below the presumptive minimum (${formatINR(deemed)}). Regular books + ITR-3 required.`);
  }

  return {
    turnover: round2(turnover),
    digitalReceipts: round2(digital),
    cashReceipts: round2(cash),
    deemedIncome: deemed,
    presumptiveIncome: round2(presumptiveIncome),
    isEligible,
    section: '44AD',
    threshold,
    notes,
  };
}

export function compute44ADA({ digitalReceipts = 0, cashReceipts = 0, declaredIncome } = {}) {
  const digital = Math.max(0, Number(digitalReceipts) || 0);
  const cash = Math.max(0, Number(cashReceipts) || 0);
  const turnover = digital + cash;
  const cashPct = turnover > 0 ? cash / turnover : 0;
  const threshold = cashPct <= 0.05 ? 7_500_000 : 5_000_000;
  const isEligible = turnover <= threshold;

  const deemed = round2(turnover * 0.50);
  const declared = Number(declaredIncome) || 0;
  const presumptiveIncome = Math.max(deemed, declared);

  const notes = [];
  if (!isEligible) {
    notes.push(`Gross receipts of ${formatINR(turnover)} exceed the §44ADA limit of ${formatINR(threshold)}. Full books + ITR-3 + audit (§44AB) apply.`);
  }
  if (declared && declared < deemed) {
    notes.push('Declared income is below 50% of gross receipts. Full books required.');
  }

  return {
    turnover: round2(turnover),
    digitalReceipts: round2(digital),
    cashReceipts: round2(cash),
    deemedIncome: deemed,
    presumptiveIncome: round2(presumptiveIncome),
    isEligible,
    section: '44ADA',
    threshold,
    notes,
  };
}

export function compute44AE({ heavyVehicleMonths = 0, heavyVehicleTonnage = 0, lightVehicleMonths = 0, declaredIncome } = {}) {
  const hMonths = Math.max(0, Number(heavyVehicleMonths) || 0);
  const hTonnes = Math.max(0, Number(heavyVehicleTonnage) || 0);
  const lMonths = Math.max(0, Number(lightVehicleMonths) || 0);

  const heavyIncome = round2(hMonths * hTonnes * 1000);
  const lightIncome = round2(lMonths * 7500);
  const deemed = heavyIncome + lightIncome;
  const declared = Number(declaredIncome) || 0;
  const presumptiveIncome = Math.max(deemed, declared);

  // (vehicle-months) / 12 approximates the peak fleet size.
  const impliedFleet = (hMonths + lMonths) / 12;
  const isEligible = impliedFleet <= 10.0001;

  const notes = [];
  if (!isEligible) {
    notes.push(`Implied fleet ≈ ${impliedFleet.toFixed(1)} vehicles exceeds §44AE's 10-goods-carriage cap. Regular books + ITR-3 + audit apply.`);
  }
  if (declared && declared < deemed) {
    notes.push(`Declared income (${formatINR(declared)}) is below the presumptive minimum (${formatINR(deemed)}). Regular books + ITR-3 required.`);
  }

  return {
    heavyIncome,
    lightIncome,
    deemedIncome: deemed,
    presumptiveIncome: round2(presumptiveIncome),
    isEligible,
    section: '44AE',
    notes,
  };
}

// ─── Advance tax + interest ─────────────────────────────────────────────────

export function getAdvanceTaxSchedule(fy = CURRENT_FY) {
  const startYear = parseInt(String(fy).split('-')[0], 10);
  if (!Number.isFinite(startYear)) throw new Error(`Invalid FY: ${fy}`);
  const endYear = startYear + 1;
  return [
    { installment: 1, dueDate: `${startYear}-06-15`, cumulativePct: 0.15, label: 'By 15 June' },
    { installment: 2, dueDate: `${startYear}-09-15`, cumulativePct: 0.45, label: 'By 15 Sept' },
    { installment: 3, dueDate: `${startYear}-12-15`, cumulativePct: 0.75, label: 'By 15 Dec' },
    { installment: 4, dueDate: `${endYear}-03-15`,   cumulativePct: 1.00, label: 'By 15 March' },
  ];
}

export function computeAdvanceTaxSchedule(totalTax, tdsAlreadyDeducted = 0, paid = [], mode = 'regular', fy = CURRENT_FY) {
  const netLiability = Math.max(0, totalTax - (Number(tdsAlreadyDeducted) || 0));
  if (netLiability < 10_000) {
    return {
      netLiability,
      applies: false,
      note: 'Net liability (after TDS) is below ₹10,000 — no advance tax required.',
      schedule: [],
      fy,
    };
  }
  const fullSchedule = getAdvanceTaxSchedule(fy);
  const rows = (mode === 'presumptive' ? [fullSchedule[3]] : fullSchedule)
    .map((row, i, arr) => {
      const cumulativeDue = round2(netLiability * row.cumulativePct);
      const totalPaidByDue = paid
        .filter(p => p.date <= row.dueDate)
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const prev = mode === 'presumptive' ? 0 : (arr[i - 1]?.cumulativePct || 0);
      return {
        ...row,
        installmentDue: round2(netLiability * (row.cumulativePct - prev)),
        cumulativeDue,
        totalPaidByDue,
        shortfall: Math.max(0, cumulativeDue - totalPaidByDue),
      };
    });
  const totalPaid = paid.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return {
    applies: true,
    netLiability,
    totalPaid: round2(totalPaid),
    totalOutstanding: round2(Math.max(0, netLiability - totalPaid)),
    schedule: rows,
    mode,
    fy,
  };
}

export function compute234CInterest(schedule) {
  if (!schedule.applies || !schedule.schedule.length) return 0;
  const netLiab = schedule.netLiability;

  // Presumptive mode: single installment, 1 month × 1%.
  if (schedule.mode === 'presumptive' || schedule.schedule.length === 1) {
    const only = schedule.schedule[0];
    return round2(rule119A(netLiab - (only?.totalPaidByDue || 0)) * 0.01);
  }

  const [i1, i2, i3, i4] = schedule.schedule;
  let interest = 0;
  if (i1 && i1.totalPaidByDue < 0.12 * netLiab) interest += rule119A(netLiab * 0.15 - i1.totalPaidByDue) * 0.03;
  if (i2 && i2.totalPaidByDue < 0.36 * netLiab) interest += rule119A(netLiab * 0.45 - i2.totalPaidByDue) * 0.03;
  if (i3) interest += rule119A(netLiab * 0.75 - i3.totalPaidByDue) * 0.03;
  if (i4) interest += rule119A(netLiab - i4.totalPaidByDue) * 0.01;
  return round2(interest);
}

export function compute234BInterest(schedule, assessmentPaymentDate, fy) {
  if (!schedule.applies) return 0;
  const netLiab = schedule.netLiability;
  if (schedule.totalPaid >= 0.9 * netLiab) return 0;

  const shortfall = rule119A(netLiab - schedule.totalPaid);
  const useFy = schedule.fy || fy || CURRENT_FY;
  const startYear = parseInt(String(useFy).split('-')[0], 10);
  if (!Number.isFinite(startYear)) return 0;

  const fyEnd = new Date(`${startYear + 1}-04-01`);
  const payDate = assessmentPaymentDate ? new Date(assessmentPaymentDate) : new Date();
  if (payDate <= fyEnd) return 0;

  const months = Math.max(1,
    (payDate.getFullYear() - fyEnd.getFullYear()) * 12
    + (payDate.getMonth() - fyEnd.getMonth())
    + (payDate.getDate() > fyEnd.getDate() ? 1 : 0)
  );
  return round2(shortfall * 0.01 * months);
}

// §234A — late FILING (distinct from 234B/C which are late PAYMENT).
// 1% per month on unpaid self-assessment tax from (dueDate + 1) to filingDate.
export function compute234AInterest(netTaxPayable, taxPaid, filingDate, dueDate, fy = CURRENT_FY) {
  const outstanding = Math.max(0, (Number(netTaxPayable) || 0) - (Number(taxPaid) || 0));
  if (outstanding <= 0) return 0;

  let due;
  if (dueDate) {
    due = new Date(dueDate);
  } else {
    const startYear = parseInt(String(fy).split('-')[0], 10);
    if (!Number.isFinite(startYear)) return 0;
    due = new Date(`${startYear + 1}-07-31`);
  }
  const filed = filingDate ? new Date(filingDate) : new Date();
  if (!(filed > due)) return 0;

  const months = Math.max(1,
    (filed.getFullYear() - due.getFullYear()) * 12
    + (filed.getMonth() - due.getMonth())
    + (filed.getDate() > due.getDate() ? 1 : 0)
  );
  return round2(rule119A(outstanding) * 0.01 * months);
}

// ─── ITR-4 field map ────────────────────────────────────────────────────────

export function buildITR4FieldMap(inputs, tax, presumptive, deductions) {
  const rows = [];
  const add = (section, field, value, extra = {}) => rows.push({ section, field, value, ...extra });

  add('Part A — General', 'PAN', '', { note: 'Fill from your profile' });
  add('Part A — General', 'Filing Status', 'Filed under §139(1) — before due date');
  add('Part A — General', 'Aadhaar', '', { note: 'Must be linked' });

  if (presumptive?.section === '44AD') {
    add('Part A — Nature of Business', 'Section 44AD (Trading / Retail / Manufacturing)', 'Yes');
    add('Part A — Nature of Business', 'Gross Turnover (digital)', presumptive.digitalReceipts);
    add('Part A — Nature of Business', 'Gross Turnover (cash)', presumptive.cashReceipts);
  } else if (presumptive?.section === '44ADA') {
    add('Part A — Nature of Business', 'Section 44ADA (Profession)', 'Yes');
    add('Part A — Nature of Business', 'Gross Receipts', presumptive.turnover);
  } else if (presumptive?.section === '44AE') {
    add('Part A — Nature of Business', 'Section 44AE (Transport)', 'Yes');
  }

  const salary = Number(inputs.salary) || 0;
  const std = tax.standardDeduction || 0;
  add('B — Income', 'B1. Salary (gross)', salary, { note: salary > 0 ? 'From Form 16' : undefined });
  if (std) add('B — Income', '  Less: Standard Deduction', -std);
  add('B — Income', '  Net Salary', Math.max(0, salary - std));
  add('B — Income', 'B2. House Property (net)', Number(inputs.housePropertyIncome) || 0);
  add('B — Income', 'B3. Business / Profession',
    presumptive?.presumptiveIncome ?? (Number(inputs.businessIncome) || 0),
    { note: presumptive ? `Presumptive @ §${presumptive.section}` : 'From books' });
  add('B — Income', 'B4. Other Sources', Number(inputs.otherSources) || 0);
  add('B — Income', 'B5. Gross Total Income', tax.grossTotalIncome, { bold: true });

  if (tax.regime === 'old') {
    add('C — Deductions (Chapter VI-A)', '§80C', Math.min(150_000, Number(deductions?.['80C']) || 0));
    add('C — Deductions (Chapter VI-A)', '§80CCD(1B) — NPS', Math.min(50_000, Number(deductions?.['80CCD1B']) || 0));
    add('C — Deductions (Chapter VI-A)', '§80D — Health Insurance', Math.min(100_000, Number(deductions?.['80D']) || 0));
    add('C — Deductions (Chapter VI-A)', '§80TTA — Savings Interest', Math.min(10_000, Number(deductions?.['80TTA']) || 0));
    add('C — Deductions (Chapter VI-A)', '§80E — Education Loan Interest', Number(deductions?.['80E']) || 0);
    add('C — Deductions (Chapter VI-A)', '§80G — Donations', Number(deductions?.['80G']) || 0);
    add('C — Deductions (Chapter VI-A)', '  Total Chapter VI-A', tax.allowedDeductions, { bold: true });
  } else {
    add('C — Deductions (Chapter VI-A)', '§80CCD(2) — Employer NPS', Number(deductions?.['80CCD2']) || 0,
      { note: 'Only deduction allowed under new regime' });
  }

  add('D — Tax Computation', 'D1. Taxable Income', tax.taxableIncome, { bold: true });
  add('D — Tax Computation', 'D2. Tax on Total Income (slab)', tax.slabTax);
  if (tax.stcgTax) add('D — Tax Computation', '   + STCG (20%)', tax.stcgTax);
  if (tax.ltcgTax) add('D — Tax Computation', '   + LTCG (12.5%)', tax.ltcgTax);
  if (tax.rebate87A) add('D — Tax Computation', '   − §87A Rebate', -tax.rebate87A);
  if (tax.surcharge) add('D — Tax Computation', '   + Surcharge', tax.surcharge);
  add('D — Tax Computation', '   + Health & Ed Cess (4%)', tax.cess);
  add('D — Tax Computation', 'D3. TOTAL TAX PAYABLE', tax.totalTax, { bold: true, big: true });

  return rows;
}