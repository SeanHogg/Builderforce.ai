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
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { githubStatusMessage } from '../../application/integrations/githubTestError';
import { encryptCredentials, decryptCredentials } from '../../application/integrations/credentialCrypto';

/**
 * Credential providers accepted by this endpoint. Mirrors integrationProviderEnum
 * in schema.ts (sans google_calendar/rally/freshworks, which are managed by their
 * own flows). Board-sync providers are a subset of this list.
 */
const CREDENTIAL_PROVIDERS = [
  'github', 'gitlab', 'bitbucket', 'jira', 'confluence',
  'freshservice', 'freshdesk', 'servicenow', 'linear', 'sentry', 'pagerduty',
  'monday', 'asana', 'clickup',
] as const;
type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number];

/** Mask a credential value for display (show last 4 chars). */
function maskToken(token: string): string {
  if (token.length <= 4) return '****';
  return '****' + token.slice(-4);
}

// ---------------------------------------------------------------------------
// Connectivity test helpers (per provider)
// ---------------------------------------------------------------------------

async function testGitHub(creds: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  const token = creds.accessToken as string;
  if (!token) return { ok: false, message: 'accessToken is required' };
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Builderforce/1.0', Accept: 'application/vnd.github+json' },
    });
    return res.ok
      ? { ok: true, message: 'Connected' }
      : { ok: false, message: githubStatusMessage(res.status, 'token') };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Network error contacting GitHub' };
  }
}

async function testJira(
  creds: Record<string, unknown>,
  baseUrl: string | null,
): Promise<{ ok: boolean; message: string }> {
  const token = creds.apiToken as string;
  const email = creds.email as string;
  if (!token || !email || !baseUrl) return { ok: false, message: 'email, apiToken, and baseUrl are required' };
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/myself`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${btoa(`${email}:${token}`)}`, Accept: 'application/json' },
  });
  return res.ok
    ? { ok: true, message: 'Connected' }
    : { ok: false, message: `Jira API returned ${res.status}` };
}

