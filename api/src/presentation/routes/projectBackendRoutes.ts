/**
 * `/api/projects/:projectId/backend` — operating a project's server-side half.
 *
 *   GET    /                    ingress URL, strategy, live handlers, spec errors
 *   PATCH  /                    switch hosting strategy
 *   POST   /materialize         re-run the strategy (regenerate README / Worker)
 *   GET    /requests            recent inbound deliveries
 *   GET    /secrets             stored secret names + hints (never values)
 *   PUT    /secrets/:name       create or rotate one secret
 *   DELETE /secrets/:name
 *
 * Every route is tenant-scoped through {@link assertProject}: a project id in a
 * path is user input, and the backend it addresses holds credentials and a public
 * ingress. Reading another tenant's ingress token would be enough to receive
 * their webhooks' replies.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import type { Env, HonoEnv } from '../../env';
import {
  ensureProjectBackend,
  findProjectForTenant,
  HOSTING_STRATEGIES,
  ingressUrlFor,
  isBackendStatus,
  loadHandlers,
  materializeBackend,
  probeWorkerHealth,
  readHandlerDocument,
  recentBackendRequests,
  removeHandler,
  saveHandler,
  setBackendStatus,
  BACKEND_STATUSES,
} from '../../application/backend';
import { isBackendStrategy } from '../../application/backend/hostingStrategy';
import { BUILTIN_CONNECTORS } from '../../application/connectors/defaults';
import {
  deleteProjectSecret,
  listProjectSecrets,
  setProjectSecret,
} from '../../application/secrets/projectSecrets';
import { verifySecretNameFor } from '../../application/backend/webhookVerification';
import { HOSTING_APEX } from '../../application/ide/siteHosting';
import { siteForProject } from '../../application/ide/siteTraffic';

/** Resolve + authorise the project in the path. A miss is reported as 404 rather
 *  than 403 — the existence of another tenant's project is itself information. */
const assertProject = (db: Db, tenantId: number, raw: string) =>
  findProjectForTenant(db, tenantId, Number(raw));

/**
 * Secret names the project's OWN handlers require, derived from what they
 * actually declare rather than from a stored list. A handler switched from
 * `twilio` to `none` should stop demanding a token immediately, and a list that
 * had to be maintained separately would keep asking for it forever.
 */
function requiredSecretsFor(handlers: Awaited<ReturnType<typeof loadHandlers>>['specs']): string[] {
  const names = new Set<string>();
  for (const h of handlers) {
    const secret = verifySecretNameFor(h);
    if (secret) names.add(secret);
  }
  return [...names];
}

/** Connector manifests the handlers reference — needed by the Worker generator. */
function connectorsFor(handlers: Awaited<ReturnType<typeof loadHandlers>>['specs']) {
  const keys = new Set<string>();
  for (const h of handlers) for (const s of h.steps) if (s.kind === 'connector') keys.add(s.connector);
  return [...keys].map((k) => BUILTIN_CONNECTORS.get(k)).filter((m): m is NonNullable<typeof m> => !!m);
}

/**
 * Re-run the project's hosting strategy against whatever is in the canvas now.
 *
 * Every write that changes what the backend DOES calls this, so the generated
 * artefacts — the declarative endpoint map, the `github-worker` Worker source —
 * are never a snapshot of an older set of handlers. Editing a handler and having
 * the Worker still ship the previous one is the exact drift the declarative
 * strategy was designed to avoid; the other strategy has to be kept honest by
 * hand, and this is that hand.
 */
async function regenerate(
  db: Db,
  env: Env & { UPLOADS?: R2Bucket },
  tenantId: number,
  project: { id: number; name: string },
) {
  if (!env.UPLOADS) return null;
  const { specs } = await loadHandlers(env.UPLOADS, project.id);
  const secrets = await listProjectSecrets(db, tenantId, project.id);
  return materializeBackend({
    db,
    env,
    bucket: env.UPLOADS,
    tenantId,
    projectId: project.id,
    projectName: project.name,
    connectors: connectorsFor(specs),
    secretNames: secrets.map((s) => s.name),
    requiredSecretNames: requiredSecretsFor(specs),
  });
}

