/**
 * The scope every Insights read and write shares (PRD 33 §3, D17).
 *
 * A recording, a rollup cell, an issue and a live visitor all belong to ONE site
 * inside ONE workspace, and that pair is the whole scope — there is no platform
 * scope, no `tenantId: null` site and no superadmin path. Builderforce's own site
 * is a site of the Builderforce workspace like any other.
 *
 * Every read takes a `ReplayScope` as a parameter; a read never infers scope from a
 * row it fetched. Services spread `scope.tenantId` AND `scope.siteId` into each
 * statement, so `check-tenant-scope` sees the tenant predicate in the statement
 * itself rather than behind a helper.
 */

export interface ReplayScope {
  readonly tenantId: number;
  readonly siteId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every Insights row id (site, recording, issue) is a uuid. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** A replay site id is a uuid (`replay_sites.id`). */
export function isReplaySiteId(value: unknown): value is string {
  return isUuid(value);
}

/** Whether `value` is a complete scope: a positive integer tenant and a uuid site. */
export function isReplayScope(value: unknown): value is ReplayScope {
  if (!value || typeof value !== 'object') return false;
  const { tenantId, siteId } = value as { tenantId?: unknown; siteId?: unknown };
  return typeof tenantId === 'number' && Number.isInteger(tenantId) && tenantId > 0 && isReplaySiteId(siteId);
}
