/**
 * Project backends — the service layer over the {@link BackendHostingStrategy}
 * port. This is the ONE place that knows how a project's server-side half is
 * bound to a strategy, where its handlers live, and how its ingress is addressed.
 *
 * Handlers are read from the CANVAS (R2) on every ingress request rather than
 * from a database copy. That is a deliberate cost: it means the canvas is the
 * single source of truth for what the backend does, so editing a handler in the
 * IDE changes behaviour immediately, with no publish step to forget and no
 * "deployed version vs. what I see" drift — the failure mode that makes
 * webhook debugging miserable. The read is one R2 list plus one GET per handler,
 * which is well inside a webhook's latency budget.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveApiOrigin } from '../../env';
import { projectBackendRequests, projectBackends, projects } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile } from '../ide/workspaceStore';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { declarativeStrategy } from './adapters/declarative';
import { githubWorkerStrategy } from './adapters/githubWorker';
import {
  isBackendStrategy,
  type BackendHostingStrategy,
  type BackendStrategyKey,
  type MaterializeContext,
  type MaterializeResult,
} from './hostingStrategy';
import { HANDLERS_DIR, handlerNameFromPath, parseHandlerSpec, type HandlerSpec } from './handlerSpec';

const STRATEGIES: Record<BackendStrategyKey, BackendHostingStrategy> = {
  declarative: declarativeStrategy,
  'github-worker': githubWorkerStrategy,
};

/** Every strategy, for the picker UI. */
export const HOSTING_STRATEGIES: readonly BackendHostingStrategy[] = Object.values(STRATEGIES);

/** Resolve a strategy key, falling back to the zero-setup default. An unknown key
 *  must not 500 an ingress request — the default always works. */
export function resolveHostingStrategy(key: string | null | undefined): BackendHostingStrategy {
  return isBackendStrategy(key) ? STRATEGIES[key] : declarativeStrategy;
}

// ---------------------------------------------------------------------------
// The backend row
// ---------------------------------------------------------------------------

export interface ProjectBackend {
  id: string;
  projectId: number;
  tenantId: number;
  strategy: BackendStrategyKey;
  status: string;
  ingressToken: string;
  deployedUrl: string | null;
  handlerCount: number;
  lastDeployedAt: string | null;
}

/**
 * A 32-character URL-safe token. Long enough that the ingress path is not
 * enumerable; NOT treated as a bearer secret anywhere (per-handler signature
 * verification is the real authentication — see webhookVerification.ts).
 */
function newIngressToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
}

/** The public base a project's webhooks are delivered to. */
export function ingressUrlFor(env: Env, ingressToken: string): string {
  return `${resolveApiOrigin(env)}/hooks/${ingressToken}`;
}

/**
 * Get the project's backend row, creating it on first use.
 *
 * Idempotent under concurrency: two simultaneous callers both insert, one loses
 * the unique constraint on `project_id`, and the loser re-reads rather than
 * failing. A project must never end up with two ingress tokens — the older one
 * would already be in a provider's console and would silently stop resolving.
 */
