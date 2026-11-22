import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { eq, ne, sql, desc, asc } from 'drizzle-orm';
import dotenv from 'dotenv';
dotenv.config();

import { computeInvoiceTotals } from './src/utils.js';
import { reconcileGstr2b } from './utils/recon.js';

// ── Database (Drizzle + better-sqlite3) ────────────────────────────────────
import {
  db, sqlite, DB_PATH, DATA_DIR,
  bills, clients, products, purchases, expenses,
  receipts, profiles, templates, recurring, meta, auditLogs,
  requestLogs, users,
} from './db/index.js';
import { logEvent, verifyAuditChain } from './db/auditEngine.js';
import { encryptProfileBankDetails, decryptProfileBankDetails } from './utils/crypto.js';
import { hashPassword, comparePassword, generateToken, verifyToken, ROLES } from './utils/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Port choice — see original comments. 47371 is in IANA's unassigned range.
const DEFAULT_PORT = 47371;
const PORT_FILE = path.join(DATA_DIR, 'port.txt');

const persistedPort = (() => {
  try {
    if (!fs.existsSync(PORT_FILE)) return null;
    const n = parseInt(fs.readFileSync(PORT_FILE, 'utf-8').trim(), 10);
    return (isFinite(n) && n >= 1024 && n <= 65535) ? n : null;
  } catch { return null; }
})();
const STARTING_PORT = persistedPort || DEFAULT_PORT;
const MAX_PORT_SCAN = 50;

const app = express();
let activeServer = null;
let wss = null;

function broadcast(type, data) {
  if (!wss || !wss.clients) return;
  const payload = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch { /* ignore individual write errors */ }
    }
  }
}

// ── Multer in-memory storage for GSTR-2B file uploads ─────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

// ── Authentication & RBAC Middlewares ──────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.slice(7).trim();
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: ' + err.message });
  }
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }
    next();
  };
}

// ── CORS lockdown (localhost only) ─────────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allow =
    !origin ||
    /^https?:\/\/localhost(:\d+)?$/i.test(origin) ||
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin) ||
    /^https?:\/\/\[::1\](:\d+)?$/i.test(origin);
  if (!allow) {
    return res.status(403).json({ error: 'Cross-origin request refused' });
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Idempotency-Key');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '5mb' }));

// ── Backend Idempotency Middleware (for Offline PWA Write-Behind) ───────────
app.use((req, res, next) => {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'DELETE'].includes(method)) {
    return next();
  }

  const idempotencyKey = req.headers['x-idempotency-key'];
  if (!idempotencyKey) {
    return next();
  }

  try {
    const existing = db.select().from(requestLogs).where(eq(requestLogs.key, idempotencyKey)).get();
    if (existing) {
      res.setHeader('X-Cache', 'IDEMPOTENT-HIT');
      try {
        const parsed = JSON.parse(existing.response);
        return res.status(parsed.status || 200).json(parsed.body !== undefined ? parsed.body : parsed);
      } catch {
        return res.send(existing.response);
      }
    }
  } catch (err) {
    console.warn('Idempotency lookup error:', err);
  }

  // Intercept response to store result
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = function (body) {
    try {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        db.insert(requestLogs).values({
          key: idempotencyKey,
          response: JSON.stringify({ status: res.statusCode, body }),
          timestamp: new Date().toISOString(),
        }).onConflictDoNothing().run();
      }
    } catch (saveErr) {
      console.warn('Failed to store idempotency record:', saveErr);
    }
    return originalJson(body);
  };

  res.send = function (body) {
    try {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        db.insert(requestLogs).values({
          key: idempotencyKey,
          response: JSON.stringify({ status: res.statusCode, body }),
          timestamp: new Date().toISOString(),
        }).onConflictDoNothing().run();
      }
    } catch (saveErr) {
      console.warn('Failed to store idempotency record:', saveErr);
    }
    return originalSend(body);
  };

  next();
});

// ════════════════════════════════════════════════════════════════════════════
// Authentication Endpoints
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = db.select().from(users).where(eq(users.username, username)).get();
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const matches = await comparePassword(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/auth/users', requireAuth, requireRole(['ADMIN']), (req, res) => {
  try {
    const rows = db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    }).from(users).all();
    res.json(rows);
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

