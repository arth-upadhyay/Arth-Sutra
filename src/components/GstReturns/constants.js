// ---------------------------------------------------------------------------
// GST Returns constants + filing-guide step definitions.
// ---------------------------------------------------------------------------
export const GST_TYPES = ['tax-invoice', 'credit-note'];

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const QUARTERS = [
  { id: 'Q1', label: 'Q1 (Apr–Jun)', months: [3, 4, 5] },
  { id: 'Q2', label: 'Q2 (Jul–Sep)', months: [6, 7, 8] },
  { id: 'Q3', label: 'Q3 (Oct–Dec)', months: [9, 10, 11] },
  { id: 'Q4', label: 'Q4 (Jan–Mar)', months: [0, 1, 2] },
];

// ========== Filing Guide Steps ==========
export const GSTR1_STEPS = [
  {
    title: 'Login to GST Portal',
    details: `1. Open gst.gov.in in your browser (Chrome/Firefox recommended).
2. Click "Login" at top-right → Enter your GSTIN or Username → Enter Password → Enter Captcha → Click "LOGIN".
3. If you have 2FA enabled, enter the OTP sent to your registered mobile.
4. After login, you'll see the Dashboard. Click "Returns" in the top menu → Click "Returns Dashboard".
IMPORTANT: Use your authorized signatory credentials. Only the primary authorized signatory or additional users with filing rights can file returns.`
  },
  {
    title: 'Select Return Period for GSTR-1',
    details: `1. On the Returns Dashboard page, select "Financial Year" (e.g., 2025-26) and "Return Filing Period" (select the month, e.g., March).
2. Click "SEARCH" button.
3. The page will show all returns for that period. Find "GSTR-1" tile.
4. Click "PREPARE ONLINE" if you have fewer than 500 invoices. Click "PREPARE OFFLINE" if you have 500+ invoices (you'll download the offline tool, import the JSON from this app, and upload).
5. For QRMP scheme users: Select the quarter end month. You file quarterly but can use IFF (Invoice Furnishing Facility) monthly for B2B invoices.
NOTE: GSTR-1 must be filed BEFORE GSTR-3B. Due date: 11th of next month (monthly filers) or 13th of month after quarter (QRMP).`
  },
  {
    title: 'Table 4A — B2B Invoices (Registered Clients)',
    details: `1. Click "4A, 4B, 4C, 6B, 6C — B2B Invoices" tile.
2. Click "+ ADD INVOICE" button.
3. For EACH B2B invoice from your GSTR-1 tab above, enter:
   • Receiver GSTIN — Enter the 15-digit GSTIN (e.g., 03AABCU9603R1ZN). Portal auto-validates.
   • Invoice Number — Must match EXACTLY as on your invoice (e.g., INV/2025-26/0001).
   • Invoice Date — DD/MM/YYYY format. Must fall within the return period.
   • Invoice Value — Total invoice amount INCLUDING tax (the "Total" column in B2B table above).
   • Place of Supply — Select the state. For intra-state, this is YOUR state. For inter-state, this is the BUYER's state.
   • Reverse Charge — Select "N" (No) for normal supplies. Select "Y" only if the buyer pays GST under reverse charge (Section 9(3)/9(4)).
   • Invoice Type — "Regular" for normal invoices, "SEZ supplies with payment" / "SEZ supplies without payment" for SEZ.
   • Click "ADD" under tax details → Enter Rate (e.g., 18%), Taxable Value, IGST or CGST+SGST amounts.
4. Click "SAVE" after each invoice.
5. Repeat for ALL B2B invoices.
TIP: Use the "GSTR-1 JSON" export from this app and upload via offline tool to skip manual entry.
COMMON ERROR: "Invoice number already exists" — each invoice number must be unique within the period.`
  },
  {
    title: 'Table 5 — B2C Large (Inter-state > ₹2.5 Lakh)',
    details: `This table is ONLY for inter-state invoices to UNREGISTERED persons (no GSTIN) where invoice value EXCEEDS ₹2,50,000.
1. Click "5A, 5B — B2C (Large) Invoices" tile.
2. Click "+ ADD INVOICE".
3. Enter: Place of Supply (buyer's state), Invoice Number, Invoice Date, Invoice Value, Taxable Value, IGST Amount, Cess (if any).
4. Only IGST applies here (never CGST/SGST) since these are inter-state.
5. Click "SAVE".
NOTE: If you have no inter-state B2C invoices above ₹2.5L, skip this table entirely.`
  },
  {
    title: 'Table 7 — B2C Small (All Other B2C)',
    details: `This covers ALL remaining B2C invoices: intra-state B2C of any value + inter-state B2C below ₹2.5 lakh.
1. Click "7 — B2C (Others)" tile.
2. Data is entered in AGGREGATE (not individual invoices). Group by: Supply Type (Intra/Inter), Place of Supply, and Tax Rate.
3. For each combination, enter: Type (Intra-State/Inter-State), Place of Supply, Rate (e.g., 18%), Taxable Value, CGST/SGST or IGST.
4. Use the B2C table in your GSTR-1 tab above — it's already aggregated by rate.
5. Click "SAVE".
IMPORTANT: Intra-state B2C → enter CGST + SGST. Inter-state B2C → enter IGST only.`
  },
  {
    title: 'Table 9B — Credit/Debit Notes',
    details: `Only if you issued Credit Notes or Debit Notes during this period.
1. Click "9B — Credit/Debit Notes (Registered)" for notes to GSTIN holders.
2. Enter: Receiver GSTIN, Note Number, Note Date, Note Type (Credit/Debit), Note Value, Place of Supply, Taxable Value, Tax Amounts.
3. For unregistered persons: Click "9B — Credit/Debit Notes (Unregistered)" and enter without GSTIN.
4. Credit Notes reduce your liability. Debit Notes increase it.
RULE: Credit note must reference the original invoice. Must be issued before September 30 following the end of the financial year of the original invoice or before filing annual return, whichever is earlier (Section 34 of CGST Act).`
  },
  {
    title: 'Table 12 — HSN-wise Summary of Outward Supplies',
    details: `Mandatory reporting based on your turnover:
• Turnover up to ₹1.5 Crore — HSN summary NOT mandatory (but recommended)
• Turnover ₹1.5 Cr to ₹5 Cr — 4-digit HSN code mandatory
• Turnover above ₹5 Cr — 6-digit HSN code mandatory
1. Click "12 — HSN-wise Summary of outward supplies".
2. For each HSN/SAC code, enter: HSN Code, Description, UQC (Unit — NOS/KGS/MTR etc.), Total Quantity, Taxable Value, IGST, CGST, SGST, Cess.
3. Use the HSN Summary from your GSTR-1 tab above.
4. Click "SAVE".
COMMON ERROR: "Invalid HSN code" — ensure HSN codes match the official HSN Master list. Services use SAC codes (starting with 99).`
  },
  {
    title: 'Table 13 — Documents Issued During the Period',
    details: `1. Click "13 — Documents Issued during the tax period".
2. Enter the serial number range for each document type:
   • Invoices for outward supply — From: INV/2025-26/0001, To: INV/2025-26/0015, Total: 15, Cancelled: 0
   • Credit Notes — From/To range, Total issued, Cancelled count
   • Debit Notes — same
   • Delivery Challans — same
3. Net Issued = Total - Cancelled (auto-calculated).
4. Use the Document Summary from your GSTR-1 tab above.
5. Click "SAVE".`
  },
  {
    title: 'Preview, Submit & File GSTR-1',
    details: `1. After filling all tables, scroll to bottom and click "PREVIEW" button.
2. Review the summary carefully. Check:
   • Total taxable value matches your records
   • B2B + B2C totals are correct
   • Tax amounts (IGST, CGST, SGST) match
   • HSN summary totals match
3. If everything looks correct, click "SUBMIT" button.
⚠️ WARNING: After clicking SUBMIT, data is FROZEN. You CANNOT edit any table after submission. Only proceed if you're sure.
4. After submission, click "FILE GSTR-1" button (appears after submit).
5. Select filing method:
   • DSC (Digital Signature Certificate) — for companies and LLPs (mandatory)
   • EVC (Electronic Verification Code) — OTP sent to registered mobile/email. Available for proprietors, partnerships, HUFs.
6. Enter OTP or sign with DSC → Click "FILE".
7. You'll see ARN (Acknowledgement Reference Number). Save this for your records.
DONE! GSTR-1 is filed. Now proceed to GSTR-3B.`
  },
];

