// src/utils/offlineSync.js
// ─────────────────────────────────────────────────────────────────────────────
// IndexedDB Write-Behind Queue for Offline-First PWA
// Uses `idb` to queue mutations when offline and replays them when back online.
// ─────────────────────────────────────────────────────────────────────────────

import { openDB } from 'idb';

const DB_NAME = 'ArthSutraOffline';
const DB_VERSION = 1;
const STORE_NAME = 'syncQueue';

/**
 * Opens or initializes the IndexedDB database.
 */
export async function getOfflineDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    },
  });
}

/**
 * Returns true if the request body or headers indicate a multipart upload.
 */
function isMultipartRequest(options) {
  if (options?.body instanceof FormData) return true;
  const contentType = options?.headers?.['Content-Type'] || options?.headers?.['content-type'] || '';
  return typeof contentType === 'string' && contentType.includes('multipart/form-data');
}

/**
 * offlineFetch:
 * Wrapper around window.fetch with write-behind queueing for offline operation.
 */
export async function offlineFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PUT', 'DELETE'].includes(method);

  // Inject Authorization header if token exists in localStorage
  const token = localStorage.getItem('arthsutra_token');
  const headers = { ...(options.headers || {}) };
  if (token && !headers['Authorization'] && !headers['authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // File Upload Exception: Reject multipart uploads when offline
  if (isMultipartRequest(options)) {
    if (!navigator.onLine) {
      throw new Error('File uploads require an internet connection.');
    }
    return fetch(url, { ...options, headers });
  }

  // Online flow: Attempt normal fetch
  if (navigator.onLine) {
    try {
      const res = await fetch(url, { ...options, headers });
      return res;
    } catch (err) {
      // If network failed (e.g. TypeError from dropped connection) and it is a mutation,
      // fall through to write-behind queueing.
      if (!isMutation) {
        throw err;
      }
    }
  }

  // Offline mutation flow: Queue to IndexedDB with Idempotency Key
  if (isMutation) {
    const idempotencyKey = crypto.randomUUID();
    headers['X-Idempotency-Key'] = idempotencyKey;

    try {
      const db = await getOfflineDB();
      await db.add(STORE_NAME, {
        url,
        method,
        headers,
        body: options.body,
        idempotencyKey,
        queuedAt: new Date().toISOString(),
      });

      // Return synthetic 202 Accepted response
      return new Response(JSON.stringify({ success: true, offline: true, idempotencyKey }), {
        status: 202,
        statusText: 'Accepted (Queued Offline)',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (dbErr) {
      console.error('Failed to queue offline request in IndexedDB:', dbErr);
      throw new Error('Offline storage unavailable: ' + dbErr.message);
    }
  }

  // Offline GET request: let service worker cache handle or return offline error
  return fetch(url, { ...options, headers });
}

/**
 * Replays all queued mutations from IndexedDB when network connectivity resumes.
 */
export async function replaySyncQueue() {
  if (!navigator.onLine) return;

  try {
    const db = await getOfflineDB();
    const items = await db.getAll(STORE_NAME);
    if (!items || items.length === 0) return;

    let successCount = 0;
    for (const item of items) {
      try {
        const token = localStorage.getItem('arthsutra_token');
        const headers = { ...item.headers };
        if (token && !headers['Authorization'] && !headers['authorization']) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(item.url, {
          method: item.method,
          headers,
          body: item.body,
        });

        // 2xx response means server accepted or idempotency returned cached response
        if (res.ok) {
          await db.delete(STORE_NAME, item.id);
          successCount++;
        } else if (res.status >= 400 && res.status < 500 && res.status !== 409) {
          // Client error that cannot be resolved by retrying (e.g., bad format), remove
          await db.delete(STORE_NAME, item.id);
        }
      } catch (reqErr) {
        console.warn('Network error during offline sync replay, will retry later:', reqErr);
        break; // Stop and retry later if network failed again
      }
    }

    if (successCount > 0) {
      window.dispatchEvent(new CustomEvent('syncComplete', { detail: { count: successCount } }));
    }
  } catch (err) {
    console.error('Error during replaySyncQueue:', err);
  }
}
