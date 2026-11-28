# Arth-Sutra (अर्थ-सूत्र)

**Arth-Sutra** — A modern, free, open-source, offline-first GST billing, inventory management, tax compliance, and accounting application designed specifically for Indian MSMEs, wholesalers, retailers, distributors, manufacturers, and freelancers.

Runs 100% locally on your own machine. Zero monthly subscriptions. Zero cloud lock-in. No telemetry.

---

## Overview

| Attribute | Specification |
|---|---|
| **Version** | `v1.2.0` |
| **Target Jurisdiction** | India-Only (`INR ₹` · `PIN Code` · Indian States/UTs · `GSTIN` / `PAN` / `IFSC` · Drug Licence No. · CGST / SGST / UTGST / IGST · HSN & SAC) |
| **Frontend Stack** | React 19 · Vite 7 · Lucide Icons · HTML2Canvas · jsPDF |
| **Backend Stack** | Express 5 · Node.js 18+ · WebSockets (`ws`) |
| **Database** | SQLite (`better-sqlite3`) via Drizzle ORM (ACID Compliant) |
| **Desktop App** | Native Rust + WebView2 Installer (`ArthSutra-Lite-Setup.exe`) · Electron 45 · NSIS Installer |
| **Security** | AES-256-GCM Encryption (DB & `.arthbackup` Bundles) · Pure JS `bcryptjs` Hashing · JWT Authentication · Role-Based Access Control (RBAC) · SHA-256 Audit Trail |
| **Offline Capabilities** | PWA (Service Workers) · IndexedDB Queue · Offline-to-Online Idempotent Sync |
| **License** | Apache 2.0 |

---

## Why Arth-Sutra?

Most Indian small businesses are forced into paying ₹15,000 to ₹35,000 every single year for commercial billing software like Marg ERP, Tally, Vyapar, Zoho Books, or myBillBook. These proprietary platforms lock your financial data behind recurring subscriptions, cloud silos, and vendor paywalls. 
same for my father the marg erp was too bloated for him

**Arth-Sutra was built to break that cycle.** Originally created for a family retail business, it is an open-source, locally hosted accounting engine that ensures you maintain 100% ownership and privacy of your financial records.

---

## What's New in v1.2.0

- 🗄️ **SQLite + Drizzle ORM Engine:** Migrated from legacy flat JSON files to a high-concurrency, ACID-compliant SQLite database (`data/arth-sutra.sqlite`) with schema safety and automated JSON-to-SQLite migration.
- 🔗 **Cryptographic Tamper-Evident Audit Trail:** Every business transaction is cryptographically signed using SHA-256 hash chaining (Merkle-style). Real-time verification (via API or **Settings → Account Security**) detects any manual row edits or database tampering.
- 🇮🇳 **India-Only Business Configuration & Drug Licence Tracking:** Locked strictly to Indian MSME defaults (`PIN Code`, Indian States & UTs, `GSTIN`, `PAN`, `IFSC Code`, `INR ₹`) with zero foreign country, ZIP, or EIN chrome. Tracks **Drug Licence No.** (`licence`) across Company Details, multi-Business Profiles, Clients, and automatic Seller Licence seeding on invoices.
- ✂️ **2-Bills-Per-Page Tear Sheets & Print Layout Engine:** Default `2/Page` | `1/Page` mode stacks `CLIENT COPY` and `OFFICE / SELF COPY` top-and-bottom on A4 Portrait with a horizontal `TEAR` divider, alongside full **Invoice Layout** settings (logo, HSN, amount in words, bank/UPI QR sizes, watermarks, GST Rule 48 multi-copy labels, continuation headers/page numbers, margins, and digital signature).
- 🛡️ **Role-Based Access Control (RBAC), Team Users & JWT Authentication:** Multi-user `ADMIN`, `ACCOUNTANT`, and `CLERK` permission tiers, pure JS `bcryptjs` hashing, signed 24h JWT sessions, and an ADMIN **Team Users & Roles** panel inside **Settings → Account Security**.
- 🔒 **Unified Sepia Lock Screen & First-Time Setup Wizard:** Integrated sepia authentication screen paired with a First-Time Setup Wizard (`POST /api/auth/setup`) where the admin defines custom credentials (no hardcoded default passwords are ever seeded) or restores directly from an existing backup.
- 🔐 **AES-256-GCM Encryption at Rest:** NIST SP 800-38D encryption protecting bank/IFSC credentials inside SQLite and PBKDF2 + AES-256-GCM encryption for portable `.arthbackup` bundles.
- 🔄 **Real-Time WebSocket Sync & Offline PWA Write-Behind Queue:** Live multi-terminal LAN sync via JWT-authenticated WebSockets, Service Worker caching, and IndexedDB `X-Idempotency-Key` replay on reconnect.
- 🔍 **AI/Fuzzy GSTR-2B Reconciliation Engine:** Reconciles supplier invoices against portal GSTR-2B JSON/Excel using Levenshtein distance fuzzy matching, tax tolerance, and mismatch categorization.
- ☁️ **Off-PC Disaster Recovery & Cloud Sync:** Auto-detects **Google Drive for Desktop**, **OneDrive**, and external/USB drives to mirror rolling SQLite snapshots, `HOW-TO-RESTORE.txt`, incremental PDFs, and optional `.arthbackup` bundles, plus direct Google Drive OAuth upload/restore.
- 🖥️ **Compact Native Rust + WebView2 & Electron Desktop Apps:** Ultra-compact native Windows installer (`ArthSutra-Lite-Setup.exe` via `desktop-rust/` + NSIS) alongside Electron 45 NSIS desktop packaging (`release/ArthSutra Setup.exe`).
- 🧩 **Modular Plugin System & Tally XML Export:** Dynamic plugin loader with a built-in Tally ERP exporter generating XML sales vouchers for TallyPrime and Tally.ERP 9.