app.post('/api/auth/users', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const validRoles = ['ADMIN', 'ACCOUNTANT', 'CLERK'];
    const userRole = validRoles.includes(role) ? role : 'CLERK';

    const existing = db.select().from(users).where(eq(users.username, username)).get();
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const passwordHash = await hashPassword(password);
    const result = db.insert(users).values({
      username,
      passwordHash,
      role: userRole,
      createdAt: new Date().toISOString(),
    }).run();

    res.json({ success: true, id: result.lastInsertRowid, username, role: userRole });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

app.delete('/api/auth/users/:id', requireAuth, requireRole(['ADMIN']), (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (req.user.id === targetId) {
      return res.status(400).json({ error: 'Cannot delete your own admin account' });
    }
    db.delete(users).where(eq(users.id, targetId)).run();
    res.json({ success: true });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

// ── Path-safety helpers (unchanged from original) ─────────────────────────

function safeFileName(id) {
  return String(id).replace(/[/\\:*?"<>|]/g, '_');
}

function safePathSegment(input, fallback = 'Untitled') {
  if (input === undefined || input === null) return fallback;
  let s;
  try { s = decodeURIComponent(String(input)); } catch { s = String(input); }
  s = s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
  s = s.replace(/\.{2,}/g, '-');
  s = s.replace(/^[.\s]+|[.\s]+$/g, '');
  s = s.slice(0, 120);
  return s || fallback;
}

function isPathInside(resolved, root) {
  const r = path.resolve(root);
  const p = path.resolve(resolved);
  return p === r || p.startsWith(r + path.sep);
}

// ── Error handling (same as original) ─────────────────────────────────────

const ERRORS_LOG = path.join(DATA_DIR, 'errors.log');

function errRes(res, status, code, err) {
  if (err) {
    try {
      const ts = new Date().toISOString();
      const msg = err && err.stack ? err.stack : String(err);
      fs.appendFileSync(ERRORS_LOG, `[${ts}] [api:${code}] ${msg}\n`, 'utf-8');
    } catch { /* ignore */ }
  }
  const MESSAGES = {
    'bad-request': 'Invalid request',
    'not-found': 'Not found',
    'conflict': 'Conflict with existing resource',
    'server-error': 'Internal server error',
    'forbidden': 'Refused',
    'invalid-path': 'Invalid path',
    'payload-too-large': 'Request body too large',
  };
  return res.status(status).json({ error: MESSAGES[code] || code, code });
}

// ── DB helper: read a meta value ──────────────────────────────────────────

function getMetaValue(key, fallback = null) {
  const row = db.select().from(meta).where(eq(meta.key, key)).get();
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function setMetaValue(key, value) {
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  db.insert(meta).values({ key, value: str })
    .onConflictDoUpdate({ target: meta.key, set: { value: str } })
    .run();
}

// ── DB helper: reconstruct a bill object from a row ───────────────────────
// The `data` column holds the ENTIRE original JSON. We parse it and return
// the full object so the API response is identical to the old JSON-file one.

function billRowToObj(row) {
  try { return JSON.parse(row.data); } catch { return {}; }
}

// ── DB helper: reconstruct a purchase/recurring object from a row ─────────

function purchaseRowToObj(row) {
  return {
    id: row.id,
    date: row.date,
    supplierName: row.supplierName,
    supplierAddress: row.supplierAddress,
    supplierGstin: row.supplierGstin,
    invoiceNumber: row.invoiceNumber,
    items: safeParseJSON(row.items, []),
    totalAmount: row.totalAmount,
    totalTax: row.totalTax,
    taxableAmount: row.taxableAmount,
    applyRoundOff: row.applyRoundOff,
    roundOff: row.roundOff,
    paymentStatus: row.paymentStatus,
    interstate: row.interstate,
    note: row.note,
  };
}

function productRowToObj(row) {
  return {
    id: row.id,
    name: row.name,
    hsn: row.hsn,
    purchasePrice: row.purchasePrice,
    sellingPrice: row.sellingPrice,
    rate: row.rate,
    mrp: row.mrp,
    taxPercent: row.taxPercent,
    cessPercent: row.cessPercent,
    unit: row.unit,
    stock: row.stock,
    description: row.description,
    pkg: row.pkg,
    batches: safeParseJSON(row.batches, []),
  };
}

function profileRowToObj(row) {
  return {
    id: row.id,
    businessName: row.businessName,
    address: row.address,
    city: row.city,
    pin: row.pin,
    state: row.state,
    country: row.country,
    gstin: row.gstin,
    pan: row.pan,
    email: row.email,
    phone: row.phone,
    bankName: row.bankName,
    accountNumber: row.accountNumber,
    ifsc: row.ifsc,
    swift: row.swift,
    logo: row.logo,
    signature: row.signature,
    upiId: row.upiId,
    googleClientId: row.googleClientId,
    googleDriveFolder: row.googleDriveFolder,
    paymentAccounts: safeParseJSON(row.paymentAccounts, []),
  };
}

function recurringRowToObj(row) {
  try { return JSON.parse(row.data); } catch { return {}; }
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ════════════════════════════════════════════════════════════════════════════
// BILLS
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/bills', (req, res) => {
  const rows = db.select().from(bills)
    .where(eq(bills.isTrashed, false))
    .orderBy(desc(bills.invoiceDate))
    .all();
  res.json(rows.map(billRowToObj));
});

app.post('/api/bills', (req, res) => {
  const bill = req.body;
  if (!bill || !bill.id) return res.status(400).json({ error: 'Bill must have an id' });

  // Encrypt snapshot bank details before storing and hashing in audit log
  if (bill.profile) {
    bill.profile = encryptProfileBankDetails(bill.profile);
  }

  const overwrite = req.query.overwrite === '1' || req.query.overwrite === 'true';
  let action = 'CREATE';

  try {
    db.transaction((tx) => {
      const existing = tx.select({ id: bills.id }).from(bills)
        .where(eq(bills.id, bill.id))
        .get();

      if (!overwrite && existing) {
        const err = new Error('A bill with this invoice number already exists');
        err.statusCode = 409;
        err.invoiceNumber = bill.id;
        throw err;
      }

      action = existing ? 'UPDATE' : 'CREATE';

      tx.insert(bills).values({
        id: bill.id,
        clientName: bill.clientName || '',
        invoiceNumber: bill.invoiceNumber || bill.id,
        invoiceDate: bill.invoiceDate || '',
        invoiceType: bill.invoiceType || 'tax-invoice',
        currency: bill.currency || 'INR',
        totalAmount: bill.totalAmount || 0,
        totalTaxAmount: bill.totalTaxAmount || 0,
        status: bill.status || 'unpaid',
        paidAmount: bill.paidAmount || 0,
        printedCount: bill.printedCount || 0,
        lastPrintedAt: bill.lastPrintedAt || null,
        generatedFrom: bill.generatedFrom || null,
        autoGenerated: !!bill.autoGenerated,
        autoGeneratedAt: bill.autoGeneratedAt || null,
        isTrashed: false,
        trashedAt: null,
        data: JSON.stringify(bill),
      }).onConflictDoUpdate({
        target: bills.id,
        set: {
          clientName: bill.clientName || '',
          invoiceNumber: bill.invoiceNumber || bill.id,
          invoiceDate: bill.invoiceDate || '',
          invoiceType: bill.invoiceType || 'tax-invoice',
          currency: bill.currency || 'INR',
          totalAmount: bill.totalAmount || 0,
          totalTaxAmount: bill.totalTaxAmount || 0,
          status: bill.status || 'unpaid',
          paidAmount: bill.paidAmount || 0,
          printedCount: bill.printedCount || 0,
          lastPrintedAt: bill.lastPrintedAt || null,
          generatedFrom: bill.generatedFrom || null,
          autoGenerated: !!bill.autoGenerated,
          autoGeneratedAt: bill.autoGeneratedAt || null,
          isTrashed: false,
          trashedAt: null,
          data: JSON.stringify(bill),
        },
      }).run();

      // Cryptographically log the audit event inside the same transaction
      logEvent('bill', bill.id, action, bill, tx);
    });

    broadcast(action === 'UPDATE' ? 'BILL_UPDATED' : 'BILL_CREATED', bill);
    res.json({ success: true });
  } catch (err) {
    if (err.statusCode === 409) {
      return res.status(409).json({
        error: err.message,
        invoiceNumber: err.invoiceNumber,
      });
    }
    errRes(res, 500, 'server-error', err);
  }
});

// Credit dependency check — scans all active bills for credit-applied
// payments referencing the given billId.
function findCreditDependents(billId) {
  try {
    const rows = db.select({ data: bills.data }).from(bills)
      .where(eq(bills.isTrashed, false))
      .all();
    const dependents = [];
    for (const row of rows) {
      const other = billRowToObj(row);
      if (!other || other.id === billId) continue;
      const payments = other.payments || other.data?.payments || [];
      for (const p of payments) {
        if (p?.mode !== 'credit-applied') continue;
        const sources = p?.creditSourceBillIds || [];
        if (sources.includes(billId)) {
          dependents.push({ id: other.id, invoiceNumber: other.invoiceNumber, amount: p.amount });
          break;
        }
      }
    }
    return dependents;
  } catch {
    return [];
  }
}

app.delete('/api/bills/:id', (req, res) => {
  const id = req.params.id;
  const existing = db.select({ id: bills.id }).from(bills).where(eq(bills.id, id)).get();
  if (!existing) return res.json({ success: true });

  // Credit dependency check
  const force = req.query.force === '1' || req.query.force === 'true';
  if (!force) {
    const dependents = findCreditDependents(id);
    if (dependents.length > 0) {
      return res.status(409).json({
        error: 'client-credit-dependency',
        message: 'This bill was used as a client-credit source on another invoice. Deleting it would leave that invoice paid via credit that no longer has a real source.',
        dependents,
      });
    }
  }

  try {
    db.transaction((tx) => {
      if (req.query.permanent === '1') {
        tx.delete(bills).where(eq(bills.id, id)).run();
        logEvent('bill', id, 'DELETE', { id, permanent: true }, tx);
      } else {
        const trashedAt = new Date().toISOString();
        tx.update(bills).set({
          isTrashed: true,
          trashedAt,
        }).where(eq(bills.id, id)).run();
        logEvent('bill', id, 'UPDATE', { id, isTrashed: true, trashedAt }, tx);
      }
    });

    broadcast('BILL_DELETED', { id, permanent: req.query.permanent === '1', trashed: req.query.permanent !== '1' });

    if (req.query.permanent === '1') {
      return res.json({ success: true, permanent: true });
    }
    res.json({ success: true, trashed: true });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PROFILE (singleton — stored in meta table with key 'profile')
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_PROFILE = {
  businessName: '', address: '', state: '', gstin: '', pan: '',
  email: '', phone: '', bankName: '', accountNumber: '', ifsc: '',
  logo: '', signature: '', upiId: '', googleClientId: '', googleDriveFolder: 'GST Billing Invoices',
};

app.get('/api/profile', (req, res) => {
  const raw = getMetaValue('profile', DEFAULT_PROFILE);
  res.json(decryptProfileBankDetails(raw));
});

app.post('/api/profile', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), (req, res) => {
  const encrypted = encryptProfileBankDetails(req.body);
  setMetaValue('profile', encrypted);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// CLIENTS
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/clients', (req, res) => {
  const rows = db.select().from(clients).orderBy(asc(clients.name)).all();
  res.json(rows.map(r => ({
    id: r.id, name: r.name, address: r.address, city: r.city, pin: r.pin,
    state: r.state, gstin: r.gstin, country: r.country, email: r.email,
    phone: r.phone, isSEZ: r.isSEZ, licence: r.licence,
  })));
});

app.post('/api/clients', (req, res) => {
  const client = req.body;
  if (!client.id) client.id = 'cli_' + Date.now();
  db.insert(clients).values({
    id: client.id,
    name: client.name || '',
    address: client.address || '',
    city: client.city || '',
    pin: client.pin || '',
    state: client.state || '',
    gstin: client.gstin || '',
    country: client.country || '',
    email: client.email || '',
    phone: client.phone || '',
    isSEZ: !!client.isSEZ,
    licence: client.licence || '',
  }).onConflictDoUpdate({
    target: clients.id,
    set: {
      name: client.name || '',
      address: client.address || '',
      city: client.city || '',
      pin: client.pin || '',
      state: client.state || '',
      gstin: client.gstin || '',
      country: client.country || '',
      email: client.email || '',
      phone: client.phone || '',
      isSEZ: !!client.isSEZ,
      licence: client.licence || '',
    },
  }).run();
  broadcast('CLIENT_UPDATED', client);
  res.json({ success: true, id: client.id });
});

app.delete('/api/clients/:id', (req, res) => {
  db.delete(clients).where(eq(clients.id, req.params.id)).run();
  broadcast('CLIENT_DELETED', { id: req.params.id });
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// TERMS TEMPLATES
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/templates', (req, res) => {
  let rows = db.select().from(templates).orderBy(asc(templates.name)).all();
  if (rows.length === 0) {
    // Seed default template
    const defaultTpl = {
      id: 'default',
      name: 'Standard Terms',
      content: '1. Payment is due within 15 days of invoice date unless otherwise agreed in writing.\n2. Interest @ 18% p.a. will be charged on overdue payments beyond the due date.\n3. The scope of work is limited to what is explicitly mentioned in the project proposal/agreement. Any additional requirements will be quoted and billed separately.\n4. All intellectual property and source code will be transferred to the client only upon receipt of full payment.\n5. We shall not be liable for any delays caused by incomplete or late submission of content, credentials, or approvals from the client\'s end.\n6. Any change requests after project approval may attract additional charges and revised timelines.\n7. This invoice is subject to the jurisdiction of courts at the service provider\'s registered location.\n8. E. & O.E.',
    };
    db.insert(templates).values(defaultTpl).run();
    rows = [defaultTpl];
  }
  res.json(rows.map(r => ({ id: r.id, name: r.name, content: r.content })));
});

app.post('/api/templates', (req, res) => {
  const tpl = req.body;
  if (!tpl.id) tpl.id = 'tpl_' + Date.now();
  db.insert(templates).values({
    id: tpl.id, name: tpl.name || '', content: tpl.content || '',
  }).onConflictDoUpdate({
    target: templates.id,
    set: { name: tpl.name || '', content: tpl.content || '' },
  }).run();
  res.json({ success: true, id: tpl.id });
});

app.delete('/api/templates/:id', (req, res) => {
  db.delete(templates).where(eq(templates.id, req.params.id)).run();
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// PRODUCTS / INVENTORY
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/products', (req, res) => {
  const rows = db.select().from(products).orderBy(asc(products.name)).all();
  res.json(rows.map(productRowToObj));
});

app.post('/api/products', (req, res) => {
  const product = req.body;
  if (!product.id) product.id = 'prod_' + Date.now();
  let action = 'CREATE';

  try {
    db.transaction((tx) => {
      const existing = tx.select({ id: products.id }).from(products).where(eq(products.id, product.id)).get();
      action = existing ? 'UPDATE' : 'CREATE';

      tx.insert(products).values({
        id: product.id,
        name: product.name || '',
        hsn: product.hsn || '',
        purchasePrice: product.purchasePrice || 0,
        sellingPrice: product.sellingPrice || 0,
        rate: product.rate || 0,
        mrp: product.mrp || 0,
        taxPercent: product.taxPercent || 0,
        cessPercent: product.cessPercent || 0,
        unit: product.unit || '',
        stock: product.stock || 0,
        description: product.description || '',
        pkg: product.pkg || '',
        batches: JSON.stringify(product.batches || []),
      }).onConflictDoUpdate({
        target: products.id,
        set: {
          name: product.name || '',
          hsn: product.hsn || '',
          purchasePrice: product.purchasePrice || 0,
          sellingPrice: product.sellingPrice || 0,
          rate: product.rate || 0,
          mrp: product.mrp || 0,
          taxPercent: product.taxPercent || 0,
          cessPercent: product.cessPercent || 0,
          unit: product.unit || '',
          stock: product.stock || 0,
          description: product.description || '',
          pkg: product.pkg || '',
          batches: JSON.stringify(product.batches || []),
        },
      }).run();

      logEvent('product', product.id, action, product, tx);
    });

    broadcast(action === 'UPDATE' ? 'PRODUCT_UPDATED' : 'PRODUCT_CREATED', product);
    res.json({ success: true, id: product.id });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

app.delete('/api/products/:id', (req, res) => {
  try {
    db.transaction((tx) => {
      tx.delete(products).where(eq(products.id, req.params.id)).run();
      logEvent('product', req.params.id, 'DELETE', { id: req.params.id }, tx);
    });
    broadcast('PRODUCT_DELETED', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// EXPENSES
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/expenses', (req, res) => {
  const rows = db.select().from(expenses).orderBy(desc(expenses.date)).all();
  res.json(rows.map(r => ({
    id: r.id, date: r.date, description: r.description, category: r.category,
    amount: r.amount, gstAmount: r.gstAmount, gstPercent: r.gstPercent,
    vendorName: r.vendorName, vendorGstin: r.vendorGstin, invoiceNo: r.invoiceNo,
    paymentMode: r.paymentMode, interstate: r.interstate, note: r.note,
  })));
});

app.post('/api/expenses', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), (req, res) => {
  const expense = req.body;
  if (!expense.id) expense.id = 'exp_' + Date.now();
  db.insert(expenses).values({
    id: expense.id,
    date: expense.date || '',
    description: expense.description || '',
    category: expense.category || '',
    amount: expense.amount || 0,
    gstAmount: expense.gstAmount || 0,
    gstPercent: expense.gstPercent || 0,
    vendorName: expense.vendorName || '',
    vendorGstin: expense.vendorGstin || '',
    invoiceNo: expense.invoiceNo || '',
    paymentMode: expense.paymentMode || '',
    interstate: !!expense.interstate,
    note: expense.note || '',
  }).onConflictDoUpdate({
    target: expenses.id,
    set: {
      date: expense.date || '',
      description: expense.description || '',
      category: expense.category || '',
      amount: expense.amount || 0,
      gstAmount: expense.gstAmount || 0,
      gstPercent: expense.gstPercent || 0,
      vendorName: expense.vendorName || '',
      vendorGstin: expense.vendorGstin || '',
      invoiceNo: expense.invoiceNo || '',
      paymentMode: expense.paymentMode || '',
      interstate: !!expense.interstate,
      note: expense.note || '',
    },
  }).run();
  res.json({ success: true, id: expense.id });
});

app.delete('/api/expenses/:id', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), (req, res) => {
  db.delete(expenses).where(eq(expenses.id, req.params.id)).run();
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// RECURRING INVOICES
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/recurring', (req, res) => {
  const rows = db.select().from(recurring).orderBy(asc(recurring.clientName)).all();
  res.json(rows.map(recurringRowToObj));
});

app.post('/api/recurring', (req, res) => {
  const item = req.body;
  if (!item.id) item.id = 'rec_' + Date.now();
  db.insert(recurring).values({
    id: item.id,
    active: item.active !== false,
    clientName: item.clientName || '',
    invoiceType: item.invoiceType || 'tax-invoice',
    nextDate: item.nextDate || '',
    frequency: item.frequency || 'monthly',
    data: JSON.stringify(item),
  }).onConflictDoUpdate({
    target: recurring.id,
    set: {
      active: item.active !== false,
      clientName: item.clientName || '',
      invoiceType: item.invoiceType || 'tax-invoice',
      nextDate: item.nextDate || '',
      frequency: item.frequency || 'monthly',
      data: JSON.stringify(item),
    },
  }).run();
  res.json({ success: true, id: item.id });
});

app.delete('/api/recurring/:id', (req, res) => {
  db.delete(recurring).where(eq(recurring.id, req.params.id)).run();
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// RECEIPTS / PAYMENT VOUCHERS
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/receipts', (req, res) => {
  const rows = db.select().from(receipts).orderBy(desc(receipts.date)).all();
  res.json(rows.map(r => ({
    id: r.id, date: r.date, receiptNo: r.receiptNo, clientName: r.clientName,
    clientAddress: r.clientAddress, amount: r.amount, paymentMode: r.paymentMode,
    referenceNo: r.referenceNo, againstInvoice: r.againstInvoice, note: r.note,
    currency: r.currency, source: r.source, billId: r.billId,
  })));
});

app.post('/api/receipts', (req, res) => {
  const receipt = req.body;
  if (!receipt.id) receipt.id = 'rcp_' + Date.now();
  db.insert(receipts).values({
    id: receipt.id,
    date: receipt.date || '',
    receiptNo: receipt.receiptNo || '',
    clientName: receipt.clientName || '',
    clientAddress: receipt.clientAddress || '',
    amount: receipt.amount || 0,
    paymentMode: receipt.paymentMode || '',
    referenceNo: receipt.referenceNo || '',
    againstInvoice: receipt.againstInvoice || '',
    note: receipt.note || '',
    currency: receipt.currency || 'INR',
    source: receipt.source || '',
    billId: receipt.billId || '',
  }).onConflictDoUpdate({
    target: receipts.id,
    set: {
      date: receipt.date || '',
      receiptNo: receipt.receiptNo || '',
      clientName: receipt.clientName || '',
      clientAddress: receipt.clientAddress || '',
      amount: receipt.amount || 0,
      paymentMode: receipt.paymentMode || '',
      referenceNo: receipt.referenceNo || '',
      againstInvoice: receipt.againstInvoice || '',
      note: receipt.note || '',
      currency: receipt.currency || 'INR',
      source: receipt.source || '',
      billId: receipt.billId || '',
    },
  }).run();
  res.json({ success: true, id: receipt.id });
});

app.delete('/api/receipts/:id', (req, res) => {
  db.delete(receipts).where(eq(receipts.id, req.params.id)).run();
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// PURCHASES (Purchase Bills for ITC)
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/purchases', (req, res) => {
  const rows = db.select().from(purchases).orderBy(desc(purchases.date)).all();
  res.json(rows.map(purchaseRowToObj));
});

app.post('/api/purchases', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), (req, res) => {
  const purchase = req.body;
  if (!purchase.id) purchase.id = 'pur_' + Date.now();
  let action = 'CREATE';

  try {
    db.transaction((tx) => {
      const existing = tx.select({ id: purchases.id }).from(purchases).where(eq(purchases.id, purchase.id)).get();
      action = existing ? 'UPDATE' : 'CREATE';

      tx.insert(purchases).values({
        id: purchase.id,
        date: purchase.date || '',
        supplierName: purchase.supplierName || '',
        supplierAddress: purchase.supplierAddress || '',
        supplierGstin: purchase.supplierGstin || '',
        invoiceNumber: purchase.invoiceNumber || '',
        totalAmount: purchase.totalAmount || 0,
        totalTax: purchase.totalTax || 0,
        taxableAmount: purchase.taxableAmount || 0,
        applyRoundOff: !!purchase.applyRoundOff,
        roundOff: purchase.roundOff || 0,
        paymentStatus: purchase.paymentStatus || 'Unpaid',
        interstate: !!purchase.interstate,
        note: purchase.note || '',
        items: JSON.stringify(purchase.items || []),
      }).onConflictDoUpdate({
        target: purchases.id,
        set: {
          date: purchase.date || '',
          supplierName: purchase.supplierName || '',
          supplierAddress: purchase.supplierAddress || '',
          supplierGstin: purchase.supplierGstin || '',
          invoiceNumber: purchase.invoiceNumber || '',
          totalAmount: purchase.totalAmount || 0,
          totalTax: purchase.totalTax || 0,
          taxableAmount: purchase.taxableAmount || 0,
          applyRoundOff: !!purchase.applyRoundOff,
          roundOff: purchase.roundOff || 0,
          paymentStatus: purchase.paymentStatus || 'Unpaid',
          interstate: !!purchase.interstate,
          note: purchase.note || '',
          items: JSON.stringify(purchase.items || []),
        },
      }).run();

      logEvent('purchase', purchase.id, action, purchase, tx);
    });

    broadcast(action === 'UPDATE' ? 'PURCHASE_UPDATED' : 'PURCHASE_CREATED', purchase);
    res.json({ success: true, id: purchase.id });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

app.delete('/api/purchases/:id', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), (req, res) => {
  try {
    db.transaction((tx) => {
      tx.delete(purchases).where(eq(purchases.id, req.params.id)).run();
      logEvent('purchase', req.params.id, 'DELETE', { id: req.params.id }, tx);
    });
    broadcast('PURCHASE_DELETED', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// BUSINESS PROFILES (multi-business)
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/profiles', (req, res) => {
  const rows = db.select().from(profiles).orderBy(asc(profiles.businessName)).all();
  res.json(rows.map(profileRowToObj).map(decryptProfileBankDetails));
});

app.post('/api/profiles', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), (req, res) => {
  const prof = req.body;
  if (!prof.id) prof.id = 'biz_' + Date.now();
  const encrypted = encryptProfileBankDetails(prof);

  db.insert(profiles).values({
    id: encrypted.id,
    businessName: encrypted.businessName || '',
    address: encrypted.address || '',
    city: encrypted.city || '',
    pin: encrypted.pin || '',
    state: encrypted.state || '',
    country: encrypted.country || '',
    gstin: encrypted.gstin || '',
    pan: encrypted.pan || '',
    email: encrypted.email || '',
    phone: encrypted.phone || '',
    bankName: encrypted.bankName || '',
    accountNumber: encrypted.accountNumber || '',
    ifsc: encrypted.ifsc || '',
    swift: encrypted.swift || '',
    logo: encrypted.logo || '',
    signature: encrypted.signature || '',
    upiId: encrypted.upiId || '',
    googleClientId: encrypted.googleClientId || '',
    googleDriveFolder: encrypted.googleDriveFolder || 'GST Billing Invoices',
    paymentAccounts: typeof encrypted.paymentAccounts === 'string' ? encrypted.paymentAccounts : JSON.stringify(encrypted.paymentAccounts || []),
  }).onConflictDoUpdate({
    target: profiles.id,
    set: {
      businessName: encrypted.businessName || '',
      address: encrypted.address || '',
      city: encrypted.city || '',
      pin: encrypted.pin || '',
      state: encrypted.state || '',
      country: encrypted.country || '',
      gstin: encrypted.gstin || '',
      pan: encrypted.pan || '',
      email: encrypted.email || '',
      phone: encrypted.phone || '',
      bankName: encrypted.bankName || '',
      accountNumber: encrypted.accountNumber || '',
      ifsc: encrypted.ifsc || '',
      swift: encrypted.swift || '',
      logo: encrypted.logo || '',
      signature: encrypted.signature || '',
      upiId: encrypted.upiId || '',
      googleClientId: encrypted.googleClientId || '',
      googleDriveFolder: encrypted.googleDriveFolder || 'GST Billing Invoices',
      paymentAccounts: typeof encrypted.paymentAccounts === 'string' ? encrypted.paymentAccounts : JSON.stringify(encrypted.paymentAccounts || []),
    },
  }).run();
  res.json({ success: true, id: encrypted.id });
});

app.delete('/api/profiles/:id', requireAuth, requireRole(['ADMIN']), (req, res) => {
  db.delete(profiles).where(eq(profiles.id, req.params.id)).run();
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// META (counters, settings)
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/meta/:key', (req, res) => {
  const val = getMetaValue(req.params.key, null);
  res.json({ value: val });
});

app.post('/api/meta/:key', (req, res) => {
  setMetaValue(req.params.key, req.body.value);
  res.json({ success: true });
});

// Atomic increment — better-sqlite3 is synchronous so this is race-free.
app.post('/api/meta/:key/increment', (req, res) => {
  // Wrap in a transaction for ACID safety
  const result = sqlite.transaction(() => {
    const row = db.select().from(meta).where(eq(meta.key, req.params.key)).get();
    const current = Number(row?.value || 0);
    const next = current + 1;
    setMetaValue(req.params.key, next);
    return next;
  })();
  res.json({ value: result });
});

// ════════════════════════════════════════════════════════════════════════════
// EXPORT / IMPORT
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/export', (req, res) => {
  const data = {
    bills:          db.select().from(bills).where(eq(bills.isTrashed, false)).all().map(billRowToObj),
    profile:        getMetaValue('profile', DEFAULT_PROFILE),
    clients:        db.select().from(clients).all().map(r => ({ id: r.id, name: r.name, address: r.address, city: r.city, pin: r.pin, state: r.state, gstin: r.gstin, country: r.country, email: r.email, phone: r.phone, isSEZ: r.isSEZ, licence: r.licence })),
    termsTemplates: db.select().from(templates).all().map(r => ({ id: r.id, name: r.name, content: r.content })),
    products:       db.select().from(products).all().map(productRowToObj),
    expenses:       db.select().from(expenses).all().map(r => ({ id: r.id, date: r.date, description: r.description, category: r.category, amount: r.amount, gstAmount: r.gstAmount, gstPercent: r.gstPercent, vendorName: r.vendorName, vendorGstin: r.vendorGstin, invoiceNo: r.invoiceNo, paymentMode: r.paymentMode, interstate: r.interstate, note: r.note })),
    recurring:      db.select().from(recurring).all().map(recurringRowToObj),
    receipts:       db.select().from(receipts).all().map(r => ({ id: r.id, date: r.date, receiptNo: r.receiptNo, clientName: r.clientName, clientAddress: r.clientAddress, amount: r.amount, paymentMode: r.paymentMode, referenceNo: r.referenceNo, againstInvoice: r.againstInvoice, note: r.note, currency: r.currency, source: r.source, billId: r.billId })),
    profiles:       db.select().from(profiles).all().map(profileRowToObj),
    purchases:      db.select().from(purchases).all().map(purchaseRowToObj),
    meta:           (() => {
      const obj = {};
      for (const row of db.select().from(meta).all()) {
        if (row.key === 'profile') continue; // exported separately above
        try { obj[row.key] = JSON.parse(row.value); } catch { obj[row.key] = row.value; }
      }
      return obj;
    })(),
    exportedAt: new Date().toISOString(),
  };
  res.json(data);
});

app.post('/api/import', (req, res) => {
  const data = req.body;
  const overwrite = req.query.overwrite === '1' || req.query.overwrite === 'true';
  const counts = {
    billCount: 0, billSkipped: 0,
    clientCount: 0, clientSkipped: 0,
    templateCount: 0, templateSkipped: 0,
    productCount: 0, productSkipped: 0,
    expenseCount: 0, expenseSkipped: 0,
    recurringCount: 0, recurringSkipped: 0,
    receiptCount: 0, receiptSkipped: 0,
    profileCount: 0, profileSkipped: 0,
    purchaseCount: 0, purchaseSkipped: 0,
  };

  // Wrap the entire import in a transaction for ACID compliance
  sqlite.transaction(() => {

    // Helper: upsert one entity, honouring the overwrite flag.
    const upsertEntity = (table, idField, entity, buildValues, countKey, skipKey) => {
      if (!entity?.id) return;
      if (!overwrite) {
        const existing = db.select({ id: idField }).from(table).where(eq(idField, entity.id)).get();
        if (existing) { counts[skipKey]++; return; }
      }
      db.insert(table).values(buildValues(entity))
        .onConflictDoUpdate({ target: idField, set: buildValues(entity) }).run();
      counts[countKey]++;
    };

    // Profile singleton
    if (data.profile) {
      if (overwrite || !getMetaValue('profile', null)) {
        setMetaValue('profile', data.profile);
      }
    }

    // Bills
    for (const b of (data.bills || [])) {
      if (!b?.id) continue;
      if (!overwrite) {
        const existing = db.select({ id: bills.id }).from(bills).where(eq(bills.id, b.id)).get();
        if (existing) { counts.billSkipped++; continue; }
      }
      db.insert(bills).values({
        id: b.id, clientName: b.clientName || '', invoiceNumber: b.invoiceNumber || b.id,
        invoiceDate: b.invoiceDate || '', invoiceType: b.invoiceType || 'tax-invoice',
        currency: b.currency || 'INR', totalAmount: b.totalAmount || 0,
        totalTaxAmount: b.totalTaxAmount || 0, status: b.status || 'unpaid',
        paidAmount: b.paidAmount || 0, printedCount: b.printedCount || 0,
        lastPrintedAt: b.lastPrintedAt || null, generatedFrom: b.generatedFrom || null,
        autoGenerated: !!b.autoGenerated, autoGeneratedAt: b.autoGeneratedAt || null,
        isTrashed: false, trashedAt: null, data: JSON.stringify(b),
      }).onConflictDoUpdate({
        target: bills.id,
        set: {
          clientName: b.clientName || '', invoiceNumber: b.invoiceNumber || b.id,
          invoiceDate: b.invoiceDate || '', invoiceType: b.invoiceType || 'tax-invoice',
          currency: b.currency || 'INR', totalAmount: b.totalAmount || 0,
          totalTaxAmount: b.totalTaxAmount || 0, status: b.status || 'unpaid',
          paidAmount: b.paidAmount || 0, printedCount: b.printedCount || 0,
          lastPrintedAt: b.lastPrintedAt || null, generatedFrom: b.generatedFrom || null,
          autoGenerated: !!b.autoGenerated, autoGeneratedAt: b.autoGeneratedAt || null,
          isTrashed: false, trashedAt: null, data: JSON.stringify(b),
        },
      }).run();
      counts.billCount++;
    }

    // Clients
    for (const c of (data.clients || [])) {
      upsertEntity(clients, clients.id, c, (e) => ({
        id: e.id, name: e.name || '', address: e.address || '', city: e.city || '',
        pin: e.pin || '', state: e.state || '', gstin: e.gstin || '', country: e.country || '',
        email: e.email || '', phone: e.phone || '', isSEZ: !!e.isSEZ, licence: e.licence || '',
      }), 'clientCount', 'clientSkipped');
    }

    // Templates
    for (const t of (data.termsTemplates || [])) {
      upsertEntity(templates, templates.id, t, (e) => ({
        id: e.id, name: e.name || '', content: e.content || '',
      }), 'templateCount', 'templateSkipped');
    }

    // Products
    for (const p of (data.products || [])) {
      upsertEntity(products, products.id, p, (e) => ({
        id: e.id, name: e.name || '', hsn: e.hsn || '',
        purchasePrice: e.purchasePrice || 0, sellingPrice: e.sellingPrice || 0,
        rate: e.rate || 0, mrp: e.mrp || 0, taxPercent: e.taxPercent || 0,
        cessPercent: e.cessPercent || 0, unit: e.unit || '', stock: e.stock || 0,
        description: e.description || '', pkg: e.pkg || '',
        batches: JSON.stringify(e.batches || []),
      }), 'productCount', 'productSkipped');
    }

    // Expenses
    for (const e of (data.expenses || [])) {
      upsertEntity(expenses, expenses.id, e, (x) => ({
        id: x.id, date: x.date || '', description: x.description || '',
        category: x.category || '', amount: x.amount || 0, gstAmount: x.gstAmount || 0,
        gstPercent: x.gstPercent || 0, vendorName: x.vendorName || '',
        vendorGstin: x.vendorGstin || '', invoiceNo: x.invoiceNo || '',
        paymentMode: x.paymentMode || '', interstate: !!x.interstate, note: x.note || '',
      }), 'expenseCount', 'expenseSkipped');
    }

    // Recurring
    for (const r of (data.recurring || [])) {
      upsertEntity(recurring, recurring.id, r, (e) => ({
        id: e.id, active: e.active !== false, clientName: e.clientName || '',
        invoiceType: e.invoiceType || 'tax-invoice', nextDate: e.nextDate || '',
        frequency: e.frequency || 'monthly', data: JSON.stringify(e),
      }), 'recurringCount', 'recurringSkipped');
    }

    // Receipts
    for (const r of (data.receipts || [])) {
      upsertEntity(receipts, receipts.id, r, (e) => ({
        id: e.id, date: e.date || '', receiptNo: e.receiptNo || '',
        clientName: e.clientName || '', clientAddress: e.clientAddress || '',
        amount: e.amount || 0, paymentMode: e.paymentMode || '',
        referenceNo: e.referenceNo || '', againstInvoice: e.againstInvoice || '',
        note: e.note || '', currency: e.currency || 'INR', source: e.source || '',
        billId: e.billId || '',
      }), 'receiptCount', 'receiptSkipped');
    }

    // Profiles (multi-business)
    for (const p of (data.profiles || [])) {
      upsertEntity(profiles, profiles.id, p, (e) => ({
        id: e.id, businessName: e.businessName || '', address: e.address || '',
        city: e.city || '', pin: e.pin || '', state: e.state || '',
        country: e.country || '', gstin: e.gstin || '', pan: e.pan || '',
        email: e.email || '', phone: e.phone || '', bankName: e.bankName || '',
        accountNumber: e.accountNumber || '', ifsc: e.ifsc || '', swift: e.swift || '',
        logo: e.logo || '', signature: e.signature || '', upiId: e.upiId || '',
        googleClientId: e.googleClientId || '',
        googleDriveFolder: e.googleDriveFolder || 'GST Billing Invoices',
        paymentAccounts: JSON.stringify(e.paymentAccounts || []),
      }), 'profileCount', 'profileSkipped');
    }

    // Purchases
    for (const p of (data.purchases || [])) {
      upsertEntity(purchases, purchases.id, p, (e) => ({
        id: e.id, date: e.date || '', supplierName: e.supplierName || '',
        supplierAddress: e.supplierAddress || '', supplierGstin: e.supplierGstin || '',
        invoiceNumber: e.invoiceNumber || '', totalAmount: e.totalAmount || 0,
        totalTax: e.totalTax || 0, taxableAmount: e.taxableAmount || 0,
        applyRoundOff: !!e.applyRoundOff, roundOff: e.roundOff || 0,
        paymentStatus: e.paymentStatus || 'Unpaid', interstate: !!e.interstate,
        note: e.note || '', items: JSON.stringify(e.items || []),
      }), 'purchaseCount', 'purchaseSkipped');
    }

    // Meta
    if (data.meta) {
      if (overwrite || db.select().from(meta).all().length === 0) {
        for (const [key, value] of Object.entries(data.meta)) {
          setMetaValue(key, value);
        }
      }
    }

    // Post-import counter reconciliation (same logic as original)
    const allBills = db.select({ data: bills.data }).from(bills)
      .where(eq(bills.isTrashed, false)).all();
    const maxByPrefix = {};
    for (const row of allBills) {
      const bill = billRowToObj(row);
      const num = String(bill?.invoiceNumber || bill?.id || '');
      const m = num.match(/^([A-Z]+)[\W_].*?(\d+)\s*$/i);
      if (!m) continue;
      const prefix = m[1].toUpperCase();
      const suffix = parseInt(m[2], 10);
      if (!Number.isFinite(suffix)) continue;
      if (!maxByPrefix[prefix] || suffix > maxByPrefix[prefix]) maxByPrefix[prefix] = suffix;
    }
    for (const [prefix, maxNum] of Object.entries(maxByPrefix)) {
      const key = `counter_${prefix}`;
      const existing = Number(getMetaValue(key, 0));
      if (maxNum > existing) setMetaValue(key, maxNum);
    }
  })();

  res.json({ ...counts, hasProfile: !!data.profile });
});

// ════════════════════════════════════════════════════════════════════════════
// Save PDF to local folder (file system — NOT migrated to SQLite)
// ════════════════════════════════════════════════════════════════════════════

const INVOICES_DIR = path.join(__dirname, 'Saved Invoices');
if (!fs.existsSync(INVOICES_DIR)) fs.mkdirSync(INVOICES_DIR, { recursive: true });

app.post('/api/save-pdf', express.raw({ type: 'application/pdf', limit: '20mb' }), (req, res) => {
  try {
    const rawName = req.query.name || `invoice-${Date.now()}.pdf`;
    const safeClient = safePathSegment(req.query.client, 'General');
    const safeMonth = safePathSegment(req.query.month, new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }));
    let safeName = safePathSegment(rawName, `invoice-${Date.now()}.pdf`);
    if (!safeName.toLowerCase().endsWith('.pdf')) safeName += '.pdf';

    const folderPath = path.join(INVOICES_DIR, safeClient, safeMonth);
    const filePath = path.join(folderPath, safeName);
    if (!isPathInside(filePath, INVOICES_DIR)) return errRes(res, 400, 'invalid-path');

    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    fs.writeFileSync(filePath, req.body);
    res.json({ saved: true, relPath: path.relative(__dirname, filePath).split(path.sep).join('/') });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Move saved PDF to Trash (file system operation)
// ════════════════════════════════════════════════════════════════════════════

const TRASH_DIR = path.join(__dirname, 'Trash');
if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });

app.post('/api/trash-pdf', express.json(), (req, res) => {
  try {
    const { fileName, clientName } = req.body;
    if (!fileName) return errRes(res, 400, 'bad-request');

    const safeClient = safePathSegment(clientName, 'General');
    const safeName = safePathSegment(fileName, 'Untitled.pdf');

    const clientDir = path.join(INVOICES_DIR, safeClient);
    if (!isPathInside(clientDir, INVOICES_DIR)) return errRes(res, 400, 'invalid-path');
    let found = false;

    if (fs.existsSync(clientDir)) {
      const months = fs.readdirSync(clientDir).filter(f => {
        try { return fs.statSync(path.join(clientDir, f)).isDirectory(); } catch { return false; }
      });
      for (const month of months) {
        const filePath = path.join(clientDir, month, safeName);
        if (!isPathInside(filePath, INVOICES_DIR)) continue;
        if (fs.existsSync(filePath)) {
          const trashPath = path.join(TRASH_DIR, safeClient, month);
          const trashFile = path.join(trashPath, safeName);
          if (!isPathInside(trashFile, TRASH_DIR)) return errRes(res, 400, 'invalid-path');
          if (!fs.existsSync(trashPath)) fs.mkdirSync(trashPath, { recursive: true });
          try { fs.renameSync(filePath, trashFile); }
          catch { fs.copyFileSync(filePath, trashFile); fs.unlinkSync(filePath); }
          found = true;
          break;
        }
      }
    }

    if (!found) {
      const flatPath = path.join(INVOICES_DIR, safeName);
      if (isPathInside(flatPath, INVOICES_DIR) && fs.existsSync(flatPath)) {
        const trashPath = path.join(TRASH_DIR, safeClient);
        const trashFile = path.join(trashPath, safeName);
        if (isPathInside(trashFile, TRASH_DIR)) {
          if (!fs.existsSync(trashPath)) fs.mkdirSync(trashPath, { recursive: true });
          try { fs.renameSync(flatPath, trashFile); }
          catch { fs.copyFileSync(flatPath, trashFile); fs.unlinkSync(flatPath); }
          found = true;
        }
      }
    }

    res.json({ trashed: found });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Version check
// ════════════════════════════════════════════════════════════════════════════

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));

app.get('/api/version', (req, res) => {
  res.json({ current: pkg.version });
});

app.get('/api/check-update', async (req, res) => {
  res.json({
    current: pkg.version, latest: pkg.version, updateAvailable: false,
    releaseNotes: null, releaseUrl: null, releasePublishedAt: null, releaseTag: null,
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Feature #7: Plugin Architecture Loader
// ════════════════════════════════════════════════════════════════════════════

const loadedPlugins = [];
const PLUGINS_DIR = path.join(__dirname, 'plugins');
const USER_PLUGINS_DIR = path.join(DATA_DIR, 'plugins');

async function loadPlugins() {
  const dirsToScan = [PLUGINS_DIR];
  if (USER_PLUGINS_DIR !== PLUGINS_DIR) {
    dirsToScan.push(USER_PLUGINS_DIR);
  }

  for (const dir of dirsToScan) {
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      continue;
    }

    let files = [];
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    } catch (err) {
      console.warn(`[plugins] Failed to read directory ${dir}:`, err.message);
      continue;
    }

    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        const fileUrl = pathToFileURL(fullPath).href;
        const imported = await import(fileUrl);
        const plugin = imported.default || imported;

        if (!plugin || typeof plugin !== 'object') {
          console.warn(`[plugins] Skipping invalid plugin in ${file}: does not export an object.`);
          continue;
        }

        const name = plugin.name || path.basename(file, '.js');
        if (loadedPlugins.some(p => p.id === name || p.name === name)) {
          continue;
        }

        if (typeof plugin.registerRoutes === 'function') {
          plugin.registerRoutes(app, {
            db, sqlite, bills, clients, products, purchases, expenses, receipts, profiles,
          });
          console.log(`  [Plugin Loaded] ${plugin.displayName || name} (v${plugin.version || '1.0.0'}) from ${file}`);
        } else {
          console.warn(`[plugins] Plugin "${name}" has no registerRoutes method.`);
        }

        loadedPlugins.push({
          id: name,
          name: plugin.displayName || plugin.name || name,
          description: plugin.description || 'Custom extension plugin.',
          version: plugin.version || '1.0.0',
          author: plugin.author || 'Custom',
          endpoints: plugin.endpoints || [],
          ui: plugin.ui || null,
        });
      } catch (pluginErr) {
        console.error(`[plugins] Failed to load plugin "${file}":`, pluginErr);
      }
    }
  }
}

app.get('/api/plugins', (req, res) => {
  res.json({ plugins: loadedPlugins });
});

// ════════════════════════════════════════════════════════════════════════════
// Serve production build
// ════════════════════════════════════════════════════════════════════════════

const distPath = path.join(__dirname, 'dist');
const indexPath = path.join(distPath, 'index.html');
app.use(express.static(distPath, { fallthrough: true }));

// ════════════════════════════════════════════════════════════════════════════
// Backups — now simplified to SQLite file copy
// ════════════════════════════════════════════════════════════════════════════

const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function todayLocalIso() {
  return new Date().toLocaleDateString('sv-SE');
}

function runDailyBackup() {
  try {
    ensureDir(BACKUPS_DIR);
    const today = todayLocalIso();
    const target = path.join(BACKUPS_DIR, `${today}.sqlite`);
    if (fs.existsSync(target)) return;

    // Use SQLite's backup API — safe even while the DB is in use (WAL mode).
    // better-sqlite3's .backup() is async; we use the synchronous file-copy
    // approach after checkpointing WAL so the copy is consistent.
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(DB_PATH, target);

    console.log(`[backup] Daily snapshot saved: ${target}`);

    // Retention: keep last 30 backups
    const all = fs.readdirSync(BACKUPS_DIR)
      .filter(n => /^\d{4}-\d{2}-\d{2}\.sqlite$/.test(n))
      .sort();
    while (all.length > 30) {
      const oldest = all.shift();
      try { fs.unlinkSync(path.join(BACKUPS_DIR, oldest)); } catch { /* ignore */ }
    }
  } catch (err) {
    console.warn('[backup] Daily backup failed:', err.message);
  }
}

setTimeout(runDailyBackup, 5000);
setInterval(runDailyBackup, 24 * 60 * 60 * 1000);

// Backup management endpoints

app.get('/api/backups', (req, res) => {
  try {
    ensureDir(BACKUPS_DIR);
    const list = fs.readdirSync(BACKUPS_DIR)
      .filter(n => /^\d{4}-\d{2}-\d{2}\.sqlite$/.test(n))
      .sort().reverse()
      .map(name => {
        const stat = fs.statSync(path.join(BACKUPS_DIR, name));
        return { date: name.replace('.sqlite', ''), createdAt: stat.mtime.toISOString() };
      });
    res.json(list);
  } catch (err) { errRes(res, 500, 'server-error', err); }
});

app.delete('/api/backups/:date', (req, res) => {
  try {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errRes(res, 400, 'bad-request');
    const [y, m, d] = date.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) {
      return errRes(res, 400, 'bad-request');
    }
    const backupFile = path.join(BACKUPS_DIR, `${date}.sqlite`);
    if (!isPathInside(backupFile, BACKUPS_DIR)) return errRes(res, 400, 'invalid-path');
    if (!fs.existsSync(backupFile)) return errRes(res, 404, 'not-found');
    fs.unlinkSync(backupFile);
    res.json({ success: true, date });
  } catch (err) { errRes(res, 500, 'server-error', err); }
});

app.post('/api/backups/:date/restore', (req, res) => {
  try {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errRes(res, 400, 'bad-request');
    const backupFile = path.join(BACKUPS_DIR, `${date}.sqlite`);
    if (!isPathInside(backupFile, BACKUPS_DIR)) return errRes(res, 400, 'invalid-path');
    if (!fs.existsSync(backupFile)) return errRes(res, 404, 'not-found');

    const [y, m, d] = date.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) {
      return errRes(res, 400, 'bad-request');
    }

    // Create a pre-restore snapshot
    const preRestorePath = path.join(BACKUPS_DIR, `pre-restore-${Date.now()}.sqlite`);
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(DB_PATH, preRestorePath);

    try {
      // Close current DB, copy backup over, re-open would require restart.
      // Instead, we do an in-process restore: read the backup DB and copy
      // all tables into the current DB inside a transaction.
      const backupDb = new Database(backupFile, { readonly: true });

      sqlite.transaction(() => {
        // Clear all tables
        for (const table of ['bills', 'clients', 'products', 'purchases', 'expenses',
                             'receipts', 'profiles', 'templates', 'recurring', 'meta']) {
          sqlite.exec(`DELETE FROM ${table}`);
        }

        // Copy from backup
        for (const table of ['bills', 'clients', 'products', 'purchases', 'expenses',
                             'receipts', 'profiles', 'templates', 'recurring', 'meta']) {
          const rows = backupDb.prepare(`SELECT * FROM ${table}`).all();
          if (rows.length === 0) continue;
          const cols = Object.keys(rows[0]);
          const placeholders = cols.map(() => '?').join(', ');
          const insert = sqlite.prepare(
            `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`
          );
          for (const row of rows) {
            insert.run(...cols.map(c => row[c]));
          }
        }
      })();

      backupDb.close();

      // Success — remove pre-restore snapshot
      try { fs.unlinkSync(preRestorePath); } catch { /* keep for safety */ }
      res.json({ success: true, restored: date });
    } catch (restoreErr) {
      // Rollback: restore from pre-restore snapshot
      try {
        const rollbackDb = new Database(preRestorePath, { readonly: true });
        sqlite.transaction(() => {
          for (const table of ['bills', 'clients', 'products', 'purchases', 'expenses',
                               'receipts', 'profiles', 'templates', 'recurring', 'meta']) {
            sqlite.exec(`DELETE FROM ${table}`);
            const rows = rollbackDb.prepare(`SELECT * FROM ${table}`).all();
            if (rows.length === 0) continue;
            const cols = Object.keys(rows[0]);
            const placeholders = cols.map(() => '?').join(', ');
            const insert = sqlite.prepare(
              `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`
            );
            for (const row of rows) {
              insert.run(...cols.map(c => row[c]));
            }
          }
        })();
        rollbackDb.close();
      } catch { /* if rollback fails, pre-restore file stays for manual recovery */ }
      errRes(res, 500, 'server-error', restoreErr);
    }
  } catch (err) { errRes(res, 500, 'server-error', err); }
});

let __lastBackupNowMs = 0;
app.post('/api/backups/now', (req, res) => {
  const now = Date.now();
  if (now - __lastBackupNowMs < 5000) {
    return errRes(res, 429, 'server-error');
  }
  __lastBackupNowMs = now;
  runDailyBackup();
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
// Trash bin (soft-deleted invoices — now in the bills table with isTrashed=1)
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/trash', (req, res) => {
  try {
    const rows = db.select().from(bills).where(eq(bills.isTrashed, true)).all();
    res.json(rows.map(row => {
      const obj = billRowToObj(row);
      obj._trashedAt = row.trashedAt || null;
      return obj;
    }));
  } catch (err) { errRes(res, 500, 'server-error', err); }
});

app.post('/api/trash/:id/restore', (req, res) => {
  try {
    const row = db.select({ id: bills.id }).from(bills)
      .where(eq(bills.id, req.params.id))
      .get();
    if (!row) return res.status(404).json({ error: 'Not in trash' });

    db.transaction((tx) => {
      tx.update(bills).set({
        isTrashed: false,
        trashedAt: null,
      }).where(eq(bills.id, req.params.id)).run();

      logEvent('bill', req.params.id, 'UPDATE', { id: req.params.id, isTrashed: false, restored: true }, tx);
    });

    broadcast('BILL_UPDATED', { id: req.params.id, isTrashed: false, restored: true });
    res.json({ success: true });
  } catch (err) { errRes(res, 500, 'server-error', err); }
});

app.delete('/api/trash/:id', (req, res) => {
  try {
    db.transaction((tx) => {
      tx.delete(bills).where(eq(bills.id, req.params.id)).run();
      logEvent('bill', req.params.id, 'DELETE', { id: req.params.id, permanent: true, fromTrash: true }, tx);
    });
    broadcast('BILL_DELETED', { id: req.params.id, permanent: true, fromTrash: true });
    res.json({ success: true });
  } catch (err) { errRes(res, 500, 'server-error', err); }
});

// Auto-purge trashed bills older than 30 days
function purgeOldTrash() {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    // Delete trashed bills whose trashedAt is older than 30 days
    sqlite.exec(`DELETE FROM bills WHERE is_trashed = 1 AND trashed_at IS NOT NULL AND trashed_at < '${cutoff}'`);
  } catch { /* ignore */ }
}
setInterval(purgeOldTrash, 24 * 60 * 60 * 1000);

// ════════════════════════════════════════════════════════════════════════════
// Cryptographic Audit Trail Verification
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/audit/verify', (req, res) => {
  try {
    const result = verifyAuditChain(db);
    res.json(result);
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// AI-Powered GSTR-2B Reconciliation
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/recon/gstr2b', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), upload.single('file'), (req, res) => {
  try {
    let rawJson = null;

    if (req.file) {
      const content = req.file.buffer.toString('utf-8');
      try {
        rawJson = JSON.parse(content);
      } catch (err) {
        return res.status(400).json({ error: 'Uploaded file is not valid JSON' });
      }
    } else if (req.body) {
      if (typeof req.body === 'string') {
        try {
          rawJson = JSON.parse(req.body);
        } catch (err) {
          return res.status(400).json({ error: 'Invalid JSON payload' });
        }
      } else if (typeof req.body === 'object') {
        // In case express parsed JSON body or form-data body string
        if (req.body.gstr2b) {
          rawJson = typeof req.body.gstr2b === 'string' ? JSON.parse(req.body.gstr2b) : req.body.gstr2b;
        } else {
          rawJson = req.body;
        }
      }
    }

    if (!rawJson || (typeof rawJson === 'object' && Object.keys(rawJson).length === 0)) {
      return res.status(400).json({ error: 'No GSTR-2B data provided. Upload a JSON file or post JSON body.' });
    }

    // Retrieve local purchases from SQLite
    const purchaseRows = db.select().from(purchases).all();
    const localPurchases = purchaseRows.map((p) => {
      let parsedData = {};
      try {
        parsedData = typeof p.data === 'string' ? JSON.parse(p.data) : (p.data || {});
      } catch { /* ignore */ }
      return {
        id: p.id,
        supplierName: p.supplierName || parsedData.supplierName || '',
        supplierGstin: p.supplierGstin || parsedData.supplierGstin || '',
        invoiceNumber: p.invoiceNumber || parsedData.invoiceNumber || '',
        date: p.date || parsedData.date || '',
        taxableAmount: p.taxableAmount || parsedData.taxableAmount || 0,
        totalTax: p.totalTax || parsedData.totalTax || 0,
        totalAmount: p.totalAmount || parsedData.totalAmount || 0,
        paymentStatus: p.paymentStatus || parsedData.paymentStatus || 'Unpaid',
        items: p.items || parsedData.items || [],
        note: p.note || parsedData.note || '',
      };
    });

    const reconciliation = reconcileGstr2b(rawJson, localPurchases);
    res.json({
      success: true,
      ...reconciliation,
    });
  } catch (err) {
    console.error('Reconciliation error:', err);
    errRes(res, 500, 'server-error', err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Health check
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => {
  let errorsTail = '';
  try {
    if (fs.existsSync(ERRORS_LOG)) {
      const stat = fs.statSync(ERRORS_LOG);
      const fd = fs.openSync(ERRORS_LOG, 'r');
      const len = Math.min(stat.size, 4096);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, Math.max(0, stat.size - len));
      fs.closeSync(fd);
      errorsTail = buf.toString('utf-8');
    }
  } catch { /* ignore */ }
  res.json({
    ok: true,
    version: process.env.npm_package_version || 'unknown',
    uptimeSec: Math.round(process.uptime()),
    pid: process.pid,
    hasRecentErrors: !!errorsTail.trim(),
    errorsTail,
    storage: 'sqlite',
  });
});

// Load plugins before the SPA catch-all so plugin routes are registered first
await loadPlugins();

// ════════════════════════════════════════════════════════════════════════════
// SPA catch-all
// ════════════════════════════════════════════════════════════════════════════

app.get('{*path}', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'No such endpoint' });
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return servePlaceholder(req, res);
});

function servePlaceholder(req, res) {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'No such endpoint' });
  res.status(503).send(`<!doctype html>
<html><head><meta charset="utf-8"><title>ArthSutra — building…</title>
<meta http-equiv="refresh" content="3">
<style>
  body { font-family: -apple-system, Segoe UI, Inter, sans-serif; max-width: 560px;
         margin: 6rem auto; padding: 2rem; color: #1e293b; line-height: 1.55; }
  h1 { color: #1e40af; margin: 0 0 0.5rem; }
  code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #cbd5e1;
             border-top-color: #1e40af; border-radius: 50%; animation: spin 1s linear infinite;
             vertical-align: middle; margin-right: 6px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .muted { color: #64748b; font-size: 0.9em; }
  .box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 0.85rem 1rem; border-radius: 8px; margin-top: 1rem; }
</style></head>
<body>
  <h1>ArthSutra</h1>
  <p><span class="spinner"></span> The app is still building. This page refreshes every 3 seconds.</p>
  <div class="box">
    <p style="margin:0 0 0.5rem"><strong>Local install?</strong></p>
    <p style="margin:0">If you started the server but never built the frontend, run:</p>
    <p style="margin:0.5rem 0 0"><code>npm run build</code></p>
    <p class="muted" style="margin:0.5rem 0 0">…then reload this page.</p>
  </div>
  <div class="box">
    <p style="margin:0 0 0.5rem"><strong>StackBlitz / Codespaces?</strong></p>
    <p style="margin:0">First-time build takes ~30 seconds inside browser sandboxes. Sit tight.</p>
  </div>
  <p class="muted" style="margin-top:1.5rem">Server is running on port ${req.socket.localPort} · API health: <a href="/api/version">/api/version</a></p>
</body></html>`);
}

// ════════════════════════════════════════════════════════════════════════════
// Global error handler
// ════════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = Number(err && (err.status || err.statusCode)) || 500;
  let code = 'server-error';
  if (status === 413) code = 'payload-too-large';
  else if (status === 400) code = 'bad-request';
  else if (status === 404) code = 'not-found';
  errRes(res, status, code, err);
});

// ════════════════════════════════════════════════════════════════════════════
// Error log + graceful shutdown
// ════════════════════════════════════════════════════════════════════════════

const ERRORS_LOG_MAX = 200 * 1024;
function rotateErrorsIfLarge() {
  try {
    if (!fs.existsSync(ERRORS_LOG)) return;
    const stat = fs.statSync(ERRORS_LOG);
    if (stat.size <= ERRORS_LOG_MAX) return;
    const fd = fs.openSync(ERRORS_LOG, 'r');
    const keep = Buffer.alloc(ERRORS_LOG_MAX);
    fs.readSync(fd, keep, 0, ERRORS_LOG_MAX, stat.size - ERRORS_LOG_MAX);
    fs.closeSync(fd);
    const s = keep.toString('utf-8');
    const nl = s.indexOf('\n');
    const tmp = ERRORS_LOG + '.tmp';
    fs.writeFileSync(tmp, (nl >= 0 ? s.slice(nl + 1) : s), 'utf-8');
    fs.renameSync(tmp, ERRORS_LOG);
  } catch { /* ignore */ }
}

function logFatal(err, source = 'fatal') {
  try {
    rotateErrorsIfLarge();
    const ts = new Date().toISOString();
    const msg = err && err.stack ? err.stack : String(err);
    fs.appendFileSync(ERRORS_LOG, `[${ts}] [${source}] ${msg}\n`, 'utf-8');
  } catch { /* nothing we can do */ }
}

process.on('uncaughtException', (err) => logFatal(err, 'uncaughtException'));
process.on('unhandledRejection', (err) => logFatal(err, 'unhandledRejection'));

// ════════════════════════════════════════════════════════════════════════════
// Recurring invoices — auto-fire on boot + daily interval
// ════════════════════════════════════════════════════════════════════════════

function advanceDate(dateStr, frequency, interval) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const n = Math.max(1, parseInt(interval, 10) || 1);
  if (frequency === 'weekly') d.setDate(d.getDate() + 7 * n);
  else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3 * n);
  else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + n);
  else d.setMonth(d.getMonth() + n);
  return d.toISOString().split('T')[0];
}

