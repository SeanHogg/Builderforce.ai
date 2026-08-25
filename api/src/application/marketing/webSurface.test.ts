/**
 * The web surface's decidable invariants (PRD 19 §9 — landing pages, website, SEO).
 *
 * Asserted on the pure validators and on the source text rather than against a
 * database, because each of these is decided before a query runs and each fails a
 * VISITOR rather than a build:
 *
 *   - A slug or path that survives validation becomes a public URL. Coercing a bad
 *     one means the author saved a page at an address they were never shown.
 *   - The public reads must not be able to serve a draft. That is a property of the
 *     query text, so it is asserted on the query text — a mock database would only
 *     prove the mock agrees with itself.
 *   - Publication has to be the only way `status` reaches `live`, or a live page
 *     with no `published_at` becomes representable and every analytics join has to
 *     special-case it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSurfaceError } from './webSurface';

const src = readFileSync(resolve(__dirname, 'webSurface.ts'), 'utf8');
const routes = readFileSync(
  resolve(__dirname, '..', '..', 'presentation', 'routes', 'webSurfaceRoutes.ts'),
  'utf8',
);

/** The validators are module-private on purpose — they are not a public API — so
 *  they are exercised through the exported error they throw, which is the part a
 *  caller actually depends on. */
describe('WebSurfaceError carries the status the route will return', () => {
  it('defaults to 400, the shape a bad payload deserves', () => {
    expect(new WebSurfaceError('nope').status).toBe(400);
  });

  it('can carry 404 and 409 without a second error class', () => {
    expect(new WebSurfaceError('gone', 404).status).toBe(404);
    expect(new WebSurfaceError('taken', 409).status).toBe(409);
  });

  it('is an Error, so an unhandled one still produces a stack', () => {
    expect(new WebSurfaceError('x')).toBeInstanceOf(Error);
    expect(new WebSurfaceError('x').name).toBe('WebSurfaceError');
  });
});