---

## Comprehensive Feature Matrix

### 1. Invoicing & Billing
* **Document Types:**
  - Tax Invoices (B2B, B2C, SEZ supplies, LUT export invoices)
  - Proforma Invoices & Estimates
  - Credit Notes & Debit Notes
  - Bills of Supply (for composition dealers and exempt goods)
  - Delivery Challans (for job work, supply on approval, transport)
* **Intelligent Tax Handling:**
  - Automatic Place of Supply (POS) detection from client GSTIN or state selection.
  - Automatic tax splitting into CGST + SGST (intra-state) or IGST (inter-state) or UTGST.
  - Comprehensive HSN / SAC database with dynamic GST rate suggestions.
  - Support for GST Cess and reverse charge mechanism (RCM).
* **Flexible Discounts:**
  - Line-item discounts: Percentage (`%`), Flat (`₹`), With-Tax, or Per-Unit.
  - Invoice-level global discounts.
* **TDS & TCS Calculations:**
  - Automatic calculation of TCS (Section 206C(1H)) and TDS (Section 194Q) with cumulative-threshold tracking.
* **2-Bills-Per-Page Tear Sheets & Invoice Layout:**
  - `2/Page` | `1/Page` quick toggle in the live preview toolbar & Print Preview modal (`TwoUpSheetPreview.jsx` & `invoicePdfBuilder.js`).
  - Stacks `CLIENT COPY` and `OFFICE / SELF COPY` top-and-bottom on one A4 Portrait sheet with an optional horizontal dashed `TEAR` divider.
  - Supports **1-up GST Rule 48 multi-copy printing** (`ORIGINAL FOR RECIPIENT`, `DUPLICATE FOR TRANSPORTER`, `TRIPLICATE FOR SUPPLIER`), diagonal watermarks, continuation headers & page numbers, custom margins (mm), and digital signature stamps.
* **Seller Drug Licence & Multi-Profile Billing:**
  - Automatic `details.sellerLicence` seeding from the active business profile (`profile.licence`) on new invoices and **Billing From** profile switches, plus multi-account bank/UPI selection per invoice.
* **Instant Digital Payments:**
  - Dynamic UPI QR codes (`56 × 56 px`, `75 × 75 px`, or `100 × 100 px`) rendered on invoices with payee VPA, business name, and exact invoice payable amount.
* **A4 Print & PDF Archival:**
  - High-resolution A4 & thermal PDF export with company logo, signatures, and Indian Terms & Conditions presets (`TERMS_PRESETS`).
  - Auto-saved PDF archive under `Saved Invoices/<ClientName>/<Month>/`.

### 2. Inventory & Batch Management (FEFO)
* **Product Catalog:**
  - SKU code, product name, HSN/SAC code, primary unit (UQC), secondary units.
  - Purchase cost price, selling price, and MRP tracking.
* **First-Expiry-First-Out (FEFO) Engine:**
  - Tracks individual stock batches with manufacturing dates, expiry dates, and MRPs.
  - Auto-allocates oldest non-expired batches when products are added to an invoice.
  - **Automatic Line Splitting:** If an ordered quantity exceeds the available stock in a single batch, the invoice row automatically splits across batches upon blur so older stock is cleared first.
  - Strict stock validation prevents over-billing beyond available batch balances.
