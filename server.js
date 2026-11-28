import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
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
import { encrypt, safeDecrypt, encryptProfileBankDetails, decryptProfileBankDetails } from './utils/crypto.js';
import { isEncryptedBackup, encryptBackupBundle, decryptBackupBundle } from './utils/backupCrypto.js';
import {
  checkSqliteIntegrity,
  createSafeSqliteSnapshot,
  detectCloudFolders,
  inspectSqliteBackup,
  mirrorBackupToFolder,
  restoreSqliteFromFile,
  todayLocalIso,
  validateMirrorFolder,
} from './utils/disasterRecovery.js';
import { hashPassword, hashPasswordSync, comparePassword, generateToken, verifyToken, ROLES } from './utils/auth.js';

// Note: Automatic admin seeding on startup is disabled in favor of the First-Time Setup Wizard (/api/auth/setup)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));

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
let __autoMirrorTimer = null;
let __backupInFlight = false;
let __pendingResync = false;

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

// ── Multer in-memory storage for GSTR-2B and backup file uploads ───────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit for .sqlite / .arthbackup / .json
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

app.use(express.json({ limit: '50mb' }));

// ── Debounced Auto-Mirror Hook for Disaster Recovery ──────────────────────
const MUTATING_DATA_PREFIXES = [
  '/api/bills', '/api/clients', '/api/products', '/api/purchases',
  '/api/expenses', '/api/receipts', '/api/profile', '/api/profiles',
  '/api/templates', '/api/recurring', '/api/trash', '/api/save-pdf', '/api/import',
  '/api/meta/invoiceNumberSettings', '/api/meta/stockAlertSettings',
  '/api/meta/invoiceDisplayOptions', '/api/meta/enabledModules',
];
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method.toUpperCase())) {
    if (MUTATING_DATA_PREFIXES.some(pfx => req.path.startsWith(pfx))) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          scheduleAutoMirror();
        }
      });
    }
  }
  next();
});

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

