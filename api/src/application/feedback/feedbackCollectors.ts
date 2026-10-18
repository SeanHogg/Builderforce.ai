/**
 * Feedback collectors — the ONE use case behind every read and write of a
 * project's feedback collector and its provider webhooks.
 *
 * Collector rows used to be queried inline by two routers: the authenticated
 * management surface (`/api/feedback/collectors…`, plus the in-app panel reading
 * the project's collector settings) and the public snippet edge
 * (`/api/feedback-ingest`, resolving a collector from its ingest key). Both now
 * read through here, so the tenant predicate, the key hashing and the "one
 * collector per project" refusal each exist exactly once.
 *
 * NOT the same thing as `error_collectors` (`/api/quality/collectors`): that is
 * machine telemetry with tenant-level collectors, mapping rules, key rotation and
 * pull credentials; this is human input that opens human-gated tickets. They share
 * the primitives that are genuinely common (`generateApiKey`/`hashSecret`,
 * `credentialCrypto`) and nothing else.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { feedbackCollectorIntegrations, feedbackCollectors, projects } from '../../infrastructure/database/schema';
import { generateApiKey, hashSecret } from '../../infrastructure/auth/HashService';
import { isUniqueViolation } from '../../infrastructure/database/uniqueViolation';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { InternalError } from '../../domain/shared/errors';
import { loadProjectInTenant } from '../project/projectOwnership';
import { credentialSecret, encryptCredentials } from '../integrations/credentialCrypto';
import { getFeedbackProvider, listFeedbackProviders } from './feedbackProviders';
import { originAllowed } from '../llm/tenantApiKeyService';
import type { FeedbackTarget } from './feedbackEngine';

/** Public ingest paths, built in ONE place so the URL handed out is the URL served. */
export const FEEDBACK_INGEST_PATHS = {
  submit: '/api/feedback-ingest/submit',
  config: '/api/feedback-ingest/config',
  webhookBase: (collectorId: string) => `/api/feedback-ingest/webhooks/${collectorId}`,
  webhook: (collectorId: string, provider: string) => `/api/feedback-ingest/webhooks/${collectorId}/${provider}`,
} as const;

/** The project's name when it belongs to the tenant, else null. */
export async function ownedProjectName(db: Db, tenantId: number, projectId: number): Promise<string | null> {
  const row = await loadProjectInTenant(db, tenantId, projectId, { name: projects.name });
  return row?.name ?? null;
}

/** True when the collector belongs to the tenant — the only anchor integration paths carry. */
export async function ownsCollector(db: Db, tenantId: number, collectorId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: feedbackCollectors.id })
    .from(feedbackCollectors)
    .where(and(eq(feedbackCollectors.id, collectorId), eq(feedbackCollectors.tenantId, tenantId)))
    .limit(1);
  return Boolean(row);
}

export function listCollectors(db: Db, tenantId: number) {
  return db
    .select({
      id: feedbackCollectors.id, name: feedbackCollectors.name, projectId: feedbackCollectors.projectId,
      enabled: feedbackCollectors.enabled, autoCreateTask: feedbackCollectors.autoCreateTask,
      dailyLimit: feedbackCollectors.dailyLimit, allowedOrigins: feedbackCollectors.allowedOrigins,
      lastSubmissionAt: feedbackCollectors.lastSubmissionAt, createdAt: feedbackCollectors.createdAt,
    })
    .from(feedbackCollectors)
    .where(eq(feedbackCollectors.tenantId, tenantId))
    .orderBy(desc(feedbackCollectors.createdAt))
    .limit(LIST_ROW_CAP);
}

export type CreateCollectorResult =
  | { ok: true; collector: { id: string; name: string; projectId: number }; ingestKey: string }
  | { ok: false; reason: 'project_not_found' | 'already_exists' };

/** Create a project's collector and mint its ingest key (returned once, stored hashed). */
export async function createCollector(
  db: Db,
  args: { tenantId: number; projectId: number; name?: string | null; createdBy: string | null },
): Promise<CreateCollectorResult> {
  const projectName = await ownedProjectName(db, args.tenantId, args.projectId);
  if (!projectName) return { ok: false, reason: 'project_not_found' };

  const ingestKey = generateApiKey('bff');
  const keyHash = await hashSecret(ingestKey);
  let row;
  try {
    [row] = await db
      .insert(feedbackCollectors)
      .values({
        tenantId: args.tenantId, projectId: args.projectId,
        name: args.name?.trim() || projectName,
        keyHash, createdBy: args.createdBy,
      })
      .returning({ id: feedbackCollectors.id, name: feedbackCollectors.name, projectId: feedbackCollectors.projectId });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, reason: 'already_exists' };
    throw e;
  }
  if (!row) throw new InternalError('Failed to create collector');
  return { ok: true, collector: row, ingestKey };
}

