/**
 * Catalog adoption analytics — the shared compute behind /api/catalog-analytics.
 *
 * The marketplace catalog surfaces (Skills, Personas, Prompts) each had only a
 * point-in-time counter strip (CatalogInsightsBar). This turns the already-
 * captured, TIMESTAMPED adoption rows into an over-time signal: a daily
 * installs/usage series + the top-N adopted items, in ONE uniform shape across
 * all three catalog kinds — the "insights everywhere" standard.
 *
 * Source of the time-series (prefer reusing existing timestamped rows; the
 * generic `catalog_adoption_events` table is unioned in for kinds/events that
 * have no other timestamped home — e.g. true prompt "uses"):
 *
 *   prompt : promptLibraryStars.createdAt      → install (adoption)
 *            promptLibraryVersions.createdAt    → usage   (authoring activity)
 *   skill  : artifactAssignments.assignedAt     → install (attached to a scope)
 *   persona: artifactAssignments.assignedAt     → install
 *   (all)  : catalogAdoptionEvents.createdAt     → install | usage (recorded live)
 *
 * Everything is tenant-scoped. Pure + deterministic (takes `now`) so it caches
 * cleanly and unit-tests without a clock.
 */

import { and, eq, gte } from 'drizzle-orm';
import {
  artifactAssignments,
  promptLibraryStars,
  promptLibraryVersions,
  promptLibraryEntries,
  catalogAdoptionEvents,
} from '../../infrastructure/database/schema';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

export type CatalogKind = 'skill' | 'persona' | 'prompt';

export interface CatalogAnalytics {
  kind: CatalogKind;
  windowDays: number;
  totals: { items: number; installs: number; usage: number };
  series: Array<{ day: string; installs: number; usage: number }>;
  topItems: Array<{ id: string; name: string; installs: number; usage: number }>;
}

const MS_PER_DAY = 86_400_000;
const TOP_N = 8;

/** Normalize a plural route segment (skills|personas|prompts) → a catalog kind. */
export function toCatalogKind(raw: string | undefined): CatalogKind | null {
  switch (raw) {
    case 'skill': case 'skills': return 'skill';
    case 'persona': case 'personas': return 'persona';
    case 'prompt': case 'prompts': return 'prompt';
    default: return null;
  }
}

/** Cache version token for a tenant's catalog-adoption keyspace; bumped on every
 *  recorded event so a fresh install/use refreshes the (short-TTL) analytics. */
export function catalogAnalyticsVersionKey(tenantId: number): string {
  return `catalog-analytics:t:${tenantId}`;
}

/**
 * Record a live adoption event (install / usage) into the generic events table
 * and bump the tenant's analytics cache token. Best-effort: a failure never
 * fails the caller's primary write (recording is telemetry, not the operation).
 */
export async function recordCatalogAdoption(
  db: Db,
  env: Env,
  input: { tenantId: number; kind: CatalogKind; itemId: string; itemName?: string | null; eventType: 'install' | 'usage'; actorId?: string | null },
): Promise<void> {
  try {
    await db.insert(catalogAdoptionEvents).values({
      tenantId: input.tenantId,
      kind: input.kind,
      itemId: input.itemId.slice(0, 128),
      itemName: input.itemName?.slice(0, 255) ?? null,
      eventType: input.eventType,
      actorId: input.actorId ?? null,
    });
    await bumpCacheVersion(env, catalogAnalyticsVersionKey(input.tenantId));
  } catch {
    // Telemetry write — swallow.
  }
}

/** UTC `YYYY-MM-DD` for a millis / Date. */
function dayKey(ts: number | Date): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** One normalized adoption event, kind-agnostic, ready to bucket. */
interface Ev { ts: number; itemId: string; itemName: string; type: 'install' | 'usage' }

/**
 * Compute the adoption analytics for one catalog `kind` over the last
 * `windowDays` for `tenantId`. Returns a zero-filled daily series (so the chart
 * has a continuous x-axis even on sparse tenants), the top-N items, and totals.
 */
