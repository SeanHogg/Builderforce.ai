/**
 * Integration routes – /api/integrations
 *
 * Manages third-party integration credentials (GitHub, Jira, Bitbucket,
 * Confluence, Freshservice).  Credentials are encrypted at rest using
 * AES-256-GCM with a tenant-derived key.
 *
 * POST   /api/integrations           Create credential     (MANAGER+)
 * GET    /api/integrations           List credentials      (MANAGER+)
 * GET    /api/integrations/:id       Get credential detail (MANAGER+)
 * PATCH  /api/integrations/:id       Update credential     (MANAGER+)
 * DELETE /api/integrations/:id       Delete credential     (MANAGER+)
 * POST   /api/integrations/:id/test  Test connectivity     (MANAGER+)
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { integrationCredentials, integrationSyncLogs } from '../../infrastructure/database/schema';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

// ---------------------------------------------------------------------------
// AES-256-GCM encryption helpers (Web Crypto — works in Cloudflare Workers)
// ---------------------------------------------------------------------------

/** Derive an AES-256 key from a passphrase using PBKDF2. */
async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('builderforce-integrations'), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptCredentials(
  data: Record<string, unknown>,
  secret: string,
): Promise<{ enc: string; iv: string }> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return {
    enc: btoa(String.fromCharCode(...new Uint8Array(enc))),
    iv:  Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

async function decryptCredentials(
  encB64: string,
  ivHex: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  try {
    const key = await deriveKey(secret);
    const iv  = new Uint8Array(ivHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      Uint8Array.from(atob(encB64), (c) => c.charCodeAt(0)),
    );
    return JSON.parse(new TextDecoder().decode(dec));
  } catch {
    return null;
  }
}

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
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Builderforce/1.0', Accept: 'application/vnd.github+json' },
  });
  return res.ok
    ? { ok: true, message: 'Connected' }
    : { ok: false, message: `GitHub API returned ${res.status}` };
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

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createIntegrationRoutes(db: Db, encryptionSecret: string): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // POST /api/integrations
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      provider: string;
      name: string;
      baseUrl?: string;
      credentials: Record<string, unknown>;
    }>();

    if (!body.provider || !body.name || !body.credentials) {
      return c.json({ error: 'provider, name, and credentials are required' }, 400);
    }

    const validProviders = ['github', 'bitbucket', 'jira', 'confluence', 'freshservice'];
    if (!validProviders.includes(body.provider)) {
      return c.json({ error: `provider must be one of: ${validProviders.join(', ')}` }, 400);
    }

    const { enc, iv } = await encryptCredentials(body.credentials, encryptionSecret);

    const [row] = await db
      .insert(integrationCredentials)
      .values({
        tenantId,
        provider:       body.provider as 'github' | 'bitbucket' | 'jira' | 'confluence' | 'freshservice',
        name:           body.name.trim(),
        baseUrl:        body.baseUrl ?? null,
        credentialsEnc: enc,
        iv,
        isEnabled:      true,
      })
      .returning({
        id: integrationCredentials.id,
        provider: integrationCredentials.provider,
        name: integrationCredentials.name,
        baseUrl: integrationCredentials.baseUrl,
        isEnabled: integrationCredentials.isEnabled,
        createdAt: integrationCredentials.createdAt,
      });

    return c.json(row, 201);
  });

  // GET /api/integrations
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db
      .select({
        id:           integrationCredentials.id,
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
      .where(eq(integrationCredentials.tenantId, tenantId))
      .orderBy(desc(integrationCredentials.createdAt));

    return c.json({ integrations: rows });
  });

  // GET /api/integrations/:id
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(integrationCredentials)
      .where(and(eq(integrationCredentials.id, id), eq(integrationCredentials.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Integration not found' }, 404);

    // Decrypt and mask for display
    const creds = await decryptCredentials(row.credentialsEnc, row.iv, encryptionSecret);
    const maskedCreds: Record<string, string> = {};
    if (creds) {
      for (const [k, v] of Object.entries(creds)) {
        maskedCreds[k] = maskToken(String(v));
      }
    }

    return c.json({ ...row, credentialsEnc: undefined, iv: undefined, credentials: maskedCreds });
  });

  // PATCH /api/integrations/:id
  router.patch('/:id', async (c) => {
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
    if (body.credentials) {
      const encrypted = await encryptCredentials(body.credentials, encryptionSecret);
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
        updatedAt:      new Date(),
      })
      .where(and(eq(integrationCredentials.id, id), eq(integrationCredentials.tenantId, tenantId)))
      .returning({
        id: integrationCredentials.id,
        provider: integrationCredentials.provider,
        name: integrationCredentials.name,
        baseUrl: integrationCredentials.baseUrl,
        isEnabled: integrationCredentials.isEnabled,
        updatedAt: integrationCredentials.updatedAt,
      });

    return c.json(updated);
  });

  // DELETE /api/integrations/:id
  router.delete('/:id', async (c) => {
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
  router.post('/:id/test', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const [row] = await db
      .select()
      .from(integrationCredentials)
      .where(and(eq(integrationCredentials.id, id), eq(integrationCredentials.tenantId, tenantId)));
    if (!row) return c.json({ error: 'Integration not found' }, 404);

    const creds = await decryptCredentials(row.credentialsEnc, row.iv, encryptionSecret);
    if (!creds) return c.json({ error: 'Failed to decrypt credentials' }, 500);

    let result: { ok: boolean; message: string };
    switch (row.provider) {
      case 'github':
        result = await testGitHub(creds);
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
