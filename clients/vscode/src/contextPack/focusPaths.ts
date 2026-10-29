/**
 * The FILES a request is about (PRD 35 E2) — the paths the user named in the sentence
 * ("update docs/specs/35-prd.md", "look at `clients/vscode/src/bfApi.ts:584`"). The
 * context pack inlines or outlines each one before turn 1, so the run does not spend its
 * first turns finding and reading the document it was handed.
 *
 * The extractor itself is the ONE shared copy in `@builderforce/agent-tools` (cloud run-end
 * memory anchors facts with the same rule); this module keeps only the disk half — where a
 * named path lives under the workspace root — which needs `node:path`.
 */

import * as path from "node:path";

export { MAX_FOCUS_PATHS, asPathToken, extractFocusPaths } from "@builderforce/agent-tools";

/**
 * Where a named path lives on disk, or undefined when it would escape the workspace
 * root. Relative paths resolve against the root; an absolute path must sit under it.
 */
export function resolveUnderRoot(root: string, candidate: string): string | undefined {
  if (!root) return undefined;
  const base = path.resolve(root);
  const abs = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(base, candidate);
  const rel = path.relative(base, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return abs;
}

/** True for a path written relative — an absolute path in a document is somebody else's
 *  machine, so it names no area of this workspace. */
export function isRelativePath(p: string): boolean {
  return !/^[A-Za-z]:|^[\\/]/.test(p);
}

/** The workspace-relative, forward-slash form a pack and a code map speak. */
export function workspaceRelative(root: string, abs: string): string {
  return path.relative(path.resolve(root), abs).split(path.sep).join("/");
}
