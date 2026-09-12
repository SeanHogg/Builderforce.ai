/**
 * The request's tenant, read ONE way.
 *
 * `Vars.tenantId` is typed `number` because every route behind `authMiddleware`
 * (or `hostOrTenantAuth`) is guaranteed one — that middleware refuses a token
 * without a `tid`. But not every route is behind it: `optionalAuthMiddleware`
 * swallows the rejection, `webAuthMiddleware` authenticates a person with no
 * workspace at all, and a route registered above a router's blanket gate runs
 * with none. On those, `c.get('tenantId') as number` is a lie the compiler
 * believes, and the handler goes on to query `WHERE tenant_id = undefined`.
 *
 * So there are exactly two questions a handler may ask, and they are spelled
 * here rather than re-cast at every call site:
 *
 *   - {@link optionalTenantId} — "is there a workspace?" (`null` when not). For a
 *     read whose answer is NARROWER signed out: a guest catalogue, a roster of
 *     locked seats, an entitlement flag that is simply `false`.
 *   - {@link requireTenantId} — "the workspace, or 401". For anything that only
 *     means something inside one.
 */
import { UnauthorizedError } from '../../domain/shared/errors';

/**
 * Anything that can answer `get('tenantId')` — a Hono context of ANY route env
 * (`HonoEnv` or one that extends it), so no call site has to cast its context.
 */
export interface TenantSource {
  get(key: 'tenantId'): unknown;
}

/**
 * The authenticated tenant id, or `null` when the request carries no workspace.
 *
 * Reads the variable as what it may actually be at runtime (`unknown`) rather
 * than what `Vars` promises, so a non-positive or non-integer value — which no
 * auth path publishes — is treated as absent instead of being queried with.
 */
export function optionalTenantId(c: TenantSource): number | null {
  const raw: unknown = c.get('tenantId');
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null;
}

/**
 * The authenticated tenant id; throws {@link UnauthorizedError} (401) when the
 * request has no workspace. The one spelling of "this endpoint needs a tenant".
 */
export function requireTenantId(c: TenantSource): number {
  const tenantId = optionalTenantId(c);
  if (tenantId == null) {
    throw new UnauthorizedError('This endpoint requires a workspace token; please select a workspace first');
  }
  return tenantId;
}
