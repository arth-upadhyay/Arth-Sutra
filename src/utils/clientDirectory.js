// src/utils/clientDirectory.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers for client directory search, historical bill extraction,
// multi-token matching, and automatic client upsert on invoice save/print.
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeClientKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function toClientFormShape(c = {}) {
  return {
    name: c.name || '',
    address: c.address || '',
    city: c.city || '',
    pin: c.pin || '',
    state: c.state || '',
    gstin: c.gstin || '',
    country: c.country || '',
    email: c.email || '',
    phone: c.phone || '',
    isSEZ: !!c.isSEZ,
    licence: c.licence || '',
  };
}

const CLIENT_STR_FIELDS = [
  'name', 'address', 'city', 'pin', 'state',
  'gstin', 'country', 'email', 'phone', 'licence',
];

/**
 * Combines explicitly saved clients (`/api/clients`) with unique client
 * snapshots extracted from existing non-trashed bills (newest bill first).
 * Saved records always win when non-empty; empty fields on saved records
 * (e.g. DL No. / GSTIN) are filled from recent bill snapshots.
 */
export function mergeSavedAndBillClients(savedClients = [], bills = []) {
  const byKey = new Map();
  const byGstin = new Map();

  for (const raw of Array.isArray(savedClients) ? savedClients : []) {
    const trimmedName = String(raw?.name || '').trim();
    if (!trimmedName) continue;
    const key = normalizeClientKey(trimmedName);
    const rec = { ...toClientFormShape(raw), ...raw, name: trimmedName };
    byKey.set(key, rec);
    const gst = String(rec.gstin || '').trim().toUpperCase();
    if (gst) byGstin.set(gst, key);
  }

  const sortedBills = (Array.isArray(bills) ? bills : [])
    .filter(b => b && !b.isTrashed)
    .slice()
    .sort((a, b) => String(b.invoiceDate || '').localeCompare(String(a.invoiceDate || '')));

  for (const bill of sortedBills) {
    const snap = bill?.data?.client || (bill?.clientName ? { name: bill.clientName } : null);
    const trimmedName = String(snap?.name || '').trim();
    if (!trimmedName) continue;

    const key = normalizeClientKey(trimmedName);
    const gst = String(snap?.gstin || '').trim().toUpperCase();
    const targetKey = byKey.has(key) ? key : (gst && byGstin.has(gst) ? byGstin.get(gst) : null);

    if (targetKey) {
      const existing = byKey.get(targetKey);
      for (const f of CLIENT_STR_FIELDS) {
        if (f === 'name') continue;
        if (!String(existing[f] || '').trim() && String(snap?.[f] || '').trim()) {
          existing[f] = String(snap[f]).trim();
        }
      }
      if (!existing.isSEZ && snap?.isSEZ) existing.isSEZ = true;
      continue;
    }

    const synthetic = {
      ...toClientFormShape(snap),
      id: `hist_${key}`,
      name: trimmedName,
      _fromHistory: true,
      _sourceBillId: bill.invoiceNumber || bill.id || '',
    };
    byKey.set(key, synthetic);
    if (gst) byGstin.set(gst, key);
  }

  return Array.from(byKey.values()).sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
  );
}

/**
 * Searches saved & historical clients across name, GSTIN, Drug Licence No.,
 * phone, city, and address with prefix relevance ranking (matching product search UX).
 */
export function filterClientSuggestions(clients = [], query = '', limit = 8) {
  const list = Array.isArray(clients)
    ? clients.filter(c => c && String(c.name || '').trim())
    : [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return list.slice(0, limit);

  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = [];

  for (const c of list) {
    const lname = String(c.name || '').toLowerCase();
    const gst = String(c.gstin || '').toLowerCase();
    const lic = String(c.licence || '').toLowerCase();
    const haystack = [c.name, c.gstin, c.licence, c.phone, c.city, c.address, c.state, c.pin]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (!tokens.every(t => haystack.includes(t))) continue;

    let rank = 3;
    if (lname.startsWith(q)) rank = 0;
    else if (lname.includes(q)) rank = 1;
    else if (gst.startsWith(q) || lic.startsWith(q)) rank = 2;

    scored.push({ client: c, rank });
  }

  scored.sort((a, b) =>
    (a.rank - b.rank)
    || String(a.client.name || '').localeCompare(String(b.client.name || ''), undefined, { sensitivity: 'base' })
  );

  return scored.slice(0, limit).map(s => s.client);
}

/**
 * Builds an upsert payload for `saveClient` from the invoice's client fields.
 * Merges incoming non-empty fields onto any existing saved record matching
 * `selectedClientId` (when the name matches), client name, or GSTIN.
 */
export function buildClientUpsertPayload(
  formClient = {},
  { savedClients = [], selectedClientId = null, preferencePatch = {} } = {},
) {
  const trimmedName = String(formClient?.name || '').trim();
  if (!trimmedName) return null;

  const key = normalizeClientKey(trimmedName);
  const formGstin = String(formClient?.gstin || '').trim().toUpperCase();
  const realSaved = (Array.isArray(savedClients) ? savedClients : [])
    .filter(c => c && c.id && !String(c.id).startsWith('hist_') && !c._fromHistory);

  let existing = null;
  if (selectedClientId && !String(selectedClientId).startsWith('hist_')) {
    const byId = realSaved.find(c => c.id === selectedClientId);
    if (byId && normalizeClientKey(byId.name) === key) existing = byId;
  }
  if (!existing) {
    existing = realSaved.find(c => normalizeClientKey(c.name) === key) || null;
  }
  if (!existing && formGstin) {
    existing = realSaved.find(c => String(c.gstin || '').trim().toUpperCase() === formGstin) || null;
  }

  const next = {
    ...(existing || {}),
    name: trimmedName,
  };

  for (const field of CLIENT_STR_FIELDS) {
    if (field === 'name') continue;
    const incoming = formClient[field] != null ? String(formClient[field]).trim() : '';
    const prev = existing?.[field] != null ? String(existing[field]).trim() : '';
    next[field] = incoming || prev || '';
  }

  next.gstin = String(next.gstin || '').toUpperCase();
  next.isSEZ = formClient.isSEZ !== undefined ? !!formClient.isSEZ : !!existing?.isSEZ;

  for (const [pk, pv] of Object.entries(preferencePatch || {})) {
    if (pv !== undefined && pv !== '') next[pk] = pv;
  }

  if (!existing) {
    return { record: next, changed: true, isNew: true };
  }

  const keysToCompare = [
    ...CLIENT_STR_FIELDS,
    'isSEZ',
    'preferredPaperSize',
    'preferredCurrency',
    'preferredLayoutFormat',
    'autoPrint',
  ];
  const changed = keysToCompare.some((k) => {
    if (k === 'isSEZ' || k === 'autoPrint') return !!next[k] !== !!existing[k];
    return String(next[k] || '') !== String(existing[k] || '');
  });

  return { record: next, changed, isNew: false };
}
