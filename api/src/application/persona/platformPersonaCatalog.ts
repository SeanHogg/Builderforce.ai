/**
 * Platform personas — the admin-managed, built-in persona catalogue
 * (`platform_personas`). ONE reader and ONE writer for every surface.
 *
 * Three routes read this table — `/api/admin/personas` (CRUD, every row),
 * `/api/v1/personas` (developer API) and `/api/agent-hosts/:id/platform-personas`
 * (agent hosts) — and the last two were the same active-rows select written twice.
 * The admin view differs only by SCOPE (it sees inactive rows too), so scope is a
 * parameter here rather than a second copy. Writes live here as well so the
 * cache invalidation (the active list + the cloud capability cache) cannot be
 * forgotten by one of them.
 *
 * Distinct from `marketplace_personas` (/api/personas): those are tenant-published
 * marketplace listings with visibility and installs, not the platform catalogue.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { platformPersonas } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { invalidateCapabilityCache } from '../artifact/capabilityContext';
import type { Env } from '../../env';

export type PlatformPersonaRow = typeof platformPersonas.$inferSelect;

/**
 * Who is reading. `active` is every non-admin reader (developer API, agent hosts);
 * `admin` is the platform console and also sees deactivated rows.
 */
export type PlatformPersonaScope = 'active' | 'admin';

/** The active list is read by every agent host on startup and changes only on an admin write. */
const ACTIVE_LIST_CACHE_KEY = 'platform-personas:active';

/** Platform personas for a scope, ordered by name. The active list is cached. */
export async function listPlatformPersonas(env: Env, db: Db, scope: PlatformPersonaScope): Promise<PlatformPersonaRow[]> {
  if (scope === 'admin') {
    return db.select().from(platformPersonas).orderBy(platformPersonas.name);
  }
  return getOrSetCached(env, ACTIVE_LIST_CACHE_KEY, () => db
    .select()
    .from(platformPersonas)
    .where(eq(platformPersonas.active, true))
    .orderBy(platformPersonas.name)
    .limit(LIST_ROW_CAP));
}

const parseJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : String(d);

/** The parsed admin projection: JSON columns decoded, timestamps as ISO strings. */
export function platformPersonaView(r: PlatformPersonaRow) {
  return {
    id:            r.id,
    name:          r.name,
    slug:          r.slug,
    description:   r.description ?? null,
    voice:         r.voice ?? null,
    perspective:   r.perspective ?? null,
    decisionStyle: r.decisionStyle ?? null,
    outputPrefix:  r.outputPrefix ?? null,
    capabilities:  parseJson<string[]>(r.capabilities, []),
    tags:          parseJson<string[]>(r.tags, []),
    psychometric:  parseJson<unknown>(r.psychometric, null),
    source:        r.source ?? 'builtin',
    author:        r.author ?? null,
    active:        r.active,
    createdAt:     iso(r.createdAt),
    updatedAt:     iso(r.updatedAt),
  };
}

export interface PlatformPersonaInput {
  name?: string;
  slug?: string | null;
  description?: string | null;
  voice?: string | null;
  perspective?: string | null;
  decisionStyle?: string | null;
  outputPrefix?: string | null;
  capabilities?: string[] | null;
  tags?: string[] | null;
  psychometric?: unknown;
  source?: string | null;
  author?: string | null;
  active?: boolean | null;
}

const toSlug = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '-');
const jsonList = (v: string[] | null | undefined): string | null => (v?.length ? JSON.stringify(v) : null);

export async function createPlatformPersona(env: Env, db: Db, input: PlatformPersonaInput & { name: string }): Promise<PlatformPersonaRow | null> {
  const [inserted] = await db
    .insert(platformPersonas)
    .values({
      name: input.name,
      slug: toSlug(input.slug ?? input.name),
      description: input.description ?? null,
      voice: input.voice ?? null,
      perspective: input.perspective ?? null,
      decisionStyle: input.decisionStyle ?? null,
      outputPrefix: input.outputPrefix ?? null,
      capabilities: jsonList(input.capabilities),
      tags: jsonList(input.tags),
      psychometric: input.psychometric ? JSON.stringify(input.psychometric) : null,
      source: input.source ?? 'builtin',
      author: input.author ?? null,
      active: input.active ?? true,
    })
    .returning();
  await invalidateCached(env, ACTIVE_LIST_CACHE_KEY);
  return inserted ?? null;
}

/** Apply the present fields. `null` when the persona does not exist. */
export async function updatePlatformPersona(env: Env, db: Db, id: number, input: PlatformPersonaInput): Promise<PlatformPersonaRow | null> {
  const [existing] = await db.select().from(platformPersonas).where(eq(platformPersonas.id, id)).limit(1);
  if (!existing) return null;
  const updates: Partial<typeof platformPersonas.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.slug != null) updates.slug = toSlug(input.slug);
  if (input.description !== undefined) updates.description = input.description;
  if (input.voice !== undefined) updates.voice = input.voice;
  if (input.perspective !== undefined) updates.perspective = input.perspective;
  if (input.decisionStyle !== undefined) updates.decisionStyle = input.decisionStyle;
  if (input.outputPrefix !== undefined) updates.outputPrefix = input.outputPrefix;
  if (input.capabilities !== undefined) updates.capabilities = jsonList(input.capabilities);
  if (input.tags !== undefined) updates.tags = jsonList(input.tags);
  if (input.psychometric !== undefined) updates.psychometric = input.psychometric ? JSON.stringify(input.psychometric) : null;
  if (input.source != null) updates.source = input.source;
  if (input.author !== undefined) updates.author = input.author;
  if (input.active != null) updates.active = input.active;
  const [updated] = await db.update(platformPersonas).set(updates).where(eq(platformPersonas.id, id)).returning();
  if (!updated) return null;
  // Both slugs: a cloud run may hold the persona under either.
  await Promise.all([
    invalidateCached(env, ACTIVE_LIST_CACHE_KEY),
    invalidateCapabilityCache(env, 'persona', existing.slug),
    updated.slug !== existing.slug ? invalidateCapabilityCache(env, 'persona', updated.slug) : Promise.resolve(),
  ]);
  return updated;
}

/** `false` when the persona does not exist. */
export async function deletePlatformPersona(env: Env, db: Db, id: number): Promise<boolean> {
  const [deleted] = await db
    .delete(platformPersonas)
    .where(eq(platformPersonas.id, id))
    .returning({ id: platformPersonas.id, slug: platformPersonas.slug });
  if (!deleted) return false;
  await Promise.all([
    invalidateCached(env, ACTIVE_LIST_CACHE_KEY),
    invalidateCapabilityCache(env, 'persona', deleted.slug),
  ]);
  return true;
}
