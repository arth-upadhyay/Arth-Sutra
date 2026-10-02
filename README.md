
# Arth Sutra

GST billing  inventory  and returns software for Indian small businesses Runs entirely on your own computer.

| | |
|---|---|
| Version | v1.2.0 |
| Platform | India only · A4 invoices only |
| Stack | React 19 + Vite 7 frontend · Express 5 backend · Node.js 18+ |
| Storage | Plain JSON files under `data/` |
| License | Apache 2.0 |

**First launch:** enter the password `ARTH`. You will then be able to set your own password, which is used from then on.

created for small buisnesses who got tired of paying  30k/year to marg/vyapar etc 

## Features

**Billing**
- Tax invoice, proforma, credit note, bill of supply, delivery challan
- CGST / SGST / UTGST / IGST split from place of supply
- HSN / SAC line items with rate suggestion
- Batch number, expiry, MRP per line item, with FEFO auto-fill
- Automatic line split when a single batch can't cover the ordered quantity
- Per-line discounts (₹ / % / with-tax / per-unit) and invoice-level discount
- TDS / TCS with cumulative-threshold handling
- Payment account snapshot per invoice

**Inventory**
- Product catalog with HSN, MRP, selling price, cost price, batch stock
- Purchase bills with OCR import from a supplier invoice image
- Stock ledger with FEFO deduction
- Low-stock alerts

**Compliance**
- GSTR-1 export (CSV + JSON)
- GSTR-3B export (CSV + JSON)
- GSTR-2B reconciliation
- e-Way Bill JSON (NIC v1.0.1221 schema)
- Income Tax helper (regime comparison, §44AD/ADA/AE, advance tax)

**Reports**
- P&L with Cost of Goods Sold
- Outstanding aging (0–30 / 31–60 / 61–90 / 90+)
- Client ledger with running Dr/Cr balance
- Product movement
- Gross Profit on the dashboard

**Data**
- Daily backups, 30-day rolling retention
- Trash bin for invoices (30-day soft delete)
- Backup / restore as a single JSON file
- Optional Google Drive upload to your own account

---

## Install

### Prerequisites

- Node.js 18 or newer
- A modern browser

### Windows

1. Download the repo (Code → Download ZIP) and unzip it.
2. Double-click `Install ArthSutra.bat`.
3. A desktop icon is created. Open it.

Windows may show "Windows protected your PC" — click **More info → Run anyway**. This is expected for unsigned open-source software.

To stop the server, run `Stop ArthSutra.bat`.

### macOS / Linux

bash
git clone https://github.com/arth-upadhyay/Arth-Sutra.git
cd Arth-Sutra
npm install
npm start


Then open `http://localhost:47371`.

### Development

bash
npm run dev      # Vite dev server + Express daemon, hot reload
npm run build    # production bundle
npm test         # vitest


The server starts on port `47371`. If it's taken, it scans up to `47421`, and persists the chosen port to `data/port.txt`.

---

## How it works

### Data storage

All data is stored as individual JSON files under `data/`:


data/
├── bills/          one file per invoice
├── clients/
├── products/
├── purchases/
├── expenses/
├── recurring/
├── receipts/
├── profiles/
├── templates/
├── backups/        dated snapshots, last 30 days
├── trash/          soft-deleted bills
├── meta.json       counters, settings
└── errors.log


PDFs are written to `Saved Invoices/<client>/<month>/`. Deleted PDFs go to `Trash/`.

Nothing in `data/` or `Saved Invoices/` is committed to git.

### Frontend

- `src/store.js` — wraps the HTTP API
- `src/utils.js` — GST math, state codes, formatting
- `src/utils/printSettings.js` — invoice layout defaults
- `src/components/InvoiceGenerator/` — invoice form and hooks
- `src/components/Dashboard/` — dashboard and metrics hooks
- `src/components/GstReturns/` — GSTR exports
- `src/components/InvoicePreview.jsx` — the printable template

### Backend

`server.js` is a single Express 5 process that:

- Serves the built React bundle from `dist/`
- Reads and writes JSON files under `data/`
- Writes files atomically (`.tmp` → rename)
- Binds to `127.0.0.1` only
- Runs a daily backup at boot and every 24 hours
- Rejects cross-origin requests from anything other than localhost

The invoice counter (`POST /api/meta/:key/increment`) is atomic because the read-modify-write is fully synchronous.

### Request flow on invoice save

1. `useInvoiceForm` holds the form state.
2. `useInvoiceTotals` recomputes tax on every keystroke via `computeInvoiceTotals()` in `utils.js`.
3. On Save, `useInvoicePersistence` reserves an invoice number, stamps `costAtSale` on each line from the current `product.purchasePrice`, and POSTs to `/api/bills`.
4. `syncStock(items)` deducts quantities from the correct batches and rewrites the product records.
5. Save & Download renders the preview with html2canvas, writes a PDF with jsPDF, and POSTs it to `/api/save-pdf`.

### FEFO batch selection

When a product is picked on a line:

1. Batches with `quantity <= 0` or past expiry are excluded.
2. Remaining batches are sorted by expiry ascending.
3. The earliest-expiry batch fills `batch`, `expiry`, `mrp`, `omrp` on the line.
4. If the ordered quantity exceeds that batch's stock, on blur the line splits into two rows — one per batch — so old stock goes out first.
5. If total stock across all batches is still short, the save is blocked.

### Invoice numbers

Numbers are reserved atomically through `/api/meta/:key/increment` on first save. Displayed numbers before save are previews only (`peek: true`) and don't consume counter values. Cancelled forms don't burn numbers.

### Gross profit

Every invoice line stores `costAtSale` at save time. Changing a product's purchase price later does not change saved invoices. The dashboard computes `Σ (rate − costAtSale) × qty` across the active filter. Bills saved before this feature fall back to the product's current `purchasePrice`.

### Backup and trash

- Daily snapshot to `data/backups/<date>/`, kept for 30 days
- Deleted invoices moved to `data/trash/`, kept for 30 days, restorable
- Manual full export produces a single JSON file containing all collections plus selected localStorage keys

Email: arth14deepak@gmail.com

## License

Apache 2.0. See `LICENSE`.