function nextInvoiceNumber(prefix, _settings = {}) {
  // ACID: runs inside the caller's transaction
  const metaRow = db.select().from(meta).where(eq(meta.key, `counter_${prefix}`)).get();
  const settingsRow = db.select().from(meta).where(eq(meta.key, 'invoiceNumberSettings')).get();
  const cfg = {
    format: 'branded', brandPrefix: '', separator: '/', showFinYear: true, padDigits: 4,
    ...(settingsRow ? safeParseJSON(settingsRow.value, {}) : {}),
  };
  const next = (Number(metaRow?.value) || 0) + 1;
  setMetaValue(`counter_${prefix}`, next);

  if (cfg.format === 'random') {
    return `${cfg.brandPrefix || prefix}${cfg.separator}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  }
  const sep = cfg.separator || '/';
  const pfx = cfg.brandPrefix || prefix;
  const padded = String(next).padStart(cfg.padDigits || 4, '0');
  if (cfg.showFinYear) {
    const y = new Date().getFullYear();
    return `${pfx}${sep}${y}-${String(y + 1).slice(-2)}${sep}${padded}`;
  }
  return `${pfx}${sep}${padded}`;
}

async function processDueRecurring() {
  const today = new Date().toISOString().split('T')[0];
  const rows = db.select().from(recurring)
    .where(eq(recurring.active, true))
    .all();
  let fired = 0;
  const yieldToLoop = () => new Promise(r => setImmediate(r));

  for (const row of rows) {
    await yieldToLoop();
    const tpl = recurringRowToObj(row);
    if (!tpl || !tpl.active) continue;
    if (!tpl.nextDate || tpl.nextDate > today) continue;
    if (tpl.endMode === 'onDate' && tpl.endDate && today > tpl.endDate) continue;
    if (tpl.endMode === 'afterN' && tpl.maxOccurrences && (tpl.occurrencesCreated || 0) >= tpl.maxOccurrences) continue;

    try {
      // Wrap each recurring fire in a transaction: create bill + update template + bump counter
      sqlite.transaction(() => {
        // Resolve live profile
        const profileRows = db.select().from(profiles).all();
        let profile = profileRows.find(p => p.id && tpl.profileId && p.id === tpl.profileId);
        if (!profile) profile = profileRows.find(p => (p.businessName || '') === tpl.profileBusinessName);
        profile = profile ? profileRowToObj(profile) : getMetaValue('profile', {});

        const prefix = (tpl.invoiceType === 'proforma' ? 'EST'
                     : tpl.invoiceType === 'credit-note' ? 'CN'
                     : tpl.invoiceType === 'bill-of-supply' ? 'BOS'
                     : tpl.invoiceType === 'composition' ? 'COMP'
                     : tpl.invoiceType === 'delivery-challan' ? 'DC'
                     : 'INV');
        const invoiceNumber = nextInvoiceNumber(prefix);
        const invoiceDate = today;

        const client = {
          name: tpl.clientName,
          state: tpl.clientState,
          gstin: tpl.clientGstin,
          isSEZ: !!tpl.isSEZ,
        };
        const details = { placeOfSupply: tpl.placeOfSupply };
        const invoiceOptions = tpl.invoiceOptions || {};
        const totals = computeInvoiceTotals({
          items: tpl.items || [],
          profile,
          client,
          details,
          showGST: invoiceOptions.showGST !== false,
          taxInclusive: !!tpl.taxInclusive,
          invoiceOptions,
        });

        const bill = {
          id: invoiceNumber,
          clientName: tpl.clientName,
          invoiceNumber,
          invoiceDate,
          invoiceType: tpl.invoiceType || 'tax-invoice',
          currency: (tpl.invoiceOptions && tpl.invoiceOptions.currency) || 'INR',
          totalAmount: totals.total,
          totalTaxAmount: totals.totalTaxAmount,
          status: 'unpaid',
          paidAmount: 0,
          payments: [],
          generatedFrom: tpl.id,
          autoGenerated: true,
          autoGeneratedAt: new Date().toISOString(),
          data: {
            profile,
            client: {
              name: tpl.clientName, state: tpl.clientState, gstin: tpl.clientGstin,
              address: tpl.clientAddress, country: tpl.clientCountry, city: tpl.clientCity,
              pin: tpl.clientPin, email: tpl.clientEmail, phone: tpl.clientPhone,
              isSEZ: tpl.isSEZ,
            },
            details: { invoiceNumber, invoiceDate, dueDate: '', placeOfSupply: '' },
            items: (tpl.items || []).map(i => ({
              ...i,
              name: i.name || i.description || '',
            })),
            totals,
            invoiceType: tpl.invoiceType || 'tax-invoice',
            customTerms: tpl.customTerms || '',
            customNotes: tpl.customNotes || '',
            extraSections: tpl.extraSections || [],
            invoiceOptions: tpl.invoiceOptions || {},
            taxInclusive: !!tpl.taxInclusive,
          },
        };

        // Insert the generated bill
        db.insert(bills).values({
          id: bill.id,
          clientName: bill.clientName || '',
          invoiceNumber: bill.invoiceNumber,
          invoiceDate: bill.invoiceDate,
          invoiceType: bill.invoiceType,
          currency: bill.currency,
          totalAmount: bill.totalAmount,
          totalTaxAmount: bill.totalTaxAmount,
          status: 'unpaid',
          paidAmount: 0,
          printedCount: 0,
          generatedFrom: bill.generatedFrom,
          autoGenerated: true,
          autoGeneratedAt: bill.autoGeneratedAt,
          isTrashed: false,
          data: JSON.stringify(bill),
        }).run();

        // Cryptographically log the audit event
        logEvent('bill', bill.id, 'CREATE', bill, sqlite);

        // Advance the template
        tpl.nextDate = advanceDate(tpl.nextDate, tpl.frequency, tpl.interval);
        tpl.lastGenerated = today;
        tpl.occurrencesCreated = (tpl.occurrencesCreated || 0) + 1;

        db.update(recurring).set({
          nextDate: tpl.nextDate,
          data: JSON.stringify(tpl),
        }).where(eq(recurring.id, tpl.id)).run();
      })();

      broadcast('BILL_CREATED', bill);
      fired += 1;
    } catch (err) {
      logFatal(err, 'recurring');
    }
  }

  if (fired > 0) {
    console.log(`  Auto-generated ${fired} recurring invoice${fired !== 1 ? 's' : ''}.`);
    setMetaValue('lastRecurringAutoFire', { date: today, count: fired, at: new Date().toISOString() });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Start server
// ════════════════════════════════════════════════════════════════════════════

function startServer(port) {
  const server = http.createServer(app);
  const socketServer = new WebSocketServer({ server });

  socketServer.on('connection', (ws, req) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(4001, 'Unauthorized: Missing token');
        return;
      }
      const decoded = verifyToken(token);
      ws.user = decoded;
      ws.send(JSON.stringify({
        type: 'CONNECTED',
        user: decoded.username,
        role: decoded.role,
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      ws.close(4001, 'Unauthorized: Invalid token');
    }
  });

  server.on('error', (err) => {
    try { socketServer.close(); } catch { /* ignore */ }
    if (err.code === 'EADDRINUSE' && port < STARTING_PORT + MAX_PORT_SCAN) {
      console.log(`  Port ${port} is busy, trying ${port + 1}...`);
      startServer(port + 1);
    } else if (err.code === 'EADDRINUSE') {
      console.warn(`  Scanned ${MAX_PORT_SCAN} ports from ${STARTING_PORT} — letting OS assign a free one.`);
      startServer(0);
    } else {
      console.error(`  Failed to start server: ${err.message}`);
      logFatal(err, 'startup');
      process.exit(1);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    activeServer = server;
    wss = socketServer;
    const actualPort = server.address()?.port || port;
    try { fs.writeFileSync(PORT_FILE, String(actualPort), 'utf-8'); } catch { /* ignore */ }
    console.log(`\n  ArthSutra running at http://localhost:${actualPort}`);
    console.log(`  Data stored in: ${DB_PATH}\n`);
  });
}

function gracefulShutdown(signal) {
  console.log(`\n  Received ${signal}, closing connections...`);
  if (wss) try { wss.close(); } catch { /* ignore */ }
  // Close SQLite cleanly
  try { sqlite.close(); } catch { /* ignore */ }
  if (!activeServer) { process.exit(0); return; }
  const force = setTimeout(() => {
    console.warn('  Force-exiting after 3s grace period');
    process.exit(1);
  }, 3000);
  force.unref();
  activeServer.close(() => {
    clearTimeout(force);
    console.log('  Server closed cleanly.');
    process.exit(0);
  });
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

startServer(STARTING_PORT);
setTimeout(() => { processDueRecurring().catch(err => logFatal(err, 'recurring')); }, 3000);
setInterval(() => { processDueRecurring().catch(err => logFatal(err, 'recurring')); }, 24 * 60 * 60 * 1000);

export { startServer, loadPlugins, activeServer as httpServer, app };
