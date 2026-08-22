/**
 * WHAT A PUBLISHED APP MAY READ OF ITS OWNER'S BUSINESS.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────
 * The `entity` step is three lines of execution and one genuinely load-bearing
 * decision: what a stranger on somebody else's website is allowed to see of that
 * somebody's tenant data. Putting that decision inside the ingress — which already
 * owns transport, verification, connector resolution and the LLM dep — is how a
 * security rule ends up somewhere nobody looks when they change it. It lives here,
 * alone, with the reasoning attached.
 *
 * ── THE POSTURE: DENY UNLESS DECLARED ────────────────────────────────────────
 * A handler reads exactly the `(domain, kind)` pairs its spec names, and nothing
 * else. There is no wildcard form, no "all kinds in this domain", and no way for a
 * request to widen what the spec declared — the caller cannot pass a domain, only
 * a filter within one the author already wrote down. Everything about a request is
 * therefore either declared in the spec or unable to happen.
 *
 * That is deliberately stricter than the surrounding code needs it to be. The
 * visitor here is the weakest identity on the platform: frequently anonymous,
 * never a member of the tenant whose data is being read, and reaching a URL that
 * is public by construction. The grant should be legible in the artifact the
 * author edits, and an allowlist is legible where a `default:` case is not.
 *
 * ── WHAT IS PROJECTED, AND WHY NOT THE ROW ───────────────────────────────────
 * `objects` is the kernel's registry projection — id, kind, domain, title,
 * timestamps. It is not the underlying table, and this returns a NARROWER shape
 * still: no tenant id, no internal ref id. A published page can list what exists
 * and when it changed; it cannot enumerate the tenant it belongs to or address the
 * underlying row. Anything richer is a decision to take per domain, with its own
 * reasoning, rather than something a generic reader grants by default.
 *
 * ── SCOPE COMES FROM THE SITE, NEVER FROM THE REQUEST ────────────────────────
 * `tenantId` is passed in by the ingress from the site record it already resolved.
 * A handler spec is data any project collaborator can edit, so a tenant id written
 * in one would be a tenant id somebody could change — the read would then be a
 * cross-tenant read authored from inside a tenant. There is no argument here that
 * a spec can influence except the filter.
 */
import { and, desc, eq, ilike, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { objects } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { isDomain } from '../kernel/ObjectRegistry';

/** Hard ceiling on rows a published page can pull in one step. Matches the
 *  kernel's own item cap: a public endpoint must not be the one place an
 *  unbounded result set is reachable. */
const MAX_ITEMS = 50;
const DEFAULT_ITEMS = 20;

/** One registry object, as a published page sees it. Deliberately narrower than
 *  the `objects` row — see the projection note above. */
export interface PublicEntityItem {
  id: string;
  kind: string;
  title: string | null;
  updatedAt: string | null;
}

/** What the `entity` step binds to `steps.<id>`. `error` is set instead of
 *  throwing so a page renders its empty state rather than a 500 — the same
 *  contract `readCollection` has, for the same reason. */
export interface EntityRead {
  domain: string;
  kind: string;
  count: number;
  items: PublicEntityItem[];
  error?: string;
}

export interface EntityReadArgs {
  domain: string;
  objectKind: string;
  limit?: number;
  /** Already rendered by the runtime; a blank value means "no filter" rather
   *  than "match the empty string", so an unfilled search box lists everything
   *  instead of nothing. */
  titleContains?: string;
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_ITEMS;
  return Math.max(1, Math.min(MAX_ITEMS, Math.floor(raw)));
}

/**
 * Bind a tenant-scoped, kind-scoped list of registry objects.
 *
 * Cached through the canonical read-through cache: a published page hits this on
 * every render for every visitor, and the answer only changes when the projection
 * runs. The key carries every argument that changes the result, so two different
 * filters cannot share an entry.
 */
export async function readTenantEntities(
  db: Db,
  env: Env,
  tenantId: number,
  args: EntityReadArgs,
): Promise<EntityRead> {
  const domain = args.domain.trim();
  const kind = args.objectKind.trim();
  const empty = { domain, kind, count: 0, items: [] as PublicEntityItem[] };

  // Re-checked at execution and not only at parse: a spec is stored data, and a
  // domain that was valid when it was written must not be assumed valid when it
  // is run.
  if (!isDomain(domain)) return { ...empty, error: `Unknown domain: ${domain}` };
  if (!kind) return { ...empty, error: 'No object kind declared' };

  const limit = clampLimit(args.limit);
  const filter = args.titleContains?.trim() ?? '';
  const key = `site-entities:${tenantId}:${domain}:${kind}:${limit}:${filter.toLowerCase()}`;

  const rows = await getOrSetCached(env, key, async () => {
    const where = [
      eq(objects.tenantId, tenantId),
      eq(objects.domain, domain),
      eq(objects.kind, kind),
      isNull(objects.archivedAt),
    ];
    // `ilike` with the term escaped so a visitor typing `%` searches for a
    // percent sign rather than matching every row.
    if (filter) where.push(ilike(objects.title, `%${filter.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
    return db
      .select({ id: objects.id, kind: objects.kind, title: objects.title, updatedAt: objects.updatedAt })
      .from(objects)
      .where(and(...where))
      .orderBy(desc(objects.updatedAt))
      .limit(limit);
  });

  const items: PublicEntityItem[] = rows.map((r) => ({
    id: String(r.id),
    kind: r.kind,
    title: r.title ?? null,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : (r.updatedAt ?? null),
  }));
  return { domain, kind, count: items.length, items };
}
