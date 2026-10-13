/**
 * Insights sites — resolving one for ingest, and reading them for a workspace
 * (PRD 33 §3.2 `replay_sites`, §3.3 step 1, D17).
 *
 * A site is reached two ways and both are origin-bound:
 *   • `bfr_…` — an external site's public key: a `tenant_api_keys` row with scope
 *     `replay:ingest`, not revoked, whose allowed origins include the request's
 *     Origin. The key's only power is ingest from those origins.
 *   • `hosted:<siteId>` — a Builderforce-hosted app: the request's Origin must be the
 *     app's own subdomain or its custom domain.
 * A resolution is cached five minutes by the token's hash, so ingest normally costs
 * no database round trip to find its site.
 *
 * Writes (`replaySiteAdmin.ts`) call `bumpReplaySitesVersion` from replayCacheKeys.
 */

import { desc, eq } from 'drizzle-orm';
import {
  DEFAULT_REPLAY_SITE_SETTINGS,
  type ReplaySiteKind,
  type ReplaySiteSettings,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { replaySites } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { ForbiddenError } from '../../domain/shared/errors';
import { isReplaySiteId } from '../../domain/replay/replayScope';
import { originAllowed, resolveTenantApiKey } from '../llm/tenantApiKeyService';
import { siteForProject } from '../ide/siteTraffic';
import { HOSTING_APEX } from '../ide/siteHosting';
import { siteRecordKey, siteTokenKey, tenantSitesKey } from './replayCacheKeys';

/** The public key prefix of an external site. */
export const REPLAY_KEY_PREFIX = 'bfr_';
/** The token prefix of a hosted app's site. */
export const HOSTED_TOKEN_PREFIX = 'hosted:';

const RESOLUTION_TTL_SECONDS = 5 * 60;
const RECORD_TTL_SECONDS = 10 * 60;
/** D3: 30 days by default, a site may raise it to 90. */
export const MAX_RETENTION_DAYS = 90;

export interface ReplaySiteRecord {
  id: string;
  tenantId: number;
  kind: ReplaySiteKind;
  projectId: number | null;
  label: string;
  apiKeyId: string | null;
  settings: ReplaySiteSettings;
  status: 'active' | 'disabled';
  /** ISO timestamp (the record is cached as JSON). */
  createdAt: string;
}

const SITE_COLUMNS = {
  id: replaySites.id,
  tenantId: replaySites.tenantId,
  kind: replaySites.kind,
  projectId: replaySites.projectId,
  label: replaySites.label,
  apiKeyId: replaySites.apiKeyId,
  settings: replaySites.settings,
  status: replaySites.status,
  createdAt: replaySites.createdAt,
};

type SiteRow = {
  id: string;
  tenantId: number;
  kind: string;
  projectId: number | null;
  label: string;
  apiKeyId: string | null;
  settings: unknown;
  status: string;
  createdAt: Date;
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** `replay_sites.settings` jsonb → complete, bounded settings. Unknown keys are dropped. */
export function siteSettings(raw: unknown): ReplaySiteSettings {
  const d = DEFAULT_REPLAY_SITE_SETTINGS;
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const keepRate = typeof s.keepRate === 'number' && Number.isFinite(s.keepRate)
    ? Math.min(1, Math.max(0, s.keepRate))
    : d.keepRate;
  const retentionDays = typeof s.retentionDays === 'number' && Number.isFinite(s.retentionDays)
    ? Math.min(MAX_RETENTION_DAYS, Math.max(1, Math.round(s.retentionDays)))
    : d.retentionDays;
  return {
    maskAllText: bool(s.maskAllText, d.maskAllText),
    consentRequired: bool(s.consentRequired, d.consentRequired),
    keepRate,
    recordCanvas: bool(s.recordCanvas, d.recordCanvas),
    identify: bool(s.identify, d.identify),
    retentionDays,
    recorderChannel: typeof s.recorderChannel === 'string' && s.recorderChannel.trim()
      ? s.recorderChannel.trim().slice(0, 64)
      : null,
  };
}

function toRecord(row: SiteRow): ReplaySiteRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind === 'hosted' ? 'hosted' : 'external',
    projectId: row.projectId ?? null,
    label: row.label,
    apiKeyId: row.apiKeyId ?? null,
    settings: siteSettings(row.settings),
    status: row.status === 'disabled' ? 'disabled' : 'active',
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt))).toISOString(),
  };
}

/** Cached as an envelope so "no such site" is cached too, distinct from a miss. */
type Found<T> = { found: true; value: T } | { found: false };

/**
 * One site by id, with no tenant filter — the id is how a hosted app's public token
 * names its site, and every caller then binds it: `resolveSiteForIngest` to the
 * request origin, {@link getSiteForTenant} to the caller's workspace.
 */