export interface CollectorPatch {
  name?: string;
  enabled?: boolean;
  autoCreateTask?: boolean;
  /** Already range-checked by the caller (1..10000). */
  dailyLimit?: number;
  allowedOrigins?: string;
}

/** Partial update; false when the collector is not the tenant's. */
export async function updateCollector(db: Db, tenantId: number, id: string, patch: CollectorPatch): Promise<boolean> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.autoCreateTask !== undefined) set.autoCreateTask = patch.autoCreateTask;
  if (patch.dailyLimit !== undefined) set.dailyLimit = Math.floor(patch.dailyLimit);
  if (patch.allowedOrigins !== undefined) set.allowedOrigins = patch.allowedOrigins.trim() || '*';
  const [row] = await db
    .update(feedbackCollectors).set(set)
    .where(and(eq(feedbackCollectors.id, id), eq(feedbackCollectors.tenantId, tenantId)))
    .returning({ id: feedbackCollectors.id });
  return Boolean(row);
}

export async function deleteCollector(db: Db, tenantId: number, id: string): Promise<boolean> {
  const [row] = await db
    .delete(feedbackCollectors)
    .where(and(eq(feedbackCollectors.id, id), eq(feedbackCollectors.tenantId, tenantId)))
    .returning({ id: feedbackCollectors.id });
  return Boolean(row);
}

/**
 * The submit target for an IN-APP submission on a project. A project collector's
 * settings govern in-app submissions too when one exists, so "don't open tickets
 * yet" is honoured on both channels. Deliberately NOT attributed to the collector:
 * in-app traffic must not consume the snippet's abuse budget.
 */
export async function inAppTarget(db: Db, tenantId: number, projectId: number): Promise<FeedbackTarget> {
  const [collector] = await db
    .select({ autoCreateTask: feedbackCollectors.autoCreateTask, enabled: feedbackCollectors.enabled })
    .from(feedbackCollectors)
    .where(and(eq(feedbackCollectors.tenantId, tenantId), eq(feedbackCollectors.projectId, projectId)))
    .limit(1);
  return {
    collectorId: null,
    tenantId,
    projectId,
    autoCreateTask: collector ? collector.autoCreateTask && collector.enabled : true,
    dailyLimit: null,
  };
}

export interface ResolvedCollector extends FeedbackTarget {
  projectName: string;
  allowedOrigins: string;
}

/**
 * Resolve an enabled collector (and its project label) from a raw ingest key.
 * Key-addressed by design: the snippet carries no tenant, the key IS the tenant.
 */
export async function resolveCollectorByKey(db: Db, key: string): Promise<ResolvedCollector | null> {
  const keyHash = await hashSecret(key);
  const [row] = await db
    .select({
      id: feedbackCollectors.id,
      tenantId: feedbackCollectors.tenantId,
      projectId: feedbackCollectors.projectId,
      enabled: feedbackCollectors.enabled,
      autoCreateTask: feedbackCollectors.autoCreateTask,
      dailyLimit: feedbackCollectors.dailyLimit,
      allowedOrigins: feedbackCollectors.allowedOrigins,
      projectName: projects.name,
    })
    .from(feedbackCollectors)
    .innerJoin(projects, eq(projects.id, feedbackCollectors.projectId))
    .where(eq(feedbackCollectors.keyHash, keyHash))
    .limit(1);
  if (!row || !row.enabled) return null;
  return {
    collectorId: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    autoCreateTask: row.autoCreateTask,
    dailyLimit: row.dailyLimit,
    projectName: row.projectName,
    allowedOrigins: row.allowedOrigins,
  };
}

/**
 * Per-collector origin policy, layered ON TOP of the CORS allowance that lets any
 * origin reach an ingest path, so a leaked key cannot be driven from a site the
 * owner never authorized. The check itself is the platform's ONE allowlist rule
 * (`tenantApiKeyService.originAllowed`: no Origin = server-side = allowed; exact
 * match; '*' escape hatch). The only collector-specific part is the column's
 * encoding: a comma list where blank means '*', the column default.
 */
export function collectorOriginAllowed(allowedOrigins: string, origin: string | undefined): boolean {
  const list = allowedOrigins.split(',').map((s) => s.trim()).filter(Boolean);
  return originAllowed(list.length ? list : ['*'], origin ?? null);
}

// ── Provider webhooks (Sentry / PostHog) ────────────────────────────────────

