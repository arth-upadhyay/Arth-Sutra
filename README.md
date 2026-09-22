

# ArthSutra bascally means arth's system in sanskrit 

**ARTH's SYSTEM** — a free, open-source, offline-first GST billing & invoicing application built for Indian small and medium businesses.

Built by [@arth-upadhyay](https://github.com/arth-upadhyay) originally for a family business, now maintained as a public alternative to commercial ERP software like Marg, Tally, Vyapar, and myBillBook.

# note:

**the first time you open the arthsutra it will ask for the password enter-(ARTH) as its only one time after that you will get a option to  enter your open password and that password will be till forever**

## Why this exists
my father needed a erp for billiing inventory mangment etc like marg erp or tally etc but they charge way too much and its bloated for his needs 


---

## Current state

| Attribute | Value |
|-----------|-------|
| **Version** | v1.1.0 |
| **Target** | India-only, A4-only, offline-first |
| **License** | Apache 2.0 |
| **Stack** | React 19 + Vite 7 · Express 5 · Node.js 18+ |
| **Storage** | Local JSON files under `data/` (no database server) |

### What works

- Tax invoices, proforma / estimate, credit note, bill of supply, delivery challan
- Automatic CGST / SGST / IGST split based on place of supply
- HSN / SAC line items with unit UQC mapping
- Batch + expiry tracking on line items
- Custom units (Carat, Bundle, Bushel, …) saved per device
- Multi-business profile switcher
- Multi-payment-account per profile with UPI QR
- Client directory with statement PDF (running Dr/Cr ledger)
- Expense tracker with ITC classification
- Purchase bills with automated stock ledger updates
- Recurring invoices with due-date advance
- Payment receipts with printable voucher
- Reports: P&L, outstanding aging, client analytics, product performance
- GST Returns: GSTR-1 CSV + JSON, GSTR-3B CSV + JSON, GSTR-2B reconciliation
- E-Way Bill JSON (NIC portal v1.0.1221 schema)
- Income Tax Helper: Old vs New regime, presumptive §44AD/ADA/AE, advance tax
- Backup / restore as a single JSON file, optional Google Drive copy
- Auto-backup rotation (last 30 days) + 30-day soft-delete Trash Bin
- PWA install (Windows / macOS / Linux)
- Light + dark mode
- Command palette (`Ctrl + K`)
- 100% offline. No telemetry, no analytics, no external calls.

---

## Getting started

### Prerequisites

- **Node.js 18 or newer** — [nodejs.org](https://nodejs.org)
- A modern browser (Chrome, Edge, Firefox, Safari)

### Install (Windows)

1. Download the ZIP from the green **Code** button → **Download ZIP**, unzip.
2. Double-click **`Install ArthSutra.bat`**.
3. A desktop icon appears. Open it.

> Windows may show **"Windows protected your PC"** — click *More info* → *Run anyway*. This is normal for unsigned open-source apps.

### Run on subsequent sessions

Double-click the desktop icon, or run **`Start ArthSutra Server.bat`** from the install folder. To stop the server, run **`Stop ArthSutra.bat`**.

### Install (macOS / Linux)

```bash
git clone https://github.com/arth-upadhyay/Arth-Sutra.git
cd Arth-Sutra
npm install
npm start
```

Open http://localhost:47371 in your browser.

Development

```bash
npm run dev      # Vite dev server + Express daemon, hot reload
npm run build    # production bundle
npm test         # run vitest suite
```

---

Architecture

```
Arth-Sutra/
├── server.js                    Express daemon (JSON API + filesystem bridge)
├── data/                        User data (gitignored)
│   ├── bills.json
│   ├── clients.json
│   ├── products.json
│   ├── profiles.json
│   ├── expenses.json
│   ├── purchases.json
│   ├── recurring.json
│   ├── receipts.json
│   ├── templates.json
│   └── meta.json                Settings, counters, region, modules
├── Saved Invoices/              PDF archive (gitignored)
├── Trash/                       Soft-deleted PDFs, 30-day retention (gitignored)
├── public/
│   └── tesseract/               Bundled OCR assets (worker, core WASM, eng)
├── scripts/                     Build + test utilities
├── src/
│   ├── main.jsx                 React entry + service worker registration
│   ├── App.jsx                  Root layout, sidebar, routing
│   ├── index.css                Global stylesheet
│   ├── store.js                 Frontend wrapper around the JSON API
│   ├── utils.js                 Formatting, GST math, states, units
│   ├── utils/
│   │   ├── printSettings.js     App-wide print defaults
│   │   ├── itr.js               Income Tax slab engine
│   │   ├── clientCredit.js      Overpayment / credit note math
│   │   ├── hsnRates.js          HSN → GST rate lookup
│   │   └── share.js             WhatsApp / email helpers
│   ├── components/
│   │   ├── Dashboard/
│   │   │   ├── index.jsx
│   │   │   ├── constants.jsx
│   │   │   ├── ReceiptModal.jsx
│   │   │   └── hooks/
│   │   │       ├── useDashboardMetrics.js
│   │   │       ├── useInvoiceFilters.js
│   │   │       ├── useInvoiceActions.js
│   │   │       ├── useDashboardAlerts.js
│   │   │       └── useReceiptModal.js
│   │   ├── InvoiceGenerator/
│   │   │   ├── index.jsx
│   │   │   └── hooks/
│   │   │       ├── useInvoiceForm.js
│   │   │       ├── useInvoiceTotals.js
│   │   │       ├── useInvoicePersistence.js
│   │   │       ├── useClientSearch.js
│   │   │       └── useProductSearch.js
│   │   ├── GstReturns/
│   │   │   ├── GstReturns.jsx
│   │   │   ├── index.js
│   │   │   ├── constants.js
│   │   │   ├── components/StepList.jsx
│   │   │   ├── hooks/useGstReturns.js
│   │   │   └── utils/gstHelpers.js
│   │   ├── InvoicePreview.jsx   Printable PDF template
│   │   ├── IncomeTax.jsx        Regime / presumptive / advance tax
│   │   ├── SettingsView.jsx     All app settings
│   │   ├── PrintSettings.jsx    Print & PDF preferences
│   │   ├── ClientsView.jsx
│   │   ├── InventoryView.jsx
│   │   ├── ExpenseTracker.jsx
│   │   ├── PurchaseBills.jsx
│   │   ├── ReceiptVoucher.jsx
│   │   ├── RecurringInvoices.jsx
│   │   ├── ReportsView.jsx
│   │   ├── UserGuideView.jsx
│   │   ├── WelcomeGuide.jsx
│   │   ├── SetupWizard.jsx
│   │   ├── LockScreen.jsx
│   │   ├── BillOCR.jsx
│   │   ├── ClientModal.jsx
│   │   ├── ConfirmModal.jsx
│   │   ├── HelpButton.jsx
│   │   ├── PageHeader.jsx
│   │   ├── PrintPreviewModal.jsx
│   │   ├── Toast.jsx
│   │   └── utils.test.jsx
│   └── userGuideContent.js      Static guide content
├── Install ArthSutra.bat        Windows installer
├── Start ArthSutra Server.bat   Windows server launcher
├── Stop ArthSutra.bat           Windows server stopper
├── start-server-silent.bat      Boot-time silent launcher
├── vite.config.js
└── package.json
```

Data flow

1. User enters invoice data in InvoiceGenerator/index.jsx.
2. All state lives in useInvoiceForm (single source of truth).
3. useInvoiceTotals recomputes CGST / SGST / IGST / cess / TCS / TDS on every keystroke using computeInvoiceTotals from utils.js.
4. useInvoicePersistence writes the bill via store.js → POST /api/bills.
5. Express daemon writes data/bills.json synchronously.
6. InvoicePreview.jsx renders the printable layout with the same props that were used to compute the totals.
7. generateSingleBillPdfBlob uses html2canvas → jsPDF → POST /api/save-pdf to persist the physical PDF to Saved Invoices/.

---

What was recently cleaned up

Refactor: A4-only

· PAPER_SIZES reduced to a single A4 entry.
· getPaperSize() now returns A4 unconditionally.
· All .paper-thermal*, .paper-a5*, .paper-letter, .paper-legal, .paper-b5, .paper-custom CSS blocks deleted.
· Thermal-specific settings in printSettings.js removed (fontFamily, fontSize, fontWeight, allCaps, lineSpacing, contrast, cutMark, feedLines, qrSize, thermalPrintMode, thermalBufferSafe, …).
· Thermal print branch in InvoiceGenerator removed.
· PrintSettings.jsx sections for thermal typography, layout, and content deleted.

Refactor: Dead print settings removed

Unused keys purged from DEFAULT_PRINT_SETTINGS:

· watermark, multi-copy, page numbers, margins, barcode/QR
· letterhead, signature image, terms-on-separate-page
· feedback QR, user-colour overrides, row density
· date/number formatting, custom tax rate editor, saved templates

Refactor: Dead UI removed

· DESIGN_PRESETS array and the "Visual style" grid deleted from PrintSettings.jsx.
· BUSINESS_PRESETS grid deleted.
· ExtraFieldsEditor, SavedTemplatesEditor, ColorRow, CustomListEditor component definitions removed.
· ACCENT_PRESETS, PDF_STYLES arrays removed from InvoiceGenerator.
· Aging PDF (duplicate of Statement PDF) removed from ClientsView.

Refactor: Monoliths split into folders

Old file New structure LOC removed
src/components/Dashboard.jsx src/components/Dashboard/ + hooks 1,165
src/components/InvoiceGenerator.jsx src/components/InvoiceGenerator/ + hooks 3,191
src/components/GstReturns.jsx src/components/GstReturns/ + hooks + helpers 979

Root-level duplicates UserGuideView.jsx and WelcomeGuide.jsx were also removed (the canonical copies live in src/components/).

Fixes

· PurchaseBills.jsx no longer applies a hardcoded 30% markup when a purchase is recorded. Selling price is now set equal to purchase price on first sync; the user overrides via the Products page.
· RecurringInvoices.generateNow() now populates data.totals on the generated bill so downstream reports don't crash.
· Currency column removed from Reports (India-only → always INR).
· ClientModal.jsx no longer carries per-client paper size / currency / auto-print preferences.

Security notes

· All data stays on the local machine. The only outbound network calls are: Google Drive upload (opt-in), GitHub release check, and the optional Google Fonts stylesheet.
· The local Express daemon binds to 127.0.0.1 only.
· The Content Security Policy in index.html blocks all inline <script> tags, restricts connect-src to localhost and Google APIs, and disables object-src.
· The invoice template still uses dangerouslySetInnerHTML for the Terms & Conditions field. Until that is sanitised, do not paste untrusted content into Terms.

**for any bugs or issues** 
Open an issue at github.com/arth-upadhyay/Arth-Sutra/issues with:

· The action that triggered it
· What you expected
· What actually happened
· Browser console output if any

Email: arth14deepak@gmail.com 

Apache License 2.0
