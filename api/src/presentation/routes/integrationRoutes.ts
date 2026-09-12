/**
 * Integration routes – /api/integrations
 *
 * Manages third-party integration credentials (GitHub, Jira, Bitbucket,
 * Confluence, Freshservice).  Credentials are encrypted at rest using
 * AES-256-GCM with a PER-TENANT derived key (the base secret is folded with the
 * tenant id into the PBKDF2 salt; new rows are written as `v2:` ciphertext, legacy
 * global-key rows still decrypt — see application/integrations/credentialCrypto).
 *
 * POST   /api/integrations           Create credential     (MANAGER+)
 * GET    /api/integrations           List credentials      (MANAGER+)
 * GET    /api/integrations/:id       Get credential detail (MANAGER+)
 * PATCH  /api/integrations/:id       Update credential     (MANAGER+)
 * DELETE /api/integrations/:id       Delete credential     (MANAGER+)
 * POST   /api/integrations/:id/test  Test connectivity     (MANAGER+)
 */

import { Hono } from 'hono';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { integrationCredentials, integrationSyncLogs, projects } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { encryptCredentials, decryptCredentials } from '../../application/integrations/credentialCrypto';
import {
  CONNECTABLE_PROVIDERS,
  isConnectableProvider,
  testProviderCredential,
  validateProviderCredentials,
} from '../../application/integrations/providerTests';
import { CONNECTABLE_CATEGORIES, connectableCatalog } from '../../application/integrations/connectableCatalog';
import { getMissingIntegrationRecommendations } from '../../application/integrations/integrationGapRecommendations';
import { limitParam } from './queryParams';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { loadProjectInTenant } from '../../application/project/projectOwnership';
import { parseBody, z, zNonEmptyString, zOptionalString, zPositiveInt } from './requestBody';

/** POST / — the provider is checked against the live registry below, not a static enum. */
const CreateCredentialBody = z.object({
  provider: zNonEmptyString,
  name: zNonEmptyString,
  baseUrl: zOptionalString,
  projectId: zPositiveInt.nullable().optional(),
  credentials: z.record(z.string(), z.unknown()),
});

/** PATCH /:id — every field optional; `baseUrl: null` clears it, absent leaves it. */
const PatchCredentialBody = z.object({
  name: zNonEmptyString.optional(),
  baseUrl: z.string().nullable().optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
  isEnabled: z.boolean().optional(),
});

/**
 * Credential providers accepted by this endpoint come from ONE registry
 * (`application/integrations/providerTests`), which unions the hand-written
 * SCM/PM/ITSM probes with the Data + Marketing catalog. Adding a provider to the
 * catalog therefore makes it connectable here with no edit to this file — the
 * previous hard-coded list is exactly how the builder ended up advertising 24
 * integrations the backend would not accept.
 *
 * `google_calendar`, `rally` and `freshworks` remain absent: they are managed by
 * their own OAuth / board-sync flows.
 */
type CredentialProvider = string;