async function testBitbucket(creds: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  const token = creds.accessToken as string;
  if (!token) return { ok: false, message: 'accessToken is required' };
  const res = await fetch('https://api.bitbucket.org/2.0/user', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok
    ? { ok: true, message: 'Connected' }
    : { ok: false, message: `Bitbucket API returned ${res.status}` };
}

async function testGitLab(
  creds: Record<string, unknown>,
  baseUrl: string | null,
): Promise<{ ok: boolean; message: string }> {
  const token = creds.accessToken as string;
  if (!token) return { ok: false, message: 'accessToken is required' };
  // Self-hosted GitLab supported via baseUrl; default to gitlab.com.
  const root = (baseUrl?.replace(/\/$/, '') || 'https://gitlab.com');
  const res = await fetch(`${root}/api/v4/user`, {
    headers: { Authorization: `Bearer ${token}`, 'PRIVATE-TOKEN': token },
  });
  return res.ok
    ? { ok: true, message: 'Connected' }
    : { ok: false, message: `GitLab API returned ${res.status}` };
}

async function testConfluence(
  creds: Record<string, unknown>,
  baseUrl: string | null,
): Promise<{ ok: boolean; message: string }> {
  const token = creds.apiToken as string;
  const email = creds.email as string;
  if (!token || !email || !baseUrl) return { ok: false, message: 'email, apiToken, and baseUrl are required' };
  // Confluence Cloud REST API — list spaces (limit 1 is a lightweight auth probe)
  const url = `${baseUrl.replace(/\/$/, '')}/wiki/rest/api/space?limit=1`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${btoa(`${email}:${token}`)}`,
      Accept: 'application/json',
    },
  });
  return res.ok
    ? { ok: true, message: 'Connected' }
    : { ok: false, message: `Confluence API returned ${res.status}` };
}

async function testFreshservice(
  creds: Record<string, unknown>,
  baseUrl: string | null,
): Promise<{ ok: boolean; message: string }> {
  const apiKey = creds.apiKey as string;
  if (!apiKey || !baseUrl) return { ok: false, message: 'apiKey and baseUrl are required' };
  // Freshservice REST API — fetch the authenticated agent profile
  const url = `${baseUrl.replace(/\/$/, '')}/api/v2/agents/me`;
  const res = await fetch(url, {
    headers: {
      // Freshservice uses HTTP Basic with apiKey as username and "X" as password
      Authorization: `Basic ${btoa(`${apiKey}:X`)}`,
      Accept: 'application/json',
    },
  });
  return res.ok
    ? { ok: true, message: 'Connected' }
    : { ok: false, message: `Freshservice API returned ${res.status}` };
}

async function testFreshdesk(
  creds: Record<string, unknown>,
  baseUrl: string | null,
): Promise<{ ok: boolean; message: string }> {
  const apiKey = creds.apiKey as string;
  if (!apiKey || !baseUrl) return { ok: false, message: 'apiKey and baseUrl are required' };
  // Freshdesk REST API — a lightweight agent-list probe; Basic auth with apiKey:X.
  const url = `${baseUrl.replace(/\/$/, '')}/api/v2/agents?per_page=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${btoa(`${apiKey}:X`)}`, Accept: 'application/json' },
  });
  return res.ok
    ? { ok: true, message: 'Connected' }
    : { ok: false, message: `Freshdesk API returned ${res.status}` };
}

async function testLinear(creds: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  const apiKey = creds.apiKey as string;
  if (!apiKey) return { ok: false, message: 'apiKey is required' };
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ viewer { id } }' }),
  });
  if (!res.ok) return { ok: false, message: `Linear API returned ${res.status}` };
  const json = (await res.json()) as { errors?: unknown[] };
  return json.errors?.length ? { ok: false, message: 'Linear rejected the API key' } : { ok: true, message: 'Connected' };
}

async function testSentry(
  creds: Record<string, unknown>,
  baseUrl: string | null,
): Promise<{ ok: boolean; message: string }> {
  const token = creds.token as string;
  if (!token) return { ok: false, message: 'token is required' };
  const root = (baseUrl?.replace(/\/$/, '') || 'https://sentry.io');
  const res = await fetch(`${root}/api/0/organizations/`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return res.ok
    ? { ok: true, message: 'Connected' }
    : { ok: false, message: `Sentry API returned ${res.status}` };
}

async function testPagerDuty(creds: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  const apiToken = creds.apiToken as string;
  if (!apiToken) return { ok: false, message: 'apiToken is required' };
  const res = await fetch('https://api.pagerduty.com/users?limit=1', {
    headers: { Authorization: `Token token=${apiToken}`, Accept: 'application/vnd.pagerduty+json;version=2' },
  });
  return res.ok
    ? { ok: true, message: 'Connected' }
    : { ok: false, message: `PagerDuty API returned ${res.status}` };
}

async function testServiceNow(
  creds: Record<string, unknown>,
  baseUrl: string | null,
): Promise<{ ok: boolean; message: string }> {
  const username = creds.username as string;
  const password = creds.password as string;
  if (!username || !password || !baseUrl) return { ok: false, message: 'username, password, and baseUrl are required' };
  const url = `${baseUrl.replace(/\/$/, '')}/api/now/table/sys_user?sysparm_limit=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${btoa(`${username}:${password}`)}`, Accept: 'application/json' },
  });
  return res.ok
    ? { ok: true, message: 'Connected' }
    : { ok: false, message: `ServiceNow API returned ${res.status}` };
}

async function testMonday(creds: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  const token = creds.token as string;
  if (!token) return { ok: false, message: 'token is required' };
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json', 'API-Version': '2024-01' },
    body: JSON.stringify({ query: '{ me { id } }' }),
  });
  if (!res.ok) return { ok: false, message: `monday API returned ${res.status}` };
  const json = (await res.json()) as { errors?: unknown[] };
  return json.errors?.length ? { ok: false, message: 'monday rejected the token' } : { ok: true, message: 'Connected' };
}

async function testAsana(creds: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  const token = creds.accessToken as string;
  if (!token) return { ok: false, message: 'accessToken is required' };
  const res = await fetch('https://app.asana.com/api/1.0/users/me', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return res.ok
    ? { ok: true, message: 'Connected' }
    : { ok: false, message: `Asana API returned ${res.status}` };
}

async function testClickUp(creds: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  const token = creds.token as string;
  if (!token) return { ok: false, message: 'token is required' };
  const res = await fetch('https://api.clickup.com/api/v2/user', {
    headers: { Authorization: token, Accept: 'application/json' },
  });
  return res.ok
    ? { ok: true, message: 'Connected' }
    : { ok: false, message: `ClickUp API returned ${res.status}` };
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
    const body = await c.req.json<{
      provider: string;
      name: string;
      baseUrl?: string;
      projectId?: number | null;
      credentials: Record<string, unknown>;
    }>();

    if (!body.provider || !body.name || !body.credentials) {
      return c.json({ error: 'provider, name, and credentials are required' }, 400);
    }

    if (!CREDENTIAL_PROVIDERS.includes(body.provider as CredentialProvider)) {
      return c.json({ error: `provider must be one of: ${CREDENTIAL_PROVIDERS.join(', ')}` }, 400);
    }

    // Optional project scope — NULL means workspace-global. When set, the
    // project must belong to this tenant (prevents cross-tenant scoping).
    let projectId: number | null = null;
    if (body.projectId != null) {
      const [proj] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, body.projectId), eq(projects.tenantId, tenantId)));
      if (!proj) return c.json({ error: 'projectId not found in this workspace' }, 400);
      projectId = proj.id;
    }

    const { enc, iv } = await encryptCredentials(body.credentials, encryptionSecret, tenantId);

    const [row] = await db
      .insert(integrationCredentials)
      .values({
        tenantId,
        projectId,
        provider:       body.provider as CredentialProvider,
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
      .orderBy(desc(integrationCredentials.createdAt));

    return c.json({ integrations: rows });
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

    const body = await c.req.json<{
      name?: string;
      baseUrl?: string | null;
      credentials?: Record<string, unknown>;
      isEnabled?: boolean;
    }>();

    let credentialsEnc = existing.credentialsEnc;
    let iv = existing.iv;
    const rotated = !!body.credentials;
    if (body.credentials) {
      const encrypted = await encryptCredentials(body.credentials, encryptionSecret, tenantId);
      credentialsEnc = encrypted.enc;
      iv = encrypted.iv;
    }

    const [updated] = await db
      .update(integrationCredentials)
      .set({
        name:           body.name?.trim() ?? existing.name,
        baseUrl:        'baseUrl' in body ? (body.baseUrl ?? null) : existing.baseUrl,
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
    if (!creds) return c.json({ error: 'Failed to decrypt credentials' }, 500);

    let result: { ok: boolean; message: string };
    switch (row.provider) {
      case 'github':
        result = await testGitHub(creds);
        break;
      case 'gitlab':
        result = await testGitLab(creds, row.baseUrl);
        break;
      case 'jira':
        result = await testJira(creds, row.baseUrl);
        break;
      case 'bitbucket':
        result = await testBitbucket(creds);
        break;
      case 'confluence':
        result = await testConfluence(creds, row.baseUrl);
        break;
      case 'freshservice':
        result = await testFreshservice(creds, row.baseUrl);
        break;
      case 'freshdesk':
        result = await testFreshdesk(creds, row.baseUrl);
        break;
      case 'linear':
        result = await testLinear(creds);
        break;
      case 'sentry':
        result = await testSentry(creds, row.baseUrl);
        break;
      case 'pagerduty':
        result = await testPagerDuty(creds);
        break;
      case 'servicenow':
        result = await testServiceNow(creds, row.baseUrl);
        break;
      case 'monday':
        result = await testMonday(creds);
        break;
      case 'asana':
        result = await testAsana(creds);
        break;
      case 'clickup':
        result = await testClickUp(creds);
        break;
      default:
        result = { ok: false, message: `Connectivity test not available for provider: ${row.provider}` };
    }

    // Persist test result
    await db
      .update(integrationCredentials)
      .set({ lastTestedAt: new Date(), lastTestOk: result.ok, updatedAt: new Date() })
      .where(eq(integrationCredentials.id, id));

    return c.json(result);
  });

  // GET /api/integrations/:id/sync-logs
  router.get('/:id/sync-logs', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);

    const [cred] = await db
      .select({ id: integrationCredentials.id })
      .from(integrationCredentials)
      .where(and(eq(integrationCredentials.id, id), eq(integrationCredentials.tenantId, tenantId)));
    if (!cred) return c.json({ error: 'Integration not found' }, 404);

    const logs = await db
      .select()
      .from(integrationSyncLogs)
      .where(eq(integrationSyncLogs.credentialId, id))
      .orderBy(desc(integrationSyncLogs.startedAt))
      .limit(limit);

    return c.json({ logs });
  });

  return router;
}
