/**
 * Tenant-scoped object-storage key ownership.
 *
 * Uploaded R2 objects are namespaced under a `${tenantId}/` prefix; a request may
 * only touch a key that starts with its own tenant prefix. This is the one
 * predicate for that check — callers keep their own 403/404 response shaping.
 */
export function isKeyOwnedByTenant(
  key: string | null | undefined,
  tenantId: number,
): key is string {
  return !!key && key.startsWith(`${tenantId}/`);
}
