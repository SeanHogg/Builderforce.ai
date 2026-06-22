/**
 * tenant_models — the tenant "LLM" object (migration 0211).
 *
 * A tenant defines a reusable, named model config = { base model + system prompt +
 * params (+ optional persona / BYO key / future trained model) }. Any surface — a
 * cloud agent, an on-prem host, or the Designer Brain — selects it by the ref
 * `tenant_model:<slug>`, and {@link resolveTenantModel} expands that ref into the
 * concrete base model + system directives + sampling params to apply at run time.
 *
 * This is the ONE resolver every surface shares (DRY): the gateway
 * `/v1/chat/completions` route resolves it for Brain/on-prem/external callers, and
 * the cloud agent loop ({@link runCloudToolLoop}) resolves it for V2 runs. No
 * surface re-implements the expansion.
 */
import { and, desc, eq } from 'drizzle-orm';
import { tenantModels, marketplacePersonas } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import {
  getOrSetCached,
  getCacheVersion,
  bumpCacheVersion,
} from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

/** The ref prefix a model field carries to point at a tenant model. */
export const TENANT_MODEL_REF_PREFIX = 'tenant_model:';

export type TenantModelRow = typeof tenantModels.$inferSelect;

export interface TenantModelInput {
  name: string;
  baseModel?: string | null;
  systemPrompt?: string | null;
  params?: Record<string, unknown> | null;
  personaId?: string | null;
  providerKey?: string | null;
  trainedModelRef?: string | null;
  visibility?: 'private' | 'tenant';
}

/** The expanded form a run applies. `baseModel: null` = run on the plan default. */
export interface ResolvedTenantModel {
  id: string;
  slug: string;
  name: string;
  baseModel: string | null;
  /** Compiled system directives (the model's system prompt + any persona block). */
  directives: string | null;
  /** Sampling params (temperature/top_p/…) to apply when the caller didn't set them. */
  params: Record<string, unknown>;
  /** Provider whose BYO key to route through (e.g. 'anthropic'); null = managed. */
  providerKey: string | null;
}

/** Cache version key per tenant — bumped on any write so list/resolve age out together. */
function versionKey(tenantId: number): string {
  return `tenant_models:${tenantId}`;
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'model';
}

function safeParams(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch { return {}; }
  }
  return {};
}

/** Ensure (tenant, slug) uniqueness by suffixing on clash. */
async function uniqueSlug(db: Db, tenantId: number, base: string, excludeId: string | null): Promise<string> {
  const [clash] = await db
    .select({ id: tenantModels.id })
    .from(tenantModels)
    .where(and(eq(tenantModels.tenantId, tenantId), eq(tenantModels.slug, base)));
  if (!clash || clash.id === excludeId) return base;
  return `${base}-${Math.abs(hash(`${tenantId}:${base}:${excludeId ?? ''}`)).toString(36).slice(0, 5)}`;
}

/** Tiny deterministic hash (no Date.now/random — keeps slugs stable on retry). */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

/** Public view (no internal columns beyond what the editor needs). */
export function tenantModelView(r: TenantModelRow) {
  return {
    id: r.id,
    slug: r.slug,
    ref: `${TENANT_MODEL_REF_PREFIX}${r.slug}`,
    name: r.name,
    baseModel: r.baseModel,
    systemPrompt: r.systemPrompt,
    params: safeParams(r.params),
    personaId: r.personaId,
    providerKey: r.providerKey,
    trainedModelRef: r.trainedModelRef,
    visibility: r.visibility,
    updatedAt: r.updatedAt,
  };
}

/** List a tenant's models (cached). */
export async function listTenantModels(env: Env, db: Db, tenantId: number) {
  const version = await getCacheVersion(env, versionKey(tenantId));
  return getOrSetCached(
    env,
    `tenant_models:list:${tenantId}:v:${version}`,
    async () => {
      const rows = await db
        .select()
        .from(tenantModels)
        .where(eq(tenantModels.tenantId, tenantId))
        .orderBy(desc(tenantModels.updatedAt));
      return rows.map(tenantModelView);
    },
    { kvTtlSeconds: 120 },
  );
}

