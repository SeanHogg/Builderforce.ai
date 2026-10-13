/**
 * MANAGING INSIGHTS SITES — create, configure, verify (PRD 33 §4.2 steps 4–6).
 *
 * Two kinds of site, one table (`replay_sites`):
 *   • EXTERNAL — any website. Creating one mints its `bfr_` site key through the one
 *     key service (`mintTenantApiKey`, scope `replay:ingest` ONLY, bound to the site's
 *     origins — the allowed origins live on the key, not here).
 *   • HOSTED — a Builderforce-hosted app, one per project, switched on by a member.
 *     It needs no key: its loader carries `hosted:<siteId>` and the sites Worker
 *     injects it (`siteReplayInjection.ts`).
 *
 * ── THE SITE KEY IS PUBLIC, BY DESIGN ───────────────────────────────────────────
 * The raw `bfr_` key is stored in `settings.publicKey` and returned on every read of
 * the site, because the person needs it again every time they paste the snippet and
 * it is in their site's page source anyway. That is safe only because the key can do
 * nothing but send recordings from the listed origins: it carries the single scope
 * `replay:ingest`, it cannot be exchanged for a session
 * (`keyMayActAsMember`), it cannot be revoked by whoever holds it, and
 * `mintTenantApiKey` refuses to mint a `bfr_` key any other way. Treat that list as
 * the key's threat model when changing anything here.
 *
 * Every write bumps the site cache version (`bumpReplaySitesVersion`) and drops the
 * ingest resolution of the site's token, so a change reaches the loader on the next
 * request rather than after a TTL. Reads are cached under the tenant's sites version.
 */
import { and, desc, eq } from 'drizzle-orm';
import {
  DEFAULT_REPLAY_SITE_SETTINGS,
  type ReplaySiteDto,
  type ReplaySiteSettings,
  type ReplaySiteVerifyDto,
} from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { projects, replayRecordings, replaySites, tenantApiKeys } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { coerceStringArrayOrNull } from '../../domain/shared/jsonColumn';
import { ForbiddenError, NotFoundError, ValidationError } from '../../domain/shared/errors';
import type { ReplayScope } from '../../domain/replay/replayScope';
import {
  normaliseSiteOrigins,
  REPLAY_SITE_LABEL_MAX,
  validateSiteLabel,
  validateSiteSettingsPatch,
} from '../../domain/replay/replaySiteInput';
import { mintTenantApiKey, REPLAY_KEY_CLIENT, updateTenantApiKey } from '../llm/tenantApiKeyService';
import { loadProjectInTenant } from '../project/projectOwnership';
import { bumpReplaySitesVersion, siteTokenKey, tenantSitesKey } from './replayCacheKeys';
import { HOSTED_TOKEN_PREFIX, siteSettings } from './replaySites';
import { replayTelemetryDb } from './replayDatabase';
import { firstTraceAt, recordReplayTrace, REPLAY_TRACE_VERBS } from './replayTrace';

const SITE_DTO_TTL_SECONDS = 10 * 60;

/** The row + its key's origins, as one join reads them. */
export interface ReplaySiteRowWithKey {
  id: string;
  kind: string;
  projectId: number | null;
  label: string;
  settings: unknown;
  status: string;
  createdAt: Date | string;
  allowedOrigins: unknown;
}

function publicKeyOf(rawSettings: unknown): string | null {
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) return null;
  const key = (rawSettings as { publicKey?: unknown }).publicKey;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/** The one projection of a site onto the wire (`ReplaySiteDto`). */
export function toSiteDto(row: ReplaySiteRowWithKey): ReplaySiteDto {
  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt));
  return {
    id: row.id,
    kind: row.kind === 'hosted' ? 'hosted' : 'external',
    projectId: row.projectId ?? null,
    label: row.label,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    settings: siteSettings(row.settings),
    allowedOrigins: coerceStringArrayOrNull(row.allowedOrigins) ?? [],
    publicKey: publicKeyOf(row.settings),
    createdAt: createdAt.toISOString(),
  };
}

const SITE_WITH_KEY = {
  id: replaySites.id,
  kind: replaySites.kind,
  projectId: replaySites.projectId,
  label: replaySites.label,
  settings: replaySites.settings,
  status: replaySites.status,
  createdAt: replaySites.createdAt,
  allowedOrigins: tenantApiKeys.allowedOrigins,
};

/** Every site of the workspace, newest first, as DTOs. Cached under the tenant's sites version. */
export async function listSiteDtos(env: Env, db: Db, tenantId: number): Promise<ReplaySiteDto[]> {
  const key = `${await tenantSitesKey(env, tenantId)}:dto`;
  return getOrSetCached(env, key, async () => {
    const rows = await db
      .select(SITE_WITH_KEY)
      .from(replaySites)
      .leftJoin(tenantApiKeys, eq(tenantApiKeys.id, replaySites.apiKeyId))
      .where(scopedToTenant(replaySites, tenantId))
      .orderBy(desc(replaySites.createdAt));
    return rows.map(toSiteDto);
  }, { kvTtlSeconds: SITE_DTO_TTL_SECONDS });
}

