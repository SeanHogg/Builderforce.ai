/**
 * Deterministic JSON — object keys sorted at every depth — for anything that is KEYED
 * on a tool call's arguments.
 *
 * Two places in this package fingerprint a call by its arguments: the MCP relay's
 * create-dedupe (`mcpCatalog.ts`) and the run loop's read-repeat guard
 * (`readCoverage.ts`). Object key order can differ between two calls a model means
 * identically (`{path, offset}` vs `{offset, path}`), and `JSON.stringify` preserves
 * insertion order, so a naive fingerprint sees two different calls. Both consumers need
 * the same answer to "are these the same arguments?", so the canonicalisation lives once.
 */
export function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}
