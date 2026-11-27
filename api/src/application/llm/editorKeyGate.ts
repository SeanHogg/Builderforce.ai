/**
 * THE "editor key must still be live" gate — the one place that decides whether a derived
 * editor session (or a key being exchanged for one) may keep acting, and with which refusal.
 *
 * It was written four times (scoped-token mint, the auth middleware's scoped-token branch,
 * the VS Code workspace switch and the key → session exchange), each spelling the same
 * 401 'Invalid or revoked API key'. They all call here now; the predicate itself stays in
 * {@link resolveEditorKeySession} (gateway auth's key loader) and `keyMayActAsMember`.
 *
 * Application layer: returns a typed refusal, never an HTTP response, so a route / middleware
 * only maps `{ status, code, message }` onto its own envelope.
 */
import type { Db } from '../../infrastructure/database/connection';
import { resolveEditorKeySession } from './gatewayAccess';
import { deserializeScopes, keyMayActAsMember } from './tenantApiKeyService';

export type EditorKeyRefusal = {
  ok: false;
  status: 401 | 403;
  code: 'invalid_api_key' | 'session_stale' | 'editor_key_required';
  message: string;
};

export type LiveEditorKey = { ok: true; mayRescope: boolean };

export const INVALID_API_KEY_MESSAGE = 'Invalid or revoked API key';

const INVALID_API_KEY: EditorKeyRefusal = {
  ok: false, status: 401, code: 'invalid_api_key', message: INVALID_API_KEY_MESSAGE,
};

/**
 * A session derived from an editor key, checked live. `keyId` is the session's `kid` (null /
 * undefined = the token carries none).
 *
 * - `missingKey: 'allow'` — a token with no key id is not a key-derived session, so there is
 *   nothing to check (scoped-token mint, middleware branch).
 * - `missingKey: 'session_stale'` — the token predates key tracking: it cannot be checked and
 *   must not renew itself, so refuse with 403 `session_stale` (the editor re-exchanges its key).
 * - `requireRescope` — the caller is about to act in ANOTHER workspace, so the key must also
 *   pass the gateway's editor-key bar: 403 `editor_key_required`.
 *
 * A revoked, unknown or foreign key (not minted by `userId`) is a 401 `invalid_api_key`.
 */
export async function assertLiveEditorKey(
  db: Db,
  input: {
    keyId: string | null | undefined;
    userId: string;
    missingKey: 'allow' | 'session_stale';
    requireRescope?: boolean;
  },
): Promise<LiveEditorKey | EditorKeyRefusal> {
  if (!input.keyId) {
    if (input.missingKey === 'allow') return { ok: true, mayRescope: false };
    return {
      ok: false,
      status: 403,
      code: 'session_stale',
      message: 'Session predates key tracking; exchange the key again.',
    };
  }
  const key = await resolveEditorKeySession(db, input.keyId, input.userId);
  if (!key.valid) return INVALID_API_KEY;
  if (input.requireRescope && !key.mayRescope) {
    return {
      ok: false,
      status: 403,
      code: 'editor_key_required',
      message: 'Only an unrestricted, server-only editor key issued by device sign-in can act in another workspace.',
    };
  }
  return { ok: true, mayRescope: key.mayRescope };
}

/**
 * The same gate for a key PRESENTED for exchange (`/api/auth/tenant-api-key-token`), where the
 * caller already holds the key's row (looked up by secret hash): a missing or revoked row, or a
 * scoped key (a public `bfr_` site key above all, which is a least-privilege service token and
 * never becomes a member session), gets the one answer an unknown key gets.
 */
export function assertExchangeableKeyRow<T extends { revokedAt: Date | null; scopes: string | null }>(
  row: T | undefined,
): { ok: true; row: T } | EditorKeyRefusal {
  if (!row || row.revokedAt) return INVALID_API_KEY;
  if (!keyMayActAsMember(deserializeScopes(row.scopes))) return INVALID_API_KEY;
  return { ok: true, row };
}
