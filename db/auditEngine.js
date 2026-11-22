// db/auditEngine.js
// ─────────────────────────────────────────────────────────────────────────────
// Cryptographically Auditable Event Log Engine
// Appends tamper-evident audit records inside atomic database transactions.
// ─────────────────────────────────────────────────────────────────────────────

import { desc, asc } from 'drizzle-orm';
import { db, sqlite, auditLogs } from './index.js';
import { generateAuditHash } from '../src/utils/audit.js';

/**
 * Appends an audit log entry inside the given transaction `tx`.
 * 
 * @param {string} entityType - "bill" | "product" | "purchase"
 * @param {string} entityId   - Unique identifier of the entity
 * @param {string} action     - "CREATE" | "UPDATE" | "DELETE"
 * @param {object|string} payload - Data state being written
 * @param {object} [tx]       - Active Drizzle transaction or better-sqlite3 instance
 * @returns {object} The created audit record
 */
export function logEvent(entityType, entityId, action, payload, tx = db) {
  let previousHash = 'GENESIS';

  // Support both Drizzle transactions and raw better-sqlite3 connections
  if (tx && typeof tx.prepare === 'function') {
    // Raw sqlite connection
    const latest = tx.prepare('SELECT current_hash FROM audit_logs ORDER BY id DESC LIMIT 1').get();
    if (latest && latest.current_hash) {
      previousHash = latest.current_hash;
    }

    const { currentHash, sanitizedPayloadStr, timestamp } = generateAuditHash(payload, previousHash);

    const insertStmt = tx.prepare(`
      INSERT INTO audit_logs (entity_type, entity_id, action, payload, previous_hash, current_hash, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertStmt.run(
      entityType,
      String(entityId),
      action,
      sanitizedPayloadStr,
      previousHash,
      currentHash,
      timestamp
    );

    return {
      id: result.lastInsertRowid,
      entityType,
      entityId: String(entityId),
      action,
      payload: sanitizedPayloadStr,
      previousHash,
      currentHash,
      timestamp,
    };
  }

  // Drizzle transaction or instance
  const latestRow = tx.select({ currentHash: auditLogs.currentHash })
    .from(auditLogs)
    .orderBy(desc(auditLogs.id))
    .limit(1)
    .get();

  if (latestRow && latestRow.currentHash) {
    previousHash = latestRow.currentHash;
  }

  const { currentHash, sanitizedPayloadStr, timestamp } = generateAuditHash(payload, previousHash);

  const inserted = tx.insert(auditLogs).values({
    entityType,
    entityId: String(entityId),
    action,
    payload: sanitizedPayloadStr,
    previousHash,
    currentHash,
    timestamp,
  }).returning().get();

  return inserted;
}

/**
 * Reads the audit_logs table from oldest to newest and recomputes the SHA-256
 * hash chain. Returns whether the audit trail is valid or flags corrupted rows.
 * 
 * @param {object} [client] - Drizzle instance or better-sqlite3 connection
 * @returns {{ valid: boolean, totalRecords?: number, corruptedAtId?: number, reason?: string }}
 */
export function verifyAuditChain(client = db) {
  let rows = [];

  if (client && typeof client.prepare === 'function') {
    const rawRows = client.prepare('SELECT * FROM audit_logs ORDER BY id ASC').all();
    rows = rawRows.map(r => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      payload: r.payload,
      previousHash: r.previous_hash,
      currentHash: r.current_hash,
      timestamp: r.timestamp,
    }));
  } else {
    rows = client.select().from(auditLogs).orderBy(asc(auditLogs.id)).all();
  }

  if (!rows || rows.length === 0) {
    return { valid: true, totalRecords: 0 };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // 1. Check previousHash link
    if (i === 0) {
      if (row.previousHash !== 'GENESIS') {
        return {
          valid: false,
          corruptedAtId: row.id,
          reason: `Genesis row previousHash is "${row.previousHash}", expected "GENESIS"`,
        };
      }
    } else {
      const prevRow = rows[i - 1];
      if (row.previousHash !== prevRow.currentHash) {
        return {
          valid: false,
          corruptedAtId: row.id,
          reason: `Row previousHash "${row.previousHash}" does not match preceding currentHash "${prevRow.currentHash}"`,
        };
      }
    }

    // 2. Recompute and check currentHash
    const { currentHash: recomputedHash } = generateAuditHash(
      row.payload,
      row.previousHash,
      row.timestamp
    );

    if (recomputedHash !== row.currentHash) {
      return {
        valid: false,
        corruptedAtId: row.id,
        reason: `Row currentHash "${row.currentHash}" does not match recomputed hash "${recomputedHash}"`,
      };
    }
  }

  return { valid: true, totalRecords: rows.length };
}
