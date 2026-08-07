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
  loadHandlers,
  materializeBackend,
  recentBackendRequests,
} from '../../application/backend';
import { isBackendStrategy } from '../../application/backend/hostingStrategy';
import { BUILTIN_CONNECTORS } from '../../application/connectors/defaults';
import {
  deleteProjectSecret,
  listProjectSecrets,
  setProjectSecret,
} from '../../application/secrets/projectSecrets';
import { VERIFY_SECRET_NAME } from '../../application/backend/webhookVerification';

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
  for (const h of handlers) if (h.verify !== 'none') names.add(VERIFY_SECRET_NAME[h.verify]);
  return [...names];
}

/** Connector manifests the handlers reference — needed by the Worker generator. */
function connectorsFor(handlers: Awaited<ReturnType<typeof loadHandlers>>['specs']) {
  const keys = new Set<string>();
  for (const h of handlers) for (const s of h.steps) if (s.kind === 'connector') keys.add(s.connector);
  return [...keys].map((k) => BUILTIN_CONNECTORS.get(k)).filter((m): m is NonNullable<typeof m> => !!m);
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

    const ingressUrl = ingressUrlFor(env, backend.ingressToken);
    return c.json({
      backend: {
        strategy: backend.strategy,
        status: backend.status,
        ingressUrl,
        deployedUrl: backend.deployedUrl,
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
        stepCount: s.steps.length,
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

    const body = await c.req.json<{ strategy?: unknown }>().catch(() => ({}) as never);
    if (!isBackendStrategy(body.strategy)) {
      return c.json({ error: `strategy must be one of: ${HOSTING_STRATEGIES.map((s) => s.key).join(', ')}` }, 400);
    }
    const backend = await ensureProjectBackend(c.env as Env, db, tenantId, project.id, body.strategy);
    return c.json({ backend: { strategy: backend.strategy, ingressUrl: ingressUrlFor(c.env as Env, backend.ingressToken) } });
  });

  /** Re-run the strategy. On `declarative` this regenerates the endpoint map; on
   *  `github-worker` it regenerates the Worker from the current handlers. */
  router.post('/:projectId/backend/materialize', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const project = await assertProject(db, tenantId, c.req.param('projectId'));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const env = c.env as Env & { UPLOADS?: R2Bucket };
    if (!env.UPLOADS) return c.json({ error: 'Storage is not configured' }, 503);

    const { specs } = await loadHandlers(env.UPLOADS, project.id);
    const secrets = await listProjectSecrets(db, tenantId, project.id);
    const result = await materializeBackend({
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
    return c.json({ result });
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
