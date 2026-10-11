/**
 * The query scope every replay read and write shares.
 *
 * A visit, a cell, a mark and a recording all belong to one site inside one
 * tenant. Encoding that as `{ tenantId, siteId }` here — rather than as a
 * WHERE clause each service invents — is what stops a later Insights query
 * from forgetting the tenant predicate. `scopeWhere` is the drizzle-shaped
 * predicate those queries spread; it is not a second identifier.
 */

export interface ReplayScope {
  tenantId: number;
  siteId: string;
}

/**
 * The equality predicate for `ReplayScope`.
 *
 * `tenantId` is `null` when the caller passed a non-positive id (the platform
 * site records signed-out traffic without a workspace). `siteId` is omitted
 * when empty so a tenant-wide listing can reuse the same helper.
 */
export function scopeWhere(scope: ReplayScope): { tenantId: number | null; siteId?: string } {
  const where: { tenantId: number | null; siteId?: string } = {
    tenantId: scope.tenantId > 0 ? scope.tenantId : null,
  };
  if (scope.siteId) where.siteId = scope.siteId;
  return where;
}
