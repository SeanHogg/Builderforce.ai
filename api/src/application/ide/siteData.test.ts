import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLLECTION,
  MAX_FIELDS,
  MAX_PAYLOAD_BYTES,
  MAX_VALUE_LENGTH,
  createCollection,
  exportOwnedSiteRecords,
  normalizeCollectionName,
  sanitizeSubmission,
  submitSiteRecord,
} from './siteData';
import { fakeDb, whereColumns } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

describe('normalizeCollectionName', () => {
  it('slugifies to a URL segment', () => {
    expect(normalizeCollectionName('Newsletter Signups')).toBe('newsletter-signups');
    expect(normalizeCollectionName('contact_form')).toBe('contact-form');
    expect(normalizeCollectionName('  Leads  ')).toBe('leads');
  });

  it('rejects names the router could not address', () => {
    expect(normalizeCollectionName('')).toBeNull();
    expect(normalizeCollectionName('!!!')).toBeNull();
    expect(normalizeCollectionName('---')).toBeNull();
  });

  it('is idempotent — the create path and the write path must agree', () => {
    const once = normalizeCollectionName('My Form')!;
    expect(normalizeCollectionName(once)).toBe(once);
  });
});

describe('sanitizeSubmission', () => {
  it('keeps ordinary form fields', () => {
    const result = sanitizeSubmission({ name: 'Sam', email: 'sam@example.com', count: 3, agreed: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({ name: 'Sam', email: 'sam@example.com', count: 3, agreed: true });
    expect(result.email).toBe('sam@example.com');
  });

  it('lifts and normalizes the email regardless of field casing', () => {
    const upper = sanitizeSubmission({ Email: '  SAM@Example.COM ' });
    expect(upper.ok && upper.email).toBe('sam@example.com');
    const bad = sanitizeSubmission({ email: 'not-an-email' });
    expect(bad.ok && bad.email).toBeNull();
  });

  it('STRIPS underscore-prefixed control fields — they are never stored', () => {
    const result = sanitizeSubmission({ name: 'Sam', _gotcha: '', _redirect: '/thanks' });
    expect(result.ok && result.payload).toEqual({ name: 'Sam' });
  });

  it('flags a filled honeypot', () => {
    const bot = sanitizeSubmission({ name: 'Sam', _gotcha: 'http://spam' });
    expect(bot.ok && bot.honeypot).toBe(true);
    const human = sanitizeSubmission({ name: 'Sam', _gotcha: '   ' });
    expect(human.ok && human.honeypot).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(sanitizeSubmission(null)).toMatchObject({ ok: false });
    expect(sanitizeSubmission('a string')).toMatchObject({ ok: false });
    expect(sanitizeSubmission([1, 2, 3])).toMatchObject({ ok: false });
  });

  it('bounds total size, field count and per-value length', () => {
    expect(sanitizeSubmission({ big: 'x'.repeat(MAX_PAYLOAD_BYTES + 100) })).toMatchObject({ ok: false });

    const wide: Record<string, string> = {};
    for (let i = 0; i <= MAX_FIELDS; i += 1) wide[`f${i}`] = 'v';
    expect(sanitizeSubmission(wide)).toMatchObject({ ok: false });

    const long = sanitizeSubmission({ note: 'y'.repeat(MAX_VALUE_LENGTH + 500) });
    expect(long.ok && (long.payload.note as string).length).toBe(MAX_VALUE_LENGTH);
  });

  it('stores nested values as JSON text rather than rejecting a multi-select form', () => {
    const result = sanitizeSubmission({ tags: ['a', 'b'] });
    expect(result.ok && result.payload.tags).toBe('["a","b"]');
  });
});

describe('submitSiteRecord', () => {
  const input = {
    siteId: 1,
    tenantId: 7,
    collectionName: 'signups',
    body: { name: 'Sam', email: 'sam@example.com' },
  };

  it('404s an unknown collection', async () => {
    const db = fakeDb([[]]);
    await expect(submitSiteRecord({ ...input, db: db as unknown as Db }))
      .resolves.toMatchObject({ ok: false, status: 404 });
  });

  it('404s (does not 403) a collection with public writes turned off — it must not be probeable', async () => {
    const db = fakeDb([[{ id: 3, acceptsPublicWrites: false, audienceId: null, dailyWriteCap: 0, tenantId: 7 }]]);
    await expect(submitSiteRecord({ ...input, db: db as unknown as Db }))
      .resolves.toMatchObject({ ok: false, status: 404 });
  });

  it('stores a valid submission and bumps the collection counter', async () => {
    const db = fakeDb([
      [{ id: 3, acceptsPublicWrites: true, audienceId: null, dailyWriteCap: 0, tenantId: 7 }],
      [{ count: 0 }],
      [{ id: 42 }],
      [],
    ]);
    const result = await submitSiteRecord({ ...input, db: db as unknown as Db, ipHash: 'h', userAgent: 'UA' });
    expect(result).toMatchObject({ ok: true, recordId: 42, accepted: true });

    const insert = db.calls.find((c) => c.kind === 'insert')!;
    expect(insert.payload).toMatchObject({ collectionId: 3, tenantId: 7, email: 'sam@example.com', ipHash: 'h' });
    expect(db.calls.some((c) => c.kind === 'update')).toBe(true);
  });

  it('accepts-and-discards a honeypot hit, looking identical to success from outside', async () => {
    const db = fakeDb([[{ id: 3, acceptsPublicWrites: true, audienceId: null, dailyWriteCap: 0, tenantId: 7 }]]);
    const result = await submitSiteRecord({
      ...input, db: db as unknown as Db, body: { name: 'Sam', _gotcha: 'spam' },
    });
    expect(result).toMatchObject({ ok: true, accepted: true, recordId: null });
    // Nothing was written — telling a bot it failed only teaches it.
    expect(db.calls.some((c) => c.kind === 'insert')).toBe(false);
  });

  it('429s once the collection has hit its daily ceiling', async () => {
    const db = fakeDb([
      [{ id: 3, acceptsPublicWrites: true, audienceId: null, dailyWriteCap: 5, tenantId: 7 }],
      [{ count: 5 }],
    ]);
    await expect(submitSiteRecord({ ...input, db: db as unknown as Db }))
      .resolves.toMatchObject({ ok: false, status: 429 });
    expect(db.calls.some((c) => c.kind === 'insert')).toBe(false);
  });

  it('rejects an oversized body before touching the write path', async () => {
    const db = fakeDb([[{ id: 3, acceptsPublicWrites: true, audienceId: null, dailyWriteCap: 0, tenantId: 7 }]]);
    const result = await submitSiteRecord({
      ...input, db: db as unknown as Db, body: { big: 'x'.repeat(MAX_PAYLOAD_BYTES + 10) },
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(db.calls.some((c) => c.kind === 'insert')).toBe(false);
  });

  it('adds the submitter to the linked audience — site form to marketable contact, one request', async () => {
    const db = fakeDb([
      [{ id: 3, acceptsPublicWrites: true, audienceId: 11, dailyWriteCap: 0, tenantId: 7 }],
      [{ count: 0 }],
      [{ id: 42 }],
      [],
      [{ id: 11 }],                        // audience ownership check
      [{ id: 1, isNew: true }],            // member upsert
      [],                                  // count refresh
    ]);
    const result = await submitSiteRecord({ ...input, db: db as unknown as Db });
    expect(result).toMatchObject({ ok: true, audienceAdded: true });
    const memberInsert = db.calls.filter((c) => c.kind === 'insert')[1]!;
    expect(memberInsert.payload).toMatchObject([{ audienceId: 11, email: 'sam@example.com', source: 'site-form' }]);
  });

  it('does not fail the submission when the audience write fails', async () => {
    // The visitor already succeeded; losing the CRM side-effect must not lose them.
    const db = fakeDb([
      [{ id: 3, acceptsPublicWrites: true, audienceId: 11, dailyWriteCap: 0, tenantId: 7 }],
      [{ count: 0 }],
      [{ id: 42 }],
      [],
      [],  // audience not found → addAudienceMembers rejects the member
    ]);
    await expect(submitSiteRecord({ ...input, db: db as unknown as Db }))
      .resolves.toMatchObject({ ok: true, recordId: 42, audienceAdded: false });
  });
});

describe('createCollection', () => {
  it('rejects an unusable name', async () => {
    const db = fakeDb();
    await expect(createCollection(db as unknown as Db, 7, 1, 2, '!!!'))
      .resolves.toMatchObject({ ok: false, status: 400 });
  });

  it('409s a duplicate name on the same site', async () => {
    const db = fakeDb([[{ id: 3 }]]);
    await expect(createCollection(db as unknown as Db, 7, 1, 2, 'signups'))
      .resolves.toMatchObject({ ok: false, status: 409 });
  });
});

describe('default collection', () => {
  it('is the zero-setup one publishing provisions', () => {
    expect(DEFAULT_COLLECTION).toBe('signups');
    expect(normalizeCollectionName(DEFAULT_COLLECTION)).toBe(DEFAULT_COLLECTION);
  });
});

describe('exportOwnedSiteRecords', () => {
  const args = { siteId: 1, tenantId: 7, siteUserId: 99 };

  it('returns everything this person put in, grouped by collection', async () => {
    const db = fakeDb([[
      { collection: 'signups', id: 3, payload: { name: 'Sam' }, createdAt: '2026-08-01T00:00:00Z' },
      { collection: 'orders', id: 2, payload: { total: 9 }, createdAt: '2026-07-01T00:00:00Z' },
      { collection: 'signups', id: 1, payload: null, createdAt: '2026-06-01T00:00:00Z' },
    ]]);
    const result = await exportOwnedSiteRecords({ ...args, db: db as unknown as Db });
    expect(result).toEqual([
      { collection: 'signups', records: [
        { id: 3, payload: { name: 'Sam' }, createdAt: '2026-08-01T00:00:00.000Z' },
        { id: 1, payload: {}, createdAt: '2026-06-01T00:00:00.000Z' },
      ] },
      { collection: 'orders', records: [
        { id: 2, payload: { total: 9 }, createdAt: '2026-07-01T00:00:00.000Z' },
      ] },
    ]);
  });

  it('is ONE query across every collection — an app with forty forms is not forty round-trips', async () => {
    // This runs while somebody waits for a download, on a path reached only after
    // the seller has already stopped answering.
    const db = fakeDb([[]]);
    await exportOwnedSiteRecords({ ...args, db: db as unknown as Db });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.chain).toContain('innerJoin');
  });

  it('is scoped to the tenant, the site AND the person — never a table dump', async () => {
    const db = fakeDb([[]]);
    await exportOwnedSiteRecords({ ...args, db: db as unknown as Db });
    const columns = whereColumns(db.calls[0]?.where);
    expect(columns).toEqual(expect.arrayContaining(['tenant_id', 'site_id', 'site_user_id']));
  });

  it('is bounded — an export is a courtesy, not a replication channel', async () => {
    const db = fakeDb([[]]);
    await exportOwnedSiteRecords({ ...args, db: db as unknown as Db });
    expect(db.calls[0]?.chain).toContain('limit');
  });

  it('returns an empty list, not a fabricated collection, when there is nothing', async () => {
    const db = fakeDb([[]]);
    await expect(exportOwnedSiteRecords({ ...args, db: db as unknown as Db })).resolves.toEqual([]);
  });
});