/**
 * A collector's webhook configuration: the provider CATALOGUE (from the adapter
 * registry, so the picker can never offer a provider with no adapter) plus what is
 * connected. Secrets are NEVER returned — only `hasSecret`. Null when the collector
 * is not the tenant's.
 */
export async function listCollectorIntegrations(db: Db, tenantId: number, collectorId: string) {
  if (!(await ownsCollector(db, tenantId, collectorId))) return null;
  const integrations = await db
    .select({
      provider:    feedbackCollectorIntegrations.provider,
      enabled:     feedbackCollectorIntegrations.enabled,
      hasSecret:   sql<boolean>`${feedbackCollectorIntegrations.secretEnc} IS NOT NULL`,
      lastEventAt: feedbackCollectorIntegrations.lastEventAt,
      createdAt:   feedbackCollectorIntegrations.createdAt,
    })
    .from(feedbackCollectorIntegrations)
    .where(and(
      eq(feedbackCollectorIntegrations.collectorId, collectorId),
      eq(feedbackCollectorIntegrations.tenantId, tenantId),
    ));
  return {
    providers: listFeedbackProviders(),
    integrations: integrations.map((row) => ({ ...row, webhookUrl: FEEDBACK_INGEST_PATHS.webhook(collectorId, row.provider) })),
  };
}

export type ConnectIntegrationResult =
  | { ok: true; provider: string; signatureHeader: string; webhookUrl: string; secret: string }
  | { ok: false; reason: 'collector_not_found' | 'unknown_provider' | 'secret_too_short' };

/**
 * Connect a provider, or rotate its secret — one write, so a "connect" on an
 * existing row can never silently do nothing while the operator pastes a new
 * secret. The secret is MINTED when none is supplied and returned exactly once.
 */
export async function connectCollectorIntegration(
  db: Db,
  env: Env,
  args: { tenantId: number; collectorId: string; provider: string | null | undefined; secret: unknown; createdBy: string | null },
): Promise<ConnectIntegrationResult> {
  if (!(await ownsCollector(db, args.tenantId, args.collectorId))) return { ok: false, reason: 'collector_not_found' };
  const adapter = args.provider ? getFeedbackProvider(args.provider) : null;
  if (!adapter) return { ok: false, reason: 'unknown_provider' };

  const supplied = typeof args.secret === 'string' ? args.secret.trim() : '';
  // A short secret is worse than none because it LOOKS configured.
  if (supplied && supplied.length < 16) return { ok: false, reason: 'secret_too_short' };
  const secret = supplied || generateApiKey('whsec');
  const sealed = await encryptCredentials({ secret }, credentialSecret(env), args.tenantId);

  await db
    .insert(feedbackCollectorIntegrations)
    .values({
      tenantId: args.tenantId, collectorId: args.collectorId, provider: adapter.id,
      secretEnc: sealed.enc, secretIv: sealed.iv, createdBy: args.createdBy,
    })
    .onConflictDoUpdate({
      target: [feedbackCollectorIntegrations.collectorId, feedbackCollectorIntegrations.provider],
      set: { secretEnc: sealed.enc, secretIv: sealed.iv, enabled: true, updatedAt: new Date() },
    });

  return {
    ok: true,
    provider: adapter.id,
    signatureHeader: adapter.signatureHeader,
    webhookUrl: FEEDBACK_INGEST_PATHS.webhook(args.collectorId, adapter.id),
    secret,
  };
}

/** Pause or resume imports without discarding the secret; false when not found. */
export async function setCollectorIntegrationEnabled(
  db: Db,
  args: { tenantId: number; collectorId: string; provider: string; enabled: boolean },
): Promise<boolean> {
  const [row] = await db
    .update(feedbackCollectorIntegrations)
    .set({ enabled: args.enabled, updatedAt: new Date() })
    .where(and(
      eq(feedbackCollectorIntegrations.tenantId, args.tenantId),
      eq(feedbackCollectorIntegrations.collectorId, args.collectorId),
      eq(feedbackCollectorIntegrations.provider, args.provider),
    ))
    .returning({ id: feedbackCollectorIntegrations.id });
  return Boolean(row);
}

/** Disconnect a provider entirely (the secret goes with it); false when not found. */
export async function deleteCollectorIntegration(
  db: Db,
  args: { tenantId: number; collectorId: string; provider: string },
): Promise<boolean> {
  const [row] = await db
    .delete(feedbackCollectorIntegrations)
    .where(and(
      eq(feedbackCollectorIntegrations.tenantId, args.tenantId),
      eq(feedbackCollectorIntegrations.collectorId, args.collectorId),
      eq(feedbackCollectorIntegrations.provider, args.provider),
    ))
    .returning({ id: feedbackCollectorIntegrations.id });
  return Boolean(row);
}
