/**
 * A CONNECTION'S API KEY — sealed, read back, and revoked with the connection.
 *
 * ── WHY THIS SITS ON TOP OF `oauthTokenVault` AND NOT BESIDE IT ──────────────
 * Because a second sealing path is exactly what that module's own docstring
 * refuses: its `fields` bag was added for "non-token secrets that belong to the
 * SAME grant", precisely so a credential that is not an OAuth token does not get
 * its own copy of `encryptCredentials`. A static API key is that case in its
 * simplest form, so it is sealed as a `fields`-only credential — an empty
 * `accessToken` and the key in `fields` — which is the shape `unsealOAuthTokens`
 * already documents and already handles.
 *
 * The result is one crypto path, one `credentials` row shape, and one place a
 * change to sealing has to land.
 *
 * ── WHY `purpose: 'api_key'` AND NOT `'oauth'` ───────────────────────────────
 * `uq_credentials_purpose (tenant, connection, purpose)` means the purpose is
 * part of the key, so a connection could hold both. More importantly the purpose
 * is what tells a reader — and the expiry sweep, which looks at `expiresAt` — that
 * this secret does not refresh and will never become stale on its own. Filing a
 * static key as `oauth` would put a row that has no refresh token into the set
 * the refresh path walks.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { credentials } from '../../infrastructure/database/schema';
import { sealOAuthTokens, unsealOAuthTokens } from './oauthTokenVault';

const PURPOSE = 'api_key';
const FIELD = 'apiKey';

/** Seal a key against a connection. Upserts, so rotating is the same call. */
export async function writeConnectionApiKey(
  db: Db, env: Env,
  input: { tenantId: number; connectionId: number; apiKey: string },
): Promise<void> {
  const sealed = await sealOAuthTokens(env, input.tenantId, {
    accessToken: '', fields: { [FIELD]: input.apiKey },
  });
  await db.insert(credentials).values({
    tenantId: input.tenantId,
    connectionId: input.connectionId,
    purpose: PURPOSE,
    secretEnc: sealed.enc,
    secretIv: sealed.iv,
  }).onConflictDoUpdate({
    target: [credentials.tenantId, credentials.connectionId, credentials.purpose],
    set: {
      secretEnc: sealed.enc, secretIv: sealed.iv,
      status: 'active', rotatedAt: new Date(), updatedAt: new Date(),
    },
  });
}

/**
 * Read the key back, or null.
 *
 * Null covers three cases on purpose — no credential, a blob that will not open,
 * and a blob with no key in it. All three mean the same thing to every caller:
 * make the request unauthenticated, or refuse it. Distinguishing them here would
 * push a three-way branch into every call site to no benefit.
 */
export async function readConnectionApiKey(
  db: Db, env: Env, tenantId: number, connectionId: number,
): Promise<string | null> {
  const [row] = await db.select({ enc: credentials.secretEnc, iv: credentials.secretIv })
    .from(credentials)
    .where(and(
      eq(credentials.tenantId, tenantId),
      eq(credentials.connectionId, connectionId),
      eq(credentials.purpose, PURPOSE),
    ))
    .limit(1);
  if (!row) return null;

  const opened = await unsealOAuthTokens(env, tenantId, row.enc, row.iv);
  return opened?.fields?.[FIELD] || null;
}

/**
 * Whether a key exists, WITHOUT opening it.
 *
 * A list endpoint needs to render "authenticated ✓" for every row, and doing
 * that through {@link readConnectionApiKey} would decrypt every secret a tenant
 * owns to answer a yes/no question — a fan-out of crypto over a listing, and a
 * plaintext key in memory for no reason.
 */
export async function hasConnectionApiKey(
  db: Db, tenantId: number, connectionId: number,
): Promise<boolean> {
  const [row] = await db.select({ id: credentials.id })
    .from(credentials)
    .where(and(
      eq(credentials.tenantId, tenantId),
      eq(credentials.connectionId, connectionId),
      eq(credentials.purpose, PURPOSE),
      eq(credentials.status, 'active'),
    ))
    .limit(1);
  return !!row;
}

/** Revoke the key. Called when the connection goes — a secret that outlives the
 *  thing it authenticated is an orphan nothing rotates and nothing uses. */
export async function deleteConnectionApiKey(
  db: Db, tenantId: number, connectionId: number,
): Promise<void> {
  await db.delete(credentials).where(and(
    eq(credentials.tenantId, tenantId),
    eq(credentials.connectionId, connectionId),
    eq(credentials.purpose, PURPOSE),
  ));
}
