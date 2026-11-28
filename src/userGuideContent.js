// Structured content for the in-app User Guide. Used for both on-screen
// rendering (UserGuideView.jsx) AND searchable PDF generation via jsPDF's
// native text() method (which produces real text glyphs the OS / Acrobat
// can search and select — unlike html2canvas, which rasterises everything).
//
// Block types:
//   { type: 'h1' | 'h2' | 'h3', text }
//   { type: 'p',   text }
//   { type: 'ul' | 'ol', items: [string, ...] }
//   { type: 'note', text }                   // highlighted callout
//   { type: 'kv',  rows: [[key, value], ...] }
//   { type: 'spacer' }

export const GUIDE_CONTENT = [
  { type: 'h1', text: 'ArthSutra — User Guide' },
  { type: 'p', text: 'A plain-language guide for everyone who uses this app — no coding background needed. Use Ctrl+F (or your PDF reader\'s search) to find anything fast.' },
  { type: 'note', text: 'TL;DR  —  Double-click "Install ArthSutra.bat" once. A desktop icon appears. Open it whenever you need the app. Your data lives in the data/ folder next to the app — back that folder up and you\'ve backed up everything.' },
  { type: 'spacer' },

  { type: 'h2', text: '1. What is this?' },
  { type: 'p', text: 'A billing & invoicing app you run on your own computer. It works without internet, your data stays on your machine, and there is no monthly fee — ever.' },
  { type: 'h3', text: 'It can do' },
  { type: 'ul', items: [
    'Tax invoices, quotations / proforma invoices, credit notes, bills of supply, delivery challans.',
    'Auto GST math — CGST + SGST, UTGST, or IGST for India based on State / GSTIN / SEZ.',
    'Generate professional PDFs (3 styles), share over WhatsApp, email, or upload to Google Drive.',
    'Track inventory with units (kg, ltr, mtr, hrs, pcs, …) including custom units.',
    'TDS / TCS line items on invoices (Section 194Q, 206C(1H), etc.).',
    'GSTR-1 / GSTR-3B CSV and JSON exports for the GST portal offline tool.',
    'GSTR-2B reconciliation — match purchases against the GSTN-generated 2B file.',
    'E-Way Bill JSON for the NIC portal.',
    'Recurring invoices, expenses, purchases, payment receipts, multi-business profile switcher.',
  ]},
  { type: 'h3', text: 'It will not' },
  { type: 'ul', items: [
    'Send your data anywhere. There is no signup, no cloud sync (unless you explicitly turn on Google Drive backup), no analytics, no telemetry.',
    'Charge you. There is no paid tier.',
  ]},
  { type: 'spacer' },

  { type: 'h2', text: '2. Quick Start (Windows)' },
  { type: 'p', text: 'You do not need any programming knowledge.' },
  { type: 'ol', items: [
    'Download the project as a ZIP from github.com/arthupadhyay/Arth-Sutra (green Code button → Download ZIP) and unzip it somewhere you will remember (e.g. Documents\\ArthSutra).',
    'Double-click "Install ArthSutra.bat". The installer takes 1-2 minutes the first time and asks no questions.',
    'A "ArthSutra" icon appears on your Desktop and in the Start Menu. Use it any time.',
    'The app opens in your browser at http://localhost:47371. Click "Install App" in the address bar to make it look like a normal Windows program.',
  ]},
  { type: 'note', text: 'If Windows shows "Windows protected your PC" → click "More info" → "Run anyway". This is normal for free open-source apps that aren\'t code-signed (signing certificates cost ~$300/year, which defeats the "free" part).' },
  { type: 'h3', text: 'macOS / Linux' },
  { type: 'p', text: 'The .bat files are Windows-only, but the app itself works anywhere with Node.js 18+. Run: git clone the repo, npm install, npm start. Open http://localhost:47371 in your browser.' },
  { type: 'spacer' },

  { type: 'h2', text: '3. First-time setup & Company details' },
  { type: 'p', text: 'When you open the app for the first time, the First-Time Setup screen guides you through getting started:' },
  { type: 'ol', items: [
    'Create your Administrator account (or switch to Restore Backup to recover everything from a previous PC).',
    'Open Settings → Company Details — enter your Business Name, Address, PIN Code, Indian State, GSTIN, PAN, and Drug Licence No.',
    'Payment Accounts — add your bank account (IFSC) and UPI ID so invoices and UPI QR codes show where clients should pay.',
    'Done — start billing.',
  ]},
  { type: 'p', text: 'Everything you set is editable later in Settings.' },
  { type: 'spacer' },

  { type: 'h2', text: '4. Making your first invoice' },
  { type: 'ol', items: [
    'Click "+ New Invoice" in the sidebar.',
    'Pick the invoice type: Tax Invoice, Proforma / Estimate, Credit Note, Bill of Supply, or Delivery Challan.',
    'Type the client name. If you have billed them before, address and tax ID auto-suggest.',
    'Add line items. Each row has Description, Qty, Unit (pcs / kg / ltr / hrs / custom), Rate, Discount, Tax %.',
    'Use "+ Add custom..." in the unit dropdown to define your own unit (e.g. Carat, Bundle, Bushel).',
    'Click "Download PDF" to save and share. The invoice gets a unique number per your invoice number format setting.',
  ]},
  { type: 'h3', text: 'Did the app save it?' },
  { type: 'p', text: 'Look at the top-left status badge:' },
  { type: 'ul', items: [
    '"Draft only — not saved yet"  →  you have started a new invoice but have not added a real client + item. Nothing is saved to the bills list.',
    '"Saving..."  →  changes being persisted now.',
    '"All changes saved"  →  safe to close.',
  ]},
  { type: 'p', text: 'If you click Back while changes are unsaved, you will see a confirmation. Choose OK to save and exit, or Cancel to keep editing. Browser refresh / tab close also asks before discarding.' },
  { type: 'spacer' },

  { type: 'h2', text: '5. Indian GST & Multi-Business Profiles' },
  { type: 'p', text: 'Arth-Sutra is tailored for Indian GST billing in INR (₹) with automatic intra-state (CGST + SGST / UTGST) and inter-state / SEZ (IGST) calculation:' },
  { type: 'kv', rows: [
    ['Place of Supply & State', 'Automatically compares your business State / GSTIN against the client State / GSTIN (or SEZ flag) to split taxes properly.'],
    ['Drug Licence No.', 'Store your seller Drug Licence No. on each Business Profile and buyer Drug Licence No. per Client; both print on GST bills automatically.'],
    ['Multi-Business Profiles', 'Run multiple firms or branches from Settings → Profiles and switch seamlessly in the sidebar or on any invoice via Billing From.'],
  ]},
  { type: 'spacer' },

  { type: 'h2', text: '6. Modules — turn off what you don\'t need' },
  { type: 'p', text: 'Settings → Modules lets you hide entire feature groups: Sales & Invoicing, Directory, Purchases & Expenses, GST & Tax, Reports, Integrations. Disabling a module hides it from the sidebar and from related forms — your data is never touched. Core modules (Dashboard, Clients, Invoicing, Settings) are locked on so the app stays usable.' },
  { type: 'spacer' },

  { type: 'h2', text: '7. PDF customization — full field control' },
  { type: 'p', text: 'In the invoice form, click Customize. You get sectioned toggles for every field on the PDF:' },
  { type: 'ul', items: [
    'Header & branding — logo, business name, business address, phone, email, business state, tax ID',
    'Client / Bill-to — client address, phone, email, place of supply',
    'Invoice meta — invoice number, invoice date, due date',
    'Items table — HSN/SAC, Qty, Unit, Rate, Discount, Tax % column',
    'Totals — subtotal row, amount in words, round-off line',
    'Footer — bank details, UPI QR (India only), signature block, "Authorized Signatory" caption, Terms & Conditions, Notes / Remarks',
  ]},
  { type: 'p', text: '"Hide all" and "Reset to default" buttons let you start clean or recover quickly.' },
  { type: 'spacer' },

  { type: 'h2', text: '8. Terms & Conditions — rich text + India presets' },
  { type: 'p', text: 'The Terms & Conditions section supports rich formatting (bold, italic, underline, bullet/numbered lists, headings, links). Below the editor, "Insert preset (by business type)" gives Indian starter templates:' },
  { type: 'ul', items: [
    'Pharma / Medical Distributor',
    'Generic SME / Trader',
    'Wholesale / Manufacturing',
    'Services / Consulting',
    'Retail / Counter Sale',
  ]},
  { type: 'p', text: 'You can also create reusable templates under Settings → Terms and load them on any invoice. Edit freely; nothing is locked.' },
  { type: 'spacer' },

  { type: 'h2', text: '9. TDS / TCS on invoices' },
  { type: 'p', text: 'In Customize → TDS or TCS:' },
  { type: 'kv', rows: [
    ['TCS — collected by you', 'Adds to the invoice total. Section 206C(1H) for sales > Rs 50 L, ecommerce 52, custom rate.'],
    ['TDS — deducted by the buyer', 'Informational only — shows below "Total Due" with a "Net Receivable" line. Sections 194Q, 194C, 194J, 194I, 194H, 194O, 195, custom.'],
  ]},
  { type: 'p', text: 'Aggregated reports are at GST Returns → TDS / TCS Report tab. Export per-quarter CSVs as input for Form 26Q (TDS) and Form 27EQ (TCS) quarterly returns.' },
  { type: 'spacer' },

  { type: 'h2', text: '10. GST returns and reconciliation' },
  { type: 'p', text: 'GST Returns view has four tabs:' },
  { type: 'ul', items: [
    'GSTR-1 — B2B / B2C / HSN / Credit Notes / Document Summary breakdown. Download CSVs and JSON (offline-tool format).',
    'GSTR-3B — Outward + ITC + tax payable summary. CSV and JSON exports.',
    'GSTR-2B Reconciliation — Import the GSTR-2B JSON downloaded from the portal; we match each entry against your purchase records and flag matched / amount-mismatch / books-only / 2B-only entries. Filter by status, export reconciliation CSV.',
    'TDS / TCS Report — see section 9.',
    'Filing Guide — step-by-step instructions for actually filing each return on the GST portal.',
  ]},
  { type: 'p', text: 'JSON files generated here can be uploaded directly via the GST portal\'s offline tool — no manual data entry.' },
  { type: 'spacer' },

  { type: 'h2', text: '11. E-Way Bill' },
  { type: 'p', text: 'In the invoice form, click "E-Way Bill" (visible for Tax Invoice and Delivery Challan types). The JSON matches the NIC portal schema (version 1.0.1221). Upload it at ewaybillgst.gov.in → Bulk Generation. Required fields: business state + PIN code, client state + PIN code (extracted from address if possible).' },
  { type: 'spacer' },

  { type: 'h2', text: '12. Payment Accounts (multiple banks / UPI per profile)' },
  { type: 'p', text: 'Each business profile can hold many payment accounts — e.g. an HDFC current account, an SBI cash-credit account, and a UPI ID. Pick which one shows on a given invoice from the Customize panel.' },
  { type: 'h3', text: 'Managing accounts' },
  { type: 'p', text: 'Settings → Payment Accounts. Click + Add account to create one. Each account has a free-text label (shown in the dropdown), bank name, account number, IFSC Code, optional UPI ID for the QR, and optional internal notes (not printed).' },
  { type: 'ul', items: [
    '⭐ Mark one account as default — it is preselected on every new invoice.',
    '↑ ↓ Reorder accounts — affects dropdown order in the invoice form.',
    '∅ Deactivate an account — keeps it editable but hides it from new-invoice dropdowns. Historical invoices that used it stay unchanged.',
    'Delete — permanently removes the account. Existing invoice PDFs that referenced it still render correctly via their saved snapshot.',
  ]},
  { type: 'h3', text: 'Picking an account on an invoice' },
  { type: 'p', text: 'In the invoice form, open Customize. The "Payment account on this invoice" dropdown lists all active accounts of the current business profile. Switching swaps both the bank-details block AND the UPI QR code on the PDF together — each account is a complete payment endpoint.' },
  { type: 'p', text: 'Tick "Show Pay via: <account> label" in the Footer toggle group to print the account label above the bank block — useful when you have multiple accounts and want the client to know which one to use.' },
  { type: 'h3', text: 'Defaults' },
  { type: 'p', text: 'New invoices default to: (1) the account you used on your last invoice for this profile (per-device memory), (2) failing that, the ⭐ default, (3) failing that, the first active account.' },
  { type: 'h3', text: 'Upgrading from a single account' },
  { type: 'p', text: 'If you used the app before v1.5, you have one bank/UPI set on your profile. Open Settings → Payment Accounts → click "Import & continue" — your existing details become your first account, marked as default. Add more from there.' },
  { type: 'spacer' },

  { type: 'h2', text: '13. Backing up your data & PC Crash Protection' },
  { type: 'p', text: 'By default, Arth-Sutra stores everything locally in a verified SQLite database (data/arth-sutra.sqlite) plus PDF archives in Saved Invoices/. Local daily snapshots are kept for 30 days in data/backups/.' },
  { type: 'h3', text: 'Automatic Off-PC Mirror (Recommended — protects against PC corruption)' },
  { type: 'p', text: 'If your PC hard drive crashes or Windows is wiped, local backups on the same PC would be lost too. Open Settings → Off-PC & Cloud to connect Google Drive for Desktop (G:\\My Drive), Microsoft OneDrive, or a USB/D: drive.' },
  { type: 'ul', items: [
    'Auto-sync within 10 seconds whenever you create or update invoices, clients, products, or settings.',
    'Optionally mirror your Saved Invoices/ PDFs incrementally.',
    'Enable a Recovery Password to save AES-256-GCM encrypted .arthbackup files so nobody can read your books on cloud storage.',
  ]},
  { type: 'h3', text: 'Manual Export & Direct Google Drive Backup' },
  { type: 'p', text: 'Settings → Import/Export → Export Backup lets you download either an encrypted .arthbackup file or a portable .json file (with decrypted, cross-PC portable bank details). You can also upload and restore backups directly via Google Drive API.' },
  { type: 'spacer' },

  { type: 'h2', text: '14. Recovering after a PC crash or moving to a new computer' },
  { type: 'p', text: 'Three easy ways to restore everything on a new or freshly formatted PC:' },
  { type: 'h3', text: 'Option A — Restore right from the First-Time Setup screen (Easiest)' },
  { type: 'ol', items: [
    'Install Google Drive for Desktop / OneDrive on the new PC (or plug in your backup USB drive).',
    'Install and open Arth-Sutra on the new PC.',
    'On the Welcome screen, switch to the "Restore Backup" tab and select latest-backup.arthbackup, latest-backup.json, or latest-backup.sqlite.',
    'Enter your Recovery Password (if set). All invoices, clients, products, settings, and accounts return immediately.',
  ]},
  { type: 'h3', text: 'Option B — Restore inside Settings' },
  { type: 'ol', items: [
    'Open Settings → Import/Export → Import Backup (.json / .arthbackup / .sqlite) and choose your backup file.',
    'Or use Settings → Off-PC & Cloud → Restore from Google Drive to pull a snapshot directly from your Drive.',
  ]},
  { type: 'h3', text: 'Option C — Copy data/ and Saved Invoices/ manually' },
  { type: 'p', text: 'If you have a copy of your data/ folder (including arth-sutra.sqlite) and Saved Invoices/, copy them into the new install\'s data folder while Arth-Sutra is closed. Do NOT run two PCs against the exact same live SQLite file at the same time.' },
  { type: 'spacer' },

  { type: 'h2', text: '15. Common questions (FAQ)' },
  { type: 'kv', rows: [
    ['Where exactly is my data?', 'In a local SQLite database (data/arth-sutra.sqlite, or %APPDATA%\\ArthSutra for the desktop installer) and Saved Invoices/ for PDFs.'],
    ['What happens if my PC gets corrupted or formatted?', 'If you enabled Off-PC Mirror (Google Drive for Desktop / OneDrive / USB) or saved an exported .arthbackup / .json / .sqlite file off-PC, install Arth-Sutra on the new PC and click "Restore Backup" on the Welcome screen. Everything comes back.'],
    ['Is anything sent to the internet?', 'Only if you turn on Google Drive backup/sync, or click Update to fetch a new version. Otherwise nothing leaves your computer.'],
    ['I\'m not GST-registered. Can I still use this?', 'Yes. Pick "Bill of Supply" as the invoice type, or set Tax % to 0.'],
    ['I run multiple businesses. Can I bill from different ones?', 'Yes. Add each business in Settings → Business Profiles. A profile picker appears at the top of every new invoice.'],
    ['Can I use my own units (e.g. Carat for jewellery)?', 'Yes. On any line item, click the Unit dropdown → "+ Add custom..." and type your unit. Saved on this device, available everywhere.'],
    ['I made a mistake on an invoice. Can I edit it?', 'Yes. Open it from the Bills list and edit. Or, if you\'ve already sent the PDF, create a Credit Note against the original invoice number — the proper GST way.'],
    ['Why does it open in my browser instead of being a real app?', 'It is a Progressive Web App. Click Install App in the address bar and Windows treats it like any other desktop app — appears in Start Menu, has its own window, no browser chrome.'],
    ['How do I update to a new version?', 'Run Update ArthSutra.bat. It pulls the latest from GitHub without touching your data/ folder.'],
    ['I want a feature that\'s missing.', 'Open an issue at github.com/arthupadhyay/Arth-Sutra/issues — many features in this app started as community requests.'],
  ]},
  { type: 'spacer' },

  { type: 'h2', text: '16. Troubleshooting' },
  { type: 'kv', rows: [
    ['"Cannot connect to server" / blank page', 'The local server is not running. Run "Start ArthSutra.bat" again, or reboot (it auto-starts on login).'],
    ['Windows shows "Windows protected your PC" or my antivirus blocked the installer', 'Click "More info" → "Run anyway". Or right-click the .bat → Properties → Unblock. The full source is on GitHub if you want to inspect it.'],
    ['Installer says Node.js install failed', 'Install Node.js manually from nodejs.org (pick LTS), then run Install ArthSutra.bat again.'],
  ]},
  { type: 'spacer' },

  { type: 'h2', text: '17. For developers' },
  { type: 'p', text: 'Stack: React 19 + Vite 7 frontend, Express 5 backend, SQLite via Drizzle ORM, plain JavaScript (no TypeScript).' },
  { type: 'p', text: 'Setup:  git clone the repo,  cd in,  npm install,  npm run dev (starts both Express + Vite dev server).' },
  { type: 'p', text: 'Key files:  src/components/InvoiceGenerator/index.jsx (invoice form),  src/components/InvoicePreview.jsx (PDF template),  src/utils.js (GST math, Indian states, units, validation, GST exports),  server.js (REST API),  src/store.js (frontend store wrapper).' },
  { type: 'p', text: 'PRs welcome. The project follows Keep a Changelog — see CHANGELOG.md.' },
  { type: 'spacer' },

  { type: 'h2', text: '18. Need help?' },
  { type: 'ul', items: [
    'GitHub issues: github.com/arthupadhyay/Arth-Sutra/issues',
    'Email arth14deepak@gmail.com',
  ]},
];
