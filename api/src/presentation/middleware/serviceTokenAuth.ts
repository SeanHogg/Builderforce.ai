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

export interface ServiceContext {
  tenantId: number;
  segmentId: string;
  /** UUID of the bfk_* key that authenticated. */
  tenantApiKeyId: string;
}

export interface SegmentCoordinates {
  accountId?: string;
  companyId?: string;
}

/**
 * Authenticate a service-to-server seam request and resolve its Segment scope.
 * `coords` come from the request body (the host names which end-client this is
 * for). Throws TenantAccessError (4xx) on auth/scope failure.
 */
export async function authenticateServiceToken(
  c: Context<HonoEnv>,
  requiredScope: TenantApiScope,
  coords: SegmentCoordinates,
): Promise<ServiceContext> {
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
  });

  return { tenantId: access.tenantId, segmentId, tenantApiKeyId: access.tenantApiKeyId };
}
