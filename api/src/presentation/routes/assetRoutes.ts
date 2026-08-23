import { Hono, type Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import { isKeyOwnedByTenant } from '../../domain/shared/r2Keys';
import { signUpload } from '../../infrastructure/auth/uploadSign';
import {
  readAssetByKey,
  readTenantAsset,
  storeTenantAsset,
  type AssetRejection,
} from '../../application/assets/tenantAssetStore';
import { wildcardPath } from './wildcardPath';

/**
 * ASSETS — /api/assets. The ONE place a file becomes a URL.
 *
 * The upload existed already, under `/api/brain/upload`, and that name is why
 * every media block in the product is URL-only: a canvas image, a knowledge
 * document's figure and an attached file all needed a place to put bytes, and the
 * only one that existed belonged to the chat. This is the same pipeline under the
 * name the rest of the product can use; the Brain's URLs stay as delegations
 * because the VS Code extension and brain-embedded already call them.
 *
 * The POLICY — ceiling, allow-list, key layout — is in
 * `application/assets/tenantAssetStore.ts`. Every router here calls it; none owns it.
 *
 * ── WHY THE READ IS PUBLIC AND THE WRITE IS NOT ──────────────────────────────
 * A file uploaded through this door is meant to be embedded — a canvas image
 * block, a knowledge document's figure — and an embedded link has to keep
 * working wherever the document is rendered: the canvas card, the print sheet,
 * the .docx writer, Brain's context. None of those hold a bearer token to attach,
 * which is the exact problem `/api/brain-files/*` already solved for a vision
 * fetch by trading a tenant check for a short-lived signature. A document asset
 * needs the opposite trade — no expiry, because the link is meant to outlive the
 * session — so `GET /api/assets/*` trades the tenant check for the key's own
 * entropy instead (see {@link readAssetByKey}). Upload stays authenticated,
 * tenant-scoped and size/type-checked; only the read is public.
 */

/** Turn a rejection from the store into the response shape a client expects. */
export function assetErrorResponse(c: Context<HonoEnv>, rejection: AssetRejection) {
  switch (rejection.error) {
    case 'unconfigured':
      return c.json({ error: 'File storage not configured' }, 503);
    case 'no-file':
      return c.json({ error: 'No file provided' }, 400);
    case 'too-large':
      return c.json({ error: `File too large (max ${rejection.maxBytes / 1024 / 1024}MB)` }, 400);
    case 'type-not-allowed':
      return c.json({ error: `File type ${rejection.type} not allowed` }, 400);
  }
}

/** POST an upload. Shared by `/api/assets` and the legacy `/api/brain/upload`. */
export async function handleAssetUpload(c: Context<HonoEnv>) {
  const formData = await c.req.formData();
  const stored = await storeTenantAsset(
    (c.env as { UPLOADS?: R2Bucket }).UPLOADS,
    formData.get('file') as File | null,
    { tenantId: c.get('tenantId') as number, userId: c.get('userId') as string },
  );
  if ('error' in stored) return assetErrorResponse(c, stored);
  return c.json(stored, 201);
}

/** GET one object back, PUBLICLY — the key is the capability. See the header. */
export async function handleAssetRead(c: Context<HonoEnv>) {
  const result = await readAssetByKey((c.env as { UPLOADS?: R2Bucket }).UPLOADS, wildcardPath(c));
  if (result === 'unconfigured') return c.json({ error: 'File storage not configured' }, 503);
  if (result === 'not-found') return c.json({ error: 'Not found' }, 404);
  return result;
}

/** GET one object back, tenant-checked. Backs the legacy authenticated
 *  `/api/brain/uploads/*` path only — see {@link readTenantAsset}. */
export async function handleTenantAssetRead(c: Context<HonoEnv>) {
  const result = await readTenantAsset(
    (c.env as { UPLOADS?: R2Bucket }).UPLOADS,
    wildcardPath(c),
    c.get('tenantId') as number,
  );
  if (result === 'unconfigured') return c.json({ error: 'File storage not configured' }, 503);
  if (result === 'not-found') return c.json({ error: 'Not found' }, 404);
  return result;
}

/** POST a signing request — a short-lived public URL for one owned object, for a
 *  consumer (an upstream LLM's vision fetch) that needs a TIME-BOXED link rather
 *  than the durable one `GET /api/assets/*` already hands out. */
export async function handleAssetSign(c: Context<HonoEnv>) {
  const tenantId = c.get('tenantId') as number;
  const { key } = await c.req.json<{ key?: string }>();
  if (!isKeyOwnedByTenant(key, tenantId)) return c.json({ error: 'Not found' }, 404);
  const secret = (c.env as Env).JWT_SECRET;
  if (!secret) return c.json({ error: 'Signing not configured' }, 503);
  return c.json(await signUpload(key, secret));
}

export function createAssetRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Upload and signing need to know WHO — auth applies to those two only.
  router.post('/', authMiddleware, handleAssetUpload);
  router.post('/sign', authMiddleware, handleAssetSign);
  // Declared AFTER `/sign` so the literal wins the match, and public (no
  // authMiddleware) — see the header for why.
  router.get('/*', handleAssetRead);

  return router;
}
