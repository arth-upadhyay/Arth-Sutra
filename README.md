```markdown
# ArthSutra

**ARTH's SYSTEM** — a free, open-source, offline-first GST billing & invoicing application built for Indian small and medium businesses.

Built by [@arthupadhyay](https://github.com/arthupadhyay) originally for a family business, now maintained as a public alternative to commercial ERP software like Marg, Tally, Vyapar, and myBillBook.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.10.x-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)
![Stack](https://img.shields.io/badge/stack-React%2019%20%2B%20Vite%207%20%2B%20Express%205-blueviolet.svg)

---

## Table of Contents

- [Why this exists](#why-this-exists)
- [Current state](#current-state)
- [Getting started](#getting-started)
- [Architecture](#architecture)
- [What was recently cleaned up](#what-was-recently-cleaned-up)
- [Known issues](#known-issues)
- [Security notes](#security-notes)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)

---

## Why this exists

Enterprise billing software is expensive and bloated. Most small Indian shops need exactly four things:

1. Generate a GST-compliant tax invoice as a PDF.
2. Track what's owed and what's paid.
3. Export GSTR-1 / GSTR-3B for the CA or the portal.
4. Keep the data on their own machine — no cloud subscriptions.

ArthSutra does those four things. It does not try to be a full ERP. It runs locally, stores data as plain JSON files, and works without an internet connection.

---

## Current state

| Attribute | Value |
|-----------|-------|
| **Version** | v1.10.x (in active refactor) |
| **Target** | India-only, A4-only, offline-first |
| **License** | MIT |
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
2. Double-click **`Install FreeGSTBill.bat`**.
3. A desktop icon appears. Open it.

> Windows may show **"Windows protected your PC"** — click *More info* → *Run anyway*. This is normal for unsigned open-source apps.

### Install (macOS / Linux)

```bash
git clone https://github.com/arthupadhyay/Arth-Sutra
cd Arth-Sutra
npm install
npm start

Open `http://localhost:47371` in your browser.

### Development

```bash
npm run dev      # Vite dev server + Express daemon, hot reload
npm run build    # production bundle
npm test         # run vitest suite
```

---

