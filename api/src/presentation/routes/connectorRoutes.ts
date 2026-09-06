/**
 * Connector platform routes — /api/connectors
 *
 * The catalog, the authoring surface, and the credential store behind
 * Builderforce's integration breadth. Three audiences, one router:
 *   • the gallery         GET  /                      catalog + connection counts
 *   • the builder         POST /  ·  PATCH /:id  ·  POST /import/openapi
 *   • the operator        connections CRUD, test, and the call log
 *
 * ROLE: MANAGER+ throughout. A connector connection holds a credential that acts on
 * the tenant's behalf in an external system — that is not a read-only surface, and
 * a member who can open a ticket must not be able to point the workforce at a new
 * Salesforce org.
 *
 * Secrets are write-only over this API: they go in on create/update and never come
 * back out. `GET` returns the non-secret fields plus the NAMES of the keys that
 * have a value, which is enough to render "connected as acme.zendesk.com".
 *
 * ERRORS. `ConnectorServiceError`, `ConnectorCallError`, `SpecFetchError` and
 * `OpenApiImportError` each carry their own status (and, for the service, the
 * `details` list a validator produced); the global handler renders them through
 * `statusOf`, so no handler here catches anything.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv, Env } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import {
  listConnectorsForTenant,
  resolveConnector,
} from '../../application/connectors/connectorRegistry';
import {
  connectionCountsByConnector,
  createConnection,
  createConnector,
  deleteConnection,
  deleteConnector,
  listCallLogs,
  listConnections,
  summarizeCatalog,
  testConnection,
  updateConnection,
  updateConnector,
} from '../../application/connectors/connectorService';
import { executeConnectorAction } from '../../application/connectors/connectorRuntime';
import { manifestFromOpenApi, fetchOpenApiSpec } from '../../application/connectors/openapiImport';
import { CONNECTOR_CATEGORIES } from '../../application/connectors/connectorManifest';
import { connectorActionCatalog } from '../../application/connectors/connectorActionCatalog';
import { limitParam } from './queryParams';
import { parseBody, z, zNonEmptyString, zOptionalString } from './requestBody';

/** A free-form JSON object — a manifest, a credential bag, an action's input. */
const zJsonObject = z.record(z.string(), z.unknown());

const CreateConnectorBody = z.object({
  manifest: zJsonObject,
  publish: z.boolean().optional(),
});

const UpdateConnectorBody = z.object({
  manifest: zJsonObject.optional(),
  status: z.enum(['published', 'draft']).optional(),
});

const ImportOpenApiBody = z.object({
  key: zNonEmptyString,
  specUrl: zOptionalString,
  spec: zJsonObject.optional(),
  name: zOptionalString,
  icon: zOptionalString,
  category: zOptionalString,
});

const CreateConnectionBody = z.object({
  connectorKey: zNonEmptyString,
  name: zNonEmptyString,
  credentials: zJsonObject.optional(),
  baseUrlOverride: z.string().nullable().optional(),
});

const UpdateConnectionBody = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  credentials: zJsonObject.optional(),
  baseUrlOverride: z.string().nullable().optional(),
});

const TestConnectionBody = z.object({
  actionKey: zOptionalString,
  input: zJsonObject.optional(),
});

const RunActionBody = z.object({
  input: zJsonObject.optional(),
  connectionId: zOptionalString,
});