export async function computeCatalogAnalytics(
  db: Db,
  tenantId: number,
  kind: CatalogKind,
  windowDays: number,
  now: number = Date.now(),
): Promise<CatalogAnalytics> {
  const since = new Date(now - windowDays * MS_PER_DAY);
  const events: Ev[] = [];

  // ── Kind-specific reuse of existing timestamped rows ──────────────────────
  if (kind === 'prompt') {
    // Stars = adoption ("install"). Join entries for tenant scope + a display name.
    const stars = await db
      .select({
        id: promptLibraryStars.entryId,
        name: promptLibraryEntries.title,
        at: promptLibraryStars.createdAt,
      })
      .from(promptLibraryStars)
      .innerJoin(promptLibraryEntries, eq(promptLibraryEntries.id, promptLibraryStars.entryId))
      .where(and(eq(promptLibraryEntries.tenantId, tenantId), gte(promptLibraryStars.createdAt, since)));
    for (const r of stars) events.push({ ts: +new Date(r.at), itemId: r.id, itemName: r.name ?? r.id, type: 'install' });

    // New versions authored = "usage"/activity on the corpus.
    const versions = await db
      .select({
        id: promptLibraryVersions.entryId,
        name: promptLibraryEntries.title,
        at: promptLibraryVersions.createdAt,
      })
      .from(promptLibraryVersions)
      .innerJoin(promptLibraryEntries, eq(promptLibraryEntries.id, promptLibraryVersions.entryId))
      .where(and(eq(promptLibraryEntries.tenantId, tenantId), gte(promptLibraryVersions.createdAt, since)));
    for (const r of versions) events.push({ ts: +new Date(r.at), itemId: r.id, itemName: r.name ?? r.id, type: 'usage' });
  } else {
    // skill | persona → artifact assignments (attaching to a scope = an install).
    const assigns = await db
      .select({ id: artifactAssignments.artifactSlug, at: artifactAssignments.assignedAt })
      .from(artifactAssignments)
      .where(and(
        eq(artifactAssignments.tenantId, tenantId),
        eq(artifactAssignments.artifactType, kind),
        gte(artifactAssignments.assignedAt, since),
      ));
    for (const r of assigns) events.push({ ts: +new Date(r.at), itemId: r.id, itemName: r.id, type: 'install' });
  }

  // ── Generic live-recorded events (any kind, install|usage) ────────────────
  const recorded = await db
    .select({
      itemId: catalogAdoptionEvents.itemId,
      itemName: catalogAdoptionEvents.itemName,
      type: catalogAdoptionEvents.eventType,
      at: catalogAdoptionEvents.createdAt,
    })
    .from(catalogAdoptionEvents)
    .where(and(
      eq(catalogAdoptionEvents.tenantId, tenantId),
      eq(catalogAdoptionEvents.kind, kind),
      gte(catalogAdoptionEvents.createdAt, since),
    ));
  for (const r of recorded) {
    events.push({
      ts: +new Date(r.at),
      itemId: r.itemId,
      itemName: r.itemName ?? r.itemId,
      type: r.type === 'usage' ? 'usage' : 'install',
    });
  }

  return aggregate(kind, windowDays, since.getTime(), now, events);
}

/** Bucket normalized events into the zero-filled series + top items + totals. */
function aggregate(kind: CatalogKind, windowDays: number, since: number, now: number, events: Ev[]): CatalogAnalytics {
  // Zero-filled day buckets [since .. now] so the trend has a continuous axis.
  const byDay = new Map<string, { installs: number; usage: number }>();
  const startDay = new Date(dayKey(since) + 'T00:00:00Z').getTime();
  for (let t = startDay; t <= now; t += MS_PER_DAY) byDay.set(dayKey(t), { installs: 0, usage: 0 });

  const byItem = new Map<string, { name: string; installs: number; usage: number }>();
  let installs = 0;
  let usage = 0;

  for (const e of events) {
    const dk = dayKey(e.ts);
    const day = byDay.get(dk) ?? byDay.set(dk, { installs: 0, usage: 0 }).get(dk)!;
    const item = byItem.get(e.itemId) ?? byItem.set(e.itemId, { name: e.itemName, installs: 0, usage: 0 }).get(e.itemId)!;
    if (e.itemName) item.name = e.itemName;
    if (e.type === 'usage') { day.usage++; item.usage++; usage++; }
    else { day.installs++; item.installs++; installs++; }
  }

  const series = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, v]) => ({ day, installs: v.installs, usage: v.usage }));

  const topItems = [...byItem.entries()]
    .map(([id, v]) => ({ id, name: v.name, installs: v.installs, usage: v.usage }))
    .sort((a, b) => (b.installs + b.usage) - (a.installs + a.usage))
    .slice(0, TOP_N);

  return {
    kind,
    windowDays,
    totals: { items: byItem.size, installs, usage },
    series,
    topItems,
  };
}
