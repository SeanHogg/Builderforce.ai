/**
 * Server-to-server auth for the cross-domain (channel-3) seams.
 *
 * The host (e.g. BurnRateOS) calls these endpoints with a tenant API key
 * (bfk_*) — never an end-user JWT — and carries the target end-client
 * coordinates (accountId/companyId) in the request so BuilderForce resolves the
 * Segment server-side (spec 05 §2.3). This helper:
 *
 *   1. authenticates the bfk_* key via requireTenantAccess,
 *   2. rejects any non-key auth path (a JWT can't drive a service seam),
 *   3. enforces the endpoint scope (least privilege — migration 0070),
 *   4. resolves the (tenantId, segmentId) scope for the named account/company.
 *
 * It throws TenantAccessError on failure so the route can render it with the
 * existing respondToAccessError helper.
 */

import type { Context } from 'hono';
import type { HonoEnv } from '../../env';
import { requireTenantAccess, TenantAccessError } from '../routes/llmRoutes';
import { keyHasScope, type TenantApiScope } from '../../application/llm/tenantApiKeyService';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import { buildDatabase } from '../../infrastructure/database/connection';
import { resolveSegmentFromHostToken } from '../../application/auth/hostOidc';

export interface ServiceContext {
  tenantId: number;
  segmentId: string;
  /** UUID of the bfk_* key that authenticated, or null when an inbound host OIDC
   *  token (verified by hostOidc.ts) drove the resolution instead. */
  tenantApiKeyId: string | null;
}

export interface SegmentCoordinates {
  accountId?: string;
  companyId?: string;
}

/**
 * Authenticate a service-to-server seam request and resolve its Segment scope.
 * `coords` come from the request body (the host names which end-client this is
 * for). Throws TenantAccessError (4xx) on auth/scope failure.
 *
 * The caller presents EITHER a scoped bfk_* key (the S2S service token) OR an
 * inbound host OIDC token (spec 05 §2.1). The OIDC path exists so a host that
 * has not yet minted a bfk_* key can still drive the seams with a short-lived,
 * host-signed JWT whose VERIFIED account/company claims resolve the Segment
 * through the same resolveSegment chokepoint.
 */
export async function authenticateServiceToken(
  c: Context<HonoEnv>,
  requiredScope: TenantApiScope,
  coords: SegmentCoordinates,
): Promise<ServiceContext> {
  // Inbound host OIDC path: `X-IdP-Token: <host JWT>`. The token is verified
  // against the tenant's configured idpIssuer (signature + issuer + expiry) and
  // its claims feed resolveSegment. Only consult this header when the caller did
  // not present a bfk_* key, so the two doors never compete.
  const hostToken = c.req.header('X-IdP-Token');
  const authHeader = c.req.header('Authorization') ?? '';

  if (hostToken && !authHeader.startsWith('Bearer bfk_')) {
    const db = buildDatabase(c.env);
    // The tenant a host token can speak for is carried in the same
    // `x-builderforce-workspace` header the bfk_* path honours; absent that it
    // is the default (tenant 1) host trust is configured against. The claims
    // caller requires the tenant to have an idpIssuer configured and rejects
    // direct tenants, so an unconfigured tenant fails closed.
    const tenantIdHeader = c.req.header('x-builderforce-workspace');
    const tenantId = tenantIdHeader ? Number(tenantIdHeader) : 1;
    if (!Number.isFinite(tenantId)) {
      throw new TenantAccessError(400, 'invalid_workspace', 'x-builderforce-workspace must be a tenant id.');
    }

    const resolved = await resolveSegmentFromHostToken(c.env, db, tenantId, hostToken);
    if (!resolved.ok) {
      throw new TenantAccessError(401, 'invalid_idp_token', resolved.error);
    }
    // The verified claims name the coordinates; the request body's coords are
    // IGNORED on this path so a caller cannot widen a verified claim set.
    return { tenantId, segmentId: resolved.segmentId, tenantApiKeyId: null };
  }

  const access = await requireTenantAccess(c);

  if (!access.tenantApiKeyId) {
    throw new TenantAccessError(
      401,
      'service_token_required',
      'This endpoint requires a tenant API key (bfk_*) sent server-to-server, not a user token.',
    );
  }

  if (!keyHasScope(access.tenantApiKeyScopes, requiredScope)) {
    throw new TenantAccessError(
      403,
      'insufficient_scope',
      `This tenant API key is not authorized for the '${requiredScope}' scope.`,
    );
  }

  const db = buildDatabase(c.env);
  const segmentId = await resolveSegment(db, access.tenantId, {
    accountId: coords.accountId,
    companyId: coords.companyId,
  }, c.env);

  return { tenantId: access.tenantId, segmentId, tenantApiKeyId: access.tenantApiKeyId };
}