// Public check for first-time setup wizard
app.get('/api/auth/status', (req, res) => {
  try {
    const row = sqlite.prepare('SELECT COUNT(*) as count FROM users').get();
    const isSetupComplete = Boolean(row && Number(row.count) > 0);
    res.json({ isSetupComplete });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

// Public first-time setup wizard: create master administrator account
app.post('/api/auth/setup', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'Username is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long' });
  }

  try {
    // Security check: Only allow setup if users table is currently empty
    const countRow = sqlite.prepare('SELECT COUNT(*) as count FROM users').get();
    if (countRow && Number(countRow.count) > 0) {
      return res.status(403).json({ error: 'Setup has already been completed' });
    }

    const passwordHash = await hashPassword(password.trim());
    const result = db.insert(users).values({
      username: username.trim(),
      passwordHash,
      role: 'ADMIN',
      createdAt: new Date().toISOString(),
    }).run();

    const newUser = db.select().from(users).where(eq(users.id, Number(result.lastInsertRowid))).get();
    const token = generateToken(newUser);

    res.status(201).json({
      success: true,
      message: 'Admin account created successfully',
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
      },
    });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

// First-Time Crash Recovery / New PC Restore: ONLY enabled when database has 0 users
app.post('/api/auth/setup-inspect-backup', backupUpload.single('file'), async (req, res) => {
  try {
    const countRow = sqlite.prepare('SELECT COUNT(*) as count FROM users').get();
    if (countRow && Number(countRow.count) > 0) {
      return res.status(403).json({ error: 'Setup has already been completed. Sign in to restore backups from Settings.' });
    }
    const result = await inspectUploadedBackupInput({
      fileBuffer: req.file?.buffer || null,
      text: req.body?.text || null,
      password: req.body?.password || '',
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to inspect backup file' });
  }
});

app.post('/api/auth/setup-restore', backupUpload.single('file'), async (req, res) => {
  try {
    const countRow = sqlite.prepare('SELECT COUNT(*) as count FROM users').get();
    if (countRow && Number(countRow.count) > 0) {
      return res.status(403).json({ error: 'Setup has already been completed. Sign in to restore backups from Settings.' });
    }

    const password = req.body?.password || '';
    const adminUsername = (req.body?.adminUsername || '').trim();
    const adminPassword = req.body?.adminPassword || '';

    let selection = null;
    if (req.body?.selection) {
      try { selection = typeof req.body.selection === 'string' ? JSON.parse(req.body.selection) : req.body.selection; }
      catch { selection = null; }
    }

    const restored = await restoreUploadedBackupInput({
      fileBuffer: req.file?.buffer || null,
      text: req.body?.text || null,
      password,
      overwrite: true,
      selection,
      allowUsers: true,
    });

    // If the restored backup didn't include any user accounts (e.g. legacy JSON export),
    // create the administrator account supplied by the user right away.
    let userCount = Number(sqlite.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0);
    let token = null;
    let user = null;

    if (userCount === 0 && adminUsername && adminPassword) {
      if (adminPassword.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters long' });
      }
      const passwordHash = await hashPassword(adminPassword);
      const insertRes = db.insert(users).values({
        username: adminUsername,
        passwordHash,
        role: 'ADMIN',
        createdAt: new Date().toISOString(),
      }).run();
      const created = db.select().from(users).where(eq(users.id, Number(insertRes.lastInsertRowid))).get();
      token = generateToken(created);
      user = { id: created.id, username: created.username, role: created.role };
      userCount = 1;
    }

    const usernames = db.select({ username: users.username, role: users.role }).from(users).all();
    res.json({
      success: true,
      ...restored,
      hasUsers: userCount > 0,
      restoredUsernames: usernames.map(u => u.username),
      token,
      user,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Restore failed' });
  }
});

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

app.put('/api/auth/profile', requireAuth, async (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body || {};
  if (!currentPassword) {
    return res.status(400).json({ error: 'Current password is required' });
  }

  try {
    const user = db.select().from(users).where(eq(users.id, req.user.id)).get();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const matches = await comparePassword(currentPassword, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: 'Incorrect current password' });
    }

    const updates = {};

    if (newUsername && newUsername.trim() && newUsername.trim() !== user.username) {
      const trimmed = newUsername.trim();
      const existing = db.select().from(users).where(eq(users.username, trimmed)).get();
      if (existing && existing.id !== user.id) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      updates.username = trimmed;
    }

    if (newPassword && newPassword.trim()) {
      updates.passwordHash = await hashPassword(newPassword.trim());
    }

    if (Object.keys(updates).length > 0) {
      db.update(users).set(updates).where(eq(users.id, user.id)).run();
    }

    const updatedUser = db.select().from(users).where(eq(users.id, user.id)).get();
    const token = generateToken(updatedUser);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      token,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        role: updatedUser.role,
      },
    });
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
  try {
    const obj = JSON.parse(row.data);
    if (obj && obj.profile) {
      obj.profile = decryptProfileBankDetails(obj.profile);
    }
    return obj;
  } catch {
    return {};
  }
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

const DEFAULT_PROFILE = {
  businessName: '',
  tagline: '',
  address: '',
  city: '',
  pin: '',
  state: '',
  country: 'India',
  gstin: '',
  pan: '',
  licence: '',
  email: '',
  phone: '',
  bankName: '',
  accountNumber: '',
  ifsc: '',
  swift: '',
  logo: '',
  logoHeight: 48,
  signature: '',
  upiId: '',
  googleClientId: '',
  googleDriveFolder: 'Arth Sutra Invoices',
  paymentAccounts: [],
  aatoAbove5Cr: false,
  prevFYTurnover: '',
  currentFYTurnover: '',
};

/**
 * Normalizes a business profile payload or database record to canonical Indian defaults.
 */
function normalizeProfile(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const accounts = typeof src.paymentAccounts === 'string'
    ? safeParseJSON(src.paymentAccounts, [])
    : (Array.isArray(src.paymentAccounts) ? src.paymentAccounts : []);
  const parsedLogoHeight = Number(src.logoHeight);

  return {
    ...DEFAULT_PROFILE,
    ...src,
    businessName: String(src.businessName ?? ''),
    tagline: String(src.tagline ?? ''),
    address: String(src.address ?? ''),
    city: String(src.city ?? ''),
    pin: String(src.pin ?? ''),
    state: String(src.state ?? ''),
    country: 'India',
    gstin: String(src.gstin ?? ''),
    pan: String(src.pan ?? ''),
    licence: String(src.licence ?? src.licenceNo ?? ''),
    email: String(src.email ?? ''),
    phone: String(src.phone ?? ''),
    bankName: String(src.bankName ?? ''),
    accountNumber: String(src.accountNumber ?? ''),
    ifsc: String(src.ifsc ?? ''),
    swift: String(src.swift ?? ''),
    logo: String(src.logo ?? ''),
    logoHeight: Number.isFinite(parsedLogoHeight) && parsedLogoHeight >= 16 ? parsedLogoHeight : 48,
    signature: String(src.signature ?? ''),
    upiId: String(src.upiId ?? ''),
    googleClientId: String(src.googleClientId ?? ''),
    googleDriveFolder: String(src.googleDriveFolder || 'Arth Sutra Invoices'),
    paymentAccounts: accounts,
    aatoAbove5Cr: Boolean(src.aatoAbove5Cr),
    prevFYTurnover: src.prevFYTurnover ?? '',
    currentFYTurnover: src.currentFYTurnover ?? '',
  };
}

function profileToDbValues(encrypted) {
  return {
    id: encrypted.id,
    businessName: encrypted.businessName || '',
    tagline: encrypted.tagline || '',
    address: encrypted.address || '',
    city: encrypted.city || '',
    pin: encrypted.pin || '',
    state: encrypted.state || '',
    country: 'India',
    gstin: encrypted.gstin || '',
    pan: encrypted.pan || '',
    licence: encrypted.licence || '',
    email: encrypted.email || '',
    phone: encrypted.phone || '',
    bankName: encrypted.bankName || '',
    accountNumber: encrypted.accountNumber || '',
    ifsc: encrypted.ifsc || '',
    swift: encrypted.swift || '',
    logo: encrypted.logo || '',
    logoHeight: Number(encrypted.logoHeight) || 48,
    signature: encrypted.signature || '',
    upiId: encrypted.upiId || '',
    googleClientId: encrypted.googleClientId || '',
    googleDriveFolder: encrypted.googleDriveFolder || 'Arth Sutra Invoices',
    paymentAccounts: typeof encrypted.paymentAccounts === 'string'
      ? encrypted.paymentAccounts
      : JSON.stringify(encrypted.paymentAccounts || []),
    aatoAbove5Cr: Boolean(encrypted.aatoAbove5Cr),
    prevFYTurnover: String(encrypted.prevFYTurnover ?? ''),
    currentFYTurnover: String(encrypted.currentFYTurnover ?? ''),
  };
}

function profileRowToObj(row) {
  return normalizeProfile({
    id: row.id,
    businessName: row.businessName,
    tagline: row.tagline,
    address: row.address,
    city: row.city,
    pin: row.pin,
    state: row.state,
    country: row.country,
    gstin: row.gstin,
    pan: row.pan,
    licence: row.licence,
    email: row.email,
    phone: row.phone,
    bankName: row.bankName,
    accountNumber: row.accountNumber,
    ifsc: row.ifsc,
    swift: row.swift,
    logo: row.logo,
    logoHeight: row.logoHeight,
    signature: row.signature,
    upiId: row.upiId,
    googleClientId: row.googleClientId,
    googleDriveFolder: row.googleDriveFolder,
    paymentAccounts: safeParseJSON(row.paymentAccounts, []),
    aatoAbove5Cr: row.aatoAbove5Cr,
    prevFYTurnover: row.prevFYTurnover,
    currentFYTurnover: row.currentFYTurnover,
  });
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
  const existing = db.select().from(bills).where(eq(bills.id, id)).get();
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

    if (req.query.permanent === '1') {
      deleteBillPdfEverywhere(existing);
    }

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

app.get('/api/profile', (req, res) => {
  const raw = getMetaValue('profile', DEFAULT_PROFILE);
  res.json(normalizeProfile(decryptProfileBankDetails(raw)));
});

app.post('/api/profile', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), (req, res) => {
  const normalized = normalizeProfile(req.body);
  const encrypted = encryptProfileBankDetails(normalized);
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
    state: r.state, gstin: r.gstin, country: (r.country || '').trim() || 'India',
    email: r.email, phone: r.phone, isSEZ: r.isSEZ, licence: r.licence,
  })));
});

