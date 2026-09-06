import { describe, expect, it, vi } from 'vitest';
import { readFrontendSource } from '../../../scripts/lib/frontendSource.mjs';

const TENANT = 88;
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('segmentId', 'seg-default');
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { createImportRoutes } from './importRoutes';
import { IMPORT_DATASETS, IMPORT_REGISTRY_FINGERPRINT, listImportKinds } from '../../application/insights/boardImport';

/** Fake db: captures the one multi-row insert the importer is allowed to make. */
function makeDb() {
  const inserts: unknown[][] = [];
  const db = {
    insert: () => ({ values: (v: unknown[]) => { inserts.push(v); return Promise.resolve([]); } }),
  };
  return { db: db as any, inserts };
}

const post = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
/** Hono resolves `c.env` from the third argument; an empty binding set keeps the
 *  cache helpers on their fall-through path. */
const ENV = {};

describe('importRoutes — GET /kinds', () => {
  it('serves the registry projection: every dataset, every column with type/required/example', async () => {
    const { db } = makeDb();
    const res = await createImportRoutes(db).request('/kinds', {}, ENV);
    expect(res.status).toBe(200);
    const { kinds } = await res.json() as { kinds: Array<{ key: string; columns: Array<Record<string, unknown>> }> };
    expect(kinds.map((k) => k.key).sort()).toEqual(Object.keys(IMPORT_DATASETS).sort());
    const headcount = kinds.find((k) => k.key === 'headcount-events')!;
    expect(headcount.columns).toContainEqual({ name: 'eventType', type: 'string', required: true, example: 'hire' });
    expect(headcount.columns).toContainEqual({ name: 'effectiveOn', type: 'dateString', required: true, example: '2026-07-01' });
  });

  it('carries a fingerprint that tracks the registry, so a cached read cannot outlive a column change', () => {
    expect(IMPORT_REGISTRY_FINGERPRINT).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('importRoutes — POST /:kind', () => {
  it('rejects an unknown kind with 400 before reading the body', async () => {
    const { db, inserts } = makeDb();
    const res = await createImportRoutes(db).request('/nope', post({ rows: [{ a: 1 }] }), ENV);
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('dryRun validates and reports without inserting (200, dryRun:true)', async () => {
    const { db, inserts } = makeDb();
    const res = await createImportRoutes(db).request('/headcount-events', post({
      dryRun: true,
      rowOffset: 500,
      rows: [
        { eventType: 'hire', effectiveOn: '2026-07-01', memberName: 'Ada' },
        { eventType: 'hire' },
      ],
    }), ENV);
    expect(res.status).toBe(200);
    const body = await res.json() as { inserted: number; skipped: number; errors: string[]; dryRun: boolean };
    expect(body).toEqual({ inserted: 1, skipped: 1, errors: ['row 502: missing required "effectiveOn"'], dryRun: true });
    expect(inserts).toHaveLength(0);
  });

  it('inserts the valid rows in ONE statement and answers 201', async () => {
    const { db, inserts } = makeDb();
    const res = await createImportRoutes(db).request('/uptime', post({
      rows: [
        { serviceName: 'api', periodDay: '2026-08-01', uptimePct: '99.98' },
        { serviceName: 'web', periodDay: '2026-08-01', uptimePct: '100' },
        { serviceName: 'broken' },
      ],
    }), ENV);
    expect(res.status).toBe(201);
    const body = await res.json() as { inserted: number; skipped: number; errors: string[]; dryRun: boolean };
    expect(body.inserted).toBe(2);
    expect(body.skipped).toBe(1);
    expect(body.dryRun).toBe(false);
    expect(body.errors).toEqual(['row 3: missing required "periodDay"']);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toHaveLength(2);
    expect(inserts[0]?.[0]).toMatchObject({ tenantId: TENANT, serviceName: 'api', periodDay: '2026-08-01', uptimePct: 99.98 });
  });

  it('answers 400 when nothing could be written', async () => {
    const { db, inserts } = makeDb();
    const res = await createImportRoutes(db).request('/incidents', post({ rows: [{ severity: 'sev1' }] }), ENV);
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
    expect((await res.json() as { inserted: number }).inserted).toBe(0);
  });
});

/**
 * The /import page labels a column through `fieldLabelKey(column.name)` →
 * `import.field<Name>`, and a kind through `kindLabelKey(key)` → `import.kind<Key>`
 * (frontend/src/lib/import-input-schema.ts). The page cannot import this registry
 * and this package cannot import the page, so the contract is asserted here, from
 * the side that OWNS the column names: every name and every kind must resolve in
 * all five catalogs, or a new column ships as `import.fieldFoo` on screen.
 */
describe('importRoutes — every registry column and kind has a label in all five catalogs', () => {
  const LOCALES = ['en', 'zh', 'es', 'fr', 'de'] as const;
  const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const fieldLabelKey = (name: string) => `field${upperFirst(name)}`;
  const kindLabelKey = (key: string) => `kind${key.split('-').map(upperFirst).join('')}`;

  const columnNames = [...new Set(listImportKinds().flatMap((k) => k.columns.map((c) => c.name)))];
  const kindKeys = listImportKinds().map((k) => k.key);

  it.each(LOCALES)('%s labels every column and kind', (locale) => {
    const catalog = JSON.parse(readFrontendSource(`frontend/src/i18n/messages/${locale}.json`, 'import column labels')) as {
      import: Record<string, unknown>;
    };
    const missing = [
      ...columnNames.map(fieldLabelKey),
      ...kindKeys.map(kindLabelKey),
    ].filter((key) => typeof catalog.import[key] !== 'string');
    expect(missing).toEqual([]);
  });
});