* **Stock Ledgers & Alerts:**
  - Real-time stock movement ledger.
  - Low-stock and near-expiry dashboard notifications.

### 3. Purchase Bills & OCR Scanning
* **Inward Supply Tracking:**
  - Record supplier purchase bills with GSTIN validation and payment status (Paid, Unpaid, Partial).
  - Automatically replenishes product stock and batch balances upon bill entry.
* **Offline OCR Bill Import:**
  - Integrated offline Tesseract.js (WASM) OCR engine.
  - Scan physical paper invoices or image uploads locally without uploading sensitive vendor data to third-party cloud servers.

### 4. GSTR-2B Automated Reconciliation
* **Intelligent Matching Algorithm:**
  - Upload raw GSTR-2B JSON or Excel downloaded directly from the GST Portal.
  - Levenshtein distance fuzzy matching on invoice numbers (handles punctuation, prefix/suffix variations, and typos).
  - 15-character GSTIN validation with typo tolerance.
* **Categorized Buckets:**
  - **Perfect Match:** Supplier invoice found and tax values match within ₹1.00 tolerance.
  - **Mismatch:** Invoice found, but taxable amount or tax values differ from portal filing.
  - **Missing in Our Books:** Present in GSTR-2B, but not yet recorded in local purchases (unclaimed ITC).
  - **Missing in GSTR-2B:** Present in local purchases, but absent in GSTR-2B (vendor failed to file GSTR-1; risk of ITC denial).
* **ITC Claim Reports:**
  - Direct calculation of eligible vs. ineligible Input Tax Credit.

### 5. Compliance & Government Returns
* **GSTR-1 Export:**
  - Generates government-compliant JSON ready for direct upload to the GST Portal.
  - Excel/CSV summaries including Table 4 (B2B), Table 5 (B2CL), Table 7 (B2CS), Table 9B (CDNR), Table 6A (EXP), and Table 12 (HSN Summary).
* **GSTR-3B Summary:**
  - Auto-computes Table 3.1 (Outward supplies) and Table 4 (Eligible ITC).
  - One-click JSON and CSV export.
* **e-Way Bill Generator:**
  - Exports JSON conforming strictly to the NIC e-Way Bill schema (v1.0.1221).
* **Income Tax Helper:**
  - Old vs. New Tax Regime tax liability comparison.
  - Presumptive taxation calculators:
    - **Section 44AD:** Small businesses (6% digital / 8% cash turnover).
    - **Section 44ADA:** Professionals (50% presumptive income).
    - **Section 44AE:** Goods carriage and transport businesses.
  - Advance tax installment calculator and statutory due date tracker.

### 6. Client & Vendor Ledgers
* **Client Directory & Drug Licence Tracking:**
  - India-locked directory (`PIN Code`, Indian `State`, `GSTIN`, `PAN`, `Drug Licence No.` / `licence`, SEZ flag, billing/shipping address, contact details, and credit terms).
* **Predictive Client Search Popup & Auto-Save:**
  - `ClientSuggestingInput` (`useClientSearch` & `clientDirectory.js`) merges saved clients with historical invoice snapshots so typing a name, GSTIN, DL No., phone, or city surfaces instant matches.
  - Automatically creates or updates client details (including newly entered `GSTIN` or `licence`) when saving an invoice.
* **Client Statement (Dr / Cr Ledger):**
  - Generates running debit/credit ledger statements as downloadable PDFs with date ranges and closing balances (including Drug Licence No.).
* **Accounts Receivable Aging:**
  - Categorized aging breakdown: `0–30 days`, `31–60 days`, `61–90 days`, and `90+ days`.

### 7. Cash Flow, Expenses & Receipts
* **Expense Management:**
  - Record business overheads, operational expenses, rent, and utility bills.
  - Categorized with GST Input Tax Credit (ITC) eligibility status.
* **Payment Receipts:**
  - Issue official payment vouchers for cash, bank, or UPI receipts.
  - Automatically links payments to pending invoices.
* **Recurring Invoices:**
  - Automated recurring schedules (Weekly, Monthly, Quarterly, Annually).
  - Automatic advance generation and cycle management.

### 8. Analytics & Financial Reporting
* **Gross Profit Tracking:**
  - Every invoice line locks `costAtSale` at the instant of transaction.
  - Historical gross profit calculations remain 100% accurate even if vendor purchase prices change in the future.
