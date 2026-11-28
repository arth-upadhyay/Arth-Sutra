import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  detectCountryFromBrowser,
  getCountriesForRegion,
  getCountryConfig,
  getStatesForCountry,
  COUNTRIES,
  INDIA_COUNTRY_CONFIG,
  TERMS_PRESETS,
} from './utils.js';
import { db, profiles, clients } from '../db/index.js';
import { eq } from 'drizzle-orm';

// ═══════════════════════════════════════════════════════════════════════
// 1. India-Only Country Lock (no United States / ZIP / EIN fallbacks)
// ═══════════════════════════════════════════════════════════════════════
describe('India-Only Country Lock', () => {
  it('detectCountryFromBrowser() always returns "India"', () => {
    expect(detectCountryFromBrowser()).toBe('India');
  });

  it('COUNTRIES array contains only India', () => {
    expect(COUNTRIES).toHaveLength(1);
    expect(COUNTRIES[0].name).toBe('India');
    expect(COUNTRIES[0].code).toBe('IN');
  });

  it('getCountriesForRegion() returns only India regardless of args', () => {
    const result = getCountriesForRegion();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('India');
  });

  it('getCountryConfig() returns Indian configuration', () => {
    const cfg = getCountryConfig();
    expect(cfg.name).toBe('India');
    expect(cfg.currency).toBe('INR');
    expect(cfg.postalLabel).toBe('PIN Code');
    expect(cfg.taxIdLabel).toBe('GSTIN');
    expect(cfg.bankLabel).toBe('IFSC Code');
    expect(cfg.stateLabel).toBe('State');
    expect(cfg.taxLabel).toBe('GST');
    expect(cfg.hasStates).toBe(true);
  });

  it('INDIA_COUNTRY_CONFIG has no ZIP Code, EIN / TIN, or Routing Number labels', () => {
    expect(INDIA_COUNTRY_CONFIG.postalLabel).toBe('PIN Code');
    expect(INDIA_COUNTRY_CONFIG.taxIdLabel).toBe('GSTIN');
    expect(INDIA_COUNTRY_CONFIG.taxIdLabel).not.toContain('EIN');
    expect(INDIA_COUNTRY_CONFIG.bankLabel).toBe('IFSC Code');
    expect(INDIA_COUNTRY_CONFIG.bankLabel).not.toContain('Routing');
  });

  it('getStatesForCountry() returns Indian states and UTs', () => {
    const states = getStatesForCountry();
    expect(states.length).toBeGreaterThan(25);
    expect(states).toContain('Maharashtra');
    expect(states).toContain('Delhi');
    expect(states).toContain('Madhya Pradesh');
    expect(states).toContain('Ladakh');
    // Should NOT contain US states
    expect(states).not.toContain('California');
    expect(states).not.toContain('New York');
    expect(states).not.toContain('Texas');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Profile Drug Licence No. Persistence & Migration
// ═══════════════════════════════════════════════════════════════════════
describe('Profile Drug Licence No. (licence) Persistence', () => {
  const TEST_PROFILE_ID = `__test_licence_${Date.now()}`;

  it('profiles table has licence column', () => {
    // Insert a profile with licence and verify it round-trips
    db.insert(profiles).values({
      id: TEST_PROFILE_ID,
      businessName: 'Test Pharma Co',
      licence: 'DL-2024/B/MP/12345',
      country: 'India',
    }).run();

    const row = db.select().from(profiles).where(eq(profiles.id, TEST_PROFILE_ID)).get();
    expect(row).toBeDefined();
    expect(row.licence).toBe('DL-2024/B/MP/12345');
    expect(row.country).toBe('India');
    expect(row.businessName).toBe('Test Pharma Co');

    // Cleanup
    db.delete(profiles).where(eq(profiles.id, TEST_PROFILE_ID)).run();
  });

  it('profiles table persists tagline, logoHeight, aatoAbove5Cr, prevFYTurnover, currentFYTurnover', () => {
    db.insert(profiles).values({
      id: TEST_PROFILE_ID,
      businessName: 'Multi-Field Test',
      tagline: 'Wholesale Distributors',
      logoHeight: 72,
      aatoAbove5Cr: true,
      prevFYTurnover: '4,80,00,000',
      currentFYTurnover: '5,10,00,000',
      licence: 'DL-9999',
      country: 'India',
    }).run();

    const row = db.select().from(profiles).where(eq(profiles.id, TEST_PROFILE_ID)).get();
    expect(row.tagline).toBe('Wholesale Distributors');
    expect(row.logoHeight).toBe(72);
    expect(row.aatoAbove5Cr).toBe(true);
    expect(row.prevFYTurnover).toBe('4,80,00,000');
    expect(row.currentFYTurnover).toBe('5,10,00,000');
    expect(row.licence).toBe('DL-9999');

    db.delete(profiles).where(eq(profiles.id, TEST_PROFILE_ID)).run();
  });

  it('profiles.country defaults to India', () => {
    db.insert(profiles).values({
      id: TEST_PROFILE_ID,
      businessName: 'Default Country Test',
    }).run();

    const row = db.select().from(profiles).where(eq(profiles.id, TEST_PROFILE_ID)).get();
    expect(row.country).toBe('India');

    db.delete(profiles).where(eq(profiles.id, TEST_PROFILE_ID)).run();
  });

  it('clients.country defaults to India', () => {
    const TEST_CLIENT_ID = `__test_client_${Date.now()}`;
    db.insert(clients).values({
      id: TEST_CLIENT_ID,
      name: 'Test Client',
    }).run();

    const row = db.select().from(clients).where(eq(clients.id, TEST_CLIENT_ID)).get();
    expect(row.country).toBe('India');

    db.delete(clients).where(eq(clients.id, TEST_CLIENT_ID)).run();
  });

  it('clients table has licence column', () => {
    const TEST_CLIENT_ID = `__test_client_lic_${Date.now()}`;
    db.insert(clients).values({
      id: TEST_CLIENT_ID,
      name: 'Pharma Buyer',
      licence: 'DL-BUYER/2024/MH',
    }).run();

    const row = db.select().from(clients).where(eq(clients.id, TEST_CLIENT_ID)).get();
    expect(row.licence).toBe('DL-BUYER/2024/MH');

    db.delete(clients).where(eq(clients.id, TEST_CLIENT_ID)).run();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. TERMS_PRESETS Format & Lookup
// ═══════════════════════════════════════════════════════════════════════
describe('TERMS_PRESETS', () => {
  it('every preset has id, label, region, and body fields', () => {
    for (const preset of TERMS_PRESETS) {
      expect(preset).toHaveProperty('id');
      expect(preset).toHaveProperty('label');
      expect(preset).toHaveProperty('region');
      expect(preset).toHaveProperty('body');
      expect(typeof preset.id).toBe('string');
      expect(typeof preset.label).toBe('string');
      expect(typeof preset.body).toBe('string');
    }
  });

  it('contains Indian business presets', () => {
    const ids = TERMS_PRESETS.map(p => p.id);
    expect(ids).toContain('pharma-distributor');
    expect(ids).toContain('generic-sme');
  });

  it('pharma-distributor preset has relevant content', () => {
    const pharma = TERMS_PRESETS.find(p => p.id === 'pharma-distributor');
    expect(pharma).toBeDefined();
    expect(pharma.body).toContain('batch number');
    expect(pharma.body).toContain('expiry');
    expect(pharma.region).toBe('IN');
  });

  it('contains a blank starter preset', () => {
    const blank = TERMS_PRESETS.find(p => p.id === 'custom-blank');
    expect(blank).toBeDefined();
    expect(blank.body).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Near-Expiry Batch Alert Logic
// ═══════════════════════════════════════════════════════════════════════
describe('Near-Expiry Batch Alerts', () => {
  // Import dynamically since it's a component hook file
  it('computeNearExpiryBatches correctly identifies expiring batches', async () => {
    const { computeNearExpiryBatches } = await import('./components/Dashboard/hooks/useDashboardAlerts.js');

    const now = new Date(2026, 5, 15); // 15 Jun 2026 (local)
    const products = [
      {
        id: 'p1',
        name: 'Paracetamol 500mg',
        batches: [
          { batchNo: 'B001', expiry: '2026-07-01', quantity: 100 },  // expires within 60 days
          { batchNo: 'B002', expiry: '2027-12-01', quantity: 200 },  // safe
        ],
      },
      {
        id: 'p2',
        name: 'Amoxicillin 250mg',
        batches: [
          { batchNo: 'A001', expiry: '2026-05-01', quantity: 50 },   // already expired
        ],
      },
    ];

    const alerts = computeNearExpiryBatches(products, now, 60);
    expect(alerts).toHaveLength(2);  // A001 (expired) + B001 (near expiry)
    expect(alerts[0].batchNo).toBe('A001');
    expect(alerts[0].isExpired).toBe(true);
    expect(alerts[1].batchNo).toBe('B001');
    expect(alerts[1].isExpired).toBe(false);
    // B002 should NOT be flagged
    expect(alerts.some(a => a.batchNo === 'B002')).toBe(false);
  });

  it('aggregateAlerts surfaces near-expiry batches alongside low-stock alerts', async () => {
    const { aggregateAlerts } = await import('./components/Dashboard/hooks/useDashboardAlerts.js');
    const items = aggregateAlerts({
      nearExpiryBatches: [{ productName: 'Paracetamol 500mg', batchNo: 'B001', expiry: '2026-07-01' }],
    });
    const entry = items.find(a => a.id === 'near-expiry');
    expect(entry).toBeDefined();
    expect(entry.kind).toBe('warn');
    expect(entry.detail).toContain('B001');
  });

  it('returns empty array for products with no batches', async () => {
    const { computeNearExpiryBatches } = await import('./components/Dashboard/hooks/useDashboardAlerts.js');
    const result = computeNearExpiryBatches([], new Date());
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Store Region Lock
// ═══════════════════════════════════════════════════════════════════════
describe('Store Region Lock', () => {
  it('getRegionMode() always returns "india"', async () => {
    const { getRegionMode } = await import('./store.js');
    expect(getRegionMode()).toBe('india');
  });

  it('setRegionMode() is a no-op (does not throw)', async () => {
    const { setRegionMode } = await import('./store.js');
    // Should not throw
    expect(() => setRegionMode('both')).not.toThrow();
    expect(() => setRegionMode('india')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. PrintSettings 1-Up PDF Flags & Seller Sample Profile
// ═══════════════════════════════════════════════════════════════════════
describe('PrintSettings 1-up PDF flags & sample profile', () => {
  it('composeInvoicePdfFromCanvas renders 3 labeled copies on 1-up A4 when multiCopyEnabled is true', async () => {
    const { DEFAULT_PRINT_SETTINGS } = await import('./utils/printSettings.js');
    const { composeInvoicePdfFromCanvas } = await import('./utils/invoicePdfBuilder.js');

    const instances = [];
    class MockJsPDF {
      constructor(opts = {}) {
        this.opts = opts;
        this.addImageCalls = [];
        this.addPageCalls = [];
        this.textCalls = [];
        this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
        instances.push(this);
      }
      saveGraphicsState() {}
      restoreGraphicsState() {}
      setFont() {}
      setFontSize() {}
      setTextColor() {}
      addPage(...args) { this.addPageCalls.push(args); }
      addImage(...args) { this.addImageCalls.push(args); }
      text(label, x, y, opts) { this.textCalls.push({ label, x, y, opts }); }
    }

    const canvas = {
      width: 2100,
      height: 2970,
      toDataURL: () => 'data:image/jpeg;base64,MOCK',
    };

    composeInvoicePdfFromCanvas({
      jsPDF: MockJsPDF,
      canvas,
      paperCfg: { kind: 'sheet', widthMm: 210, jsPdfFormat: 'a4', jsPdfOrientation: 'portrait' },
      printSettings: {
        ...DEFAULT_PRINT_SETTINGS,
        twoPerPageEnabled: false,
        multiCopyEnabled: true,
        multiCopyCount: 3,
      },
    });

    expect(instances).toHaveLength(1);
    const pdf = instances[0];
    expect(pdf.addPageCalls).toHaveLength(2);
    expect(pdf.addImageCalls).toHaveLength(3);
    const labels = pdf.textCalls.map(t => t.label);
    expect(labels).toEqual([
      'ORIGINAL FOR RECIPIENT',
      'DUPLICATE FOR TRANSPORTER',
      'TRIPLICATE FOR SUPPLIER',
    ]);
  });

  it('buildSampleInvoice defaults sample customer & profile to India', async () => {
    const { buildSampleInvoice } = await import('./utils/printSettings.js');
    const sample = buildSampleInvoice();
    expect(sample.profile.country).toBe('India');
    expect(sample.client.country).toBe('India');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. Store importData (?overwrite=1) & Live Module Sync
// ═══════════════════════════════════════════════════════════════════════
describe('Store importData overwrite & live module sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('setEnabledModules persists to localStorage and emits fgsb-modules-changed', async () => {
    const storage = {};
    const events = [];
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
    });
    vi.stubGlobal('CustomEvent', class MockCustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', {
      dispatchEvent: (ev) => { events.push(ev); },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));

    const { setEnabledModules } = await import('./store.js');
    setEnabledModules({ ewayBill: true, gstr2b: false });

    expect(JSON.parse(storage.gst_enabledModules)).toEqual({ ewayBill: true, gstr2b: false });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('fgsb-modules-changed');
    expect(events[0].detail).toEqual({ ewayBill: true, gstr2b: false });
  });

  it('importData sends ?overwrite=1 by default and forwards trashedBills', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, counts: { bills: 1, trashedBills: 1 } }),
    });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { importData } = await import('./store.js');
    const bundle = JSON.stringify({
      version: 2,
      bills: [{ id: 'b1', invoiceNumber: 'INV/1' }],
      trashedBills: [{ id: 'b2', invoiceNumber: 'INV/2', isTrashed: true }],
    });

    await importData(bundle, { bills: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/import?overwrite=1');
    const sentBody = JSON.parse(init.body);
    expect(sentBody.bills).toHaveLength(1);
    expect(sentBody.trashedBills).toHaveLength(1);
  });
});
