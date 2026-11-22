import { describe, it, expect } from 'vitest';
import { sanitizePayload, generateAuditHash } from './utils/audit.js';
import { logEvent, verifyAuditChain } from '../db/auditEngine.js';
import { db, sqlite, auditLogs } from '../db/index.js';
import { eq } from 'drizzle-orm';

describe('Cryptographically Auditable Event Log', () => {
  it('deeply sanitizes large base64 strings and logo/signatures', () => {
    const dirty = {
      id: 'INV-100',
      nested: {
        logo: 'data:image/png;base64,samplebase64data',
        signature: 'data:image/svg+xml;base64,samplesignature',
        description: 'Normal text',
      },
      list: [
        { photo: 'data:image/jpeg;base64,photo1', name: 'item1' },
      ],
    };

    const clean = sanitizePayload(dirty);
    expect(clean.nested.logo).toBe('[STRIPPED]');
    expect(clean.nested.signature).toBe('[STRIPPED]');
    expect(clean.nested.description).toBe('Normal text');
    expect(clean.list[0].photo).toBe('[STRIPPED_IMAGE]');
    expect(clean.list[0].name).toBe('item1');
  });

  it('generates consistent SHA-256 audit hashes', () => {
    const h1 = generateAuditHash({ a: 1, b: 2 }, 'GENESIS', '2026-11-23T00:00:00.000Z');
    const h2 = generateAuditHash({ b: 2, a: 1 }, 'GENESIS', '2026-11-23T00:00:00.000Z');
    expect(h1.currentHash).toBe(h2.currentHash);
    expect(h1.currentHash.length).toBe(64);
  });

  it('records audit events inside transactions and verifies chain', () => {
    db.transaction((tx) => {
      logEvent('bill', 'INV-VITEST-1', 'CREATE', { total: 100 }, tx);
      logEvent('product', 'prod-vitest-1', 'UPDATE', { stock: 25 }, tx);
    });

    const verification = verifyAuditChain(db);
    expect(verification.valid).toBe(true);
    expect(verification.totalRecords).toBeGreaterThanOrEqual(2);

    // Clean up test rows
    sqlite.prepare("DELETE FROM audit_logs WHERE entity_id LIKE '%vitest%'").run();
  });

  it('detects tampering when payload or previousHash is modified', () => {
    let testId;
    db.transaction((tx) => {
      const entry = logEvent('purchase', 'pur-tamper-test', 'CREATE', { total: 500 }, tx);
      testId = entry.id;
    });

    // Verify valid initially
    expect(verifyAuditChain(db).valid).toBe(true);

    // Tamper via raw SQL
    sqlite.prepare('UPDATE audit_logs SET payload = ? WHERE id = ?').run('{"total":9999}', testId);

    // Verification must detect the tampering
    const tamperedCheck = verifyAuditChain(db);
    expect(tamperedCheck.valid).toBe(false);
    expect(tamperedCheck.corruptedAtId).toBe(testId);

    // Clean up
    sqlite.prepare('DELETE FROM audit_logs WHERE id = ?').run(testId);
  });
});