export function createProjectBackendRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/:projectId/backend', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const env = c.env as Env & { UPLOADS?: R2Bucket };
    const backend = await ensureProjectBackend(env, db, tenantId, project.id);
    const { specs, errors } = env.UPLOADS ? await loadHandlers(env.UPLOADS, project.id) : { specs: [], errors: [] };
    const secrets = await listProjectSecrets(db, tenantId, project.id);
    const required = requiredSecretsFor(specs);
    const have = new Set(secrets.map((s) => s.name));

    // For a deployed Worker the live question is not "did it deploy" but "is it
    // credentialled" — so the readiness probe rides along with the panel's first
    // load instead of being a second call the UI has to remember to make. Only
    // for that strategy, and cached, so a declarative project pays nothing.
    const health =
      backend.strategy === 'github-worker' ? await probeWorkerHealth(env, backend.deployedUrl) : null;

    const ingressUrl = ingressUrlFor(env, backend.ingressToken);

    // The site-origin address, when the project has published one. This is the
    // URL a person actually wants: their own domain, a path they can type, and
    // the one a page on that site can `fetch()` without embedding a token.
    const site = await siteForProject(db, tenantId, project.id);
    const siteBase = site
      ? `https://${site.customDomain ?? `${site.subdomain}.${HOSTING_APEX}`}/api`
      : null;

    return c.json({
      workerHealth: health,
      backend: {
        strategy: backend.strategy,
        status: backend.status,
        ingressUrl,
        deployedUrl: backend.deployedUrl,
        siteUrl: siteBase,
        lastDeployedAt: backend.lastDeployedAt,
        handlerCount: specs.length,
      },
      strategies: HOSTING_STRATEGIES.map((s) => ({ key: s.key, label: s.label, summary: s.summary, zeroSetup: s.zeroSetup })),
      handlers: specs.map((s) => ({
        name: s.name,
        route: s.route,
        method: s.method,
        verify: s.verify,
        description: s.description ?? null,
        url: `${ingressUrl}${s.route === '/' ? '' : s.route}`,
        // Both addresses, because they are not interchangeable in use: one goes
        // in a provider console, the other into the site's own JavaScript.
        siteUrl: siteBase ? `${siteBase}${s.route === '/' ? '' : s.route}` : null,
        stepCount: s.steps.length,
        // The parsed spec rides along: a project has a handful of handlers, and
        // the editor needing one round-trip PER handler to open a form would be
        // an N+1 on a panel whose whole job is showing them all at once.
        spec: s,
      })),
      handlerErrors: errors,
      secrets,
      // The gap the operator has to close, computed rather than remembered.
      missingSecrets: required.filter((n) => !have.has(n)),
    });
  });

  router.patch('/:projectId/backend', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const env = c.env as Env;
    const body = await c.req.json<{ strategy?: unknown; status?: unknown }>().catch(() => ({}) as never);

    // Both fields are optional, but a PATCH that names NEITHER is a caller bug
    // rather than a no-op worth pretending succeeded.
    if (body.strategy === undefined && body.status === undefined) {
      return c.json({ error: 'Provide strategy and/or status' }, 400);
    }
    if (body.strategy !== undefined && !isBackendStrategy(body.strategy)) {
      return c.json({ error: `strategy must be one of: ${HOSTING_STRATEGIES.map((s) => s.key).join(', ')}` }, 400);
    }
    if (body.status !== undefined && !isBackendStatus(body.status)) {
      return c.json({ error: `status must be one of: ${BACKEND_STATUSES.join(', ')}` }, 400);
    }

    let backend = await ensureProjectBackend(
      env,
      db,
      tenantId,
      project.id,
      isBackendStrategy(body.strategy) ? body.strategy : undefined,
    );
    if (isBackendStatus(body.status)) {
      backend = await setBackendStatus(env, db, tenantId, project.id, body.status);
    }
    return c.json({
      backend: {
        strategy: backend.strategy,
        status: backend.status,
        ingressUrl: ingressUrlFor(env, backend.ingressToken),
      },
    });
  });

  // ── Handlers ─────────────────────────────────────────────────────────────
  // The authoring path for the canvas documents the ingress executes. Writes go
  // through the same parser the ingress uses, so an unsaveable spec and an
  // unservable one are the same set.

  router.get('/:projectId/backend/handlers/:name', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const env = c.env as Env & { UPLOADS?: R2Bucket };
    if (!env.UPLOADS) return c.json({ error: 'Storage is not configured' }, 503);
    const document = await readHandlerDocument(env.UPLOADS, project.id, c.req.param('name'));
    if (document === null) return c.json({ error: 'Handler not found' }, 404);
    return c.json({ document });
  });

  router.put('/:projectId/backend/handlers/:name', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const env = c.env as Env & { UPLOADS?: R2Bucket };
    if (!env.UPLOADS) return c.json({ error: 'Storage is not configured' }, 503);

    const body = await c.req.json<{ document?: unknown }>().catch(() => ({}) as never);
    const saved = await saveHandler(env, env.UPLOADS, project.id, c.req.param('name'), body.document);
    if (!saved.ok) return c.json({ error: saved.reason }, saved.status);

    await regenerate(db, env, tenantId, project);
    return c.json({ ok: true, path: saved.path, spec: saved.spec });
  });

  router.delete('/:projectId/backend/handlers/:name', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const env = c.env as Env & { UPLOADS?: R2Bucket };
    if (!env.UPLOADS) return c.json({ error: 'Storage is not configured' }, 503);
    if (!(await removeHandler(env, env.UPLOADS, project.id, c.req.param('name')))) {
      return c.json({ error: 'Invalid handler name' }, 400);
    }
    await regenerate(db, env, tenantId, project);
    return c.json({ ok: true });
  });

  /** Re-run the strategy. On `declarative` this regenerates the endpoint map; on
   *  `github-worker` it regenerates the Worker from the current handlers. */
  router.post('/:projectId/backend/materialize', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const env = c.env as Env & { UPLOADS?: R2Bucket };
    if (!env.UPLOADS) return c.json({ error: 'Storage is not configured' }, 503);
    return c.json({ result: await regenerate(db, env, tenantId, project) });
  });

  router.get('/:projectId/backend/requests', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const rows = await recentBackendRequests(db, tenantId, project.id, 50);
    return c.json({
      requests: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      })),
    });
  });

  // ── Secrets ──────────────────────────────────────────────────────────────

  router.get('/:projectId/backend/secrets', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json({ secrets: await listProjectSecrets(db, tenantId, project.id) });
  });

  router.put('/:projectId/backend/secrets/:name', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const body = await c.req.json<{ value?: unknown; description?: unknown }>().catch(() => ({}) as never);
    if (typeof body.value !== 'string') return c.json({ error: 'value is required' }, 400);

    const result = await setProjectSecret(db, c.env as Env, {
      tenantId,
      projectId: project.id,
      name: c.req.param('name'),
      value: body.value,
      description: typeof body.description === 'string' ? body.description : null,
      userId: (c.get('userId') as string) ?? null,
    });
    if (!result.ok) return c.json({ error: result.reason }, result.status);
    // The value is NOT echoed back, not even to the caller who just set it — the
    // vault has no read path by design.
    return c.json({ ok: true, secrets: await listProjectSecrets(db, tenantId, project.id) });
  });

  router.delete('/:projectId/backend/secrets/:name', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);
    await deleteProjectSecret(db, tenantId, project.id, c.req.param('name'));
    return c.json({ ok: true, secrets: await listProjectSecrets(db, tenantId, project.id) });
  });

  return router;
}
