/**
 * THE `/api/v1` credential check — one key mechanism, one answer.
 *
 * ── WHY IT IS HERE AND NOT IN THE ROUTE FILE ─────────────────────────────────────
 * It was a private function inside `publicApiRoutes.ts`, which was correct while
 * that file was the only thing on `/api/v1`. The public canvas API, the webhook
 * subscription surface and the widget registry are three more routers on the same
 * mount, and there is exactly one acceptable way to add a second caller to an
 * authorization check: extract it, and have the original read the extraction too.
 * A second copy of "is this key allowed in" is not duplication that gets tidied up
 * later — it is the copy that keeps granting access after the original learns to
 * refuse.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────────
 * It does not hash, look up, or decide about revocation or scope. That is
 * `tenantApiKeyService.resolveTenantApiKey`, the ONE resolver every tenant key goes
 * through since migration 0472 folded `developer_api_keys` away. This module is the
 * header parsing (genuinely the caller's job), the origin check, and the shape the
 * routers switch on.
 */

import type { Db } from '../../infrastructure/database/connection';
import {
  originAllowed,
  resolveTenantApiKey,
  type TenantApiScope,
} from '../llm/tenantApiKeyService';

export interface PublicApiCaller {
  keyId: string;
  tenantId: number;
}

export type PublicApiAuth =
  | { ok: false; error: string; status: 401 | 403 }
  | ({ ok: true } & PublicApiCaller);

/**
 * Resolve the key on the request, check it carries `required`, and check the
 * browser origin if there is one.
 *
 * The ORIGIN check is why migration 0472 grandfathered every copied publisher key
 * onto the any-origin allowlist: these endpoints exist to be called from an
 * external site's page, and inheriting the tenant default of server-only would
 * have revoked exactly that usage on deploy day.
 */
export async function requirePublicApiKey(
  db: Db,
  authHeader: string | undefined,
  origin: string | null,
  required: TenantApiScope,
): Promise<PublicApiAuth> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, error: 'Missing or malformed Authorization header', status: 401 };
  }
  const resolved = await resolveTenantApiKey(db, authHeader.slice(7), required);
  // One message for unknown, revoked AND under-scoped, deliberately: a caller must
  // not be able to tell which of the three it was, or an invalid key becomes a
  // probe for which scopes a valid one carries.
  if (!resolved) return { ok: false, error: 'Invalid or revoked API key', status: 401 };
  if (!originAllowed(resolved.allowedOrigins, origin)) {
    return { ok: false, error: 'This key is not allowed from this origin', status: 403 };
  }
  return { ok: true, keyId: resolved.keyId, tenantId: resolved.tenantId };
}
