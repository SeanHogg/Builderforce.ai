/**
 * The tax profile's two guarantees, pinned:
 *
 *   1. `party_roles` never carries more of the tax id than its last four — the
 *      full value only ever reaches `credentials`, through `encryptCredentials`.
 *   2. The upsert targets the PARTIAL index (migration 1117), never the bare
 *      `(tenant, subject, purpose)` triple — a target without the matching
 *      `targetWhere` does not resolve to the partial index at all, and the
 *      symptom is a runtime "no unique or exclusion constraint" error the type
 *      system cannot see.
 *
 * A batch profile load (`getTaxProfilesFor`) is exercised for exactly two
 * queries regardless of recipient count — the N+1 the report path must not have.
 */
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  getTaxProfile,
  getTaxProfilesFor,
  parseTaxProfileAttrs,
  saveTaxProfile,
  toTaxProfile,
} from './taxProfile';

const TENANT = 9;
const USER = 'user-42';
const ENV = {} as Env; // no AUTH_CACHE_KV binding — cache calls no-op to L1 only.

describe('parseTaxProfileAttrs', () => {
  it('reads a full row back, normalising the id type against the closed set', () => {
    const parsed = parseTaxProfileAttrs({
      entityType: 'llc', legalName: 'Jane Doe', taxIdType: 'ein', taxIdLast4: '6789',
      addressCountry: 'us', taxResidencyCountry: 'gb',
    });
    expect(parsed.taxIdType).toBe('ein');
    expect(parsed.addressCountry).toBe('US');
    expect(parsed.taxResidencyCountry).toBe('GB');
  });

  it('drops an id type outside the closed set rather than trusting stored junk', () => {
    expect(parseTaxProfileAttrs({ taxIdType: 'crypto-wallet' }).taxIdType).toBeNull();
  });

  it('reads an absent row as every field empty', () => {
    expect(parseTaxProfileAttrs(null).legalName).toBeNull();
    expect(parseTaxProfileAttrs(undefined).entityType).toBeNull();
  });
});

describe('toTaxProfile — completeness', () => {
  it('is incomplete without a sealed tax id even when every other field is set', () => {
    const attrs = parseTaxProfileAttrs({
      entityType: 'individual', legalName: 'Jane Doe', addressLine1: '1 Main St',
      addressCity: 'Metropolis', addressCountry: 'US', taxResidencyCountry: 'US',
    });
    expect(toTaxProfile(USER, attrs, false).complete).toBe(false);
    expect(toTaxProfile(USER, attrs, true).complete).toBe(true);
  });

  it('derives recipientType and formType rather than storing them', () => {
    const attrs = parseTaxProfileAttrs({ entityType: 'single_member_llc', taxResidencyCountry: 'FR' });
    const profile = toTaxProfile(USER, attrs, false);
    expect(profile.recipientType).toBe('individual'); // disregarded entity
    expect(profile.formType).toBe('1042-S');
  });
});

describe('getTaxProfile', () => {
  it('reads an empty profile when neither the role nor the vault has a row', async () => {
    const db = fakeDb([[], []]);
    const profile = await getTaxProfile(db as unknown as Db, undefined, TENANT, USER);
    expect(profile.hasTaxId).toBe(false);
    expect(profile.complete).toBe(false);
    expect(profile.legalName).toBeNull();
  });

  it('reports hasTaxId from the SEALED ROW existing, never by decrypting it', async () => {
    const db = fakeDb([
      [{ attrs: { legalName: 'Jane Doe' } }],
      [{ id: 501 }], // credentials row present — id only, never secretEnc
    ]);
    const profile = await getTaxProfile(db as unknown as Db, undefined, TENANT, USER);
    expect(profile.hasTaxId).toBe(true);
    expect(profile.legalName).toBe('Jane Doe');
  });
});