export const GSTR3B_STEPS = [
  {
    title: 'Navigate to GSTR-3B',
    details: `1. Login to gst.gov.in (if not already logged in).
2. Go to Returns → Returns Dashboard.
3. Select the same Financial Year and Period as your GSTR-1.
4. Click "SEARCH".
5. Find "GSTR-3B" tile → Click "PREPARE ONLINE".
NOTE: File GSTR-3B AFTER GSTR-1 is filed. From July 2025, Table 3 is auto-populated from your GSTR-1 data. Due date: 20th of next month (monthly) or 22nd/24th after quarter (QRMP, based on your state).`
  },
  {
    title: 'Table 3.1 — Outward Supplies & Tax Liability',
    details: `This table shows your OUTPUT TAX liability. From July 2025, it's auto-populated from GSTR-1.
1. Click "3.1 — Tax on outward and reverse charge inward supplies".
2. Verify/Enter these rows:
   (a) Outward taxable supplies (other than zero-rated, nil-rated, exempted):
       • Taxable Value = Your total taxable value from GSTR-1 Summary
       • IGST = Total IGST from all invoices
       • CGST = Total CGST from all invoices
       • SGST = Total SGST from all invoices
   (b) Outward taxable supplies (zero rated): Enter if you have exports or supplies to SEZ.
   (c) Other outward supplies (nil rated, exempted): Enter exempt/nil-rated supply values.
   (d) Inward supplies (liable to reverse charge): Enter if you received services under RCM (e.g., from unregistered persons, legal services, GTA).
   (e) Non-GST outward supplies: Enter non-taxable supplies (e.g., petroleum, alcohol).
3. Click "CONFIRM" when done.
IMPORTANT: Values here MUST match your GSTR-1. Any mismatch will be flagged by the system and may trigger a notice under Section 61.`
  },
  {
    title: 'Table 3.2 — Inter-state Supplies to Unregistered Persons',
    details: `Only required if you made INTER-STATE supplies to UNREGISTERED persons or composition dealers.
1. Click "3.2 — Inter-State supplies".
2. For supplies to unregistered persons:
   • Select Place of Supply (buyer's state)
   • Enter Taxable Value and IGST Amount
   • Add row for each state you supplied to
3. For supplies to composition dealers: Same format, separate section.
4. Click "CONFIRM".
NOTE: This data must reconcile with your GSTR-1 B2C Large (Table 5) data. If you have no inter-state B2C supplies, leave blank.`
  },
  {
    title: 'Table 4 — Input Tax Credit (ITC)',
    details: `This is where you CLAIM your ITC to reduce tax liability.
1. Click "4 — Eligible ITC".
2. Section (A) — ITC Available:
   (1) Import of goods — ITC from Bill of Entry (customs)
   (2) Import of services — ITC from invoices for imported services
   (3) Inward supplies liable to reverse charge — ITC on RCM supplies you paid tax on
   (4) Inward supplies from ISD — ITC distributed by Input Service Distributor
   (5) All other ITC — THIS IS YOUR MAIN ITC. Enter IGST, CGST, SGST from eligible purchase invoices.
       Use the ITC values from your GSTR-3B tab above (from Expense Tracker).
3. Section (B) — ITC Reversed: Enter if you need to reverse ITC (Rule 42/43 — common credit reversal, exempt supplies ratio).
4. Net ITC = (A) minus (B).
5. Click "CONFIRM".
CRITICAL RULES:
• ITC is only valid if supplier has filed THEIR GSTR-1 (check GSTR-2B auto-populated statement)
• ITC must be claimed within the time limit — Section 16(4): Due date of September return or annual return filing date
• ITC cannot exceed GSTR-2B values + 5% tolerance (Rule 36(4) — now removed, but system still validates against GSTR-2B)
• Retain all invoices and proof of payment for ITC claims`
  },
  {
    title: 'Table 5 — Exempt, Nil-Rated and Non-GST Inward Supplies',
    details: `1. Click "5 — Values of exempt, nil-rated and non-GST inward supplies".
2. Enter values for:
   • Inter-State inward supplies (exempt/nil/non-GST)
   • Intra-State inward supplies (exempt/nil/non-GST)
3. Examples: Purchase of milk, fresh vegetables, unprocessed food grains, educational services, healthcare services.
4. Click "CONFIRM".
NOTE: This is informational only — no tax impact. But incorrect reporting can trigger scrutiny.`
  },
  {
    title: 'Table 6 — Tax Payment (Calculate Net Payable)',
    details: `This auto-calculates based on Tables 3 and 4.
1. Click "6.1 — Payment of Tax".
2. Review the auto-calculated amounts:
   • Tax Payable = Output Tax (Table 3.1) for each head (IGST, CGST, SGST)
   • ITC Claimed = From Table 4, auto-set against each tax head
   • Tax Paid through ITC = Amount of ITC utilized
   • Tax/Cess Paid in Cash = Remaining amount to pay via cash
3. ITC utilization order (mandatory as per Section 49):
   • IGST credit → First set off against IGST liability → Then CGST → Then SGST
   • CGST credit → First against CGST → Then IGST (NOT SGST)
   • SGST credit → First against SGST → Then IGST (NOT CGST)
4. If cash payment is needed:
   • Click "CREATE CHALLAN" → Select payment method (Net Banking / NEFT/RTGS / Over the Counter)
   • Pay the amount → Challan will reflect in Electronic Cash Ledger
   • Come back and click "MAKE PAYMENT / POST CREDIT TO LEDGER"
5. If ITC fully covers your liability, no cash payment needed. Click "POST CREDIT TO LEDGER" directly.`
  },
  {
    title: 'Preview, Submit, Pay & File GSTR-3B',
    details: `1. Click "PREVIEW DRAFT GSTR-3B" at the bottom.
2. Review ALL values carefully:
   • Output tax matches GSTR-1 totals
   • ITC matches your purchase records and GSTR-2B
   • Net payable amount is correct
3. Check the "I have reconciled..." declaration checkbox.
4. Click "SUBMIT" button.
⚠️ WARNING: After SUBMIT, data is FROZEN. You cannot change any values.
5. After submit:
   • If tax is payable → Click "MAKE PAYMENT / POST CREDIT TO LEDGER" → System will utilize ITC first, then debit cash ledger.
   • If no tax payable (ITC covers everything) → Click "POST CREDIT TO LEDGER".
6. Click "FILE GSTR-3B" (appears after payment/posting).
7. Select filing method: DSC or EVC (same as GSTR-1).
8. Enter OTP or sign → Click "FILE".
9. Save the ARN number.
DONE! Both GSTR-1 and GSTR-3B are filed for this period.

LATE FILING CONSEQUENCES:
• Late fee: ₹50/day (₹25 CGST + ₹25 SGST) — capped at ₹5,000 per return for taxpayers with turnover, ₹500 for nil returns (CGST Amendment Act 2023, FY 2023-24 onwards)
• Interest: 18% p.a. on outstanding tax from due date (Section 50)
• Cannot file next month's return until current month is filed
• E-way bill generation blocked after 2 months of non-filing`
  },
];

