/**
 * Project backends — the service layer over the {@link BackendHostingStrategy}
 * port. This is the ONE place that knows how a project's server-side half is
 * bound to a strategy, where its handlers live, and how its ingress is addressed.
 *
 * Handlers are read from the CANVAS (R2) rather than from a database copy: the
 * canvas is the single source of truth for what the backend does, so editing a
 * handler in the IDE changes behaviour with no publish step to forget and no
 * "deployed version vs. what I see" drift — the failure mode that makes webhook
 * debugging miserable.
 *
 * That read is one R2 list plus a GET per handler, and it now runs on site
 * traffic as well as webhook traffic, so it is served through the read-through
 * cache and invalidated by {@link onCanvasWrite} from every write path. The
 * cache is a cost optimisation only; the invalidation, not the TTL, is what
 * preserves the no-publish-step contract.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveApiOrigin } from '../../env';
import { projectBackendRequests, projectBackends, projects } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { assertSafeUrl, resolveAndAssertPublic } from '../../infrastructure/net/ssrfGuard';
import { deleteWorkspaceFile, listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile } from '../ide/workspaceStore';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { MonitoringService } from '../monitoring/MonitoringService';
import { declarativeStrategy } from './adapters/declarative';
import { githubWorkerStrategy } from './adapters/githubWorker';
import { awsLambdaStrategy } from './adapters/awsLambda';
import { gcpCloudRunStrategy } from './adapters/gcpCloudRun';
import { azureFunctionsStrategy } from './adapters/azureFunctions';
import { BACKEND_HEALTH_PATH } from './adapters/handlerEngineSource';
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
  'aws-lambda': awsLambdaStrategy,
  'gcp-cloudrun': gcpCloudRunStrategy,
  'azure-functions': azureFunctionsStrategy,
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
    return row ? toProjectBackend(row) : null;
  };

  const existing = await read();
  if (existing) {
    if (strategy && strategy !== existing.strategy) {
      await db
        .update(projectBackends)
        .set({ strategy, updatedAt: new Date() })
        .where(scopedToTenant(projectBackends, tenantId, eq(projectBackends.id, existing.id)));
      await invalidateIngress(env, existing.ingressToken, projectId);
      // Moving back to the platform ingress means the self-hosted deployment is
      // no longer the address anything points at. Left watching, it would page
      // on-call for a backend the customer deliberately stopped using.
      if (strategy === 'declarative') {
        try {
          await new MonitoringService(db).unwatchDeployedBackend(tenantId, projectId);
        } catch (error) {
          reportCaughtError(error, { source: 'application/backend/index.ts', operation: 'ensureProjectBackend:unwatch' });
        }
      }
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
const projectBackendCacheKey = (projectId: number): string => `project-backend:project:${projectId}`;

/** One row → the shape both lookups return. */
function toProjectBackend(row: typeof projectBackends.$inferSelect): ProjectBackend {
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
}

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
      return toProjectBackend(row);
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

/**
 * Resolve a PROJECT to its active backend — the site-origin address, where the
 * host already identified the project and there is no token in the path.
 *
 * Cached with the negative result for the same reason the token lookup is: this
 * runs on public site traffic, and a site with no backend must not turn every
 * `/api/...` request into a database round-trip.
 */
