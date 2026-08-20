/**
 * Learned Model Routing (PRD 13) — the routing SCOPE and its stable string token.
 *
 * A scope names WHOSE evidence a ranking is built from, finest-first in precedence
 * (`project:<id>` → `tenant:<id>` → `global`). The token is the cache-key suffix on
 * the Worker's `routing:<scope>` KV blob, the `?scope=` query param of the
 * client-facing read, and the key a client caches its own copy under — so it lives
 * in ONE place and every side spells it identically. Pure; no I/O.
 */

/** A routing scope, finest-first in precedence. */
export type RoutingScope =
  | { kind: 'project'; id: number }
  | { kind: 'tenant'; id: number }
  | { kind: 'global' };

/**
 * The token a CLIENT sends when it means "my own tenant". A client authenticates with
 * a tenant credential and does not know its own tenant id, so it cannot spell
 * `tenant:<id>`; the api resolves this literal from the credential instead. Modeled
 * here rather than as a bare string in the route so the only client that sends it and
 * the door that reads it agree by construction.
 */
export const OWN_TENANT_SCOPE_TOKEN = 'tenant';

/** Stable string form used as the cache key suffix and the analytics query param. */
export function scopeToken(scope: RoutingScope): string {
  return scope.kind === 'global' ? 'global' : `${scope.kind}:${scope.id}`;
}

/** Parse a `scope` query param (`project:<id>` | `tenant:<id>` | `global`). Returns
 *  null for anything malformed so the caller can 400. */
export function parseScopeToken(raw: string | undefined | null): RoutingScope | null {
  if (!raw || raw === 'global') return raw === 'global' ? { kind: 'global' } : null;
  const [kind, idStr] = raw.split(':');
  const id = Number(idStr);
  if ((kind === 'project' || kind === 'tenant') && Number.isInteger(id) && id > 0) {
    return { kind, id };
  }
  return null;
}
