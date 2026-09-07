/**
 * Secret-safe fingerprint of a header set: sorted, lower-cased header NAMES only.
 *
 * Folded into `MemoryIndexManager#computeProviderKey` (manager-embedding-ops.ts)
 * so a change to the configured `memorySearch.remote.headers` — e.g. a routing
 * header that points the same model id at a different deployment — changes the
 * provider key and triggers a full reindex, without ever hashing header VALUES
 * (which may carry credentials) into the on-disk index metadata.
 */
function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

export function fingerprintHeaderNames(headers: Record<string, string> | undefined): string[] {
  if (!headers) {
    return [];
  }
  const out: string[] = [];
  for (const key of Object.keys(headers)) {
    const normalized = normalizeHeaderName(key);
    if (!normalized) {
      continue;
    }
    out.push(normalized);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}
