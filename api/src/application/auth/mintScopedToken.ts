import type { DbHandle } from '../shared/dbHandle';
import { assertLiveEditorKey } from '../llm/editorKeyGate';
import { mintTenantSessionToken } from '../../infrastructure/auth/tenantSessionToken';
import { SCOPED_TOKEN_TTL_SECONDS, type ScopedTokenAudience } from './scopedTokenAudiences';

export interface MintScopedTokenInput {
  claims: {
    userId: string;
    tenantId: number;
    role: Parameters<typeof mintTenantSessionToken>[2]['role'];
    clientSurface: Parameters<typeof mintTenantSessionToken>[2]['clientSurface'];
    userAgent: string | null;
    ipAddress: string | null;
  };
  audience: ScopedTokenAudience;
  /** The parent login session, so revoking it revokes this token too. */
  sessionId?: string | null;
  /** The editor-key id of the caller's token, when it has one; must still be a live key. */
  apiKeyId?: string | null;
}

export type MintScopedTokenResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; status: 401 | 403; code: string; error: string };

/**
 * Mints a 15-minute audience-bound copy of the caller's tenant session token through the
 * ONE tenant-token minter. A caller whose token carries an editor-key id must still hold a
 * live key (the ONE gate, `assertLiveEditorKey`, shared with the workspace switch).
 */
export async function mintScopedToken(
  db: DbHandle,
  env: { JWT_SECRET: string },
  { claims, audience, sessionId, apiKeyId }: MintScopedTokenInput,
): Promise<MintScopedTokenResult> {
  const gate = await assertLiveEditorKey(db, { keyId: apiKeyId, userId: claims.userId, missingKey: 'allow' });
  if (!gate.ok) return { ok: false, status: gate.status, code: gate.code, error: gate.message };
  const { token, expiresIn } = await mintTenantSessionToken(db, env.JWT_SECRET, {
    userId: claims.userId,
    ...(sessionId ? { sessionId } : {}),
    tenantId: claims.tenantId,
    role: claims.role,
    audience,
    expiresIn: SCOPED_TOKEN_TTL_SECONDS,
    clientSurface: claims.clientSurface,
    ...(apiKeyId ? { keyId: apiKeyId } : {}),
    userAgent: claims.userAgent,
    ipAddress: claims.ipAddress,
  });
  return { ok: true, token, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}