* **Comprehensive Financial Statements:**
  - Real-time Profit & Loss (P&L) with Cost of Goods Sold (COGS).
  - Product sales velocity and SKU performance analytics.
  - Client turnover ranking.

### 9. Security, RBAC & Cryptographic Integrity
* **Role-Based Access Control (RBAC) & Authentication:**
  - **`ADMIN`:** Unrestricted access — user management, profile configuration, database backups, audit trail verification, settings.
  - **`ACCOUNTANT`:** Invoicing, purchases, reconciliation, expenses, tax returns, and financial reports.
  - **`CLERK`:** Front-desk billing, invoice creation, and customer directory.
  - **Pure JS `bcryptjs` Hashing:** Passwords hashed with high-entropy salt rounds in pure JavaScript, removing native build toolchains (`node-gyp` / MSVC).
  - **Unified Sepia Lock Screen:** Seamless aesthetic continuity styled with the warm parchment, dark slate, and green badge palette. Handles credential validation, offline session restoration, and 24h JWT token issuance.
* **Account Security, Team Users (RBAC) & In-App Audit Verification:**
  - Update login credentials directly under **Settings → Account Security** (`PUT /api/auth/profile`) with current-password verification and automatic JWT re-issuance.
  - **Team Users & Roles (RBAC):** `ADMIN` users can create, list, and delete `ADMIN`, `ACCOUNTANT`, and `CLERK` accounts directly in **Settings → Account Security** (`GET/POST/DELETE /api/auth/users`).
  - **In-App Audit Trail Verification:** Click **Verify Audit Chain** inside **Settings → Account Security** (or call `GET /api/audit/verify`) to validate the SHA-256 chain from `GENESIS`.
* **First-Time Setup Wizard & Backup Recovery:**
  - On a fresh install with no users in the database, the app presents a First-Time Setup Wizard (`SetupScreen.jsx`) to either configure the master `ADMIN` account (`POST /api/auth/setup`) or restore an entire business directly from a `.json` / `.arthbackup` / `.sqlite` backup (`POST /api/auth/setup-inspect-backup` & `POST /api/auth/setup-restore`).
  - No hardcoded default password is ever seeded, and existing admin credentials are never overwritten on server restarts.
* **Cryptographic Event Log (SHA-256 Hash Chain):**
  - Immutable audit trail linking each state change to the previous block hash:
    $$\text{currentHash} = \text{SHA256}(\text{previousHash} + \text{timestamp} + \text{action} + \text{payload} + \text{entity})$$
  - Verification API (`GET /api/audit/verify`) detects any database tampering, row deletion, or manual edits.
* **AES-256-GCM Encryption:**
  - Encrypts sensitive financial data at rest with PBKDF2/NIST SP 800-38D specifications.
* **Localhost-Only API Lockdown:**
  - Express server strictly binds to `127.0.0.1`.
  - Cross-origin requests from outside localhost are rejected.

### 10. Offline-First PWA & Real-Time Sync
* **Service Worker Caching:**
  - Works seamlessly during internet interruptions.
* **Write-Behind Synchronization:**
  - Offline changes are queued safely in IndexedDB.
  - Upon reconnection, changes sync automatically via an idempotent pipeline (`X-Idempotency-Key`) to prevent double-billing or duplicate records.
* **Live WebSocket Broadcasts:**
  - Real-time multi-window and local network terminal updates for invoices, stock, and clients.

### 11. Extensions & Tally ERP Export
* **Modular Plugin System:**
  - Dynamic plugin loader under the `plugins/` directory.
  - Custom UI hub accessible from the navigation sidebar.
* **Tally ERP / TallyPrime XML Exporter:**
  - Generates Tally-compatible XML Sales Vouchers with complete inventory breakdowns, batch allocations, godowns, and GST tax ledgers.
  - One-click copy or direct `.xml` file download for instant import into Tally.ERP 9 and TallyPrime.

### 12. Backup & Disaster Recovery
* **Automated Daily Backups:**
  - Integrity-checked SQLite snapshots taken daily and retained for 30 rolling days.
* **On-Demand Snapshots & One-Click Restore:**
  - Instant backup creation and one-click database restoration from Settings (`BackupAndTrashPanel`).
* **Soft-Delete Trash Bin:**
  - Deleted invoices (and their archived PDFs) move to a 30-day restorable Trash Bin before permanent purge.