export async function backendByProject(env: Env, db: Db, projectId: number): Promise<ProjectBackend | null> {
  return getOrSetCached<ProjectBackend | null>(
    env,
    projectBackendCacheKey(projectId),
    async () => {
      const [row] = await db.select().from(projectBackends).where(eq(projectBackends.projectId, projectId)).limit(1);
      if (!row || row.status !== 'active') return null;
      return toProjectBackend(row);
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

/**
 * Drop every cached resolution of one backend row. Called on any write to it —
 * a strategy switch or a pause that kept serving the old value would be
 * invisible, and the pause case is exactly when someone is trying to stop it.
 *
 * BOTH keys, always: the row is reachable by ingress token and by project, and
 * clearing one would leave the other address serving the stale answer.
 */
export async function invalidateIngress(env: Env, token: string, projectId: number): Promise<void> {
  await Promise.all([
    invalidateCached(env, ingressCacheKey(token)),
    invalidateCached(env, projectBackendCacheKey(projectId)),
  ]);
}

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

/** The two states a backend can be in. `paused` makes every ingress request 404. */
export const BACKEND_STATUSES = ['active', 'paused'] as const;
export type BackendStatus = (typeof BACKEND_STATUSES)[number];

export function isBackendStatus(value: unknown): value is BackendStatus {
  return typeof value === 'string' && (BACKEND_STATUSES as readonly string[]).includes(value);
}

/**
 * Pause or resume a project's public ingress.
 *
 * `backendByIngressToken` already refuses to resolve a non-`active` row, so this
 * is the whole kill switch — but until now nothing WROTE the column, which meant
 * the only way to stop a misbehaving or compromised endpoint was a DBA with a
 * psql session. A public URL that can be created from the product but only
 * stopped from the database is not a finished feature.
 *
 * The cache invalidation is the load-bearing half: the ingress resolution is
 * cached for five minutes, so a pause that skipped it would keep serving for
 * five more minutes — exactly the window in which someone is trying to stop it.
 */
export async function setBackendStatus(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  status: BackendStatus,
): Promise<ProjectBackend> {
  const backend = await ensureProjectBackend(env, db, tenantId, projectId);
  if (backend.status === status) return backend;

  await db
    .update(projectBackends)
    .set({ status, updatedAt: new Date() })
    .where(scopedToTenant(projectBackends, tenantId, eq(projectBackends.id, backend.id)));
  await invalidateIngress(env, backend.ingressToken, projectId);
  return { ...backend, status };
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

const handlersCacheKey = (projectId: number): string => `project-backend:handlers:${projectId}`;

/**
 * {@link loadHandlers}, served through the read-through cache.
 *
 * The uncached read is one R2 list plus a GET per handler, and it runs on the
 * hottest public path there is: every webhook delivery AND — now that handlers
 * answer on the site's own origin — every `fetch('/api/...')` a published page
 * makes. Left uncached, a page that calls its backend on load turns each visitor
 * into N+1 storage round-trips.
 *
 * The canvas is still the single source of truth: every write path invalidates
 * through {@link onCanvasWrite}, so editing a handler in the IDE changes
 * behaviour on the next request rather than after a publish step. The TTL is a
 * backstop for writes that reach R2 some other way, not the invalidation
 * mechanism.
 */
export async function loadHandlersCached(
  env: Env,
  bucket: R2Bucket,
  projectId: number,
): Promise<LoadedHandlers> {
  return getOrSetCached<LoadedHandlers>(
    env,
    handlersCacheKey(projectId),
    () => loadHandlers(bucket, projectId),
    { kvTtlSeconds: 60, l1TtlMs: 15_000 },
  );
}

/**
 * Call after ANY write to a project's canvas. A no-op unless the path is a
 * handler document.
 *
 * One function rather than a condition at each write site: the IDE editor, the
 * challenge materializer and the handler authoring API all write canvas files,
 * and any of them forgetting the check would leave a project serving the
 * previous version of its backend with nothing to indicate why.
 */
export async function onCanvasWrite(env: Env, projectId: number, path: string): Promise<void> {
  if (!path.startsWith(HANDLERS_DIR)) return;
  await invalidateCached(env, handlersCacheKey(projectId));
}

/** Handler file names are canvas paths, so they are constrained like one. */
const HANDLER_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const handlerPathFor = (name: string): string => `${HANDLERS_DIR}${name}.json`;

export type HandlerWriteResult =
  | { ok: true; path: string; spec: HandlerSpec }
  | { ok: false; reason: string; status: 400 | 409 | 503 };

/**
 * Create or replace one handler in the canvas.
 *
 * The document is parsed with the SAME parser the ingress uses before it is
 * written, so a spec that would 404 at delivery time cannot be saved in the first
 * place. That is the whole point of having an authoring path: the alternative —
 * hand-editing JSON and discovering the mistake when a provider reports a failed
 * webhook — is how the feature felt before this existed.
 */
export async function saveHandler(
  env: Env,
  bucket: R2Bucket,
  projectId: number,
  name: string,
  document: unknown,
): Promise<HandlerWriteResult> {
  const clean = name.trim().toLowerCase();
  if (!HANDLER_NAME_RE.test(clean)) {
    return { ok: false, reason: 'Handler name must be lowercase letters, digits, "-" or "_"', status: 400 };
  }
  const parsed = parseHandlerSpec(document, clean);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, status: 400 };

  // Two handlers claiming the same route+method would make which one answers a
  // function of R2 listing order. Reject rather than shadow.
  const existing = await loadHandlers(bucket, projectId);
  const collision = existing.specs.find(
    (s) => s.name !== clean && s.route === parsed.spec.route && s.method === parsed.spec.method,
  );
  if (collision) {
    return { ok: false, reason: `${collision.name} already serves ${parsed.spec.method} ${parsed.spec.route}`, status: 409 };
  }

  const path = handlerPathFor(clean);
  const write = await writeWorkspaceFile(bucket, projectId, path, `${JSON.stringify(document, null, 2)}\n`);
  if (!write.ok) return { ok: false, reason: write.reason, status: 400 };
  await onCanvasWrite(env, projectId, path);
  return { ok: true, path, spec: { ...parsed.spec, name: clean } };
}

/** Remove a handler. Idempotent — deleting one that is already gone is not an error. */
export async function removeHandler(
  env: Env,
  bucket: R2Bucket,
  projectId: number,
  name: string,
): Promise<boolean> {
  const clean = name.trim().toLowerCase();
  if (!HANDLER_NAME_RE.test(clean)) return false;
  const path = handlerPathFor(clean);
  await deleteWorkspaceFile(bucket, projectId, path);
  await onCanvasWrite(env, projectId, path);
  return true;
}

/** The raw canvas document for one handler — what the editor loads and round-trips. */
export async function readHandlerDocument(
  bucket: R2Bucket,
  projectId: number,
  name: string,
): Promise<unknown | null> {
  const clean = name.trim().toLowerCase();
  if (!HANDLER_NAME_RE.test(clean)) return null;
  const raw = await readWorkspaceFile(bucket, projectId, handlerPathFor(clean));
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
    if (write.ok) {
      written.push(path);
      await onCanvasWrite(args.env, args.projectId, path);
    } else {
      errors.push({ path, reason: write.reason });
    }
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
  await invalidateIngress(args.env, backend.ingressToken, args.projectId);

  return {
    ...result,
    strategy: backend.strategy,
    handlerCount: specs.length,
    written,
    handlerErrors: errors,
  };
}

/**
 * Record where a self-hosted backend actually landed.
 *
 * Without this a self-hosted strategy is generate-only: we write the code and the
 * Action, the runner deploys it, and the platform never learns the address — so
 * the UI keeps showing the Builderforce ingress as the place to point webhooks
 * at, which for these strategies is the WRONG URL. Every generated workflow —
 * Cloudflare, AWS, Google Cloud, Azure — reports the URL back over the same
 * GitHub OIDC path the static deploy uses.
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
  await invalidateIngress(env, backend.ingressToken, args.projectId);
  // A redeploy is exactly when the secret bindings may have changed, so the
  // cached readiness for both the old and the new address has to go.
  await invalidateWorkerHealth(env, backend.deployedUrl);
  await invalidateWorkerHealth(env, parsed.origin);

  // Start watching it. Reporting the address once at deploy time and never asking
  // again is how a deleted stack keeps being shown as the place to point provider
  // webhooks at — see `watchDeployedBackend`. Best-effort: the deployment IS live,
  // and failing this call would turn a successful deploy into a reported failure.
  try {
    const name = await projectDisplayName(db, args.tenantId, args.projectId);
    await new MonitoringService(db).watchDeployedBackend(args.tenantId, {
      projectId: args.projectId,
      projectName: name,
      deployedUrl: parsed.origin,
      healthPath: BACKEND_HEALTH_PATH,
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/backend/index.ts', operation: 'recordWorkerDeployment:watch' });
  }

  return { ok: true, url: parsed.origin };
}

// ---------------------------------------------------------------------------
// Deployed-Worker readiness
// ---------------------------------------------------------------------------

export interface WorkerHealth {
  reachable: boolean;
  /** Expected secret name → whether the Worker has it bound. Names only. */
  secrets: Record<string, boolean>;
  /** Routes the DEPLOYED Worker serves — which can lag the canvas. */
  handlers: Array<{ method: string; route: string; verify?: string }>;
  reason?: string;
}

/**
 * Ask a deployed self-hosted backend whether it is actually credentialled.
 *
 * Every generated target — Cloudflare, AWS, Google Cloud, Azure — serves the
 * same health route from the same shared engine, so this one probe answers for
 * all four rather than needing a per-cloud check.
 *
 * The deploy workflow SKIPS a secret that is absent from the repository rather
 * than pushing it empty, which is the right failure posture but leaves the
 * platform unable to tell "deployed" from "deployed and will 403 everything".
 * This closes that: the generated backend reports which of its expected secrets
 * are bound, by name, and the panel can say so before a provider does.
 *
 * Guarded like any other server-side fetch to a customer-controlled URL, and
 * cached briefly — the panel polls it, and a health check that hammers the
 * customer's Worker is its own problem.
 */
export async function probeWorkerHealth(env: Env, deployedUrl: string | null): Promise<WorkerHealth | null> {
  if (!deployedUrl) return null;

  return getOrSetCached<WorkerHealth>(
    env,
    `project-backend:worker-health:${deployedUrl}`,
    async () => {
      let target: URL;
      try {
        target = assertSafeUrl(new URL(BACKEND_HEALTH_PATH, deployedUrl).toString(), { allowHttp: false });
        await resolveAndAssertPublic(target.hostname);
      } catch (error) {
        return { reachable: false, secrets: {}, handlers: [], reason: error instanceof Error ? error.message : 'Blocked URL' };
      }

      try {
        const res = await fetch(target.toString(), {
          headers: { Accept: 'application/json' },
          redirect: 'manual',
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) {
          // An older generated Worker predates the health route. Say that rather
          // than reporting the deployment as broken.
          const reason = res.status === 404
            ? 'This Worker was generated before the health route existed — re-run Rebuild and push.'
            : `Health check returned ${res.status}`;
          return { reachable: false, secrets: {}, handlers: [], reason };
        }
        const data = (await res.json()) as Partial<WorkerHealth> & { secrets?: Record<string, unknown> };
        const secrets: Record<string, boolean> = {};
        for (const [name, bound] of Object.entries(data.secrets ?? {})) secrets[name] = bound === true;
        return {
          reachable: true,
          secrets,
          handlers: Array.isArray(data.handlers) ? data.handlers : [],
        };
      } catch (error) {
        return {
          reachable: false,
          secrets: {},
          handlers: [],
          reason: error instanceof Error ? error.message : 'Could not reach the Worker',
        };
      }
    },
    { kvTtlSeconds: 30, l1TtlMs: 15_000 },
  );
}

/** Drop the cached readiness — called after a redeploy report, whose whole point
 *  is that the answer just changed. */
export async function invalidateWorkerHealth(env: Env, deployedUrl: string | null): Promise<void> {
  if (deployedUrl) await invalidateCached(env, `project-backend:worker-health:${deployedUrl}`);
}

// ---------------------------------------------------------------------------
// Request log
// ---------------------------------------------------------------------------

export type RequestVerdict = 'ok' | 'unverified' | 'no-handler' | 'rate-limited' | 'error';

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
