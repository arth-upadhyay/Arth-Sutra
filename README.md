# ArthSutra
the name just means **ARTH's SYSTEM** in sanskrit
## Why this was created
I built this software for my father. As a business owner, enterprise-grade billing software like Marg ERP was too expensive and bloated for his actual daily needs. I created this to be a free, offline-first alternative tailored specifically to Indian GST billing standards. It is now open-source so that any small-medium business owner who cannot afford high-level enterprise software can use it locally.

## Architecture Overview
ArthSutra is an offline-first Single Page Application (SPA). It is designed to run entirely on the user's local machine with zero latency, removing the dependency on continuous internet access or expensive cloud database hosting.
## password
**ARTH**
### The Tech Stack
* **Frontend:** React.js, Vite
* **Local Database:** IndexedDB (via browser storage)
* **Backend Utility:** Node.js (Local daemon for filesystem bridging)
* **Rendering Engine:** `html2canvas`, `jsPDF`

## How It Works (The Data Workflow)

To understand the codebase, here is the exact lifecycle of an invoice from data entry to PDF generation:

### 1. In-Memory State & Calculation (React)
When a user inputs billing details on the frontend, the React application handles all calculations in real-time. This includes determining CGST/SGST vs. IGST splits based on the client's state, applying multi-tier line discounts, calculating HSN/SAC groupings, and processing grand totals. No network requests are made during data entry.

### 2. Local Persistence (IndexedDB)
When the user clicks "Save", the application triggers a smart lookup function in `store.js`. 
* **Inventory Deduction:** It calculates the delta for the sold items and mathematically deducts them from the local stock ledger.
* **Database Commit:** The raw JSON payload of the invoice (client details, items, tax breakdown) is saved directly into the browser's IndexedDB.

### 3. Headless Template Rendering
Once saved, the raw data state is passed into `InvoicePreview.jsx`. This component acts as a strictly formatted rendering engine. It takes the raw data and maps it pixel-perfectly to a traditional Marg ERP Pharma layout (or thermal receipt layout, depending on user settings). 

### 4. PDF Compilation
After the DOM is rendered in the background, the application uses `html2canvas` to take a high-fidelity snapshot of the layout and passes that image data to `jsPDF`, which compiles it into a downloadable PDF blob.

### 5. Local File System & Cloud Sync (Node.js)
Because browsers cannot securely force file downloads to specific folders without user prompts, the frontend sends the PDF blob to a local Node.js daemon (`server.js`) running in the background via a `/api/save-pdf` endpoint. 
* The Node server physically writes the PDF to a "Saved Invoices" directory on the user's hard drive.
* If configured, it will simultaneously utilize the Google Drive API to push a copy of the invoice to the cloud for secure backup.

## Installation and Setup

### Prerequisites
* **Node.js** must be installed on the host machine.

### Local Deployment

RUN THE: Install FreeGSTBill.BAT         
         OR
1. Clone or download this repository.
2. Open a terminal inside the root project directory.
3. Install the dependencies:
   ```bash
   npm install
   
