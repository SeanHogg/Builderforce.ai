/**
 * Deterministic JSON — object keys sorted at every depth — for anything KEYED on a
 * value whose key order is incidental: a tool call's arguments, a cache key's request
 * fields, a trace fingerprint. Two values a caller means identically (`{path, offset}`
 * vs `{offset, path}`) must produce one string; `JSON.stringify` keeps insertion order,
 * so it cannot.
 *
 * JSON-faithful for JSON values: an object entry whose value is `undefined` is dropped
 * (as `JSON.stringify` drops it), a top-level `undefined` reads as `null`. Values JSON
 * cannot express still get a stable, distinct form instead of collapsing: a non-finite
 * number and a bigint as their string, an `Error` as its name/message/stack, bytes as
 * their numbers.
 *
 * NOT for fingerprints that are stored and later re-compared (boardsync content
 * hashes, sandbox verification stamps) — those keep `domain/shared/stableStringify`'s
 * format until their stored hashes are migrated.
 *
 * Pure and dependency-free (this package's root is imported by the Worker).
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" && !Number.isFinite(value)) return JSON.stringify(String(value));
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Error) {
    return stableStringify({ name: value.name, message: value.message, stack: value.stack });
  }
  if (value instanceof Uint8Array) {
    return stableStringify({ type: "Uint8Array", data: Array.from(value) });
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}
