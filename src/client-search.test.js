import { describe, it, expect } from 'vitest';
import {
  normalizeClientKey,
  toClientFormShape,
  mergeSavedAndBillClients,
  filterClientSuggestions,
  buildClientUpsertPayload,
} from './utils/clientDirectory.js';

describe('clientDirectory helpers', () => {
  it('normalizes names and maps records to exact invoice client form shape including licence (DL No.)', () => {
    expect(normalizeClientKey('  CITI   PATH  LABS ')).toBe('citi path labs');

    const shape = toClientFormShape({
      id: 'cli_1',
      name: 'CITI PATH LABS',
      address: 'Flat No. 4 Phase 2',
      city: 'Bhopal',
      pin: '462039',
      state: 'Madhya Pradesh',
      gstin: '23EQOPS7844J2Z0',
      licence: '20B/456/26',
      phone: '9425877961',
      country: 'India',
    });

    expect(shape).toEqual({
      name: 'CITI PATH LABS',
      address: 'Flat No. 4 Phase 2',
      city: 'Bhopal',
      pin: '462039',
      state: 'Madhya Pradesh',
      gstin: '23EQOPS7844J2Z0',
      country: 'India',
      email: '',
      phone: '9425877961',
      isSEZ: false,
      licence: '20B/456/26',
    });
  });

  it('merges saved clients with past bills so historical bill clients like CITI PATH LABS appear immediately', () => {
    const saved = [
      { id: 'cli_1', name: 'CITI PATH LABS', gstin: '23EQOPS7844J2Z0', licence: '', address: '' },
    ];
    const bills = [
      {
        id: 'INV-18',
        invoiceNumber: 'INV/2026-27/0018',
        invoiceDate: '2026-11-10',
        data: {
          client: {
            name: 'CITI PATH LABS',
            gstin: '23EQOPS7844J2Z0',
            licence: '20B/OLD',
            address: 'Old Address',
            city: 'Bhopal',
          },
        },
      },
      {
        id: 'INV-19',
        invoiceNumber: 'INV/2026-27/0019',
        invoiceDate: '2026-11-20',
        data: {
          client: {
            name: 'CITI PATH LABS',
            gstin: '23EQOPS7844J2Z0',
            licence: '20B/NEW/2026',
            address: 'Flat No. 4 Phase 2',
            city: 'Bhopal',
            state: 'Madhya Pradesh',
            pin: '462039',
          },
        },
      },
      {
        id: 'INV-20',
        invoiceNumber: 'INV/2026-27/0020',
        invoiceDate: '2026-11-21',
        data: {
          client: {
            name: 'Apollo Diagnostics',
            gstin: '27AAAAP1234A1Z5',
            licence: '21B/777',
            city: 'Indore',
          },
        },
      },
      {
        id: 'INV-TRASHED',
        isTrashed: true,
        data: { client: { name: 'Deleted Client' } },
      },
    ];

    const merged = mergeSavedAndBillClients(saved, bills);
    expect(merged.map(c => c.name)).toEqual(['Apollo Diagnostics', 'CITI PATH LABS']);

    const citi = merged.find(c => c.name === 'CITI PATH LABS');
    expect(citi.id).toBe('cli_1');
    expect(citi._fromHistory).toBeUndefined();
    // Missing fields on saved record were backfilled from the NEWEST bill snapshot
    expect(citi.licence).toBe('20B/NEW/2026');
    expect(citi.address).toBe('Flat No. 4 Phase 2');
    expect(citi.pin).toBe('462039');

    const apollo = merged.find(c => c.name === 'Apollo Diagnostics');
    expect(apollo._fromHistory).toBe(true);
    expect(apollo.licence).toBe('21B/777');
  });

  it('finds clients by partial name ("citi path"), multi-word query, GSTIN, DL No., phone, or city', () => {
    const clients = [
      {
        id: 'cli_1',
        name: 'CITI PATH LABS',
        gstin: '23EQOPS7844J2Z0',
        licence: '20B/456/26',
        city: 'Bhopal',
        phone: '9425877961',
      },
      {
        id: 'cli_2',
        name: 'MediCare Diagnostics',
        gstin: '27ABCDE1234F1Z2',
        licence: '21B/999',
        city: 'Indore',
        phone: '9826011223',
      },
    ];

    expect(filterClientSuggestions(clients, 'citi path').map(c => c.name)).toEqual(['CITI PATH LABS']);
    expect(filterClientSuggestions(clients, 'citi bhopal').map(c => c.name)).toEqual(['CITI PATH LABS']);
    expect(filterClientSuggestions(clients, '23EQO').map(c => c.name)).toEqual(['CITI PATH LABS']);
    expect(filterClientSuggestions(clients, '20B/456').map(c => c.name)).toEqual(['CITI PATH LABS']);
    expect(filterClientSuggestions(clients, '9826011').map(c => c.name)).toEqual(['MediCare Diagnostics']);
    expect(filterClientSuggestions(clients, 'unknownxyz')).toEqual([]);
  });

  it('auto-builds a new client upsert payload when billing a never-saved client', () => {
    const payload = buildClientUpsertPayload(
      {
        name: '  CITI PATH LABS ',
        gstin: '23eqops7844j2z0',
        licence: '20B/1234/26',
        address: 'Flat No. 4 Phase 2',
        city: 'Bhopal',
        pin: '462039',
        state: 'Madhya Pradesh',
        country: 'India',
      },
      {
        savedClients: [],
        preferencePatch: { preferredPaperSize: 'a4', preferredCurrency: 'INR' },
      },
    );

    expect(payload.isNew).toBe(true);
    expect(payload.changed).toBe(true);
    expect(payload.record).toMatchObject({
      name: 'CITI PATH LABS',
      gstin: '23EQOPS7844J2Z0',
      licence: '20B/1234/26',
      city: 'Bhopal',
      pin: '462039',
      preferredPaperSize: 'a4',
    });
  });

  it('updates newly entered DL No. / GSTIN onto an existing client while preserving existing email/phone, and stays idempotent when unchanged', () => {
    const existingList = [
      {
        id: 'cli_1',
        name: 'CITI PATH LABS',
        gstin: '23EQOPS7844J2Z0',
        licence: '',
        address: 'Flat No. 4',
        city: 'Bhopal',
        pin: '462039',
        state: 'Madhya Pradesh',
        country: 'India',
        email: 'lab@citipath.in',
        phone: '9425877961',
        isSEZ: false,
        preferredPaperSize: 'a4',
        preferredCurrency: 'INR',
      },
    ];

    const updated = buildClientUpsertPayload(
      {
        name: 'CITI PATH LABS',
        gstin: '23EQOPS7844J2Z0',
        licence: '20B/789/26',
        address: 'Flat No. 4',
        city: 'Bhopal',
        pin: '462039',
        state: 'Madhya Pradesh',
        country: 'India',
        email: '', // blank on invoice form -> existing email should be preserved!
        phone: '',
      },
      { savedClients: existingList, selectedClientId: 'cli_1' },
    );

    expect(updated.isNew).toBe(false);
    expect(updated.changed).toBe(true);
    expect(updated.record.id).toBe('cli_1');
    expect(updated.record.licence).toBe('20B/789/26');
    expect(updated.record.email).toBe('lab@citipath.in');
    expect(updated.record.phone).toBe('9425877961');

    // Repeating with the already-saved record produces changed: false
    const noop = buildClientUpsertPayload(updated.record, {
      savedClients: [updated.record],
      selectedClientId: 'cli_1',
    });
    expect(noop.changed).toBe(false);
  });

  it('does NOT overwrite an unrelated selectedClientId if user typed a different client name', () => {
    const existingList = [
      { id: 'cli_1', name: 'CITI PATH LABS', gstin: '23EQOPS7844J2Z0' },
    ];

    const payload = buildClientUpsertPayload(
      { name: 'Sunrise Clinic', gstin: '23OTHER1234A1Z9', licence: '21B/NEW' },
      { savedClients: existingList, selectedClientId: 'cli_1' },
    );

    expect(payload.isNew).toBe(true);
    expect(payload.record.id).toBeUndefined();
    expect(payload.record.name).toBe('Sunrise Clinic');
  });
});