export async function ensureProjectBackend(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  strategy?: BackendStrategyKey,
): Promise<ProjectBackend> {
  const read = async (): Promise<ProjectBackend | null> => {
    const [row] = await db
      .select()
      .from(projectBackends)
      .where(scopedToTenant(projectBackends, tenantId, eq(projectBackends.projectId, projectId)))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.projectId,
      tenantId: row.tenantId,
      strategy: isBackendStrategy(row.strategy) ? row.strategy : 'declarative',
      status: row.status,
      ingressToken: row.ingressToken,
      deployedUrl: row.deployedUrl,
      handlerCount: row.handlerCount,
      lastDeployedAt: row.lastDeployedAt ? new Date(row.lastDeployedAt).toISOString() : null,
    };
  };

  const existing = await read();
  if (existing) {
    if (strategy && strategy !== existing.strategy) {
      await db
        .update(projectBackends)
        .set({ strategy, updatedAt: new Date() })
        .where(scopedToTenant(projectBackends, tenantId, eq(projectBackends.id, existing.id)));
      await invalidateIngress(env, existing.ingressToken);
      return { ...existing, strategy };
    }
    return existing;
  }

  try {
    await db.insert(projectBackends).values({
      projectId,
      tenantId,
      strategy: strategy ?? 'declarative',
      ingressToken: newIngressToken(),
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/backend/index.ts', operation: 'ensureProjectBackend:insert' });
  }
  const created = await read();
  if (!created) throw new Error('Could not create the project backend');
  return created;
}

const ingressCacheKey = (token: string): string => `project-backend:ingress:${token}`;

/**
 * Resolve an ingress token to its backend. Public path — no tenant scope is
 * available, which is exactly why the token is unguessable.
 *
 * Served through the read-through cache, including the NEGATIVE result. This is
 * the hot path (every webhook delivery resolves it) AND an unauthenticated one,
 * so an uncached lookup would let anyone spraying random tokens at `/hooks/…`
 * turn each request into a Postgres round-trip. Caching the null is the half that
 * actually matters there: a valid token is at least someone's real traffic.
 */
export async function backendByIngressToken(env: Env, db: Db, token: string): Promise<ProjectBackend | null> {
  return getOrSetCached<ProjectBackend | null>(
    env,
    ingressCacheKey(token),
    async () => {
      const [row] = await db.select().from(projectBackends).where(eq(projectBackends.ingressToken, token)).limit(1);
      if (!row || row.status !== 'active') return null;
      return {
        id: row.id,
        projectId: row.projectId,
        tenantId: row.tenantId,
        strategy: isBackendStrategy(row.strategy) ? row.strategy : 'declarative',
        status: row.status,
        ingressToken: row.ingressToken,
        deployedUrl: row.deployedUrl,
        handlerCount: row.handlerCount,
        lastDeployedAt: row.lastDeployedAt ? new Date(row.lastDeployedAt).toISOString() : null,
      };
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

/** Drop the cached ingress resolution. Called on any write to the backend row —
 *  a strategy switch that kept serving the old value would be invisible. */
export async function invalidateIngress(env: Env, token: string): Promise<void> {
  await invalidateCached(env, ingressCacheKey(token));
}

/**
 * Resolve a project id to `{ id, name }` for the caller's tenant, or null.
 *
 * Every backend route takes a project id from the URL, and a project id in a URL
 * is user input pointing at something that owns credentials and a public ingress.
 * One tenant-scoped lookup, here, is what stops each route from re-deriving that
 * predicate — and getting it wrong once.
 */
export async function findProjectForTenant(
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<{ id: number; name: string } | null> {
  if (!Number.isInteger(projectId) || projectId <= 0) return null;
  const [row] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(scopedToTenant(projects, tenantId, eq(projects.id, projectId)))
    .limit(1);
  return row ?? null;
}

/**
 * Display name for the `{{project.name}}` template on the public ingress path.
 *
 * Takes the tenant from the ALREADY-RESOLVED backend row rather than skipping the
 * scope because none is at hand: the ingress token resolved to a row that carries
 * its owner, so the second read has no excuse to be unscoped. Returns a stable
 * placeholder rather than throwing — a missing name must not fail a live webhook.
 */
export async function projectDisplayName(db: Db, tenantId: number, projectId: number): Promise<string> {
  const [row] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(scopedToTenant(projects, tenantId, eq(projects.id, projectId)))
    .limit(1);
  return row?.name ?? `Project ${projectId}`;
}

// ---------------------------------------------------------------------------
// Handlers in the canvas
// ---------------------------------------------------------------------------

export interface LoadedHandlers {
  specs: HandlerSpec[];
  /** Files that exist but do not parse — surfaced, never silently skipped. */
  errors: Array<{ path: string; reason: string }>;
}

/**
 * Read every handler spec out of the project's canvas.
 *
 * A file that fails to parse is reported rather than dropped. Silently ignoring
 * a broken handler is the worst possible behaviour here: the endpoint 404s, the
 * provider reports a failure, and nothing in the platform says why.
 */
export async function loadHandlers(bucket: R2Bucket, projectId: number): Promise<LoadedHandlers> {
  const files = await listWorkspaceFiles(bucket, projectId);
  const handlerFiles = files.filter((f) => f.path.startsWith(HANDLERS_DIR) && f.path.endsWith('.json') && f.size > 0);

  const specs: HandlerSpec[] = [];
  const errors: Array<{ path: string; reason: string }> = [];

  await Promise.all(
    handlerFiles.map(async (file) => {
      const raw = await readWorkspaceFile(bucket, projectId, file.path);
      if (raw === null) return;
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch (e) {
        errors.push({ path: file.path, reason: `Not valid JSON (${(e as Error).message})` });
        return;
      }
      const result = parseHandlerSpec(parsedJson, handlerNameFromPath(file.path));
      if (result.ok) specs.push(result.spec);
      else errors.push({ path: file.path, reason: result.reason });
    }),
  );

  specs.sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : a.name < b.name ? -1 : 1));
  return { specs, errors };
}

// ---------------------------------------------------------------------------
// Materialise
// ---------------------------------------------------------------------------

export interface MaterializeOutcome extends MaterializeResult {
  strategy: BackendStrategyKey;
  handlerCount: number;
  /** Canvas paths actually written. */
  written: string[];
  handlerErrors: Array<{ path: string; reason: string }>;
}

/**
 * Run the project's strategy and persist what it produced.
 *
 * Generated files are written through {@link writeWorkspaceFile}, so the same
 * path and content contract that guards a human's edit guards a generated one —
 * a generator bug cannot put JSON into a `.ts` file or escape the project prefix.
 */
export async function materializeBackend(args: {
  db: Db;
  env: Env;
  bucket: R2Bucket;
  tenantId: number;
  projectId: number;
  projectName: string;
  /** Manifests for connectors the handlers call. */
  connectors: MaterializeContext['connectors'];
  secretNames: readonly string[];
  requiredSecretNames: readonly string[];
  strategy?: BackendStrategyKey;
}): Promise<MaterializeOutcome> {
  const backend = await ensureProjectBackend(args.env, args.db, args.tenantId, args.projectId, args.strategy);
  const strategy = resolveHostingStrategy(backend.strategy);
  const { specs, errors } = await loadHandlers(args.bucket, args.projectId);

  const result = strategy.materialize({
    projectId: args.projectId,
    tenantId: args.tenantId,
    projectName: args.projectName,
    ingressUrl: ingressUrlFor(args.env, backend.ingressToken),
    handlers: specs,
    connectors: args.connectors,
    secretNames: args.secretNames,
    requiredSecretNames: args.requiredSecretNames,
    apiOrigin: resolveApiOrigin(args.env),
  });

  const written: string[] = [];
  for (const [path, content] of Object.entries(result.files)) {
    const write = await writeWorkspaceFile(args.bucket, args.projectId, path, content);
    if (write.ok) written.push(path);
    else errors.push({ path, reason: write.reason });
  }

  await args.db
    .update(projectBackends)
    .set({
      handlerCount: specs.length,
      lastDeployedAt: new Date(),
      ...(result.webhookBaseUrl ? { deployedUrl: result.webhookBaseUrl } : {}),
      updatedAt: new Date(),
    })
    .where(scopedToTenant(projectBackends, args.tenantId, eq(projectBackends.id, backend.id)));
  await invalidateIngress(args.env, backend.ingressToken);

  return {
    ...result,
    strategy: backend.strategy,
    handlerCount: specs.length,
    written,
    handlerErrors: errors,
  };
}

/**
 * Record where a `github-worker` backend actually landed.
 *
 * Without this the strategy is generate-only: we write the Worker and the Action,
 * the runner deploys it, and the platform never learns the address — so the UI
 * keeps showing the Builderforce ingress as the place to point webhooks at, which
 * for this strategy is the WRONG URL. The generated workflow reports the URL back
 * over the same GitHub OIDC path the static deploy uses.
 *
 * Only an `https://` URL is accepted: this value is rendered as a link and copied
 * into a provider console, so a runner echoing junk must not become a click target.
 */
export async function recordWorkerDeployment(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number; url: string },
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  let parsed: URL;
  try {
    parsed = new URL(args.url);
  } catch {
    return { ok: false, reason: 'Deployed URL is not a URL' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'Deployed URL must be https' };

  const backend = await ensureProjectBackend(env, db, args.tenantId, args.projectId);
  await db
    .update(projectBackends)
    .set({ deployedUrl: parsed.origin, lastDeployedAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(projectBackends, args.tenantId, eq(projectBackends.id, backend.id)));
  await invalidateIngress(env, backend.ingressToken);
  return { ok: true, url: parsed.origin };
}

// ---------------------------------------------------------------------------
// Request log
// ---------------------------------------------------------------------------

export type RequestVerdict = 'ok' | 'unverified' | 'no-handler' | 'error';

/**
 * Record one inbound delivery. Best-effort: an audit-write failure must never
 * turn a successful webhook reply into an error — Twilio would retry a message
 * we had already handled.
 */
export async function recordBackendRequest(
  db: Db,
  row: {
    projectId: number;
    tenantId: number;
    route: string;
    method: string;
    statusCode: number;
    verdict: RequestVerdict;
    durationMs?: number;
    error?: string | null;
  },
): Promise<void> {
  try {
    await db.insert(projectBackendRequests).values({
      projectId: row.projectId,
      tenantId: row.tenantId,
      route: row.route.slice(0, 255),
      method: row.method.slice(0, 8),
      statusCode: row.statusCode,
      verdict: row.verdict,
      durationMs: row.durationMs ?? null,
      error: row.error ? row.error.slice(0, 1000) : null,
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/backend/index.ts', operation: 'recordBackendRequest' });
  }
}

/** Recent deliveries for the project's backend panel, newest first. */
export async function recentBackendRequests(db: Db, tenantId: number, projectId: number, limit = 25) {
  return db
    .select({
      id: projectBackendRequests.id,
      route: projectBackendRequests.route,
      method: projectBackendRequests.method,
      statusCode: projectBackendRequests.statusCode,
      verdict: projectBackendRequests.verdict,
      durationMs: projectBackendRequests.durationMs,
      error: projectBackendRequests.error,
      createdAt: projectBackendRequests.createdAt,
    })
    .from(projectBackendRequests)
    .where(scopedToTenant(projectBackendRequests, tenantId, eq(projectBackendRequests.projectId, projectId)))
    .orderBy(sql`${projectBackendRequests.createdAt} DESC`)
    .limit(limit);
}

export { HANDLERS_DIR } from './handlerSpec';
export type { HandlerSpec } from './handlerSpec';
export type { BackendStrategyKey, SetupStep } from './hostingStrategy';