## Architecture

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
├── public/
│   └── tesseract/               Bundled OCR assets (worker, core WASM, eng)
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
│   │   │   ├── index.jsx        Dashboard UI
│   │   │   ├── constants.js
│   │   │   ├── hooks/
│   │   │   │   ├── useDashboardMetrics.js
│   │   │   │   ├── useInvoiceFilters.js
│   │   │   │   ├── useInvoiceActions.js
│   │   │   │   ├── useDashboardAlerts.js
│   │   │   │   └── useReceiptModal.js
│   │   │   └── ReceiptModal.jsx
│   │   ├── InvoiceGenerator/
│   │   │   ├── index.jsx        Invoice form
│   │   │   └── hooks/
│   │   │       ├── useInvoiceForm.js
│   │   │       ├── useInvoiceTotals.js
│   │   │       ├── useInvoicePersistence.js
│   │   │       ├── useClientSearch.js
│   │   │       └── useProductSearch.js
│   │   ├── InvoicePreview.jsx   Printable PDF template
│   │   ├── GSTReturns.jsx       GSTR-1 / 3B / 2B / TDS / Guide
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
│   │   └── Toast.jsx
│   └── userGuideContent.js      Static guide content
```

### Data flow

1. User enters invoice data in `InvoiceGenerator/index.jsx`.
2. All state lives in `useInvoiceForm` (single source of truth).
3. `useInvoiceTotals` recomputes CGST / SGST / IGST / cess / TCS / TDS on every keystroke using `computeInvoiceTotals` from `utils.js`.
4. `useInvoicePersistence` writes the bill via `store.js` → `POST /api/bills`.
5. Express daemon writes `data/bills.json` synchronously.
6. `InvoicePreview.jsx` renders the printable layout with the same props that were used to compute the totals.
7. `generateSingleBillPdfBlob` uses `html2canvas` → `jsPDF` → `POST /api/save-pdf` to persist the physical PDF to `Saved Invoices/`.

---

## What was recently cleaned up

The following categories of dead code and stale features were removed (see commit history for details).

### Refactor: India-only

- Non-India countries removed from the picker. Only India + "Other" remain.
- `US_STATES`, `CANADA_PROVINCES`, `AUSTRALIA_STATES` deleted.
- `detectCountryFromBrowser` deleted.
- Region preference UI (`india` / `international` / `both`) removed — the app now assumes India.
- `LABEL_PRESETS` trimmed to English + Hindi.
- Dual-currency display setting removed.

### Refactor: A4-only

- `PAPER_SIZES` reduced to a single A4 entry.
- `getPaperSize()` now returns A4 unconditionally.
- All `.paper-thermal*`, `.paper-a5*`, `.paper-letter`, `.paper-legal`, `.paper-b5`, `.paper-custom` CSS blocks deleted.
- Thermal-specific settings in `printSettings.js` removed (`fontFamily`, `fontSize`, `fontWeight`, `allCaps`, `lineSpacing`, `contrast`, `cutMark`, `feedLines`, `qrSize`, `thermalPrintMode`, `thermalBufferSafe`, …).
- Thermal print branch in `InvoiceGenerator` removed.
- `PrintSettings.jsx` sections for thermal typography, layout, and content deleted.

### Refactor: Dead print settings removed

Unused keys purged from `DEFAULT_PRINT_SETTINGS`:

- watermark, multi-copy, page numbers, margins, barcode/QR
- letterhead, signature image, terms-on-separate-page
- feedback QR, user-colour overrides, row density
- date/number formatting, custom tax rate editor, saved templates

### Refactor: Dead UI removed

- `DESIGN_PRESETS` array and the "Visual style" grid deleted from `PrintSettings.jsx`.
- `BUSINESS_PRESETS` grid deleted.
- `ExtraFieldsEditor`, `SavedTemplatesEditor`, `ColorRow`, `CustomListEditor` component definitions removed.
- `ACCENT_PRESETS`, `PDF_STYLES` arrays removed from `InvoiceGenerator`.
- Aging PDF (duplicate of Statement PDF) removed from `ClientsView`.

### Fixes

- `PurchaseBills.jsx` no longer applies a hardcoded **30% markup** when a purchase is recorded. Selling price is now set equal to purchase price on first sync; the user overrides via the Products page.
- `RecurringInvoices.generateNow()` now populates `data.totals` on the generated bill so downstream reports don't crash.
- Currency column removed from Reports (India-only → always INR).
- `ClientModal.jsx` no longer carries per-client paper size / currency / auto-print preferences.

---

## Known issues

An audit run against the current code surfaced the following. These are tracked and being addressed incrementally. They are listed here so users and contributors know what to expect.

### Critical

- **`App.jsx` violates the Rules of Hooks.** `useState(isUnlocked)` runs, then an early return renders `<LockScreen />`, and only after unlock do the remaining hooks run. React warns: *"Rendered more hooks than during the previous render."* Fix: move the `isUnlocked` gate outside `App`, or wrap the app shell in a child component.

- **`InvoicePreview.jsx` is not generic.** The current template is hardcoded to a pharmaceutical / Marg layout ("Pharmaceutical Distributors", OMRP, Batch, Expiry, MRP, Licence No). It ignores most of the props it receives (`showGST`, `showHSN`, `customNotes`, `extraSections`, paper size, template). `DOMPurify` is imported but never used, and `customTerms` is rendered with `dangerouslySetInnerHTML`. **This is an XSS risk** if an attacker can write to the terms field.

- **`PurchaseBills.delete` does not revert stock.** The confirmation dialog promises "stock will be reverted", but `handleDelete` only calls `deletePurchase(id)`. Products and batches are left inflated.

- **Income Tax FY mismatch.** `IncomeTax.jsx` declares `CURRENT_FY = '2024-25'` while `itr.js` declares `CURRENT_FY = '2025-26'`. The UI label and the computed slabs belong to different assessment years.

- **`GSTReturns.jsx` mishandles credit notes.** Credit notes are included as positive B2C / HSN values in some tables and then subtracted later, making intermediate views misleading. The GSTIN validation regex is also non-standard.

### Moderate

- `printSettings.js` sample invoice totals are mathematically wrong (₹950 taxable + 18% GST ≠ ₹1130).
- `LockScreen.jsx` falls back to the hardcoded password `ARTH` when no hash is set. Anyone with the source can unlock.
- `LockScreen.jsx` uses `crypto.subtle` without a fallback for non-secure contexts (non-`https`, non-`localhost`).
- `ConfirmModal.jsx` claims to queue concurrent calls but overwrites the active modal instead. Two simultaneous `confirmAction()` calls can leave the first promise unresolved forever.
- `SetupWizard.jsx` `canFinish` is always true because `paperSize` defaults to `'a4'`. The Finish button is never disabled.
- `UserGuideView.jsx` uses a global regex with `.test()` inside `.map()`, which is stateful via `lastIndex` and can produce inconsistent highlighting.
- `hsnRates.js` has a duplicate SAC key `9985`; the second entry silently overwrites the first.
- `store.js` `getNextInvoiceNumber('RCP')` returns a branded prefix unless `explicitPrefix` is true. Receipt numbers can accidentally inherit the invoice prefix.

### Structural

These are the "monolithic file" issues. They don't break anything today but make the codebase harder to maintain:

| File | LOC | Should be split into |
|------|-----|----------------------|
| `GSTReturns.jsx` | ~2,500 | per-tab hooks + tab components |
| `SettingsView.jsx` | ~2,200 | per-section components |
| `PrintSettings.jsx` | ~1,800 | after cleanup, ~400 |
| `Dashboard/index.jsx` | ~1,400 | already part-refactored |
| `utils.js` | ~1,100 | format / GST / states / units / accounts |
| `itr.js` | ~900 | slab / surcharge / deductions / presumptive |
| `IncomeTax.jsx` | ~1,300 | per-tab components |

---

## Security notes

- All data stays on the local machine. The only outbound network calls are: Google Drive upload (opt-in), GitHub release check, and the optional Google Fonts stylesheet.
- The local Express daemon binds to `127.0.0.1` only.
- The Content Security Policy in `index.html` blocks all inline `<script>` tags, restricts `connect-src` to `localhost` and Google APIs, and disables `object-src`.
- The invoice template still uses `dangerouslySetInnerHTML` for the Terms & Conditions field. **Until that is sanitised, do not paste untrusted content into Terms.**

---

## Roadmap

Priority order for the next few releases:

1. **Fix `App.jsx` Rules of Hooks violation.** Move lock screen out of the hook tree.
2. **Make `InvoicePreview` generic.** Read every option from props. Sanitize `customTerms` with the already-imported `DOMPurify`.
3. **Fix `PurchaseBills.delete`** to restore stock and batches.
4. **Align Income Tax FY** between `IncomeTax.jsx` and `itr.js`.
5. **Fix `GSTReturns` credit-note handling** and the GSTIN regex.
6. **Split monolithic files.** `GSTReturns.jsx`, `SettingsView.jsx`, `PrintSettings.jsx`, `utils.js` into focused modules.
7. **Add tests** for credit notes, UTGST, cess, tax-inclusive discounts, TCS / TDS, and FY boundaries.

---

## Contributing

PRs welcome. Before opening one:

- Run `npm test` — the existing suite covers `computeInvoiceTotals` and `resolveLineDiscount`.
- Run `npm run build` — the production bundle must succeed.
- If you add a new `printSettings` key, add it to the export whitelist in `store.js` so it survives backup / restore.
- Follow the commit style in `git log --oneline -20`.

### Reporting bugs

Open an issue at [github.com/arthupadhyay/Arth-Sutra/issues](https://github.com/arthupadhyay/Arth-Sutra/issues) with:

- The action that triggered it
- What you expected
- What actually happened
- Browser console output if any

### Security disclosure

Email **arth14deepak@gmail.com** for security issues. Do not open a public issue for anything that could be exploited before a fix is released.

---

## License

MIT — see [LICENSE](./LICENSE).

You may use, modify, and redistribute this software for personal or commercial purposes. Attribution is appreciated but not required.

---

## Credits

Built by **Arth Upadhyay** — [github.com/arthupadhyay](https://github.com/arthupadhyay)

Built with:

- [React](https://react.dev)
- [Vite](https://vitejs.dev)
- [Express](https://expressjs.com)
- [jsPDF](https://github.com/parallax/jsPDF)
- [html2canvas](https://html2canvas.hertzen.com)
- [Tesseract.js](https://tesseract.projectnaptha.com)
- [lucide-react](https://lucide.dev)

If ArthSutra saved your business a subscription, the best way to say thanks is to report a bug, file a PR, or star the repo.

---

<div align="center">

**Made in India 🇮🇳 for Indian businesses**

</div>
```
