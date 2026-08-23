/**
 * The stored AUTH of one registered MCP server — sealing it, opening it, and
 * answering the only question the tool path ever asks: what `Authorization`
 * header do I send right now?
 *
 * Three credentials can back one server and they are tried in that order:
 *   1. a completed OAuth GRANT (`token_enc`) — refreshed in place when stale;
 *   2. the static bearer SECRET (`secret_enc`) a tenant pasted;
 *   3. nothing, for a genuinely open server.
 *
 * Everything sealed here uses the SAME primitives as every other third-party
 * grant on the platform — {@link ../../integrations/oauthTokenVault} for the
 * tokens, `credentialCrypto` for the client registration — so an MCP grant is
 * stored exactly like a mailbox or drive grant rather than inventing a fourth
 * scheme. That also means a refresh token is never at rest in plaintext, which is
 * the specific thing the "credential vault" half of the roadmap entry asked for.
 *
 * Kept apart from `mcpExtensionService` (registration CRUD) and `mcpOAuth` (the
 * protocol) so each has one reason to change: this module owns PERSISTENCE of
 * auth state and nothing else.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import { tenantMcpExtensions } from '../../../infrastructure/database/schema';
import { decryptSecretFromStorage } from '../../../infrastructure/auth/MfaService';
import { credentialSecret, decryptCredentials, encryptCredentials } from '../../integrations/credentialCrypto';
import {
  isTerminalRefreshFailure,
  mergeRefreshedTokens,
  oauthTokensStale,
  sealOAuthTokens,
  unsealOAuthTokens,
  type SealedOAuthTokens,
} from '../../integrations/oauthTokenVault';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { refreshMcpToken, type McpOAuthPendingConsent, type McpOAuthRegistration } from './mcpOAuth';

type ExtensionRow = typeof tenantMcpExtensions.$inferSelect;

/** How a server's requests are currently being authenticated. */
export type McpAuthKind = 'none' | 'secret' | 'oauth';

export function authKindOf(row: Pick<ExtensionRow, 'secretEnc' | 'tokenEnc'>): McpAuthKind {
  if (row.tokenEnc) return 'oauth';
  if (row.secretEnc) return 'secret';
  return 'none';
}

// ── The client registration blob (endpoints + client + in-flight verifier) ──

export async function sealRegistration(
  env: Env,
  tenantId: number,
  registration: McpOAuthRegistration | McpOAuthPendingConsent,
): Promise<{ enc: string; iv: string }> {
  return encryptCredentials(registration as unknown as Record<string, unknown>, credentialSecret(env), tenantId);
}

/**
 * Open the stored registration. Returns null when there is none or it cannot be
 * decrypted — a registration we cannot read is treated as "never registered",
 * which makes the next connect re-discover rather than fail forever.
 */
export async function openRegistration(
  env: Env,
  tenantId: number,
  row: Pick<ExtensionRow, 'oauthEnc' | 'oauthIv'>,
): Promise<McpOAuthPendingConsent | null> {
  if (!row.oauthEnc || !row.oauthIv) return null;
  const blob = await decryptCredentials(row.oauthEnc, row.oauthIv, credentialSecret(env), tenantId);
  if (!blob || typeof blob.tokenEndpoint !== 'string' || typeof blob.clientId !== 'string') return null;
  return {
    resource: String(blob.resource ?? ''),
    authorizationEndpoint: String(blob.authorizationEndpoint ?? ''),
    tokenEndpoint: blob.tokenEndpoint,
    ...(typeof blob.registrationEndpoint === 'string' ? { registrationEndpoint: blob.registrationEndpoint } : {}),
    scopes: Array.isArray(blob.scopes) ? (blob.scopes as unknown[]).map(String) : [],
    clientId: blob.clientId,
    ...(typeof blob.clientSecret === 'string' ? { clientSecret: blob.clientSecret } : {}),
    codeVerifier: typeof blob.codeVerifier === 'string' ? blob.codeVerifier : '',
  };
}

// ── The grant ──────────────────────────────────────────────────────────────

/** Persist a freshly-completed grant and stamp when the human consented. */
export async function storeGrant(
  db: Db,
  env: Env,
  args: { tenantId: number; extensionId: string; tokens: SealedOAuthTokens },
): Promise<void> {
  const sealed = await sealOAuthTokens(env, args.tenantId, args.tokens);
  await db
    .update(tenantMcpExtensions)
    .set({ tokenEnc: sealed.enc, tokenIv: sealed.iv, oauthConnectedAt: new Date() })
    .where(and(eq(tenantMcpExtensions.id, args.extensionId), eq(tenantMcpExtensions.tenantId, args.tenantId)));
}

/** Drop a grant (disconnect). The registration is kept, so reconnecting does not
 *  re-register a second client with the authorization server. */
export async function clearGrant(
  db: Db,
  args: { tenantId: number; extensionId: string },
): Promise<void> {
  await db
    .update(tenantMcpExtensions)
    .set({ tokenEnc: null, tokenIv: null, oauthConnectedAt: null })
    .where(and(eq(tenantMcpExtensions.id, args.extensionId), eq(tenantMcpExtensions.tenantId, args.tenantId)));
}

/**
 * The `Authorization` header value to send to this server right now, or null.
 *
 * A stale access token is refreshed and RE-SEALED before it is handed out, so the
 * caller never sees token lifecycle. A refresh the authorization server refuses
 * outright (400/401 — consent withdrawn) clears the grant, because leaving a dead
 * token in place turns one revocation into an unexplained failure on every later
 * call; a transient failure keeps the grant and lets the call fail loudly.
 */
export async function resolveAuthorization(
  db: Db,
  /** Absent only where there is no Worker env to seal with (unit tests): the
   *  static-secret path still works, the sealed grant is simply unreadable. */
  env: Env | undefined,
  row: ExtensionRow,
  keyMaterial: string,
): Promise<string | null> {
  if (env && row.tokenEnc && row.tokenIv) {
    const tokens = await unsealOAuthTokens(env, row.tenantId, row.tokenEnc, row.tokenIv);
    if (tokens) {
      if (!oauthTokensStale(tokens) || !tokens.refreshToken) return `Bearer ${tokens.accessToken}`;
      const registration = await openRegistration(env, row.tenantId, row);
      if (!registration) return `Bearer ${tokens.accessToken}`;
      try {
        const refreshed = await refreshMcpToken(registration, tokens.refreshToken);
        const merged = mergeRefreshedTokens(tokens, refreshed);
        await storeGrant(db, env, { tenantId: row.tenantId, extensionId: row.id, tokens: merged });
        return `Bearer ${merged.accessToken}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isTerminalRefreshFailure(message)) {
          await clearGrant(db, { tenantId: row.tenantId, extensionId: row.id });
        } else {
          reportCaughtError(error, {
            source: 'application/llm/mcp/mcpExtensionAuth.ts',
            operation: 'resolveAuthorization.refresh',
          });
        }
        return null;
      }
    }
  }
  if (row.secretEnc) return `Bearer ${await decryptSecretFromStorage(row.secretEnc, keyMaterial)}`;
  return null;
}