/** One site of the workspace. Another workspace's site and a missing one are the same 403 (D17). */
export async function getSiteDto(env: Env, db: Db, scope: ReplayScope): Promise<ReplaySiteDto> {
  const site = (await listSiteDtos(env, db, scope.tenantId)).find((s) => s.id === scope.siteId);
  if (!site) throw new ForbiddenError('That Insights site is not in this workspace');
  return site;
}

/** The hosted site of a project, or null when recording was never switched on for it. */
export async function projectSiteDto(env: Env, db: Db, tenantId: number, projectId: number): Promise<ReplaySiteDto | null> {
  return (await listSiteDtos(env, db, tenantId)).find((s) => s.kind === 'hosted' && s.projectId === projectId) ?? null;
}

/** Drop everything cached about a site after a write. */
async function afterSiteWrite(env: Env, tenantId: number, siteId: string, publicKey: string | null): Promise<void> {
  await bumpReplaySitesVersion(env, tenantId, siteId);
  const tokens = [`${HOSTED_TOKEN_PREFIX}${siteId}`, ...(publicKey ? [publicKey] : [])];
  for (const token of tokens) {
    await invalidateCached(env, siteTokenKey(await hashSecret(token)));
  }
}

export async function createExternalSite(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    userId: string;
    label: string;
    allowedOrigins: string[];
    /** Untrusted (a request body); validated by `validateSiteSettingsPatch`. */
    settings?: unknown;
  },
): Promise<ReplaySiteDto> {
  const label = validateSiteLabel(input.label);
  const origins = normaliseSiteOrigins(input.allowedOrigins);
  const settings: ReplaySiteSettings = { ...DEFAULT_REPLAY_SITE_SETTINGS, ...validateSiteSettingsPatch(input.settings) };

  const key = await mintTenantApiKey(db, {
    tenantId: input.tenantId,
    name: `Insights · ${label}`.slice(0, 255),
    createdByUserId: input.userId,
    client: REPLAY_KEY_CLIENT,
    prefix: 'bfr',
    scopes: ['replay:ingest'],
    allowedOrigins: origins,
  });

  const [row] = await db
    .insert(replaySites)
    .values({
      tenantId: input.tenantId,
      kind: 'external',
      projectId: null,
      label,
      apiKeyId: key.id,
      settings: { ...settings, publicKey: key.key },
      status: 'active',
    })
    .returning({ id: replaySites.id, createdAt: replaySites.createdAt });
  if (!row) throw new Error('Failed to create the Insights site');

  await afterSiteWrite(env, input.tenantId, row.id, key.key);
  await recordReplayTrace(env, db, {
    tenantId: input.tenantId,
    siteId: row.id,
    verb: REPLAY_TRACE_VERBS.siteKeyIssued,
    actorId: input.userId,
    summary: `Issued the site key for ${label}`,
    metadata: { keyId: key.id, origins },
  });

  return toSiteDto({
    id: row.id, kind: 'external', projectId: null, label, status: 'active',
    settings: { ...settings, publicKey: key.key }, createdAt: row.createdAt, allowedOrigins: origins,
  });
}

/**
 * Switch recording on for a hosted app. Idempotent on (tenant, project): an existing
 * hosted site is returned (and re-enabled if it had been switched off), never doubled.
 */
export async function createHostedSite(
  db: Db,
  env: Env,
  input: { tenantId: number; projectId: number; userId: string },
): Promise<ReplaySiteDto> {
  const project = await loadProjectInTenant(db, input.tenantId, input.projectId, { name: projects.name });
  if (!project) throw new NotFoundError('Project', input.projectId);

  const existing = await projectSiteDto(env, db, input.tenantId, input.projectId);
  if (existing) {
    if (existing.status === 'active') return existing;
    return updateSite(db, env, { tenantId: input.tenantId, siteId: existing.id }, { status: 'active' });
  }

  const label = validateSiteLabel(project.name.trim().slice(0, REPLAY_SITE_LABEL_MAX) || `Project ${input.projectId}`);
  const [inserted] = await db
    .insert(replaySites)
    .values({
      tenantId: input.tenantId,
      kind: 'hosted',
      projectId: input.projectId,
      label,
      apiKeyId: null,
      settings: { ...DEFAULT_REPLAY_SITE_SETTINGS },
      status: 'active',
    })
    // Two members switching it on at once both land on the one row the partial
    // unique index (tenant_id, project_id) allows.
    .onConflictDoNothing()
    .returning({ id: replaySites.id });

  const siteId = inserted?.id ?? (await db
    .select({ id: replaySites.id })
    .from(replaySites)
    .where(scopedToTenant(replaySites, input.tenantId, eq(replaySites.projectId, input.projectId)))
    .limit(1))[0]?.id;
  if (!siteId) throw new Error('Failed to create the hosted Insights site');

  await afterSiteWrite(env, input.tenantId, siteId, null);
  return getSiteDto(env, db, { tenantId: input.tenantId, siteId });
}

