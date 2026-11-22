// src/utils/audit.js
// ─────────────────────────────────────────────────────────────────────────────
// Cryptographic Audit Trail Utilities
// Provides recursive payload sanitization (stripping Base64 images/signatures)
// and SHA-256 hash chaining to ensure tamper-evident records.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';

/**
 * Deeply scrubs large Base64 strings, logos, and signatures from objects/arrays
 * to keep audit log payloads compact and deterministic.
 */
export function sanitizePayload(data) {
  if (data === null || data === undefined) {
    return null;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizePayload(item));
  }

  if (typeof data === 'object') {
    const cleaned = {};
    // Sort keys for deterministic JSON serialization
    const keys = Object.keys(data).sort();
    for (const key of keys) {
      // Scrub known binary/image keys
      if (key === 'logo' || key === 'signature') {
        cleaned[key] = '[STRIPPED]';
        continue;
      }

      const val = data[key];

      // Scrub data URI images or large base64 strings
      if (typeof val === 'string') {
        if (val.startsWith('data:image/')) {
          cleaned[key] = '[STRIPPED_IMAGE]';
          continue;
        }
        if (val.length > 2000 && /^[A-Za-z0-9+/=]+$/.test(val.slice(0, 100))) {
          cleaned[key] = '[STRIPPED_BASE64]';
          continue;
        }
      }

      cleaned[key] = sanitizePayload(val);
    }
    return cleaned;
  }

  if (typeof data === 'string') {
    if (data.startsWith('data:image/')) {
      return '[STRIPPED_IMAGE]';
    }
    // If it's a JSON string, try parsing and sanitizing
    if ((data.startsWith('{') && data.endsWith('}')) || (data.startsWith('[') && data.endsWith(']'))) {
      try {
        const parsed = JSON.parse(data);
        return sanitizePayload(parsed);
      } catch {
        // Not valid JSON, keep as string
      }
    }
  }

  return data;
}

/**
 * Serializes sanitized payload to deterministic JSON string.
 */
export function stringifyPayload(payload) {
  const sanitized = sanitizePayload(payload);
  return JSON.stringify(sanitized);
}

/**
 * Generates SHA-256 hash chaining the previousHash, timestamp, and sanitized payload.
 * 
 * @param {string|object} payload - The mutation payload (object or string)
 * @param {string} previousHash - SHA-256 hash of previous row, or "GENESIS"
 * @param {string} [timestamp] - ISO date string. If omitted, uses current time.
 * @returns {{ currentHash: string, sanitizedPayloadStr: string, timestamp: string }}
 */
export function generateAuditHash(payload, previousHash, timestamp) {
  const ts = timestamp || new Date().toISOString();
  const payloadStr = typeof payload === 'string' && payload.startsWith('{')
    ? stringifyPayload(payload)
    : stringifyPayload(payload);

  const hashInput = `${previousHash}:${ts}:${payloadStr}`;
  const currentHash = crypto.createHash('sha256').update(hashInput, 'utf8').digest('hex');

  return {
    currentHash,
    sanitizedPayloadStr: payloadStr,
    timestamp: ts,
  };
}