export const NIL_GSTR1_STEPS = [
  {
    title: 'Login & Navigate',
    details: `1. Login to gst.gov.in → Returns → Returns Dashboard.
2. Select Financial Year and Month → Click "SEARCH".
3. Find GSTR-1 tile → Click "PREPARE ONLINE".`
  },
  {
    title: 'Verify All Tables are Empty',
    details: `1. All tables (4A, 5, 7, 9, 12, 13) should show ZERO or be empty.
2. If any table has data from a previous session, DELETE it.
3. There should be NO invoices, NO credit notes, NO HSN entries.`
  },
  {
    title: 'Submit & File NIL GSTR-1',
    details: `1. Click "GENERATE GSTR-1 SUMMARY" at the bottom.
2. Check that all values show ₹0.00.
3. Tick the declaration checkbox: "I/We hereby declare that the information..."
4. Click "FILE GSTR-1 (NIL)" button. This special button appears when all tables are empty.
5. Select EVC/DSC → Enter OTP → File.
6. Save ARN number.
IMPORTANT: Filing NIL GSTR-1 is mandatory even with zero sales. Non-filing attracts ₹20/day penalty (₹10 CGST + ₹10 SGST), max ₹500 per return.`
  },
];

export const NIL_GSTR3B_STEPS = [
  {
    title: 'Login & Navigate',
    details: `1. Login to gst.gov.in → Returns → Returns Dashboard.
2. Select same period → Click "SEARCH".
3. Find GSTR-3B tile → Click "PREPARE ONLINE".`
  },
  {
    title: 'Verify All Values are Zero',
    details: `1. Table 3.1 — All outward supply values should be ₹0.
2. Table 4 — No ITC to claim (all zeros).
3. Table 5 — Exempt supplies should be ₹0 (unless you have exempt inward supplies).
4. Table 6 — Tax payable should be ₹0 across IGST, CGST, SGST.`
  },
  {
    title: 'Submit & File NIL GSTR-3B',
    details: `1. Click "SUBMIT" at the bottom.
2. Since no tax is payable, no payment step is needed.
3. Click "FILE GSTR-3B (NIL)" — this special button appears when all values are zero.
4. Tick the declaration: "I verify that to the best of my knowledge..."
5. Select EVC/DSC → Enter OTP → File.
6. Save ARN number.
NOTE: Even for NIL return, you MUST file both GSTR-1 and GSTR-3B separately. They are different returns.
PENALTY: ₹20/day late fee for NIL GSTR-3B (₹10 CGST + ₹10 SGST), capped at ₹500 per return.`
  },
];