export interface ReplaySitePatch {
  label?: string;
  status?: 'active' | 'disabled';
  /** Untrusted (a request body); validated by `validateSiteSettingsPatch`. */
  settings?: unknown;
  allowedOrigins?: string[];
}

export async function updateSite(db: Db, env: Env, scope: ReplayScope, patch: ReplaySitePatch): Promise<ReplaySiteDto> {
  const current = await getSiteDto(env, db, scope);

  const [raw] = await db
    .select({ settings: replaySites.settings, apiKeyId: replaySites.apiKeyId })
    .from(replaySites)
    .where(scopedToTenant(replaySites, scope.tenantId, eq(replaySites.id, scope.siteId)))
    .limit(1);
  if (!raw) throw new ForbiddenError('That Insights site is not in this workspace');

  const changes: Record<string, unknown> = {};
  if (patch.label !== undefined) changes.label = validateSiteLabel(patch.label);
  if (patch.status !== undefined) {
    if (patch.status !== 'active' && patch.status !== 'disabled') throw new ValidationError('status must be active or disabled');
    changes.status = patch.status;
  }
  if (patch.settings !== undefined) {
    const stored = raw.settings && typeof raw.settings === 'object' ? (raw.settings as Record<string, unknown>) : {};
    // `publicKey` rides along untouched: the settings a person edits never include it.
    changes.settings = { ...stored, ...siteSettings(stored), ...validateSiteSettingsPatch(patch.settings) };
  }
  if (patch.allowedOrigins !== undefined) {
    if (current.kind !== 'external' || !raw.apiKeyId) {
      throw new ValidationError('A Builderforce-hosted app is recorded on its own domains; it has no domain list');
    }
    const updated = await updateTenantApiKey(db, {
      tenantId: scope.tenantId,
      keyId: raw.apiKeyId,
      allowedOrigins: normaliseSiteOrigins(patch.allowedOrigins),
      env,
    });
    if (!updated) throw new ValidationError('The site key has been revoked; create the site again');
  }

  if (Object.keys(changes).length > 0) {
    await db
      .update(replaySites)
      .set({ ...changes, updatedAt: new Date() })
      .where(scopedToTenant(replaySites, scope.tenantId, eq(replaySites.id, scope.siteId)));
  }
  await afterSiteWrite(env, scope.tenantId, scope.siteId, current.publicKey);
  return getSiteDto(env, db, scope);
}

const firstRecordingKey = (scope: ReplayScope) => `replay:first-recording:t${scope.tenantId}:${scope.siteId}`;

/** The site's first kept recording — cached once found (it never changes). */
async function firstRecordingId(env: Env, db: Db, scope: ReplayScope): Promise<string | null> {
  const cached = await peekCached<string>(env, firstRecordingKey(scope));
  if (cached) return cached;
  const [row] = await replayTelemetryDb(env, db)
    .select({ id: replayRecordings.id })
    .from(replayRecordings)
    .where(and(
      eq(replayRecordings.tenantId, scope.tenantId),
      eq(replayRecordings.siteId, scope.siteId),
    ))
    .orderBy(replayRecordings.startedAt)
    .limit(1);
  if (!row) return null;
  await setCached(env, firstRecordingKey(scope), row.id, { kvTtlSeconds: 30 * 24 * 60 * 60 });
  return row.id;
}

/**
 * The live install checks (§4.2 step 6), read from the trace verbs ingest writes.
 *
 * `replay.loader.hit` is only written for a config request whose Origin the site
 * accepts (an unaccepted origin gets `enabled: false` and no trace), so a loader hit
 * — or any event after it — is also the proof the origin is right.
 */
export async function siteVerify(env: Env, db: Db, scope: ReplayScope): Promise<ReplaySiteVerifyDto> {
  await getSiteDto(env, db, scope);
  const [loaderHit, firstEvent, recordingId] = await Promise.all([
    firstTraceAt(env, db, { ...scope, verb: REPLAY_TRACE_VERBS.loaderHit }),
    firstTraceAt(env, db, { ...scope, verb: REPLAY_TRACE_VERBS.ingestFirstEvent }),
    firstRecordingId(env, db, scope),
  ]);
  return {
    scriptSeen: loaderHit !== null,
    originOk: loaderHit !== null || firstEvent !== null,
    firstEventAt: firstEvent?.toISOString() ?? null,
    firstRecordingId: recordingId,
  };
}