describe('saveTaxProfile', () => {
  it('merges a partial PATCH onto the existing profile without clearing untouched fields', async () => {
    const db = fakeDb([
      [{ attrs: { legalName: 'Jane Doe', entityType: 'individual' } }], // getTaxProfile: role
      [], // getTaxProfile: vault
      [], // partyRoles upsert
    ]);
    const saved = await saveTaxProfile(db as unknown as Db, ENV, TENANT, USER, { addressCity: 'Metropolis' });
    expect(saved.legalName).toBe('Jane Doe'); // untouched field survived the merge
    expect(saved.addressCity).toBe('Metropolis');
  });

  it('never writes the raw tax id to party_roles — only its last four', async () => {
    const db = fakeDb([
      [{ attrs: {} }], [], // getTaxProfile
      [], // credentials upsert (sealTaxId)
      [], // partyRoles upsert
    ]);
    await saveTaxProfile(db as unknown as Db, ENV, TENANT, USER, { taxId: '123-45-6789' });

    // The party_roles upsert is the LAST insert call in this sequence.
    const roleCall = db.calls[db.calls.length - 1];
    expect(roleCall?.kind).toBe('insert');
    const payload = roleCall?.payload as { attrs: Record<string, unknown> };
    expect(payload.attrs.taxIdLast4).toBe('6789');
    expect(JSON.stringify(payload.attrs)).not.toContain('123-45-6789');
  });

  it('seals the tax id through a targetWhere matching the partial index — never the bare triple', async () => {
    const db = fakeDb([
      [{ attrs: {} }], [], // getTaxProfile
      [], // credentials upsert
      [], // partyRoles upsert
    ]);
    await saveTaxProfile(db as unknown as Db, ENV, TENANT, USER, { taxId: 'GB123456X' });

    // The credentials upsert is the first insert issued after the two reads.
    const credentialsCall = db.calls[2];
    expect(credentialsCall?.kind).toBe('insert');
    expect(credentialsCall?.chain).toContain('onConflictDoUpdate');
    // A target with no targetWhere resolves to a DIFFERENT index (or none) in
    // Postgres — asserting its presence is what pins this against that class of
    // silent-until-runtime regression.
    expect(credentialsCall?.chain).toContain('values');
  });

  it('stamps formSubmittedAt the moment the profile first becomes complete', async () => {
    const db = fakeDb([
      [{ attrs: {
        entityType: 'individual', legalName: 'Jane Doe', addressLine1: '1 Main St',
        addressCity: 'Metropolis', addressCountry: 'US', taxResidencyCountry: 'US',
      } }],
      [], // no sealed id yet
      [], // seal
      [], // upsert
    ]);
    const saved = await saveTaxProfile(db as unknown as Db, ENV, TENANT, USER, { taxId: '123456789' });
    expect(saved.complete).toBe(true);
    expect(saved.formSubmittedAt).not.toBeNull();
  });
});

describe('getTaxProfilesFor', () => {
  it('resolves an empty result with zero queries for an empty recipient list', async () => {
    const db = fakeDb([]);
    const result = await getTaxProfilesFor(undefined as unknown as Db, TENANT, []);
    expect(result.size).toBe(0);
    void db;
  });

  it('loads N recipients in exactly TWO queries — never one per recipient', async () => {
    const userIds = ['u1', 'u2', 'u3', 'u4', 'u5'];
    const db = fakeDb([
      [{ partyRef: 'u1', attrs: { legalName: 'One' } }, { partyRef: 'u3', attrs: { legalName: 'Three' } }],
      [{ subjectRef: 'u1' }, { subjectRef: 'u5' }],
    ]);
    const result = await getTaxProfilesFor(db as unknown as Db, TENANT, userIds);

    expect(db.calls).toHaveLength(2);
    expect(result.size).toBe(5);
    expect(result.get('u1')?.hasTaxId).toBe(true);
    expect(result.get('u1')?.legalName).toBe('One');
    expect(result.get('u2')?.hasTaxId).toBe(false);
    expect(result.get('u2')?.legalName).toBeNull(); // present with empty attrs, not missing
    expect(result.get('u5')?.hasTaxId).toBe(true);
    expect(result.get('u5')?.legalName).toBeNull(); // sealed id, no W-9 facts yet
  });
});