export async function createTenantModel(
  env: Env,
  db: Db,
  tenantId: number,
  createdBy: string | null,
  input: TenantModelInput,
) {
  const slug = await uniqueSlug(db, tenantId, slugify(input.name), null);
  const [row] = await db
    .insert(tenantModels)
    .values({
      tenantId,
      createdBy: createdBy ?? null,
      name: input.name.trim(),
      slug,
      baseModel: input.baseModel?.trim() || null,
      systemPrompt: input.systemPrompt ?? null,
      params: safeParams(input.params),
      personaId: input.personaId || null,
      providerKey: input.providerKey?.trim() || null,
      trainedModelRef: input.trainedModelRef?.trim() || null,
      visibility: input.visibility ?? 'tenant',
    })
    .returning();
  await bumpCacheVersion(env, versionKey(tenantId));
  return row ? tenantModelView(row) : null;
}

export async function updateTenantModel(
  env: Env,
  db: Db,
  tenantId: number,
  id: string,
  input: Partial<TenantModelInput>,
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name != null) set.name = input.name.trim();
  if (input.baseModel !== undefined) set.baseModel = input.baseModel?.trim() || null;
  if (input.systemPrompt !== undefined) set.systemPrompt = input.systemPrompt ?? null;
  if (input.params !== undefined) set.params = safeParams(input.params);
  if (input.personaId !== undefined) set.personaId = input.personaId || null;
  if (input.providerKey !== undefined) set.providerKey = input.providerKey?.trim() || null;
  if (input.trainedModelRef !== undefined) set.trainedModelRef = input.trainedModelRef?.trim() || null;
  if (input.visibility !== undefined) set.visibility = input.visibility;
  const [row] = await db
    .update(tenantModels)
    .set(set)
    .where(and(eq(tenantModels.id, id), eq(tenantModels.tenantId, tenantId)))
    .returning();
  await bumpCacheVersion(env, versionKey(tenantId));
  return row ? tenantModelView(row) : null;
}

export async function deleteTenantModel(env: Env, db: Db, tenantId: number, id: string): Promise<boolean> {
  const [row] = await db
    .delete(tenantModels)
    .where(and(eq(tenantModels.id, id), eq(tenantModels.tenantId, tenantId)))
    .returning({ id: tenantModels.id });
  await bumpCacheVersion(env, versionKey(tenantId));
  return !!row;
}

/** Compile a marketplace persona body into a short system directive block. */
function compilePersonaBlock(persona: unknown): string | null {
  const o = persona && typeof persona === 'object' ? (persona as Record<string, unknown>) : null;
  if (!o) return null;
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  const lines = [
    str('voice') && `Voice: ${str('voice')}`,
    str('perspective') && `Perspective: ${str('perspective')}`,
    str('decisionStyle') && `Decision style: ${str('decisionStyle')}`,
    str('systemDirectives'),
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

/**
 * Expand a `tenant_model:<slug>` ref into the concrete model to run. Returns null
 * when `ref` is not a tenant-model ref OR the slug doesn't resolve for this tenant
 * (callers then treat the ref as an unknown model → plan default). Cached per
 * tenant + slug, versioned so an edit takes effect on the next run.
 */
export async function resolveTenantModel(
  env: Env,
  db: Db,
  tenantId: number,
  ref: string | undefined | null,
): Promise<ResolvedTenantModel | null> {
  if (!ref || !ref.startsWith(TENANT_MODEL_REF_PREFIX)) return null;
  const slug = ref.slice(TENANT_MODEL_REF_PREFIX.length).trim();
  if (!slug) return null;

  const version = await getCacheVersion(env, versionKey(tenantId));
  return getOrSetCached(
    env,
    `tenant_models:resolve:${tenantId}:${slug}:v:${version}`,
    async (): Promise<ResolvedTenantModel | null> => {
      const [row] = await db
        .select()
        .from(tenantModels)
        .where(and(eq(tenantModels.tenantId, tenantId), eq(tenantModels.slug, slug)));
      if (!row) return null;

      let personaBlock: string | null = null;
      if (row.personaId) {
        const [p] = await db
          .select({ persona: marketplacePersonas.persona })
          .from(marketplacePersonas)
          .where(eq(marketplacePersonas.id, row.personaId));
        if (p) personaBlock = compilePersonaBlock(p.persona);
      }

      const directives = [row.systemPrompt?.trim() || null, personaBlock]
        .filter(Boolean)
        .join('\n\n') || null;

      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        baseModel: row.baseModel?.trim() || null,
        directives,
        params: safeParams(row.params),
        providerKey: row.providerKey?.trim() || null,
      };
    },
    { kvTtlSeconds: 120 },
  );
}
