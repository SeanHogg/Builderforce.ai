/**
 * The ONE templates store over `catalog_items` (migration 1263).
 *
 * Pins the parts that are easy to get wrong without a database: the cacheable
 * row shape, which version tokens a write bumps, and that an id which is not a
 * uuid is a MISS rather than a Postgres cast error (kanban template ids arrive
 * from the URL and a built-in id like 'standard-swe' must never reach a uuid
 * column).
 */
import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Db } from '../../infrastructure/database/connection';
import {
  deleteTemplateRow,
  getPublicTemplate,
  getTenantTemplate,
  listPublicTemplates,
  updateTemplate,
} from './catalogTemplateStore';
import { publicTemplatesVersionKey, templateVersionKeysFor, tenantTemplatesVersionKey } from './templateCache';
import { CATALOG_BROWSABLE_ROWS, TEMPLATE_KINDS, templateVisibility, toStoredTemplate } from './templateKinds';

/** A query builder that counts statements and answers nothing. */
function recordingDb() {
  const calls: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'set', 'values']) chain[m] = () => chain;
  chain.limit = () => { calls.push('limit'); return Promise.resolve([]); };
  chain.returning = () => Promise.resolve([]);
  chain.then = (resolve: (rows: unknown[]) => unknown) => resolve([]);
  const db = {
    select: () => { calls.push('select'); return chain; },
    update: () => { calls.push('update'); return chain; },
    delete: () => { calls.push('delete'); return chain; },
    insert: () => { calls.push('insert'); return chain; },
  } as unknown as Db;
  return { db, calls };
}

const ROW = {
  id: '11111111-2222-4333-8444-555555555555',
  tenantId: 7,
  segmentId: null,
  kind: 'kanban_template',
  slug: 'delivery-abc123',
  name: 'Delivery',
  summary: 'A board',
  body: { lanes: [] },
  category: 'software',
  tags: null,
  version: '2',
  visibility: 'public',
  priceCents: 500,
  currency: 'usd',
  publisherRef: null,
  installCount: 3,
  rating: null,
  isTemplate: true,
  createdBy: 'user-1',
  publishedAt: new Date('2026-10-01T00:00:00.000Z'),
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.000Z'),
};

describe('toStoredTemplate', () => {
  it('turns every timestamp into an ISO string so an L1 and an L2 hit agree', () => {
    const stored = toStoredTemplate(ROW as never);
    expect(stored.publishedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(stored.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(stored.updatedAt).toBe('2026-10-02T00:00:00.000Z');
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
  });

  it('keeps an unpublished row unpublished', () => {
    expect(toStoredTemplate({ ...ROW, publishedAt: null } as never).publishedAt).toBeNull();
  });
});

describe('version tokens', () => {
  it('a tenant write bumps the tenant list AND the public catalogue of that kind', () => {
    expect(templateVersionKeysFor(7, TEMPLATE_KINDS.kanban)).toEqual([
      tenantTemplatesVersionKey(7, 'kanban_template'),
      publicTemplatesVersionKey('kanban_template'),
    ]);
  });

  it('a platform-owned row (no tenant) bumps only the public catalogue', () => {
    expect(templateVersionKeysFor(null, TEMPLATE_KINDS.manifest)).toEqual([publicTemplatesVersionKey('template')]);
  });

  it('keys never collide across kinds', () => {
    const keys = Object.values(TEMPLATE_KINDS).map((k) => tenantTemplatesVersionKey(1, k));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('a non-uuid id is a miss, never a query', () => {
  it('getTenantTemplate / getPublicTemplate', async () => {
    const { db, calls } = recordingDb();
    expect(await getTenantTemplate(db, undefined, { tenantId: 1, kind: 'kanban_template', id: 'standard-swe' })).toBeNull();
    expect(await getPublicTemplate(db, undefined, { kind: 'kanban_template', id: 'standard-swe' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('updateTemplate / deleteTemplateRow by id', async () => {
    const { db, calls } = recordingDb();
    expect(await updateTemplate(db, undefined, { tenantId: 1, kind: 'kanban_template', match: { id: 'nope' }, values: { name: 'x' } })).toBeNull();
    expect(await deleteTemplateRow(db, undefined, { tenantId: 1, kind: 'kanban_template', match: { id: 'nope' } })).toBe(false);
    expect(calls).toEqual([]);
  });

  it('a uuid id does query, and an unmatched write reports no row', async () => {
    const { db, calls } = recordingDb();
    expect(await updateTemplate(db, undefined, { tenantId: 1, kind: 'canvas_template', match: { id: ROW.id }, values: { name: 'x' } })).toBeNull();
    expect(calls).toEqual(['update']);
  });
});

describe('reads without an env', () => {
  it('fall through to ONE statement (no cache, no version read)', async () => {
    const { db, calls } = recordingDb();
    expect(await listPublicTemplates(db, undefined, { kind: 'kanban_template', scope: 'all' })).toEqual([]);
    expect(calls).toEqual(['select']);
  });
});

describe('the public list is unbounded unless a page is asked for', () => {
  it('no limit → no LIMIT (the pre-1263 kanban marketplace list)', async () => {
    const { db, calls } = recordingDb();
    await listPublicTemplates(db, undefined, { kind: 'kanban_template', scope: 'all' });
    expect(calls).not.toContain('limit');
  });

  it('a limit → LIMIT (the manifest registry asks for 200)', async () => {
    const { db, calls } = recordingDb();
    await listPublicTemplates(db, undefined, { kind: 'template', scope: 'platform', limit: 200 });
    expect(calls).toContain('limit');
  });
});

describe('CATALOG_BROWSABLE_ROWS (the generic entity reader\'s row filter)', () => {
  it('excludes exactly the private canvas templates', () => {
    const { sql, params } = new PgDialect().sqlToQuery(CATALOG_BROWSABLE_ROWS as SQL);
    expect(sql).toMatch(/^not \(/);
    expect(sql).toContain('"kind"');
    expect(sql).toContain('"visibility"');
    expect(params).toEqual(['canvas_template', 'private']);
  });
});

describe('templateVisibility', () => {
  it('narrows to the three values and defaults to private', () => {
    expect(templateVisibility('public')).toBe('public');
    expect(templateVisibility('tenant')).toBe('tenant');
    expect(templateVisibility('garbage')).toBe('private');
  });
});
