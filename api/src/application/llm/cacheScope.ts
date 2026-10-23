/**
 * THE cache scope — who a cached answer may be served back to.
 *
 * Every cache that replays an answer instead of asking a model (the exact-match
 * response cache, the semantic cache — both its `/v1/semantic-cache` route and the
 * gateway's own chat step — and the memory-first Q&A cache) must agree on one
 * question: whose answer is this? They used to answer it three ways. The exact cache
 * keyed on the tenant alone, the Q&A cache on tenant + project alone, and only the
 * semantic route mixed in the principal and role — so a project answer one person
 * produced under their permissions was replayed verbatim to another person, or to an
 * agent host, holding different ones (defect 10).
 *
 * The answer lives here, once. A scope is tenant + project + principal/permission +
 * model class, rendered to ONE key segment; each cache adds its own prefix and its
 * own content hash after it, never its own idea of who may read.
 *
 * Pure: no I/O, no clock, no runtime binding.
 */

/** Who is asking, in whatever shape the calling door knows it. */
export interface CachePrincipal {
  /** A person (`user`), or the `agentHost:<id>` subject the host door publishes. */
  userId?: string | null;
  /** An agent host, when the door knows it by id rather than by subject. */
  agentHostId?: string | number | null;
  /** A tenant API key, when that is the only credential on the request. */
  apiKeyId?: string | number | null;
  /** The permission role the request runs under — two roles see different data. */
  role?: string | null;
}

/** The scope one cached answer belongs to. */
export interface CacheScope {
  tenantId: number;
  /** The project the answer is about; absent for a project-less call. */
  projectId?: number | null;
  /** {@link principalScope} — never a raw id. */
  principal: string;
  /**
   * The CLASS of model that produced it (a tier, not an exact id), for caches that
   * match on meaning: a paraphrase answered by a premium model is not an answer for a
   * request that asked for a free one, but two premium ids are interchangeable.
   * The exact cache leaves it absent — its content hash already carries the model.
   */
  modelClass?: string | null;
}

/** The principal of a tenant-internal call that acts for no person (a sweep, a classifier). */
export const TENANT_PRINCIPAL = 'tenant';

/** Keep a segment to bounded, KV-safe characters. `:` is the separator, so it is replaced. */
function segment(raw: string, max = 80): string {
  const s = raw.replace(/[^a-zA-Z0-9_.@-]/g, '_').slice(0, max);
  return s || '_';
}

/**
 * The principal + permission segment of a scope. The role leads, so a person whose
 * role changes stops reading answers produced under the old one. No principal at all
 * is the tenant-internal principal, never "anyone".
 */
export function principalScope(p: CachePrincipal | null | undefined): string {
  if (!p) return TENANT_PRINCIPAL;
  const who = p.userId
    ? `user-${p.userId}`
    : p.agentHostId != null && p.agentHostId !== ''
      ? `host-${p.agentHostId}`
      : p.apiKeyId != null && p.apiKeyId !== ''
        ? `key-${p.apiKeyId}`
        : null;
  if (!who) return p.role ? `${segment(p.role, 32)}.${TENANT_PRINCIPAL}` : TENANT_PRINCIPAL;
  return `${segment(p.role ?? 'norole', 32)}.${segment(who)}`;
}

/** The ONE rendered scope segment every cache key embeds. */
export function cacheScopeKey(scope: CacheScope): string {
  const project = scope.projectId != null && Number.isInteger(scope.projectId) && scope.projectId > 0
    ? String(scope.projectId)
    : '-';
  const model = scope.modelClass ? segment(scope.modelClass, 32) : '-';
  return `t${scope.tenantId}:p${project}:${segment(scope.principal, 120)}:m${model}`;
}

/**
 * A short, stable digest of the scope (FNV-1a, 8 hex) for keys with a tight length
 * budget — the Q&A cache's `project_facts.key` — where tenant and project are already
 * columns and only the principal/model part must be told apart.
 */
export function cacheScopeDigest(scope: CacheScope): string {
  const s = cacheScopeKey(scope);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