* **Off-PC Disaster Recovery & Cloud Sync (`BackupRecoveryPanel`):**
  - Auto-detects **Google Drive for Desktop**, **OneDrive**, and external/USB drives (`Re-scan PC Drives`) to mirror rolling snapshots, `HOW-TO-RESTORE.txt`, and incremental `Saved Invoices/` PDFs automatically on changes.
  - Supports **PBKDF2 + AES-256-GCM encrypted `.arthbackup` bundles** with Recovery Password protection, restorable both in Settings and directly from the **First-Time Setup Wizard** (`Restore Backup` tab).
  - Includes an optional direct Google Drive OAuth upload & restore panel (`Save Drive Settings`, Connect, Upload, Restore).
* **Single-File Portable Export/Import:**
  - Granular category export and `?overwrite=1` idempotent restoration for `.arthbackup`, `.json`, and `.sqlite` backups.

### 13. Settings & Administration Hub
All 10 jump-nav sections in **Settings** (`SettingsView.jsx`) operate on Indian business defaults:
1. **Company (`#section-company`):** Business identity, tagline, **Drug Licence No.** (`licence`), `PIN Code`, Indian `State` dropdown, `GSTIN`, `PAN`, GSTR `AATO > ₹5 Cr` HSN rule & FY turnover (`gt` / `cur_gt`), multi-account Payment Accounts (`IFSC`, `UPI ID`, default⭐), Invoice Number Format (Branded/Simple Sequential/Random, Indian Apr–Mar FY `YYYY-YY`, padding, `startNumber`), and Logo/Signature uploads (`CLERK` read-only protection).
2. **Profiles (`#section-profiles`):** Switchable multi-business profiles with auto-save on switch, a **Create / Edit Business Profile** modal, and saved cards displaying `State`, `GSTIN`, and `DL` number.
3. **Terms (`#section-terms`):** Reusable Terms & Conditions templates and Indian quick-start presets (`TERMS_PRESETS`).
4. **Invoice Layout (`#section-print`):** Unified `PrintSettings` editor synced with `arthsutra_invoiceOptions` and live A4 / 2-up tear-sheet preview.
5. **Features (`#section-modules`):** Live-synced modular feature switches across Sales, Directory, Purchases & GSTR-2B, GST/E-Way Bill/TDS-TCS/Income Tax, Reports, Google Drive, and UPI QR (`hydrateEnabledModules` + `fgsb-modules-changed`).
6. **Stock (`#section-stock`):** Low-stock alert toggle & threshold paired with near-expiry / expired batch notifications (`computeNearExpiryBatches`).
7. **Backups (`#section-backups`):** Local daily SQLite snapshots + 30-day Trash Bin.
8. **Off-PC & Cloud (`#section-cloud`):** PC Crash Protection health banner, automatic Drive/OneDrive/USB folder mirror, and direct Google Drive OAuth backup/restore.
9. **Import/Export (`#section-data`):** Granular `.arthbackup`, `.json`, and `.sqlite` export/restore.
10. **Account Security (`#section-security`):** Credential updates (`PUT /api/auth/profile`), `ADMIN` **Team Users & Roles (RBAC)** management, and **Cryptographic Audit Trail Verification (SHA-256)** (`Verify Audit Chain`).

---

## Architecture

