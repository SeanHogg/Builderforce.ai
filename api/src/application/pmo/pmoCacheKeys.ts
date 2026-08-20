/**
 * The PMO cache-version tokens — one definition, used by every writer and reader.
 *
 * This string existed in THREE places (pmoRoutes, convertWorkItemType's "inlined to
 * avoid an import cycle" copy, and by import in builtinMcpService — which reached from
 * application INTO presentation to get it). A token whose spelling is duplicated is a
 * cache-invalidation bug waiting to happen: change one copy and the other's readers keep
 * serving the pre-write generation forever.
 *
 * It lives in `application/pmo` because that is the layer both the routes and the
 * services may depend on — the cycle the inlined copy was avoiding does not exist here.
 */

/**
 * One version token per tenant: every PMO write (objective, key result, initiative,
 * link, or a cross-cutting write like a time entry that changes spine human cost) bumps
 * it, orphaning the tree + rollup + spine + strategic-context caches that embed it.
 */
export function pmoVersionKey(tenantId: number): string {
  return `pmo-version:tenant:${tenantId}`;
}