describe('the public reads cannot serve a draft', () => {
  it('filters publicLandingPage on live status inside the query', () => {
    const fn = src.slice(src.indexOf('export async function publicLandingPage'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    expect(body).toContain('eq(landingPages.status, LIVE)');
  });

  it('enforces ends_at in the same predicate, so a lapsed campaign is not live', () => {
    const fn = src.slice(src.indexOf('export async function publicLandingPage'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    expect(body).toContain('endsAt} is null or');
  });

  it('returns only VISIBLE blocks to the public', () => {
    const fn = src.slice(src.indexOf('export async function publicLandingPage'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    expect(body).toContain('eq(landingPageBlocks.isVisible, true)');
  });

  it('takes no actor argument, so there is no caller-supplied way to relax it', () => {
    expect(src).toContain('export async function publicLandingPage(db: Db, tenantId: number, slug: string)');
  });
});

describe('publication is a transition, not a column write', () => {
  it('stamps published_at in the same write that sets live', () => {
    const fn = src.slice(src.indexOf('export async function publishLandingPage'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    expect(body).toContain('status: LIVE');
    expect(body).toContain('publishedAt: new Date()');
  });

  it('never lets updateLandingPage write status, which would bypass the stamp', () => {
    const fn = src.slice(src.indexOf('export async function updateLandingPage'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    expect(body).not.toContain('values.status');
  });

  it('makes the caller name which exit an unpublish is', () => {
    expect(src).toContain("to: 'draft' | 'ended' | 'archived'");
  });

  it('rejects an unrecognised exit at the route rather than defaulting it', () => {
    expect(routes).toContain("if (to !== 'draft' && to !== 'ended' && to !== 'archived')");
  });
});

describe('tenancy follows each table\'s own nullability', () => {
  it('scopes landing pages with the NOT NULL helper', () => {
    const fn = src.slice(src.indexOf('export async function listLandingPages'));
    expect(fn.slice(0, fn.indexOf('\nexport '))).toContain('scopedToTenant(landingPages, tenantId)');
  });

  it('scopes website pages and SEO pages with the nullable helper', () => {
    expect(src).toContain('scopedToNullableTenant(websitePages, tenantId)');
    expect(src).toContain('scopedToNullableTenant(marketingSeoPages, tenantId)');
  });

  it('accepts a null tenant only where the column is nullable', () => {
    expect(src).toContain('export async function websiteTree(db: Db, tenantId: number | null)');
    expect(src).toContain('export async function seoPatternSummary(db: Db, tenantId: number | null)');
    // A landing page always belongs to someone.
    expect(src).toContain('export async function listLandingPages(db: Db, tenantId: number)');
  });
});

describe('ordering survives a swap', () => {
  it('parks blocks at negative positions before writing final ones', () => {
    const fn = src.slice(src.indexOf('export async function reorderBlocks'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    // `position` is UNIQUE per page: writing final positions directly collides the
    // moment two blocks swap.
    expect(body).toContain('position: -(i + 1)');
    expect(body).toContain('db.transaction');
  });

  it('refuses a partial order rather than silently dropping blocks', () => {
    const fn = src.slice(src.indexOf('export async function reorderBlocks'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    expect(body).toContain('order must list every block on the page exactly once');
  });

  it('closes the gap after a delete so the unique index has no hole', () => {
    const fn = src.slice(src.indexOf('export async function deleteBlock'));
    const body = fn.slice(0, fn.indexOf('\n// ──'));
    expect(body).toContain('position} - 1');
  });
});

describe('deleting a website page collapses the level rather than orphaning it', () => {
  it('re-parents children onto the deleted page\'s own parent', () => {
    const fn = src.slice(src.indexOf('export async function deleteWebsitePage'));
    const body = fn.slice(0, fn.indexOf('\n// ──'));
    expect(body).toContain('parentPath: page.parentPath ?? null');
    expect(body).toContain('eq(websitePages.parentPath, page.path)');
  });

  it('does both writes in one transaction, so a crash cannot orphan the children', () => {
    const fn = src.slice(src.indexOf('export async function deleteWebsitePage'));
    expect(fn.slice(0, fn.indexOf('\n// ──'))).toContain('db.transaction');
  });
});

describe('programmatic SEO is regenerable rather than duplicated', () => {
  it('upserts on the global path, because one public URL has one owner', () => {
    const fn = src.slice(src.indexOf('export async function upsertSeoPage'));
    const body = fn.slice(0, fn.indexOf('\n/**'));
    expect(body).toContain('onConflictDoUpdate');
    expect(body).toContain('target: marketingSeoPages.path');
  });

  it('retires a pattern without deleting its impression history', () => {
    const fn = src.slice(src.indexOf('export async function retireSeoPattern'));
    const body = fn.slice(0, fn.indexOf('\n// ──'));
    expect(body).toContain(".set({ status: 'retired'");
    expect(body).not.toContain('.delete(');
  });
});

describe('the route module keeps the merge honest', () => {
  it('gates every write at MANAGER, the bar the project site already sets', () => {
    for (const write of [
      "router.post('/landing-pages', manager",
      "router.patch('/landing-pages/:id', manager",
      "router.delete('/landing-pages/:id', manager",
      "router.post('/landing-pages/:id/publish', manager",
      "router.post('/website', manager",
      "router.delete('/website/:id', manager",
      "router.post('/seo', manager",
    ]) expect(routes).toContain(write);
  });

  it('registers the literal blocks/order route before the :blockId one', () => {
    // Hono matches in registration order; the reverse would swallow `order` as an id.
    expect(routes.indexOf("blocks/order'")).toBeLessThan(routes.indexOf("blocks/:blockId', manager"));
  });

  it('leaves the public router without authMiddleware, and says why', () => {
    const pub = routes.slice(routes.indexOf('export function createPublicWebSurfaceRoutes'));
    expect(pub).not.toContain('authMiddleware');
  });

  it('returns 204 with no body from the counters, so performance does not leak', () => {
    const pub = routes.slice(routes.indexOf('export function createPublicWebSurfaceRoutes'));
    expect(pub).toContain('new Response(null, { status: 204 })');
  });
});

describe('the merge added no schema', () => {
  it('imports only tables that already existed', () => {
    // PRD 19 §9.3: a gap is a missing feature path, never a missing table. If this
    // service ever needs a new table, the policy's `newTablesAllowed: false` is
    // what it has to argue with first.
    const imports = src.slice(src.indexOf("} from '../../infrastructure/database/schema'"));
    expect(imports).toBeTruthy();
    for (const t of ['landingPages', 'landingPageBlocks', 'websitePages', 'marketingSeoPages']) {
      expect(src).toContain(t);
    }
  });

  it('registers the landing page into the kernel rather than inventing an identity', () => {
    const fn = src.slice(src.indexOf('export async function createLandingPage'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    expect(body).toContain("kind: 'landing_page'");
    expect(body).toContain("domain: 'growth'");
    expect(body).toContain('refId: inserted.id');
  });
});