```
Arth-Sutra/
├── desktop-rust/                Compact native Rust + WebView2 desktop launcher
│   ├── src/main.rs              Single-instance launcher, Express bootstrap & WebView2 window
│   ├── Cargo.toml               Rust dependencies & app metadata
│   ├── icon.ico                 Application & installer icon
│   └── installer.nsi            NSIS script producing release/ArthSutra-Lite-Setup.exe
├── electron/                    Electron 45 desktop runtime
│   └── main.js                  Main process, window management & port listener
├── server.js                    Express 5 daemon & WebSocket server
├── db/                          Database layer (SQLite + Drizzle ORM)
│   ├── index.js                 SQLite connection, table bootstrap & ensureColumn() migrations
│   ├── schema.js                Drizzle ORM schema definitions (mirroring schema.ts)
│   ├── schema.ts                TypeScript Drizzle schema source for drizzle-kit
│   └── auditEngine.js           SHA-256 cryptographic hash chain engine
├── plugins/                     Modular extensions directory
│   └── tally-export.js          TallyPrime / Tally.ERP 9 XML export engine
├── utils/                       Server-side core utilities
│   ├── auth.js                  Bcrypt hashing, JWT tokens & RBAC middleware
│   ├── backupCrypto.js          PBKDF2 + AES-256-GCM .arthbackup bundle encryption
│   ├── crypto.js                AES-256-GCM encryption at rest
│   ├── disasterRecovery.js      SQLite snapshots, integrity checks & off-PC folder mirroring
│   └── recon.js                 Levenshtein fuzzy GSTR-2B reconciliation
├── public/                      Static assets, app icons & offline Tesseract WASM files
├── scripts/                     Build, packaging, test & migration scripts
│   ├── build-native.mjs         Builds Vite + Rust WebView2 + ArthSutra-Lite-Setup.exe
│   ├── generate-icons.mjs       Generates SVG/PNG/ICO/RGBA application icon assets
│   ├── bundle-tesseract-assets.mjs Bundles offline OCR assets into public/tesseract/
│   ├── migrate-json-to-sqlite.js Migrates legacy data/*.json into SQLite
│   └── migrate-phase-2-3.js      RBAC & crypto migration scripts
├── src/                         React 19 Frontend
│   ├── context/
│   │   └── AuthContext.jsx      JWT authentication state & session management
│   ├── services/
│   │   └── googleDrive.js       Google Drive OAuth & backup file helpers
│   ├── components/
│   │   ├── Dashboard/           Sales analytics, gross profit, low-stock & near-expiry alerts
│   │   ├── InvoiceGenerator/    Tax invoice form, FEFO logic, predictive client search & hooks
│   │   ├── InvoicePreview.jsx   A4 & thermal printable GST template engine
│   │   ├── TwoUpSheetPreview.jsx 2-bills-per-page top & bottom tear-sheet wrapper
│   │   ├── PrintPreviewModal.jsx Fullscreen print/PDF preview with 2/Page | 1/Page toggle
│   │   ├── PrintSettings.jsx    Invoice Layout & PDF print configuration UI
│   │   ├── BackupRecoveryPanel.jsx Off-PC folder mirror & Google Drive OAuth backup panel
│   │   ├── ClientModal.jsx      India-locked client add/edit modal with Drug Licence No.
│   │   ├── ClientsView.jsx      Client directory & statement PDF
│   │   ├── ReconView.jsx        GSTR-2B automated reconciliation interface
│   │   ├── ExtensionsView.jsx   Plugins dashboard & Tally XML export UI
│   │   ├── SetupScreen.jsx      First-time admin setup & backup restore wizard
│   │   ├── LockScreen.jsx       Sepia-themed authentication & lock screen
│   │   ├── GstReturns/          GSTR-1, GSTR-3B & e-Way Bill export hub
│   │   ├── IncomeTax.jsx        Old vs New regime & 44AD/44ADA/44AE tax helper
│   │   ├── InventoryView.jsx    Products, batches, and stock management
│   │   ├── PurchaseBills.jsx    Purchases & OCR bill scanning
│   │   ├── ReceiptVoucher.jsx   Payment receipts & invoice settlement
│   │   ├── RecurringInvoices.jsx Automated recurring invoice schedules
│   │   ├── ReportsView.jsx      P&L, receivables aging & turnover reports
│   │   ├── ExpenseTracker.jsx   Expense tracking with ITC tags
│   │   ├── UserGuideView.jsx    Built-in searchable user guide
│   │   └── SettingsView.jsx     10-section settings, multi-profiles, RBAC users & audit UI
│   ├── hooks/
│   │   └── useSocket.js         Real-time WebSocket event listener
│   ├── utils/
│   │   ├── audit.js             Client-side audit hashing utilities
│   │   ├── clientDirectory.js   Predictive search merge & client auto-save payload builder
│   │   ├── invoicePdfBuilder.js 2-up tear-sheet & 1-up multi-copy jsPDF compositor
│   │   ├── offlineSync.js       IndexedDB offline write-behind queue
│   │   └── printSettings.js     Print settings persistence & sample invoice builder
│   ├── store.js                 Frontend API client, module sync & backup helpers
│   └── utils.js                 India GST math, Indian states, TERMS_PRESETS & module map
├── data/                        Local SQLite database & config (gitignored)
│   ├── arth-sutra.sqlite        Primary ACID-compliant database
│   └── backups/                 Rolling 30-day database backups
└── Saved Invoices/              Physical PDF invoice archive (gitignored)
```

---

## Installation & Setup