app.post('/api/clients', (req, res) => {
  const client = req.body;
  if (!client.id) client.id = 'cli_' + Date.now();
  const normalizedCountry = (client.country || '').trim() || 'India';
  const clientValues = {
    name: client.name || '',
    address: client.address || '',
    city: client.city || '',
    pin: client.pin || '',
    state: client.state || '',
    gstin: client.gstin || '',
    country: normalizedCountry,
    email: client.email || '',
    phone: client.phone || '',
    isSEZ: !!client.isSEZ,
    licence: client.licence || '',
  };
  db.insert(clients).values({
    id: client.id,
    ...clientValues,
  }).onConflictDoUpdate({
    target: clients.id,
    set: clientValues,
  }).run();
  broadcast('CLIENT_UPDATED', { ...client, country: normalizedCountry });
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
  const prof = normalizeProfile(req.body);
  if (!prof.id) prof.id = 'biz_' + Date.now();
  const encrypted = encryptProfileBankDetails(prof);
  const dbValues = profileToDbValues(encrypted);

  db.insert(profiles).values(dbValues).onConflictDoUpdate({
    target: profiles.id,
    set: dbValues,
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

const PROTECTED_META_KEYS = new Set(['profile', 'backupConfig']);

app.get('/api/meta/:key', (req, res) => {
  if (PROTECTED_META_KEYS.has(req.params.key)) {
    return errRes(res, 403, 'forbidden');
  }
  const val = getMetaValue(req.params.key, null);
  res.json({ value: val });
});

app.post('/api/meta/:key', (req, res) => {
  if (PROTECTED_META_KEYS.has(req.params.key)) {
    return errRes(res, 403, 'forbidden');
  }
  setMetaValue(req.params.key, req.body.value);
  res.json({ success: true });
});

// Atomic increment — better-sqlite3 is synchronous so this is race-free.
app.post('/api/meta/:key/increment', (req, res) => {
  if (PROTECTED_META_KEYS.has(req.params.key)) {
    return errRes(res, 403, 'forbidden');
  }
  // Wrap in a transaction for ACID safety
  const result = sqlite.transaction(() => {
    const row = db.select().from(meta).where(eq(meta.key, req.params.key)).get();
    let startBase = 0;
    if (req.params.key.startsWith('counter_')) {
      const invCfg = getMetaValue('invoiceNumberSettings', null);
      const startNum = parseInt(invCfg?.startNumber, 10);
      if (Number.isFinite(startNum) && startNum > 1) {
        startBase = startNum - 1;
      }
    }
    const current = Math.max(Number(row?.value || 0), startBase);
    const next = current + 1;
    setMetaValue(req.params.key, next);
    return next;
  })();
  res.json({ value: result });
});

// ════════════════════════════════════════════════════════════════════════════
// EXPORT / IMPORT (Portable — decrypts bank details on export, re-encrypts on import)
// ════════════════════════════════════════════════════════════════════════════

function buildPortableExportPayload({ includeRecoveryMeta = false } = {}) {
  const rawProfile = getMetaValue('profile', DEFAULT_PROFILE);
  const metaObj = {};
  for (const row of db.select().from(meta).all()) {
    if (row.key === 'profile' || row.key === 'backupConfig') continue;
    try { metaObj[row.key] = JSON.parse(row.value); } catch { metaObj[row.key] = row.value; }
  }

  const payload = {
    __arthsutra_backup: true,
    version:        pkg.version,
    bills:          db.select().from(bills).where(eq(bills.isTrashed, false)).all().map(billRowToObj),
    profile:        normalizeProfile(decryptProfileBankDetails(rawProfile)),
    clients:        db.select().from(clients).all().map(r => ({ id: r.id, name: r.name, address: r.address, city: r.city, pin: r.pin, state: r.state, gstin: r.gstin, country: (r.country || '').trim() || 'India', email: r.email, phone: r.phone, isSEZ: r.isSEZ, licence: r.licence })),
    termsTemplates: db.select().from(templates).all().map(r => ({ id: r.id, name: r.name, content: r.content })),
    products:       db.select().from(products).all().map(productRowToObj),
    expenses:       db.select().from(expenses).all().map(r => ({ id: r.id, date: r.date, description: r.description, category: r.category, amount: r.amount, gstAmount: r.gstAmount, gstPercent: r.gstPercent, vendorName: r.vendorName, vendorGstin: r.vendorGstin, invoiceNo: r.invoiceNo, paymentMode: r.paymentMode, interstate: r.interstate, note: r.note })),
    recurring:      db.select().from(recurring).all().map(recurringRowToObj),
    receipts:       db.select().from(receipts).all().map(r => ({ id: r.id, date: r.date, receiptNo: r.receiptNo, clientName: r.clientName, clientAddress: r.clientAddress, amount: r.amount, paymentMode: r.paymentMode, referenceNo: r.referenceNo, againstInvoice: r.againstInvoice, note: r.note, currency: r.currency, source: r.source, billId: r.billId })),
    profiles:       db.select().from(profiles).all().map(profileRowToObj).map(decryptProfileBankDetails),
    purchases:      db.select().from(purchases).all().map(purchaseRowToObj),
    meta:           metaObj,
    exportedAt:     new Date().toISOString(),
  };

  if (includeRecoveryMeta) {
    payload.trashedBills = db.select().from(bills).where(eq(bills.isTrashed, true)).all().map(billRowToObj);
    payload.users = db.select().from(users).all().map(u => ({
      username: u.username,
      passwordHash: u.passwordHash,
      role: u.role,
      createdAt: u.createdAt,
    }));
    payload.auditLogs = db.select().from(auditLogs).orderBy(asc(auditLogs.id)).all().map(a => ({
      entityType: a.entityType,
      entityId: a.entityId,
      action: a.action,
      payload: a.payload,
      previousHash: a.previousHash,
      currentHash: a.currentHash,
      timestamp: a.timestamp,
    }));
  }

  return payload;
}

function applyPortableImportData(data, { overwrite = false, allowUsers = false } = {}) {
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
    userCount: 0,
  };

  sqlite.transaction(() => {
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

    if (data.profile) {
      if (overwrite || !getMetaValue('profile', null)) {
        setMetaValue('profile', encryptProfileBankDetails(normalizeProfile(data.profile)));
      }
    }

    const upsertBillRecord = (b, isTrashedFlag) => {
      if (!b?.id) return;
      if (!overwrite) {
        const existing = db.select({ id: bills.id }).from(bills).where(eq(bills.id, b.id)).get();
        if (existing) { counts.billSkipped++; return; }
      }
      const encryptedBill = b.profile ? { ...b, profile: encryptProfileBankDetails(b.profile) } : b;
      const values = {
        id: b.id, clientName: b.clientName || '', invoiceNumber: b.invoiceNumber || b.id,
        invoiceDate: b.invoiceDate || '', invoiceType: b.invoiceType || 'tax-invoice',
        currency: b.currency || 'INR', totalAmount: b.totalAmount || 0,
        totalTaxAmount: b.totalTaxAmount || 0, status: b.status || 'unpaid',
        paidAmount: b.paidAmount || 0, printedCount: b.printedCount || 0,
        lastPrintedAt: b.lastPrintedAt || null, generatedFrom: b.generatedFrom || null,
        autoGenerated: !!b.autoGenerated, autoGeneratedAt: b.autoGeneratedAt || null,
        isTrashed: Boolean(isTrashedFlag),
        trashedAt: isTrashedFlag ? (b.trashedAt || b._trashedAt || new Date().toISOString()) : null,
        data: JSON.stringify(encryptedBill),
      };
      db.insert(bills).values(values).onConflictDoUpdate({ target: bills.id, set: values }).run();
      if (!isTrashedFlag) counts.billCount++;
    };

    for (const b of (data.bills || [])) upsertBillRecord(b, false);
    for (const tb of (data.trashedBills || [])) upsertBillRecord(tb, true);

    for (const c of (data.clients || [])) {
      upsertEntity(clients, clients.id, c, (e) => ({
        id: e.id, name: e.name || '', address: e.address || '', city: e.city || '',
        pin: e.pin || '', state: e.state || '', gstin: e.gstin || '',
        country: (e.country || '').trim() || 'India',
        email: e.email || '', phone: e.phone || '', isSEZ: !!e.isSEZ, licence: e.licence || '',
      }), 'clientCount', 'clientSkipped');
    }

    for (const t of (data.termsTemplates || [])) {
      upsertEntity(templates, templates.id, t, (e) => ({
        id: e.id, name: e.name || '', content: e.content || '',
      }), 'templateCount', 'templateSkipped');
    }

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

    for (const e of (data.expenses || [])) {
      upsertEntity(expenses, expenses.id, e, (x) => ({
        id: x.id, date: x.date || '', description: x.description || '',
        category: x.category || '', amount: x.amount || 0, gstAmount: x.gstAmount || 0,
        gstPercent: x.gstPercent || 0, vendorName: x.vendorName || '',
        vendorGstin: x.vendorGstin || '', invoiceNo: x.invoiceNo || '',
        paymentMode: x.paymentMode || '', interstate: !!x.interstate, note: x.note || '',
      }), 'expenseCount', 'expenseSkipped');
    }

    for (const r of (data.recurring || [])) {
      upsertEntity(recurring, recurring.id, r, (e) => ({
        id: e.id, active: e.active !== false, clientName: e.clientName || '',
        invoiceType: e.invoiceType || 'tax-invoice', nextDate: e.nextDate || '',
        frequency: e.frequency || 'monthly', data: JSON.stringify(e),
      }), 'recurringCount', 'recurringSkipped');
    }

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

    for (const p of (data.profiles || [])) {
      upsertEntity(profiles, profiles.id, p, (rawProf) => {
        const e = encryptProfileBankDetails(normalizeProfile(rawProf));
        return profileToDbValues(e);
      }, 'profileCount', 'profileSkipped');
    }

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

    if (data.meta && typeof data.meta === 'object') {
      const nonProfileMetaCount = db.select().from(meta).all().filter(r => r.key !== 'profile' && r.key !== 'backupConfig').length;
      if (overwrite || nonProfileMetaCount === 0) {
        for (const [key, value] of Object.entries(data.meta)) {
          if (key === 'profile' || key === 'backupConfig') continue;
          setMetaValue(key, value);
        }
      }
    }

    if (allowUsers && Array.isArray(data.users) && data.users.length > 0) {
      const existingUsersCount = Number(sqlite.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0);
      if (overwrite || existingUsersCount === 0) {
        if (overwrite) sqlite.exec('DELETE FROM users');
        for (const u of data.users) {
          if (!u?.username || !u?.passwordHash) continue;
          db.insert(users).values({
            username: u.username,
            passwordHash: u.passwordHash,
            role: ['ADMIN', 'ACCOUNTANT', 'CLERK'].includes(u.role) ? u.role : 'CLERK',
            createdAt: u.createdAt || new Date().toISOString(),
          }).onConflictDoNothing().run();
          counts.userCount++;
        }
      }
    }

    if (Array.isArray(data.auditLogs) && data.auditLogs.length > 0) {
      const existingAuditCount = Number(sqlite.prepare('SELECT COUNT(*) as c FROM audit_logs').get()?.c || 0);
      if (overwrite || existingAuditCount === 0) {
        sqlite.exec('DELETE FROM audit_logs');
        const insAudit = sqlite.prepare(`
          INSERT INTO audit_logs (entity_type, entity_id, action, payload, previous_hash, current_hash, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const a of data.auditLogs) {
          if (!a?.currentHash || !a?.previousHash) continue;
          insAudit.run(
            a.entityType || 'bill',
            String(a.entityId || ''),
            a.action || 'CREATE',
            typeof a.payload === 'string' ? a.payload : JSON.stringify(a.payload || {}),
            a.previousHash,
            a.currentHash,
            a.timestamp || new Date().toISOString()
          );
        }
      }
    }

    // Post-import counter reconciliation
    const allBills = db.select({ data: bills.data }).from(bills)
      .where(eq(bills.isTrashed, false)).all();
    const maxByPrefix = {};
    for (const row of allBills) {
      let bill = {};
      try { bill = JSON.parse(row.data); } catch { /* ignore */ }
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

  return { ...counts, hasProfile: !!data.profile };
}

app.get('/api/export', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), (req, res) => {
  const includeRecoveryMeta = req.query.includeRecovery === '1' || req.query.includeRecovery === 'true';
  res.json(buildPortableExportPayload({ includeRecoveryMeta }));
});

app.post('/api/import', requireAuth, requireRole(['ADMIN']), (req, res) => {
  const data = req.body;
  const overwrite = req.query.overwrite === '1' || req.query.overwrite === 'true';
  const result = applyPortableImportData(data, { overwrite, allowUsers: false });
  broadcast('DATA_RESTORED', { format: 'json' });
  res.json(result);
});

// ════════════════════════════════════════════════════════════════════════════
// Save PDF to local folder (file system — routed to DATA_DIR when packaged)
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const IS_PACKAGED_DATA_DIR = path.resolve(DATA_DIR) !== path.resolve(DEFAULT_DATA_DIR);
const INVOICES_DIR = IS_PACKAGED_DATA_DIR
  ? path.join(DATA_DIR, 'Saved Invoices')
  : path.join(__dirname, 'Saved Invoices');
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
    const baseRoot = IS_PACKAGED_DATA_DIR ? DATA_DIR : __dirname;
    res.json({ saved: true, relPath: path.relative(baseRoot, filePath).split(path.sep).join('/') });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Move saved PDF to Trash (file system operation)
// ════════════════════════════════════════════════════════════════════════════

const TRASH_DIR = IS_PACKAGED_DATA_DIR
  ? path.join(DATA_DIR, 'Trash')
  : path.join(__dirname, 'Trash');
if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });

const BILL_PDF_PREFIX = {
  'tax-invoice': 'INV',
  'proforma': 'EST',
  'bill-of-supply': 'BOS',
  'composition': 'COMP',
  'credit-note': 'CN',
  'delivery-challan': 'DC',
};

function getBillPdfNames(billRowOrObj) {
  let bill = billRowOrObj;
  if (typeof billRowOrObj?.data === 'string') {
    bill = billRowToObj(billRowOrObj);
  }
  const invType = bill?.invoiceType || billRowOrObj?.invoiceType || 'tax-invoice';
  const prefix = BILL_PDF_PREFIX[invType] || 'INV';
  const invNum = String(bill?.invoiceNumber || billRowOrObj?.invoiceNumber || bill?.id || billRowOrObj?.id || '');
  const fileName = `${prefix}_${invNum.replace(/\//g, '-')}.pdf`;
  const clientName = bill?.clientName || bill?.data?.client?.name || billRowOrObj?.clientName || 'General';
  return {
    safeClient: safePathSegment(clientName, 'General'),
    safeName: safePathSegment(fileName, 'Untitled.pdf'),
  };
}

function relocatePdfAcrossDirs(srcRoot, dstRoot, safeClient, safeName, { removeOnly = false } = {}) {
  const clientDir = path.join(srcRoot, safeClient);
  if (!isPathInside(clientDir, srcRoot)) return false;
  let handled = false;

  const handleFile = (srcFile, dstSubDir) => {
    if (!isPathInside(srcFile, srcRoot) || !fs.existsSync(srcFile)) return false;
    if (removeOnly) {
      try { fs.unlinkSync(srcFile); } catch { /* ignore */ }
      return true;
    }
    const dstDir = path.join(dstRoot, safeClient, ...dstSubDir);
    const dstFile = path.join(dstDir, safeName);
    if (!isPathInside(dstFile, dstRoot)) return false;
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
    try { fs.renameSync(srcFile, dstFile); }
    catch { fs.copyFileSync(srcFile, dstFile); fs.unlinkSync(srcFile); }
    return true;
  };

  if (fs.existsSync(clientDir)) {
    const entries = fs.readdirSync(clientDir);
    for (const entry of entries) {
      const fullEntry = path.join(clientDir, entry);
      let isDir = false;
      try { isDir = fs.statSync(fullEntry).isDirectory(); } catch { /* ignore */ }
      if (isDir) {
        if (handleFile(path.join(fullEntry, safeName), [entry])) handled = true;
      } else if (entry === safeName) {
        if (handleFile(fullEntry, [])) handled = true;
      }
    }
  }

  if (!handled && !removeOnly) {
    const flatPath = path.join(srcRoot, safeName);
    if (handleFile(flatPath, [])) handled = true;
  }

  return handled;
}

function restoreBillPdfFromTrash(billRow) {
  try {
    const { safeClient, safeName } = getBillPdfNames(billRow);
    return relocatePdfAcrossDirs(TRASH_DIR, INVOICES_DIR, safeClient, safeName);
  } catch {
    return false;
  }
}

function deleteBillPdfEverywhere(billRow) {
  try {
    const { safeClient, safeName } = getBillPdfNames(billRow);
    relocatePdfAcrossDirs(TRASH_DIR, INVOICES_DIR, safeClient, safeName, { removeOnly: true });
    relocatePdfAcrossDirs(INVOICES_DIR, TRASH_DIR, safeClient, safeName, { removeOnly: true });
  } catch { /* ignore */ }
}

app.post('/api/trash-pdf', express.json(), (req, res) => {
  try {
    const { fileName, clientName } = req.body;
    if (!fileName) return errRes(res, 400, 'bad-request');

    const safeClient = safePathSegment(clientName, 'General');
    const safeName = safePathSegment(fileName, 'Untitled.pdf');

    const clientDir = path.join(INVOICES_DIR, safeClient);
    if (!isPathInside(clientDir, INVOICES_DIR)) return errRes(res, 400, 'invalid-path');
    const found = relocatePdfAcrossDirs(INVOICES_DIR, TRASH_DIR, safeClient, safeName);

    res.json({ trashed: found });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Version check
// ════════════════════════════════════════════════════════════════════════════

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
// Backups, Off-PC Mirroring & Disaster Recovery
// ════════════════════════════════════════════════════════════════════════════

const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

const DEFAULT_BACKUP_CONFIG = {
  mirrorEnabled: false,
  mirrorPath: '',
  mirrorProvider: '',
  mirrorPdfs: true,
  autoSyncOnChange: true,
  useRecoveryPassword: false,
  recoveryPasswordEnc: '',
  recoveryPasswordHint: '',
  googleDriveAutoSync: false,
  lastLocalBackupAt: null,
  lastMirrorSyncAt: null,
  lastMirrorStatus: 'not-configured',
  lastMirrorError: '',
  lastDriveSyncAt: null,
};

function getBackupConfig() {
  const saved = getMetaValue('backupConfig', null);
  return { ...DEFAULT_BACKUP_CONFIG, ...(saved && typeof saved === 'object' ? saved : {}) };
}

function sanitizeBackupConfig(cfg) {
  const { recoveryPasswordEnc, ...rest } = cfg;
  return {
    ...rest,
    hasRecoveryPassword: Boolean(recoveryPasswordEnc),
  };
}

function saveBackupConfig(next) {
  setMetaValue('backupConfig', next);
  return next;
}

function summarizeJsonBackupData(data) {
  return {
    valid: Boolean(data && (data.__arthsutra_backup || data.__freegstbill_backup || data.bills || data.profile)),
    format: 'json',
    exportedAt: data?.exportedAt || null,
    version: data?.version || null,
    businessName: data?.profile?.businessName || '',
    hasUsers: Array.isArray(data?.users) && data.users.length > 0,
    counts: {
      profile: data?.profile && Object.keys(data.profile).length > 0 ? 1 : 0,
      profiles: Array.isArray(data?.profiles) ? data.profiles.length : 0,
      bills: Array.isArray(data?.bills) ? data.bills.length : 0,
      clients: Array.isArray(data?.clients) ? data.clients.length : 0,
      termsTemplates: Array.isArray(data?.termsTemplates) ? data.termsTemplates.length : 0,
      products: Array.isArray(data?.products) ? data.products.length : 0,
      expenses: Array.isArray(data?.expenses) ? data.expenses.length : 0,
      purchases: Array.isArray(data?.purchases) ? data.purchases.length : 0,
      recurring: Array.isArray(data?.recurring) ? data.recurring.length : 0,
      receipts: Array.isArray(data?.receipts) ? data.receipts.length : 0,
      meta: data?.meta ? Object.keys(data.meta).length : 0,
      users: Array.isArray(data?.users) ? data.users.length : 0,
    },
  };
}

function isSqliteBuffer(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 16 && buf.subarray(0, 15).toString('ascii') === 'SQLite format 3';
}

async function inspectUploadedBackupInput({ fileBuffer, text, password = '' }) {
  if (isSqliteBuffer(fileBuffer)) {
    const tmpPath = path.join(os.tmpdir(), `arthsutra-inspect-${process.pid}-${Date.now()}.sqlite`);
    try {
      fs.writeFileSync(tmpPath, fileBuffer);
      const info = inspectSqliteBackup(tmpPath);
      if (!info.valid) {
        throw new Error(info.error || 'SQLite backup file failed integrity check');
      }
      return { ...info, encrypted: false, unlocked: true };
    } finally {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  const rawText = text || (fileBuffer ? fileBuffer.toString('utf-8') : '');
  if (!rawText || !rawText.trim()) {
    throw new Error('No backup file or content provided.');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("This file doesn't look like a valid ArthSutra JSON, .arthbackup, or .sqlite backup.");
  }

  if (isEncryptedBackup(parsed)) {
    if (!password) {
      return {
        valid: true,
        format: 'arthbackup',
        encrypted: true,
        unlocked: false,
        summary: parsed.summary || null,
        createdAt: parsed.createdAt || null,
      };
    }
    const decryptedObj = decryptBackupBundle(parsed, password);
    const inspection = summarizeJsonBackupData(decryptedObj);
    return {
      valid: inspection.valid,
      format: 'arthbackup',
      encrypted: true,
      unlocked: true,
      ...inspection,
      unlockedJsonText: JSON.stringify(decryptedObj),
    };
  }

  const inspection = summarizeJsonBackupData(parsed);
  if (!inspection.valid) {
    throw new Error("This file doesn't look like an ArthSutra backup.");
  }
  return {
    ...inspection,
    encrypted: false,
    unlocked: true,
    unlockedJsonText: rawText,
  };
}

async function restoreUploadedBackupInput({ fileBuffer, text, password = '', overwrite = true, selection = null, allowUsers = false }) {
  if (isSqliteBuffer(fileBuffer)) {
    const tmpPath = path.join(os.tmpdir(), `arthsutra-restore-${process.pid}-${Date.now()}.sqlite`);
    try {
      fs.writeFileSync(tmpPath, fileBuffer);
      const result = await restoreSqliteFromFile(sqlite, DB_PATH, tmpPath, { backupsDir: BACKUPS_DIR });
      broadcast('DATA_RESTORED', { format: 'sqlite' });
      return { format: 'sqlite', ...result };
    } finally {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  const rawText = text || (fileBuffer ? fileBuffer.toString('utf-8') : '');
  if (!rawText || !rawText.trim()) {
    throw new Error('No backup content provided.');
  }

  let data = JSON.parse(rawText);
  let format = 'json';
  if (isEncryptedBackup(data)) {
    data = decryptBackupBundle(data, password);
    format = 'arthbackup';
  }

  let payload = data;
  if (selection && typeof selection === 'object') {
    payload = {};
    for (const key of ['profile', 'profiles', 'bills', 'trashedBills', 'clients', 'termsTemplates', 'products', 'expenses', 'recurring', 'receipts', 'purchases', 'meta', 'users', 'auditLogs']) {
      if (selection[key] && data[key] !== undefined) {
        payload[key] = data[key];
      }
    }
  }

  const counts = applyPortableImportData(payload, { overwrite, allowUsers });
  broadcast('DATA_RESTORED', { format });
  return { format, ...counts };
}

async function runDailyBackup({ force = false } = {}) {
  try {
    ensureDir(BACKUPS_DIR);
    const today = todayLocalIso();
    const target = path.join(BACKUPS_DIR, `${today}.sqlite`);

    if (!force && fs.existsSync(target)) {
      return { skipped: true, date: today, target };
    }

    const snap = await createSafeSqliteSnapshot(sqlite, target);
    const cfg = getBackupConfig();
    saveBackupConfig({ ...cfg, lastLocalBackupAt: new Date().toISOString() });
    console.log(`[backup] Daily snapshot saved & verified: ${target}`);

    // Retention: keep last 30 backups
    const all = fs.readdirSync(BACKUPS_DIR)
      .filter(n => /^\d{4}-\d{2}-\d{2}\.sqlite$/.test(n))
      .sort();
    while (all.length > 30) {
      const oldest = all.shift();
      try { fs.unlinkSync(path.join(BACKUPS_DIR, oldest)); } catch { /* ignore */ }
    }
    return { skipped: false, date: today, target, ...snap };
  } catch (err) {
    console.warn('[backup] Daily backup failed:', err.message);
    return { error: err.message };
  }
}

async function performMirrorSync({ reason = 'manual' } = {}) {
  const cfg = getBackupConfig();
  if (!cfg.mirrorEnabled || !cfg.mirrorPath) {
    return { skipped: true, reason: 'mirror-disabled' };
  }
  if (__backupInFlight) {
    __pendingResync = true;
    return { skipped: true, reason: 'in-flight' };
  }

  __backupInFlight = true;
  try {
    const recoveryPassword = (cfg.useRecoveryPassword && cfg.recoveryPasswordEnc)
      ? safeDecrypt(cfg.recoveryPasswordEnc, '')
      : '';
    if (cfg.useRecoveryPassword && !recoveryPassword) {
      throw new Error('Recovery password could not be unlocked; re-save it in Backup Settings.');
    }

    const exportPayload = buildPortableExportPayload({ includeRecoveryMeta: true });
    const result = await mirrorBackupToFolder({
      mirrorPath: cfg.mirrorPath,
      sqliteConn: sqlite,
      exportPayload,
      recoveryPassword,
      mirrorPdfs: cfg.mirrorPdfs !== false,
      invoicesDir: INVOICES_DIR,
      dataDir: DATA_DIR,
      appDir: __dirname,
    });

    const latestCfg = getBackupConfig();
    saveBackupConfig({
      ...latestCfg,
      lastMirrorSyncAt: result.syncedAt,
      lastMirrorStatus: 'ok',
      lastMirrorError: '',
    });
    console.log(`[backup] Off-PC mirror synced (${reason}) -> ${result.resolvedPath}`);
    return result;
  } catch (err) {
    const latestCfg = getBackupConfig();
    saveBackupConfig({
      ...latestCfg,
      lastMirrorStatus: 'error',
      lastMirrorError: err.message || 'Mirror sync failed',
    });
    console.warn(`[backup] Off-PC mirror sync failed (${reason}):`, err.message);
    return { ok: false, error: err.message };
  } finally {
    __backupInFlight = false;
    if (__pendingResync) {
      __pendingResync = false;
      setTimeout(() => { performMirrorSync({ reason: 'queued' }).catch(() => {}); }, 2000);
    }
  }
}

function scheduleAutoMirror() {
  try {
    const cfg = getBackupConfig();
    if (!cfg.mirrorEnabled || !cfg.autoSyncOnChange || !cfg.mirrorPath) return;
    if (__autoMirrorTimer) clearTimeout(__autoMirrorTimer);
    __autoMirrorTimer = setTimeout(() => {
      __autoMirrorTimer = null;
      performMirrorSync({ reason: 'auto-change' }).catch(() => {});
    }, 10000);
  } catch { /* ignore */ }
}

setTimeout(async () => {
  await runDailyBackup({ force: false });
  const cfg = getBackupConfig();
  if (cfg.mirrorEnabled && cfg.mirrorPath) {
    const stale = !cfg.lastMirrorSyncAt || (Date.now() - Date.parse(cfg.lastMirrorSyncAt)) > 15 * 60 * 1000;
    if (stale) {
      await performMirrorSync({ reason: 'startup' });
    }
  }
}, 5000);
setInterval(() => {
  runDailyBackup({ force: false }).then(() => {
    const cfg = getBackupConfig();
    if (cfg.mirrorEnabled && cfg.mirrorPath) {
      performMirrorSync({ reason: 'daily' }).catch(() => {});
    }
  });
}, 24 * 60 * 60 * 1000);

// Backup management endpoints

app.get('/api/backups', requireAuth, (req, res) => {
  try {
    ensureDir(BACKUPS_DIR);
    const list = fs.readdirSync(BACKUPS_DIR)
      .filter(n => /^\d{4}-\d{2}-\d{2}\.sqlite$/.test(n))
      .sort().reverse()
      .map(name => {
        const stat = fs.statSync(path.join(BACKUPS_DIR, name));
        return { date: name.replace('.sqlite', ''), createdAt: stat.mtime.toISOString(), sizeBytes: stat.size };
      });
    res.json(list);
  } catch (err) { errRes(res, 500, 'server-error', err); }
});

app.delete('/api/backups/:date', requireAuth, requireRole(['ADMIN']), (req, res) => {
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

app.post('/api/backups/:date/restore', requireAuth, requireRole(['ADMIN']), async (req, res) => {
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

    await restoreSqliteFromFile(sqlite, DB_PATH, backupFile, { backupsDir: BACKUPS_DIR });
    broadcast('DATA_RESTORED', { date });
    res.json({ success: true, restored: date });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

let __lastBackupNowMs = 0;
app.post('/api/backups/now', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), async (req, res) => {
  const now = Date.now();
  if (now - __lastBackupNowMs < 5000) {
    return res.status(429).json({
      error: 'Please wait a few seconds before triggering another backup.',
      code: 'rate-limited',
    });
  }
  __lastBackupNowMs = now;
  const local = await runDailyBackup({ force: true });
  const cfg = getBackupConfig();
  let mirror = null;
  if (cfg.mirrorEnabled && cfg.mirrorPath) {
    mirror = await performMirrorSync({ reason: 'manual' });
  }
  res.json({ success: !local?.error, local, mirror });
});

// Disaster recovery health, cloud folder detection & off-PC mirror endpoints

app.get('/api/backup/health', (req, res) => {
  try {
    ensureDir(BACKUPS_DIR);
    const list = fs.readdirSync(BACKUPS_DIR)
      .filter(n => /^\d{4}-\d{2}-\d{2}\.sqlite$/.test(n))
      .sort().reverse();
    const latestName = list[0] || null;
    const latestStat = latestName ? fs.statSync(path.join(BACKUPS_DIR, latestName)) : null;
    const cfg = getBackupConfig();
    const detected = detectCloudFolders();
    const integrity = checkSqliteIntegrity(sqlite);

    const mirrorOk = Boolean(cfg.mirrorEnabled && cfg.mirrorPath && cfg.lastMirrorStatus === 'ok');
    const latestOffPcIso = [cfg.lastMirrorSyncAt, cfg.lastDriveSyncAt]
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;

    const daysSinceLastOffPcSync = latestOffPcIso
      ? Math.max(0, Math.floor((Date.now() - Date.parse(latestOffPcIso)) / 86400000))
      : null;

    const recentDriveOk = Boolean(cfg.lastDriveSyncAt && (Date.now() - Date.parse(cfg.lastDriveSyncAt)) < 7 * 86400000);
    const isOffPcProtected = mirrorOk || recentDriveOk;
    let protectionLevel = 'local-only';
    if (cfg.mirrorEnabled && cfg.lastMirrorStatus === 'error') {
      protectionLevel = 'warning';
    } else if (isOffPcProtected) {
      protectionLevel = 'protected';
    } else if (latestOffPcIso) {
      protectionLevel = 'warning';
    }

    res.json({
      integrity,
      localBackups: {
        count: list.length,
        latestDate: latestName ? latestName.replace('.sqlite', '') : null,
        latestAt: latestStat ? latestStat.mtime.toISOString() : cfg.lastLocalBackupAt,
        dir: BACKUPS_DIR,
      },
      dataDir: DATA_DIR,
      invoicesDir: INVOICES_DIR,
      detectedCloudFolders: detected,
      config: sanitizeBackupConfig(cfg),
      isOffPcProtected,
      protectionLevel,
      latestOffPcSyncAt: latestOffPcIso,
      daysSinceLastOffPcSync,
    });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

app.post('/api/backup/test-folder', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), (req, res) => {
  const folderPath = req.body?.path || '';
  const result = validateMirrorFolder(folderPath, { dataDir: DATA_DIR, appDir: __dirname });
  res.json(result);
});

app.post('/api/backup/config', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const body = req.body || {};
    const prev = getBackupConfig();
    const next = { ...prev };

    if (typeof body.mirrorEnabled === 'boolean') next.mirrorEnabled = body.mirrorEnabled;
    if (typeof body.mirrorPath === 'string') next.mirrorPath = body.mirrorPath.trim();
    if (typeof body.mirrorProvider === 'string') next.mirrorProvider = body.mirrorProvider.trim();
    if (typeof body.mirrorPdfs === 'boolean') next.mirrorPdfs = body.mirrorPdfs;
    if (typeof body.autoSyncOnChange === 'boolean') next.autoSyncOnChange = body.autoSyncOnChange;
    if (typeof body.googleDriveAutoSync === 'boolean') next.googleDriveAutoSync = body.googleDriveAutoSync;
    if (typeof body.recoveryPasswordHint === 'string') next.recoveryPasswordHint = body.recoveryPasswordHint.trim().slice(0, 120);

    if (body.clearRecoveryPassword) {
      next.useRecoveryPassword = false;
      next.recoveryPasswordEnc = '';
    } else if (typeof body.recoveryPassword === 'string' && body.recoveryPassword.length > 0) {
      if (body.recoveryPassword.length < 4) {
        return res.status(400).json({ error: 'Recovery password must be at least 4 characters long.' });
      }
      next.useRecoveryPassword = true;
      next.recoveryPasswordEnc = encrypt(body.recoveryPassword);
    } else if (typeof body.useRecoveryPassword === 'boolean') {
      if (body.useRecoveryPassword && !next.recoveryPasswordEnc) {
        return res.status(400).json({ error: 'Set a Recovery Password before enabling encrypted backups.' });
      }
      next.useRecoveryPassword = body.useRecoveryPassword;
    }

    if (next.mirrorEnabled) {
      const check = validateMirrorFolder(next.mirrorPath, { dataDir: DATA_DIR, appDir: __dirname });
      if (!check.ok) {
        return res.status(400).json({ error: check.error });
      }
      next.mirrorPath = check.resolvedPath;
      next.lastMirrorStatus = 'pending';
      next.lastMirrorError = '';
    } else {
      next.lastMirrorStatus = 'not-configured';
      next.lastMirrorError = '';
    }

    saveBackupConfig(next);

    let mirrorResult = null;
    if (next.mirrorEnabled && body.syncNow !== false) {
      await runDailyBackup({ force: true });
      mirrorResult = await performMirrorSync({ reason: 'config-save' });
    }

    res.json({
      success: true,
      config: sanitizeBackupConfig(getBackupConfig()),
      mirrorResult,
    });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

app.post('/api/backup/sync-mirror', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), async (req, res) => {
  try {
    const local = await runDailyBackup({ force: true });
    const mirror = await performMirrorSync({ reason: 'manual-sync' });
    if (mirror?.ok === false) {
      return res.status(400).json({ error: mirror.error || 'Mirror sync failed', local, mirror });
    }
    res.json({ success: true, local, mirror, config: sanitizeBackupConfig(getBackupConfig()) });
  } catch (err) {
    errRes(res, 500, 'server-error', err);
  }
});

app.post('/api/backup/mark-drive-sync', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), (req, res) => {
  const cfg = getBackupConfig();
  saveBackupConfig({ ...cfg, lastDriveSyncAt: new Date().toISOString() });
  res.json({ success: true, lastDriveSyncAt: getBackupConfig().lastDriveSyncAt });
});

app.post('/api/backup/export-encrypted', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), (req, res) => {
  try {
    const { password, selection, includeRecoveryMeta = true, localStorageData = null } = req.body || {};
    if (!password || typeof password !== 'string' || password.length < 4) {
      return res.status(400).json({ error: 'Recovery password must be at least 4 characters long.' });
    }

    const full = buildPortableExportPayload({ includeRecoveryMeta: Boolean(includeRecoveryMeta) });
    let payload = full;
    if (selection && typeof selection === 'object') {
      payload = { __arthsutra_backup: true, version: full.version, exportedAt: full.exportedAt };
      for (const key of ['profile', 'profiles', 'bills', 'trashedBills', 'clients', 'termsTemplates', 'products', 'expenses', 'recurring', 'receipts', 'purchases', 'meta', 'users', 'auditLogs']) {
        if (selection[key] && full[key] !== undefined) {
          payload[key] = full[key];
        }
      }
    }
    if (localStorageData && (!selection || selection.localStorage)) {
      payload.localStorage = localStorageData;
    }

    const encryptedText = encryptBackupBundle(payload, password);
    res.json({ success: true, encryptedText });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to encrypt backup' });
  }
});

app.post('/api/backup/inspect-upload', requireAuth, requireRole(['ADMIN', 'ACCOUNTANT']), backupUpload.single('file'), async (req, res) => {
  try {
    const result = await inspectUploadedBackupInput({
      fileBuffer: req.file?.buffer || null,
      text: req.body?.text || null,
      password: req.body?.password || '',
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to inspect backup file' });
  }
});

app.post('/api/backup/restore-upload', requireAuth, requireRole(['ADMIN']), backupUpload.single('file'), async (req, res) => {
  try {
    let selection = null;
    if (req.body?.selection) {
      try { selection = typeof req.body.selection === 'string' ? JSON.parse(req.body.selection) : req.body.selection; }
      catch { selection = null; }
    }
    const overwrite = req.body?.overwrite !== 'false' && req.body?.overwrite !== false;
    const allowUsers = req.body?.allowUsers === 'true' || req.body?.allowUsers === true;

    const result = await restoreUploadedBackupInput({
      fileBuffer: req.file?.buffer || null,
      text: req.body?.text || null,
      password: req.body?.password || '',
      overwrite,
      selection,
      allowUsers,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Restore failed' });
  }
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
    const row = db.select().from(bills)
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

    const pdfRestored = restoreBillPdfFromTrash(row);
    broadcast('BILL_UPDATED', { id: req.params.id, isTrashed: false, restored: true });
    res.json({ success: true, pdfRestored });
  } catch (err) { errRes(res, 500, 'server-error', err); }
});

app.delete('/api/trash/:id', (req, res) => {
  try {
    const existing = db.select().from(bills).where(eq(bills.id, req.params.id)).get();
    db.transaction((tx) => {
      tx.delete(bills).where(eq(bills.id, req.params.id)).run();
      logEvent('bill', req.params.id, 'DELETE', { id: req.params.id, permanent: true, fromTrash: true }, tx);
    });
    if (existing) deleteBillPdfEverywhere(existing);
    broadcast('BILL_DELETED', { id: req.params.id, permanent: true, fromTrash: true });
    res.json({ success: true });
  } catch (err) { errRes(res, 500, 'server-error', err); }
});

// Auto-purge trashed bills older than 30 days
function purgeOldTrash() {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const expired = sqlite.prepare(
      'SELECT id, client_name as clientName, invoice_number as invoiceNumber, invoice_type as invoiceType, data FROM bills WHERE is_trashed = 1 AND trashed_at IS NOT NULL AND trashed_at < ?'
    ).all(cutoff);
    for (const row of expired) {
      deleteBillPdfEverywhere(row);
    }
    sqlite.prepare(
      'DELETE FROM bills WHERE is_trashed = 1 AND trashed_at IS NOT NULL AND trashed_at < ?'
    ).run(cutoff);
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

function getCurrentIndianFY(date = new Date()) {
  const yr = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  const ny = String(yr + 1).slice(-2);
  return `${yr}-${ny}`;
}

function nextInvoiceNumber(prefix, _settings = {}) {
  // ACID: runs inside the caller's transaction
  const metaRow = db.select().from(meta).where(eq(meta.key, `counter_${prefix}`)).get();
  const settingsRow = db.select().from(meta).where(eq(meta.key, 'invoiceNumberSettings')).get();
  const cfg = {
    format: 'branded', brandPrefix: '', separator: '/', showFinYear: true, startNumber: 1, padDigits: 4,
    ...(settingsRow ? safeParseJSON(settingsRow.value, {}) : {}),
  };
  const startNum = parseInt(cfg.startNumber, 10);
  const startBase = Number.isFinite(startNum) && startNum > 1 ? startNum - 1 : 0;
  const next = Math.max(Number(metaRow?.value) || 0, startBase) + 1;
  setMetaValue(`counter_${prefix}`, next);

  if (cfg.format === 'random') {
    return `${cfg.brandPrefix || prefix}${cfg.separator}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  }
  const sep = cfg.separator || '/';
  const pfx = cfg.brandPrefix || prefix;
  const padded = String(next).padStart(cfg.padDigits || 4, '0');
  if (cfg.showFinYear) {
    return `${pfx}${sep}${getCurrentIndianFY()}${sep}${padded}`;
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
      let createdBill = null;
      // Wrap each recurring fire in a transaction: create bill + update template + bump counter
      sqlite.transaction(() => {
        // Resolve live profile
        const profileRows = db.select().from(profiles).all();
        let profile = profileRows.find(p => p.id && tpl.profileId && p.id === tpl.profileId);
        if (!profile) profile = profileRows.find(p => (p.businessName || '') === tpl.profileBusinessName);
        profile = profile
          ? decryptProfileBankDetails(profileRowToObj(profile))
          : normalizeProfile(decryptProfileBankDetails(getMetaValue('profile', DEFAULT_PROFILE)));

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
        const details = {
          placeOfSupply: tpl.placeOfSupply || '',
          sellerLicence: profile.licence || '',
        };
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
              address: tpl.clientAddress, country: tpl.clientCountry || 'India', city: tpl.clientCity,
              pin: tpl.clientPin, email: tpl.clientEmail, phone: tpl.clientPhone,
              isSEZ: tpl.isSEZ,
            },
            details: {
              invoiceNumber,
              invoiceDate,
              dueDate: '',
              placeOfSupply: tpl.placeOfSupply || '',
              sellerLicence: profile.licence || '',
            },
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
        createdBill = bill;
      })();

      if (createdBill) broadcast('BILL_CREATED', createdBill);
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

async function gracefulShutdown(signal) {
  console.log(`\n  Received ${signal}, closing connections...`);
  if (__autoMirrorTimer) {
    clearTimeout(__autoMirrorTimer);
    __autoMirrorTimer = null;
    try {
      await Promise.race([
        performMirrorSync({ reason: 'shutdown' }),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
    } catch { /* ignore */ }
  }
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
