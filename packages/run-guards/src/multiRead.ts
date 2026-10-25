/**
 * `read_file` with `paths[]` (PRD 35 E4) as the read guard sees it: ONE call that read
 * several files, so the guard records — and caches — each file as the single-path read
 * it is. A later `read_file` of one of those files is then an exact repeat or a covered
 * window like any other; the multi call itself is never stubbed (its own answer is the
 * composition, and re-running it is the honest fallback). Pure.
 */

import { READ_FILE_MAX_PATHS } from "@builderforce/agent-tools";

/**
 * The single-path reads a multi-path `read_file` stands for, in request order — each
 * carrying the call's other arguments (`offset`/`limit` apply to every file). Null for
 * anything that is not a `paths[]` read (a plain `path` read stays as it is).
 */
export function singleReadsOf(tool: string, args: unknown): Array<Record<string, unknown>> | null {
  if (tool !== "read_file" || !args || typeof args !== "object" || Array.isArray(args)) return null;
  const { paths, ...rest } = args as Record<string, unknown>;
  // As `read_file` itself reads it: a non-empty `path` wins; an empty/absent one defers to `paths`.
  if (!Array.isArray(paths) || (typeof rest.path === "string" && rest.path !== "")) return null;
  const named = paths.filter((p): p is string => typeof p === "string" && p.trim() !== "").slice(0, READ_FILE_MAX_PATHS);
  if (named.length === 0) return null;
  return named.map((path) => ({ ...rest, path }));
}

/** The per-file entries of a multi-path result, or null when it does not carry them. */
export function perFileResults(result: Record<string, unknown> | null): unknown[] | null {
  return result && Array.isArray(result.files) ? (result.files as unknown[]) : null;
}