### Prerequisites
- **Node.js 18 or newer** ([nodejs.org](https://nodejs.org))
- A modern web browser (Google Chrome, Microsoft Edge, Brave, or Mozilla Firefox)

---

### Option 1: Native Windows Desktop App (Recommended)

1. Clone or download the repository ZIP and extract it:
   ```bash
   git clone https://github.com/arth-upadhyay/Arth-Sutra.git
   cd Arth-Sutra
   ```
2. Double-click **`Install ArthSutra.bat`** (or run `npm install`).
3. **Compact Native Rust + WebView2 Installer (Recommended — `<30 MB`):**
   Requires Rust (`cargo`) and NSIS (`makensis.exe` from electron-builder cache). Builds the Vite bundle, compiles `desktop-rust/`, stages `release-native/app/`, and produces `release/ArthSutra-Lite-Setup.exe`:
   ```bash
   npm run build:native
   ```
4. **Electron NSIS Desktop Installer (Alternative):**
   ```bash
   npm run electron:build
   ```
   Generates `release/ArthSutra Setup.exe`.

To launch in Electron desktop development mode:
```bash
npm run electron:dev
```

---

### Option 2: Web / Local Server Mode (Windows, macOS, Linux)

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/arth-upadhyay/Arth-Sutra.git
   cd Arth-Sutra
   npm install
   ```
2. Build the frontend and start the server:
   ```bash
   npm start
   ```
3. Open your browser and navigate to:
   ```
   http://localhost:47371
   ```

*Note: The server defaults to port `47371`. If the port is in use, it automatically scans up to port `47421` and writes the active port to `data/port.txt`.*

---

### Option 3: Development Mode (Hot Reload)

To run the Vite frontend and Express server with hot module replacement:

```bash
# On Windows
npm run dev:win

# On macOS / Linux
npm run dev
```

---

## First-Time Setup Wizard & Authentication

When Arth-Sutra is launched for the first time with an empty database:

1. **Automatic Detection:** The frontend polls `GET /api/auth/status` on load. If no user accounts exist (`isSetupComplete: false`), the application seamlessly displays the **First-Time Setup Wizard** (`SetupScreen`).
2. **New Business or Restore Backup:** Choose **New Business** to define your custom **Admin Username** and **Password**, or switch to **Restore Backup** to migrate directly from an existing `.json`, `.arthbackup`, or `.sqlite` backup (`POST /api/auth/setup-inspect-backup` & `POST /api/auth/setup-restore`).
3. **Instant Auto-Login:** Upon submitting, `POST /api/auth/setup` validates the empty database condition, securely hashes your password with `bcryptjs`, assigns the `ADMIN` role, and returns a signed 24h JWT token. You are instantly routed into the Dashboard.
4. **Permanent Security:** The `POST /api/auth/setup` endpoint automatically locks down after the initial setup. Any subsequent calls to `/api/auth/setup` return HTTP `403 Forbidden`, preventing rogue account creation.
5. **Subsequent Launches:** On all subsequent runs, the app loads the standard sepia **Lock Screen** (`LockScreen.jsx`) to authenticate returning users.

> **Credential Updates:** At any time, you can navigate to **Settings → Account Security** to change your username or password by verifying your current password. All credential changes persist safely in the local SQLite database.

---

## Key Workflows & Guides

### 1. Creating an Invoice with FEFO Batch Auto-Split
1. Click **New Invoice** (`Ctrl+N` or from the sidebar).
2. Select or enter a Client. The state code and Place of Supply (POS) auto-populate.
3. Start typing a product name. The predictive search shows matching products and batch stock balances.
4. When selecting a product with multiple batches, the engine automatically selects the batch closest to expiry.
5. If the quantity ordered exceeds that batch's stock, **the row automatically splits into two lines** on blur:
   - Line 1 consumes the remaining stock of the oldest batch.
   - Line 2 takes the balance from the subsequent batch.
6. Review totals, discounts, TCS/TDS, and click **Save & Download PDF**.

### 2. GSTR-2B Automated Reconciliation
1. Navigate to **Reconciliation** in the sidebar (accessible by `ADMIN` and `ACCOUNTANT`).
2. Download your GSTR-2B JSON file from the official GST Portal (`Services → Returns → GSTR-2B`).
3. Drag and drop the `.json` file into the upload zone.
4. The fuzzy matching algorithm matches your local purchase records against portal entries.
5. Review the 4 tabs:
   - **Matched:** Invoices confirmed and ready for ITC claim.
   - **Mismatches:** Flagged differences in tax rates, invoice numbers, or amounts.
   - **Missing in Books:** Invoices filed by suppliers that you haven't booked yet.
   - **Missing in GSTR-2B:** Bills in your accounting that suppliers haven't filed (actionable follow-up list).

### 3. Tally ERP / TallyPrime XML Export
1. Go to **Extensions** in the sidebar.
2. Under **Tally ERP Export**, pick an invoice from the dropdown.
3. Click **Preview XML** to inspect the generated XML structure.
4. Click **Download .XML** or **Copy XML**.
5. In TallyPrime or Tally.ERP 9:
   - Go to `Import Data → Vouchers`.
   - Select the downloaded XML file. All inventory items, batches, godowns, and CGST/SGST/IGST ledgers will import automatically.

### 4. Cryptographic Audit Verification
1. Verify transaction integrity directly inside the app under **Settings → Account Security → Verify Audit Chain**, or query:
   ```
   http://localhost:47371/api/audit/verify
   ```
2. The verification engine walks the SHA-256 chain from `GENESIS` to the latest record.
3. Response:
   ```json
   {
     "valid": true,
     "totalRecords": 142
   }
   ```
   If any row was manipulated directly in SQLite, the endpoint flags:
   ```json
   {
     "valid": false,
     "corruptedAtId": 48,
     "reason": "Row currentHash does not match recomputed hash"
   }
   ```

---

## Database Migrations

If you are upgrading from an older version of Arth-Sutra that used JSON files in `data/`:

```bash
# Migrates data/bills.json, clients.json, etc. to data/arth-sutra.sqlite
npm run db:migrate
```

The migration runs inside atomic database transactions with zero data loss. Your original JSON files are preserved as backups.

---

## Automated Test Suites

Arth-Sutra includes comprehensive unit and integration tests powered by Vitest:

```bash
npm test -- --run
```

Test coverage includes (81/81 tests passing across 10 test suites):
- **`india-settings.test.js` (24 tests):** India-only country lock (`PIN Code`, `GSTIN`, `IFSC Code`, Indian states), `profiles` & `clients` Drug Licence No. (`licence`) and `country = 'India'` persistence, `TERMS_PRESETS`, near-expiry batch alert computation, 1-up PrintSettings PDF flags, and `store.js` `?overwrite=1` import + live module sync event.
- **`two-up-pdf.test.js` (9 tests):** 2-bills-per-page A4 Portrait tear-sheet layout geometry, `CLIENT COPY` / `OFFICE / SELF COPY` & `TEAR` divider markings, 1-up fallback, thermal single-copy isolation, and multi-page slicing.
- **`auth-profile.test.js` (8 tests):** Empty-database user lifecycle, current password verification, profile updates, duplicate username rejection, JWT regeneration, and First-Time Setup Wizard (`/api/auth/status` & `/api/auth/setup`).
- **`crypto-auth.test.js` (7 tests):** AES-256-GCM encryption/decryption, pure JS `bcryptjs` password hashing, JWT issuance, and RBAC authorization.
- **`recon.test.js` (7 tests):** Fuzzy matching, Levenshtein distance calculations, and GSTR-2B tolerance evaluations.
- **`components/utils.test.jsx` (7 tests):** GST math, currency formatting, and discount calculations.
- **`disaster-recovery.test.js` (6 tests):** PBKDF2 + AES-256-GCM `.arthbackup` bundle encryption/decryption, integrity-checked SQLite snapshots & cross-DB restore, and incremental off-PC folder mirroring.
- **`client-search.test.js` (6 tests):** Merged directory + historical bill client discovery, multi-field predictive filtering, and idempotent client auto-save/upsert payloads.
- **`audit.test.js` (4 tests):** SHA-256 payload sanitization, hash chaining, and tamper-detection verification.
- **`db.test.js` (3 tests):** SQLite schema validation, Drizzle queries, and ACID transactions.

---

## Security & Data Privacy

- **100% Local Execution:** Arth-Sutra does not send your client details, invoices, or financial figures to any external server.
- **Zero Third-Party Telemetry:** No analytics scripts, tracking pixels, or third-party ad beacons.
- **Localhost Bound:** The Express backend binds exclusively to `127.0.0.1`. Requests originating from outside localhost are rejected with HTTP 403.
- **Strict Content Security Policy (CSP):** Blocks unauthorized external script execution.

---

## Author & Support

- **Created by:** Arth Upadhyay ([@arth-upadhyay](https://github.com/arth-upadhyay))
- **Email:** `arth14deepak@gmail.com`
- **Security Disclosures:** For sensitive security inquiries, please email `kumarup1972@gmail.com` directly.

---

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.