export function createConnectorRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // ── Catalog ────────────────────────────────────────────────────────────
  // GET /api/connectors — every connector this tenant can use, built-in and custom.
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [entries, counts] = await Promise.all([
      listConnectorsForTenant(db, tenantId, c.env as Env),
      connectionCountsByConnector(db, tenantId),
    ]);
    return c.json({ connectors: summarizeCatalog(entries, counts), categories: CONNECTOR_CATEGORIES });
  });

  // GET /api/connectors/actions — every callable action with its parameters.
  //
  // Declared BEFORE `/:key` or Hono would match "actions" as a connector key and
  // 404 it. Feeds the workflow builder's connector node, which is how every
  // connector — built-in or tenant-authored — becomes a workflow step without a
  // code change.
  router.get('/actions', async (c) => {
    const tenantId = c.get('tenantId') as number;
    return c.json({ connectors: await connectorActionCatalog(db, c.env as Env, tenantId) });
  });

  // GET /api/connectors/:key — the full manifest, for the detail panel and builder.
  router.get('/:key', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const resolved = await resolveConnector(db, tenantId, c.req.param('key'), c.env as Env);
    if (!resolved) return c.json({ error: 'Connector not found' }, 404);
    return c.json({
      manifest: resolved.manifest,
      origin: resolved.origin,
      status: resolved.status,
      id: resolved.id,
      version: resolved.version,
      /** Built-ins are read-only: they are code, and an edit would be lost on deploy. */
      editable: resolved.origin === 'tenant',
    });
  });

  // ── Authoring ──────────────────────────────────────────────────────────
  // POST /api/connectors — create a custom connector from a manifest.
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const body = await parseBody(c, CreateConnectorBody);
    const created = await createConnector(db, c.env as Env, {
      tenantId, manifest: body.manifest, userId, publish: body.publish === true,
    });
    return c.json(created, 201);
  });

  // PATCH /api/connectors/:id — edit the manifest and/or publish it.
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, UpdateConnectorBody);
    const updated = await updateConnector(db, c.env as Env, {
      tenantId,
      id: c.req.param('id'),
      ...(body.manifest !== undefined ? { manifest: body.manifest } : {}),
      ...(body.status ? { status: body.status } : {}),
    });
    return c.json(updated);
  });

  // DELETE /api/connectors/:id — remove a custom connector and its connections.
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const result = await deleteConnector(db, c.env as Env, { tenantId, id: c.req.param('id') });
    return c.json({ ok: true, ...result });
  });

  // ── OpenAPI import ─────────────────────────────────────────────────────
  // POST /api/connectors/import/openapi — turn a spec into a DRAFT manifest.
  //
  // Returns the manifest WITHOUT saving it. The importer gets you ~90% of the way;
  // the remaining decisions (which actions matter, whether `mutates` is right for
  // this API) belong to a human, and a silent save would skip that review.
  router.post('/import/openapi', async (c) => {
    const body = await parseBody(c, ImportOpenApiBody);
    const key = body.key.toLowerCase();

    let spec: unknown = body.spec;
    let fallbackBaseUrl: string | undefined;

    if (!spec) {
      if (!body.specUrl) return c.json({ error: 'Provide either specUrl or spec' }, 400);
      // The spec URL is tenant-supplied and fetched SERVER-SIDE, so the fetch lives
      // in the application layer beside the connector runtime's — same SSRF guard,
      // written once.
      const fetched = await fetchOpenApiSpec(body.specUrl);
      spec = fetched.spec;
      fallbackBaseUrl = fetched.baseUrl;
    }

    const result = manifestFromOpenApi(spec, {
      key,
      ...(body.name ? { name: body.name } : {}),
      ...(body.icon ? { icon: body.icon } : {}),
      ...(body.category ? { category: body.category } : {}),
      ...(fallbackBaseUrl ? { fallbackBaseUrl } : {}),
    });
    return c.json(result);
  });

  // ── Connections ────────────────────────────────────────────────────────
  router.get('/connections/list', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const connectorKey = c.req.query('connectorKey');
    const connections = await listConnections(db, c.env as Env, {
      tenantId, ...(connectorKey ? { connectorKey } : {}),
    });
    return c.json({ connections });
  });

  router.post('/connections', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string;
    const body = await parseBody(c, CreateConnectionBody);
    const connection = await createConnection(db, c.env as Env, {
      tenantId,
      connectorKey: body.connectorKey,
      name: body.name,
      credentials: body.credentials ?? {},
      baseUrlOverride: body.baseUrlOverride ?? null,
      userId,
    });
    return c.json({ connection }, 201);
  });

  router.patch('/connections/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, UpdateConnectionBody);
    const connection = await updateConnection(db, c.env as Env, {
      tenantId, id: c.req.param('id'),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.credentials !== undefined ? { credentials: body.credentials } : {}),
      ...(body.baseUrlOverride !== undefined ? { baseUrlOverride: body.baseUrlOverride } : {}),
    });
    return c.json({ connection });
  });

  router.delete('/connections/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    await deleteConnection(db, c.env as Env, { tenantId, id: c.req.param('id') });
    return c.json({ ok: true });
  });

  // POST /api/connectors/connections/:id/test — verify credentials with a real read.
  router.post('/connections/:id/test', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, TestConnectionBody);
    const result = await testConnection(db, c.env as Env, {
      tenantId, id: c.req.param('id'),
      ...(body.actionKey ? { actionKey: body.actionKey } : {}),
      ...(body.input ? { input: body.input } : {}),
    });
    return c.json(result);
  });

  // ── Manual invocation ──────────────────────────────────────────────────
  // POST /api/connectors/:key/actions/:action — run one action by hand.
  //
  // This is what the builder's "Run action" button posts to, and it is also the
  // human-facing twin of the agent tool: the same runtime, the same audit row,
  // tagged `actorKind: 'user'` so the log can tell the two apart.
  router.post('/:key/actions/:action', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, RunActionBody);
    const result = await executeConnectorAction({
      db, env: c.env as Env, tenantId,
      connectorKey: c.req.param('key'),
      actionKey: c.req.param('action'),
      input: body.input ?? {},
      connectionId: body.connectionId ?? null,
      actorKind: 'user',
      // A draft is callable HERE (that is how you iterate on one) but never by an
      // agent — listConnectorTools only advertises published connectors.
      allowDraft: true,
    });
    return c.json(result);
  });

  // ── Audit ──────────────────────────────────────────────────────────────
  router.get('/logs/recent', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const connectionId = c.req.query('connectionId');
    const limit = limitParam(c.req.query('limit'), 25, 500);
    const logs = await listCallLogs(db, {
      tenantId,
      ...(connectionId ? { connectionId } : {}),
      ...(Number.isFinite(limit) ? { limit } : {}),
    });
    return c.json({ logs });
  });

  return router;
}