/** Mask a credential value for display (show last 4 chars). */
function maskToken(token: string): string {
  if (token.length <= 4) return '****';
  return '****' + token.slice(-4);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createIntegrationRoutes(db: Db, encryptionSecret: string): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  // Reads (the credential list + sync logs) are allowed for any tenant member so
  // the Source-control / Integrations credential pickers populate. Mutations and
  // the detail view (which exposes masked secrets) stay MANAGER-only — applied
  // per-route below.
  const manager = requireRole(TenantRole.MANAGER);

  // POST /api/integrations
  router.post('/', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await parseBody(c, CreateCredentialBody);

    if (!isConnectableProvider(body.provider)) {
      return c.json({ error: `provider must be one of: ${CONNECTABLE_PROVIDERS.join(', ')}` }, 400);
    }

    // Catalog providers declare their credential fields, so an unusable
    // credential (a missing key, a malformed DSN) is rejected at the form rather
    // than discovered later by a failing workflow run.
    const shape = validateProviderCredentials(body.provider, body.credentials);
    if (!shape.ok) return c.json({ error: shape.error }, 400);

    // Optional project scope — NULL means workspace-global. When set, the
    // project must belong to this tenant (prevents cross-tenant scoping).
    let projectId: number | null = null;
    if (body.projectId != null) {
      const proj = await loadProjectInTenant(db, tenantId, body.projectId, { id: projects.id });
      if (!proj) return c.json({ error: 'projectId not found in this workspace' }, 400);
      projectId = proj.id;
    }

    const { enc, iv } = await encryptCredentials(body.credentials, encryptionSecret, tenantId);

    const [row] = await db
      .insert(integrationCredentials)
      .values({
        tenantId,
        projectId,
        provider:       body.provider as never,
        name:           body.name.trim(),
        baseUrl:        body.baseUrl ?? null,
        credentialsEnc: enc,
        iv,
        isEnabled:      true,
      })
      .returning({
        id: integrationCredentials.id,
        projectId: integrationCredentials.projectId,
        provider: integrationCredentials.provider,
        name: integrationCredentials.name,
        baseUrl: integrationCredentials.baseUrl,
        isEnabled: integrationCredentials.isEnabled,
        createdAt: integrationCredentials.createdAt,
      });

    return c.json(row, 201);
  });

  // GET /api/integrations            ?projectId=<n>  → that project's creds
  //                                  ?scope=global   → workspace-global only
  //                                  (no query)      → all tenant creds
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectIdParam = c.req.query('projectId');
    const scope = c.req.query('scope');

    const filters = [eq(integrationCredentials.tenantId, tenantId)];
    if (projectIdParam) {
      filters.push(eq(integrationCredentials.projectId, Number(projectIdParam)));
    } else if (scope === 'global') {
      filters.push(isNull(integrationCredentials.projectId));
    }

    const rows = await db
      .select({
        id:           integrationCredentials.id,
        projectId:    integrationCredentials.projectId,
        provider:     integrationCredentials.provider,
        name:         integrationCredentials.name,
        baseUrl:      integrationCredentials.baseUrl,
        isEnabled:    integrationCredentials.isEnabled,
        lastTestedAt: integrationCredentials.lastTestedAt,
        lastTestOk:   integrationCredentials.lastTestOk,
        createdAt:    integrationCredentials.createdAt,
        updatedAt:    integrationCredentials.updatedAt,
      })
      .from(integrationCredentials)
      .where(and(...filters))
      .orderBy(desc(integrationCredentials.createdAt)).limit(LIST_ROW_CAP);

    return c.json({ integrations: rows });
  });

  // GET /api/integrations/connectable — what CAN be connected, and how: every
  // provider's connect form (label, category, base-URL requirement, fields) plus
  // the gallery's section order. NOT `/catalog`: that literal path belongs to the
  // PUBLIC marketing catalog, mounted first in index.ts, which shadowed this
  // route for as long as it lived there.
  // Registered before `/:id` so the literal path is not swallowed by the param
  // route. The catalog is a frozen module constant (built once at load, no tenant
  // state, no I/O) — that constant is the cache; the client memoises the fetch.
  router.get('/connectable', (c) => {
    c.header('Cache-Control', 'private, max-age=300');
    return c.json({ providers: connectableCatalog(), categories: CONNECTABLE_CATEGORIES });
  });

  // GET /api/integrations/recommendations?projectId=<n>
  // Live comparison of the connectable catalog with enabled tenant/project
  // credentials. Registered before /:id so "recommendations" is never parsed as
  // a credential UUID.
  router.get('/recommendations', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rawProjectId = c.req.query('projectId');
    const projectId = rawProjectId == null ? undefined : Number(rawProjectId);
    if (projectId != null && (!Number.isInteger(projectId) || projectId <= 0)) {
      return c.json({ error: 'projectId must be a positive integer' }, 400);
    }
    if (projectId != null) {
      const project = await loadProjectInTenant(db, tenantId, projectId, { id: projects.id });
      if (!project) return c.json({ error: 'projectId not found in this workspace' }, 404);
    }

    const recommendations = await getMissingIntegrationRecommendations(db, tenantId, projectId);
    return c.json({ recommendations, total: recommendations.length });
  });

  // GET /api/integrations/:id  (returns masked secrets → MANAGER only)
  router.get('/:id', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(integrationCredentials)
      .where(and(eq(integrationCredentials.id, id), eq(integrationCredentials.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Integration not found' }, 404);

    // Decrypt and mask for display
    const creds = await decryptCredentials(row.credentialsEnc, row.iv, encryptionSecret, tenantId);
    const maskedCreds: Record<string, string> = {};
    if (creds) {
      for (const [k, v] of Object.entries(creds)) {
        maskedCreds[k] = maskToken(String(v));
      }
    }

    return c.json({ ...row, credentialsEnc: undefined, iv: undefined, credentials: maskedCreds });
  });

  // PATCH /api/integrations/:id
  router.patch('/:id', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [existing] = await db
      .select()
      .from(integrationCredentials)
      .where(and(eq(integrationCredentials.id, id), eq(integrationCredentials.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Integration not found' }, 404);

    const body = await parseBody(c, PatchCredentialBody);

    let credentialsEnc = existing.credentialsEnc;
    let iv = existing.iv;
    const rotated = body.credentials !== undefined;
    if (body.credentials) {
      const encrypted = await encryptCredentials(body.credentials, encryptionSecret, tenantId);
      credentialsEnc = encrypted.enc;
      iv = encrypted.iv;
    }

    const [updated] = await db
      .update(integrationCredentials)
      .set({
        name:           body.name ?? existing.name,
        baseUrl:        body.baseUrl !== undefined ? body.baseUrl : existing.baseUrl,
        credentialsEnc,
        iv,
        isEnabled:      body.isEnabled ?? existing.isEnabled,
        // Rotating the secret invalidates the prior connectivity result — clear it
        // so the row doesn't keep showing "connected" for a key that's now gone.
        ...(rotated ? { lastTestedAt: null, lastTestOk: null } : {}),
        updatedAt:      new Date(),
      })
      .where(and(eq(integrationCredentials.id, id), eq(integrationCredentials.tenantId, tenantId)))
      .returning({
        id: integrationCredentials.id,
        projectId: integrationCredentials.projectId,
        provider: integrationCredentials.provider,
        name: integrationCredentials.name,
        baseUrl: integrationCredentials.baseUrl,
        isEnabled: integrationCredentials.isEnabled,
        updatedAt: integrationCredentials.updatedAt,
      });

    return c.json(updated);
  });

  // DELETE /api/integrations/:id
  router.delete('/:id', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [existing] = await db
      .select({ id: integrationCredentials.id })
      .from(integrationCredentials)
      .where(and(eq(integrationCredentials.id, id), eq(integrationCredentials.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Integration not found' }, 404);

    await db.delete(integrationCredentials)
      .where(and(eq(integrationCredentials.id, id), eq(integrationCredentials.tenantId, tenantId)));

    return c.json({ deleted: true });
  });

  // POST /api/integrations/:id/test
  router.post('/:id/test', manager, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [row] = await db
      .select()
      .from(integrationCredentials)
      .where(and(eq(integrationCredentials.id, id), eq(integrationCredentials.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Integration not found' }, 404);

    const creds = await decryptCredentials(row.credentialsEnc, row.iv, encryptionSecret, tenantId);
    // A stored credential that no longer decrypts is a server-side invariant
    // failure (rotated secret, corrupt ciphertext) — reported, never described.
    if (!creds) throw new Error(`integration_credentials row ${id} did not decrypt`);

    const result = await testProviderCredential(row.provider, creds, row.baseUrl);

    // Persist test result
    await db
      .update(integrationCredentials)
      .set({ lastTestedAt: new Date(), lastTestOk: result.ok, updatedAt: new Date() })
      .where(scopedToTenant(integrationCredentials, tenantId, eq(integrationCredentials.id, id)));

    return c.json(result);
  });

  // GET /api/integrations/:id/sync-logs
  router.get('/:id/sync-logs', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const limit = limitParam(c.req.query('limit'), 20, 100);

    const [cred] = await db
      .select({ id: integrationCredentials.id })
      .from(integrationCredentials)
      .where(and(eq(integrationCredentials.id, id), eq(integrationCredentials.tenantId, tenantId)));
    if (!cred) return c.json({ error: 'Integration not found' }, 404);

    const logs = await db
      .select()
      .from(integrationSyncLogs)
      .where(scopedToTenant(integrationSyncLogs, tenantId, eq(integrationSyncLogs.credentialId, id)))
      .orderBy(desc(integrationSyncLogs.startedAt))
      .limit(limit);

    return c.json({ logs });
  });

  return router;
}
