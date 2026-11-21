/**
 * The one resolver for `.builderforce/` folders (PRD 49 §6).
 *
 * Pure: no filesystem writes. `ensureWorkspaceDirs` is the only I/O step.
 * Path overrides are rejected with the same rules as
 * `validateWorkspacePath` in `@seanhogg/builderforce-webcontainers-core`
 * (2026.11.10). The VSIX still resolves 2026.11.7, so the check lives here
 * until that export is on the installed package. Do not grow a second rule.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type WorkspacePathKey = "logs" | "diagnostics" | "methodology";

export interface ManifestPathOverrides {
  logs?: string;
  diagnostics?: string;
  methodology?: string;
}

export type PathIssueCode = "path-absolute" | "path-parent" | "path-empty";

export interface PathIssue {
  code: PathIssueCode;
  key: WorkspacePathKey;
  value: string;
}

export interface WorkspacePaths {
  root: string;
  methodology: string;
  logs: string;
  diagnostics: string;
  rules: string;
  hooks: string;
  personas: string;
  cache: string;
  issues: PathIssue[];
}

const DRIVE_PREFIX = /^[A-Za-z]:/;

/** Same rejection as core `validateWorkspacePath`. */
export function rejectWorkspaceOverride(value: string): PathIssueCode | null {
  const trimmed = value.trim();
  if (trimmed === "") return "path-empty";
  if (trimmed.startsWith("/") || trimmed.startsWith("\\") || DRIVE_PREFIX.test(trimmed)) return "path-absolute";
  if (trimmed.split(/[/\\]/).some((segment) => segment === "..")) return "path-parent";
  return null;
}

const DEFAULTS: Record<WorkspacePathKey, string> = {
  methodology: ".builderforce/methodology",
  logs: ".builderforce/logs",
  diagnostics: ".builderforce/diagnostics",
};

function resolveKey(root: string, key: WorkspacePathKey, overrides: ManifestPathOverrides | undefined, issues: PathIssue[]): string {
  const raw = overrides?.[key];
  if (typeof raw === "string") {
    const code = rejectWorkspaceOverride(raw);
    if (code) {
      issues.push({ code, key, value: raw });
    } else {
      return path.resolve(root, raw);
    }
  }
  return path.join(root, ...DEFAULTS[key].split("/"));
}

/** Resolved folders. Invalid overrides are listed on `issues` and fall back to the default. */
export function workspacePaths(root: string, overrides?: ManifestPathOverrides | null): WorkspacePaths {
  const issues: PathIssue[] = [];
  const base = path.resolve(root);
  return {
    root: path.join(base, ".builderforce"),
    methodology: resolveKey(base, "methodology", overrides ?? undefined, issues),
    logs: resolveKey(base, "logs", overrides ?? undefined, issues),
    diagnostics: resolveKey(base, "diagnostics", overrides ?? undefined, issues),
    rules: path.join(base, ".builderforce", "rules"),
    hooks: path.join(base, ".builderforce", "hooks.json"),
    personas: path.join(base, ".builderforce", "personas"),
    cache: path.join(base, ".builderforce", "cache"),
    issues,
  };
}

const GITIGNORE = ["logs/", "diagnostics/", "cache/", ""].join("\n");

/** Creates the standard folders and the gitignore that keeps machine-local output out of git. */
export function ensureWorkspaceDirs(paths: WorkspacePaths): void {
  for (const dir of [paths.root, paths.methodology, paths.logs, paths.diagnostics, paths.rules, paths.personas, paths.cache]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const ignore = path.join(paths.root, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, GITIGNORE, "utf8");
}