export async function getSite(env: Env | undefined, db: Db, siteId: string): Promise<ReplaySiteRecord | null> {
  if (!isReplaySiteId(siteId)) return null;
  const cached = await getOrSetCached<Found<ReplaySiteRecord>>(env, siteRecordKey(siteId), async () => {
    const [row] = await db
      .select(SITE_COLUMNS)
      .from(replaySites)
      // The site id is a public identifier (it is in the hosted snippet); what governs
      // access is the binding every caller applies next — origin or membership.
      .where(acrossTenants(replaySites, 'share_token', eq(replaySites.id, siteId)))
      .limit(1);
    return row ? { found: true, value: toRecord(row) } : { found: false };
  }, { kvTtlSeconds: RECORD_TTL_SECONDS });
  return cached.found ? cached.value : null;
}

/**
 * The site, if and only if it belongs to `tenantId`. A missing site and another
 * workspace's site answer the SAME 403 — the caller learns nothing about ids it
 * does not own (D17).
 */
export async function getSiteForTenant(env: Env | undefined, db: Db, tenantId: number, siteId: string): Promise<ReplaySiteRecord> {
  const site = await getSite(env, db, siteId);
  if (!site || site.tenantId !== tenantId) {
    throw new ForbiddenError('That Insights site is not in this workspace');
  }
  return site;
}

/** Every site of one workspace, newest first. */
export async function listSitesForTenant(env: Env, db: Db, tenantId: number): Promise<ReplaySiteRecord[]> {
  const key = await tenantSitesKey(env, tenantId);
  return getOrSetCached(env, key, async () => {
    const rows = await db
      .select(SITE_COLUMNS)
      .from(replaySites)
      .where(scopedToTenant(replaySites, tenantId))
      .orderBy(desc(replaySites.createdAt));
    return rows.map(toRecord);
  }, { kvTtlSeconds: RECORD_TTL_SECONDS });
}

interface IngestResolution {
  site: ReplaySiteRecord;
  /** Origins the token is valid from. `['*']` = any. */
  origins: string[];
}

function normaliseOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

async function resolveExternal(db: Db, token: string): Promise<IngestResolution | null> {
  const key = await resolveTenantApiKey(db, token, 'replay:ingest');
  if (!key) return null;
  const [row] = await db
    .select(SITE_COLUMNS)
    .from(replaySites)
    .where(scopedToTenant(replaySites, key.tenantId, eq(replaySites.apiKeyId, key.keyId)))
    .limit(1);
  if (!row) return null;
  return { site: toRecord(row), origins: key.allowedOrigins ?? [] };
}

async function resolveHosted(env: Env | undefined, db: Db, siteId: string): Promise<IngestResolution | null> {
  const site = await getSite(env, db, siteId);
  if (!site || site.kind !== 'hosted' || site.projectId === null) return null;
  const hosted = await siteForProject(db, site.tenantId, site.projectId);
  if (!hosted) return null;
  const origins = [`https://${hosted.subdomain}.${HOSTING_APEX}`];
  if (hosted.customDomain) origins.push(`https://${hosted.customDomain}`);
  return { site, origins: origins.map(normaliseOrigin) };
}

/**
 * The site a loader/recorder request is for, or null — for an unknown or revoked
 * key, a key without `replay:ingest`, a request with no Origin, or an Origin the
 * site does not allow. Ingest never says which (§6 abuse ceilings). The site may be
 * `disabled`; callers decide what that means.
 */
export async function resolveSiteForIngest(
  env: Env | undefined,
  db: Db,
  siteToken: string | null | undefined,
  origin: string | null | undefined,
): Promise<ReplaySiteRecord | null> {
  const token = siteToken?.trim();
  if (!token || !origin) return null;
  const isExternal = token.startsWith(REPLAY_KEY_PREFIX);
  const isHosted = token.startsWith(HOSTED_TOKEN_PREFIX);
  if (!isExternal && !isHosted) return null;
  if (isHosted && !isReplaySiteId(token.slice(HOSTED_TOKEN_PREFIX.length))) return null;

  const tokenHash = await hashSecret(token);
  const cached = await getOrSetCached<Found<IngestResolution>>(env, siteTokenKey(tokenHash), async () => {
    const resolved = isExternal
      ? await resolveExternal(db, token)
      : await resolveHosted(env, db, token.slice(HOSTED_TOKEN_PREFIX.length));
    return resolved ? { found: true, value: resolved } : { found: false };
  }, { kvTtlSeconds: RESOLUTION_TTL_SECONDS });
  if (!cached.found) return null;

  const { site, origins } = cached.value;
  const allowed = isExternal
    ? originAllowed(origins, origin)
    : origins.includes(normaliseOrigin(origin));
  return allowed ? site : null;
}
