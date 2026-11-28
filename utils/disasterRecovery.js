// utils/disasterRecovery.js
// ─────────────────────────────────────────────────────────────────────────────
// Off-PC Disaster Recovery Engine for Arth-Sutra
// - Cloud-sync folder auto-detection (Google Drive for Desktop, OneDrive, Dropbox)
// - SQLite WAL-safe Online Backup API + PRAGMA integrity_check verification
// - Atomic cross-drive snapshot mirroring & incremental PDF archive sync
// - Full-table schema-aware SQLite restore & portable JSON/encrypted restore
// ─────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { encryptBackupBundle } from './backupCrypto.js';

export const RESTORABLE_TABLES = [
  'bills',
  'clients',
  'products',
  'purchases',
  'expenses',
  'receipts',
  'profiles',
  'templates',
  'recurring',
  'meta',
  'audit_logs',
  'users',
];

export function todayLocalIso() {
  return new Date().toLocaleDateString('sv-SE');
}

export function isPathInside(candidate, root) {
  const r = path.resolve(root);
  const p = path.resolve(candidate);
  return p === r || p.startsWith(r + path.sep);
}

/**
 * Safely copies a file across drives/filesystems using a temp file on the
 * destination directory followed by an atomic rename.
 */
export function writeFileAtomic(targetPath, content, encoding = 'utf8') {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${path.basename(targetPath)}-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(tmpPath, content, encoding);
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

export function copyFileAtomicCrossDrive(srcPath, destPath) {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpDest = path.join(dir, `.tmp-${path.basename(destPath)}-${process.pid}-${Date.now()}`);
  try {
    fs.copyFileSync(srcPath, tmpDest);
    fs.renameSync(tmpDest, destPath);
  } catch (err) {
    try { if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Runs SQLite PRAGMA integrity_check on a live DB connection or file path.
 */
export function checkSqliteIntegrity(dbOrPath) {
  let conn = dbOrPath;
  let shouldClose = false;
  try {
    if (typeof dbOrPath === 'string') {
      if (!fs.existsSync(dbOrPath)) {
        return { ok: false, detail: 'Database file does not exist.' };
      }
      conn = new Database(dbOrPath, { readonly: true, fileMustExist: true });
      shouldClose = true;
    }
    const rows = conn.prepare('PRAGMA integrity_check(10)').all();
    const first = rows[0]?.integrity_check;
    if (rows.length === 1 && first === 'ok') {
      return { ok: true, detail: 'ok' };
    }
    const detail = rows.map(r => r.integrity_check).filter(Boolean).join('; ') || 'Integrity check failed';
    return { ok: false, detail };
  } catch (err) {
    return { ok: false, detail: err.message || 'Unable to verify SQLite integrity' };
  } finally {
    if (shouldClose && conn) {
      try { conn.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Creates a verified, WAL-consistent SQLite backup at `targetPath` using
 * SQLite's online backup API. Never overwrites an existing healthy backup if
 * the snapshot fails integrity verification.
 */
export async function createSafeSqliteSnapshot(sqliteConn, targetPath) {
  const stageDir = os.tmpdir();
  const stageFile = path.join(stageDir, `arthsutra-snap-${process.pid}-${Date.now()}.sqlite`);
  try {
    await sqliteConn.backup(stageFile);
    const check = checkSqliteIntegrity(stageFile);
    if (!check.ok) {
      throw new Error(`Database failed integrity check: ${check.detail}`);
    }
    copyFileAtomicCrossDrive(stageFile, targetPath);
    const stat = fs.statSync(targetPath);
    return { ok: true, sizeBytes: stat.size, integrityOk: true };
  } finally {
    try { if (fs.existsSync(stageFile)) fs.unlinkSync(stageFile); } catch { /* ignore */ }
  }
}

/**
 * Inspects a SQLite backup file without modifying the live database.
 */
export function inspectSqliteBackup(sqlitePath) {
  const integrity = checkSqliteIntegrity(sqlitePath);
  if (!integrity.ok) {
    return { valid: false, format: 'sqlite', integrityOk: false, error: integrity.detail };
  }

  let conn;
  try {
    conn = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    const countOf = (table, where = '') => {
      try {
        const exists = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (!exists) return 0;
        const row = conn.prepare(`SELECT COUNT(*) as c FROM ${table} ${where}`).get();
        return Number(row?.c || 0);
      } catch {
        return 0;
      }
    };

    let businessName = '';
    let exportedAt = null;
    try {
      const profRow = conn.prepare("SELECT value FROM meta WHERE key='profile'").get();
      if (profRow?.value) {
        const parsed = JSON.parse(profRow.value);
        businessName = parsed?.businessName || '';
      }
    } catch { /* ignore */ }

    try {
      const stat = fs.statSync(sqlitePath);
      exportedAt = stat.mtime.toISOString();
    } catch { /* ignore */ }

    const counts = {
      profile: businessName ? 1 : 0,
      profiles: countOf('profiles'),
      bills: countOf('bills', 'WHERE is_trashed = 0'),
      clients: countOf('clients'),
      products: countOf('products'),
      expenses: countOf('expenses'),
      purchases: countOf('purchases'),
      recurring: countOf('recurring'),
      receipts: countOf('receipts'),
      termsTemplates: countOf('templates'),
      meta: countOf('meta'),
      users: countOf('users'),
    };

    return {
      valid: true,
      format: 'sqlite',
      integrityOk: true,
      businessName,
      exportedAt,
      hasUsers: counts.users > 0,
      counts,
    };
  } catch (err) {
    return { valid: false, format: 'sqlite', integrityOk: false, error: err.message };
  } finally {
    if (conn) {
      try { conn.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * Restores all matching tables from `sourceSqlitePath` into `liveSqlite`,
 * verifying integrity first and rolling back automatically on error.
 */
export async function restoreSqliteFromFile(liveSqlite, liveDbPath, sourceSqlitePath, { backupsDir } = {}) {
  const integrity = checkSqliteIntegrity(sourceSqlitePath);
  if (!integrity.ok) {
    throw new Error(`Backup database is corrupted or unreadable: ${integrity.detail}`);
  }

  // Create a pre-restore safety snapshot first
  const safetyDir = backupsDir || path.dirname(liveDbPath);
  fs.mkdirSync(safetyDir, { recursive: true });
  const preRestorePath = path.join(safetyDir, `pre-restore-${Date.now()}.sqlite`);
  await createSafeSqliteSnapshot(liveSqlite, preRestorePath);

  const copyTables = (srcDb, dstDb) => {
    dstDb.pragma('foreign_keys = OFF');
    try {
      dstDb.transaction(() => {
        for (const table of RESTORABLE_TABLES) {
          const dstExists = dstDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
          const srcExists = srcDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
          if (!dstExists) continue;
          dstDb.exec(`DELETE FROM ${table}`);
          if (!srcExists) continue;

          const srcCols = new Set(srcDb.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
          const dstCols = dstDb.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
          const commonCols = dstCols.filter(c => srcCols.has(c));
          if (commonCols.length === 0) continue;

          const rows = srcDb.prepare(`SELECT ${commonCols.join(', ')} FROM ${table}`).all();
          if (rows.length === 0) continue;

          const placeholders = commonCols.map(() => '?').join(', ');
          const insert = dstDb.prepare(
            `INSERT OR REPLACE INTO ${table} (${commonCols.join(', ')}) VALUES (${placeholders})`
          );
          for (const row of rows) {
            insert.run(...commonCols.map(c => row[c]));
          }
        }
      })();
    } finally {
      dstDb.pragma('foreign_keys = ON');
    }
  };

  let srcDb = null;
  try {
    srcDb = new Database(sourceSqlitePath, { readonly: true, fileMustExist: true });
    copyTables(srcDb, liveSqlite);
    srcDb.close();
    srcDb = null;

    const userCount = Number(liveSqlite.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0);
    const billCount = Number(liveSqlite.prepare('SELECT COUNT(*) as c FROM bills WHERE is_trashed = 0').get()?.c || 0);
    try { fs.unlinkSync(preRestorePath); } catch { /* keep safety copy */ }
    return { ok: true, userCount, billCount };
  } catch (err) {
    if (srcDb) {
      try { srcDb.close(); } catch { /* ignore */ }
    }
    let rollbackDb = null;
    try {
      rollbackDb = new Database(preRestorePath, { readonly: true, fileMustExist: true });
      copyTables(rollbackDb, liveSqlite);
    } catch {
      /* pre-restore snapshot preserved on disk for manual recovery */
    } finally {
      if (rollbackDb) {
        try { rollbackDb.close(); } catch { /* ignore */ }
      }
    }
    throw err;
  }
}

/**
 * Auto-detects mounted cloud-sync folders on the local PC (Google Drive for Desktop,
 * Microsoft OneDrive, Dropbox) so users can turn on off-PC backup in 1 click.
 */
export function detectCloudFolders(env = process.env, { skipDriveScan = false } = {}) {
  const folders = [];
  const seenRoots = new Set();
  const userProfile = env.USERPROFILE || env.HOME || os.homedir() || '';

  const addCandidate = (id, provider, rootPath, subFolder = 'ArthSutra Backups') => {
    if (!rootPath) return;
    const normalized = path.resolve(rootPath);
    const key = normalized.toLowerCase();
    if (seenRoots.has(key)) return;
    try {
      if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
        seenRoots.add(key);
        folders.push({
          id,
          provider,
          rootPath: normalized,
          suggestedBackupPath: path.join(normalized, subFolder),
          detected: true,
        });
      }
    } catch {
      /* ignore inaccessible virtual drive */
    }
  };

  let hasGoogleDriveDesktop = false;
  let googleDriveInstalled = false;

  if (process.platform === 'win32') {
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const localAppData = env.LOCALAPPDATA || path.join(userProfile, 'AppData', 'Local');
    try {
      googleDriveInstalled =
        fs.existsSync(path.join(programFiles, 'Google', 'Drive File Stream')) ||
        fs.existsSync(path.join(localAppData, 'Google', 'DriveFS'));
    } catch {
      googleDriveInstalled = false;
    }

    if (!skipDriveScan) {
      // Check common mounted drive letters (G: first, then D..Z) for Google Drive Desktop's "My Drive"
      const letters = ['G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'D', 'E', 'F', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
      for (const letter of letters) {
        for (const sub of ['My Drive', 'Google Drive']) {
          const candidate = `${letter}:\\${sub}`;
          try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
              addCandidate(`gdrive-${letter.toLowerCase()}`, 'Google Drive for Desktop', candidate);
              hasGoogleDriveDesktop = true;
            }
          } catch {
            /* drive not mounted */
          }
        }
      }
    }
  } else if (process.platform === 'darwin') {
    const cloudStorage = path.join(userProfile, 'Library', 'CloudStorage');
    try {
      if (fs.existsSync(cloudStorage)) {
        for (const entry of fs.readdirSync(cloudStorage)) {
          if (entry.startsWith('GoogleDrive-')) {
            googleDriveInstalled = true;
            const myDrive = path.join(cloudStorage, entry, 'My Drive');
            if (fs.existsSync(myDrive)) {
              addCandidate('gdrive-mac', 'Google Drive for Desktop', myDrive);
              hasGoogleDriveDesktop = true;
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Fallback user-profile locations for Google Drive
  if (userProfile) {
    for (const sub of ['Google Drive', 'My Drive']) {
      const p = path.join(userProfile, sub);
      if (fs.existsSync(p)) {
        addCandidate('gdrive-home', 'Google Drive for Desktop', p);
        hasGoogleDriveDesktop = true;
      }
    }
  }

  // Microsoft OneDrive
  for (const [envKey, label] of [
    ['OneDrive', 'Microsoft OneDrive'],
    ['OneDriveConsumer', 'Microsoft OneDrive (Personal)'],
    ['OneDriveCommercial', 'Microsoft OneDrive (Work)'],
  ]) {
    if (env[envKey]) {
      addCandidate(`onedrive-${envKey.toLowerCase()}`, label, env[envKey]);
    }
  }
  if (userProfile) {
    addCandidate('onedrive-home', 'Microsoft OneDrive', path.join(userProfile, 'OneDrive'));
    addCandidate('dropbox-home', 'Dropbox', path.join(userProfile, 'Dropbox'));
  }

  return {
    folders,
    hasGoogleDriveDesktop,
    googleDriveInstalled: googleDriveInstalled || hasGoogleDriveDesktop,
  };
}

/**
 * Validates that a mirror backup path is safe (not inside the live DATA_DIR
 * or OS system directories) and writable right now.
 */
export function validateMirrorFolder(targetDir, { dataDir, appDir } = {}) {
  if (!targetDir || typeof targetDir !== 'string' || !targetDir.trim()) {
    return { ok: false, error: 'Please enter or select a backup folder path.' };
  }

  const resolved = path.resolve(targetDir.trim());
  if (dataDir && isPathInside(resolved, dataDir)) {
    return {
      ok: false,
      error: 'Choose a folder outside the local app data folder (for example Google Drive, OneDrive, D:\\ drive, or a USB drive).',
    };
  }
  if (appDir && isPathInside(resolved, appDir)) {
    return {
      ok: false,
      error: 'Choose a folder outside the Arth-Sutra program folder so app reinstalls or PC crashes cannot erase it.',
    };
  }

  const lower = resolved.toLowerCase();
  if (/^[a-z]:\\(windows|program files|program files \(x86\))(\\.*)?$/i.test(lower)) {
    return { ok: false, error: 'Cannot store backups inside Windows system folders.' };
  }

  // Ensure the drive root itself exists on Windows (e.g. G:\ or E:\ when unplugged)
  const parsed = path.parse(resolved);
  if (parsed.root && !fs.existsSync(parsed.root)) {
    return {
      ok: false,
      error: `Drive "${parsed.root}" is not connected right now. Plug in the drive or start Google Drive for Desktop first.`,
    };
  }

  const probeFile = path.join(resolved, `.arthsutra-write-test-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    fs.writeFileSync(probeFile, 'ok', 'utf8');
    const readBack = fs.readFileSync(probeFile, 'utf8');
    fs.unlinkSync(probeFile);
    if (readBack !== 'ok') {
      return { ok: false, error: 'Write verification failed in target folder.' };
    }
    return { ok: true, resolvedPath: resolved };
  } catch (err) {
    try { if (fs.existsSync(probeFile)) fs.unlinkSync(probeFile); } catch { /* ignore */ }
    return { ok: false, error: `Folder is not writable: ${err.message}` };
  }
}

/**
 * Incrementally mirrors PDF files from `srcDir` into `destDir`, copying only
 * new or modified files so cloud syncs remain fast and lightweight.
 */
export function syncDirectoryIncremental(srcDir, destDir) {
  const stats = { copied: 0, skipped: 0, errors: 0 };
  if (!srcDir || !fs.existsSync(srcDir)) return stats;

  const walk = (curSrc, curDest) => {
    let entries = [];
    try {
      entries = fs.readdirSync(curSrc, { withFileTypes: true });
    } catch {
      stats.errors += 1;
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const srcPath = path.join(curSrc, entry.name);
      const destPath = path.join(curDest, entry.name);
      try {
        if (entry.isDirectory()) {
          walk(srcPath, destPath);
        } else if (entry.isFile()) {
          const sStat = fs.statSync(srcPath);
          let needsCopy = true;
          if (fs.existsSync(destPath)) {
            const dStat = fs.statSync(destPath);
            if (dStat.size === sStat.size && dStat.mtimeMs >= sStat.mtimeMs - 1000) {
              needsCopy = false;
            }
          }
          if (needsCopy) {
            copyFileAtomicCrossDrive(srcPath, destPath);
            stats.copied += 1;
          } else {
            stats.skipped += 1;
          }
        }
      } catch {
        stats.errors += 1;
      }
    }
  };

  walk(srcDir, destDir);
  return stats;
}

const HOW_TO_RESTORE_GUIDE = `Arth-Sutra Off-PC Disaster Recovery Guide
==========================================

If your PC crashes, gets formatted, or you move to a new computer:

1. Install and launch Arth-Sutra on the new computer.
2. On the First-Time Setup screen (or under Settings -> Data Management -> Import Backup):
   Click "Restore from Backup".
3. Choose the newest backup file from this folder:
   - "latest-backup.arthbackup"  (if Recovery Password encryption is enabled)
   - "latest-backup.json"        (portable full JSON backup)
   - "latest-backup.sqlite"      (direct SQLite database snapshot)
   - Or any older dated snapshot in the "daily" subfolder.
4. Enter your Recovery Password (if prompted). All invoices, clients, inventory,
   purchases, expenses, receipts, and settings will be restored.

If you also synced "Saved Invoices", copy that folder back to retrieve generated PDFs.
`;

/**
 * Mirrors a verified backup snapshot (and optional PDFs) to the configured
 * external / cloud-synced mirror folder (e.g., Google Drive Desktop or OneDrive).
 */
export async function mirrorBackupToFolder({
  mirrorPath,
  sqliteConn,
  exportPayload,
  recoveryPassword = '',
  mirrorPdfs = true,
  invoicesDir = '',
  dataDir = '',
  appDir = '',
  retentionDays = 30,
}) {
  const validation = validateMirrorFolder(mirrorPath, { dataDir, appDir });
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const targetRoot = validation.resolvedPath;
  const dailyDir = path.join(targetRoot, 'daily');
  fs.mkdirSync(dailyDir, { recursive: true });

  const guidePath = path.join(targetRoot, 'HOW-TO-RESTORE.txt');
  if (!fs.existsSync(guidePath)) {
    try { writeFileAtomic(guidePath, HOW_TO_RESTORE_GUIDE); } catch { /* ignore */ }
  }

  const today = todayLocalIso();
  const filesWritten = [];

  if (recoveryPassword) {
    const encryptedContent = encryptBackupBundle(exportPayload, recoveryPassword);
    const latestEnc = path.join(targetRoot, 'latest-backup.arthbackup');
    const dailyEnc = path.join(dailyDir, `${today}.arthbackup`);
    writeFileAtomic(latestEnc, encryptedContent, 'utf8');
    writeFileAtomic(dailyEnc, encryptedContent, 'utf8');
    filesWritten.push('latest-backup.arthbackup', `daily/${today}.arthbackup`);

    // Prune older daily .arthbackup files
    pruneDatedFiles(dailyDir, /^\d{4}-\d{2}-\d{2}\.arthbackup$/, retentionDays);
  } else {
    const latestSqlite = path.join(targetRoot, 'latest-backup.sqlite');
    const dailySqlite = path.join(dailyDir, `${today}.sqlite`);
    await createSafeSqliteSnapshot(sqliteConn, latestSqlite);
    copyFileAtomicCrossDrive(latestSqlite, dailySqlite);

    const jsonText = JSON.stringify(exportPayload, null, 2);
    const latestJson = path.join(targetRoot, 'latest-backup.json');
    writeFileAtomic(latestJson, jsonText, 'utf8');

    filesWritten.push('latest-backup.sqlite', 'latest-backup.json', `daily/${today}.sqlite`);
    pruneDatedFiles(dailyDir, /^\d{4}-\d{2}-\d{2}\.sqlite$/, retentionDays);
  }

  let pdfSync = null;
  if (mirrorPdfs && invoicesDir && fs.existsSync(invoicesDir)) {
    pdfSync = syncDirectoryIncremental(invoicesDir, path.join(targetRoot, 'Saved Invoices'));
  }

  return {
    ok: true,
    resolvedPath: targetRoot,
    syncedAt: new Date().toISOString(),
    encrypted: Boolean(recoveryPassword),
    filesWritten,
    pdfSync,
  };
}

function pruneDatedFiles(dir, pattern, maxKeep) {
  try {
    const files = fs.readdirSync(dir).filter(n => pattern.test(n)).sort();
    while (files.length > maxKeep) {
      const oldest = files.shift();
      try { fs.unlinkSync(path.join(dir, oldest)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
