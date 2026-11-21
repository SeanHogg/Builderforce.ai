/**
 * PRD 49 write scope. Pure: no `node:*`, no persona types. `agent-tools` does
 * not depend on `agent-runtime`. Absent scope means every write is allowed.
 */

export type WriteScopeEntry =
  | { key: "root" }
  | { key: "logs" | "diagnostics" | "methodology"; sub?: string };

/** `root` is the workspace root. The other folders are absolute or workspace-relative. */
export interface WriteScopePaths {
  root: string;
  methodology: string;
  logs: string;
  diagnostics: string;
}

export interface WriteScopeDecision {
  allowed: boolean;
  reason?: string;
}

function norm(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isAbs(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(norm(path));
}

function hasParent(path: string): boolean {
  return norm(path).split("/").includes("..");
}

function join(root: string, rel: string): string {
  const base = norm(root);
  const rest = norm(rel).replace(/^\.\//, "");
  return rest ? `${base}/${rest}` : base;
}

function resolveScope(entry: WriteScopeEntry, paths: WriteScopePaths): string {
  if (entry.key === "root") return norm(paths.root);
  const base = norm(paths[entry.key]);
  const sub = entry.sub?.replace(/^[/\\]+|[/\\]+$/g, "");
  if (!sub || hasParent(sub)) return base;
  return `${base}/${norm(sub)}`;
}

function within(folder: string, target: string, workspaceRoot: string): boolean {
  const folderNorm = norm(folder);
  const root = norm(workspaceRoot);
  const raw = norm(target).replace(/^\.\//, "");
  const abs = isAbs(raw) ? raw : join(root, raw);
  if (abs === folderNorm || abs.startsWith(`${folderNorm}/`)) return true;
  const folderRel = folderNorm.startsWith(`${root}/`) ? folderNorm.slice(root.length + 1) : folderNorm;
  if (raw === folderRel || raw.startsWith(`${folderRel}/`)) return true;
  const withoutDot = folderRel.replace(/^\.builderforce\//, "");
  return raw === withoutDot || raw.startsWith(`${withoutDot}/`);
}

function describe(entry: WriteScopeEntry): string {
  if (entry.key === "root") return "the workspace root";
  return entry.sub ? `${entry.key}/${entry.sub}` : entry.key;
}

/**
 * `scope` undefined → allowed. Otherwise the target must stay inside a resolved
 * scope folder. A `..` segment is refused.
 */
export function writeAllowed(
  scope: readonly WriteScopeEntry[] | undefined,
  paths: WriteScopePaths,
  target: string,
  roleName: string,
): WriteScopeDecision {
  if (scope === undefined) return { allowed: true };
  if (!target.trim() || hasParent(target)) {
    return { allowed: false, reason: `${roleName} may not write a path that leaves its scope` };
  }
  const folders = scope.map((entry) => resolveScope(entry, paths));
  if (folders.some((folder) => within(folder, target, paths.root))) return { allowed: true };
  const where = scope.map(describe).join(" or ");
  return { allowed: false, reason: `${roleName} may only write under ${where}` };
}
