/**
 * Read the workspace's committed directives — `.builderforce/hooks.json` and
 * `.builderforce/rules.md` — for a run.
 *
 * Every run reads them, so each file is cached by its (mtime, size) version token: an
 * unchanged file costs one `stat`, an edited one is re-read on the very next run. A
 * missing file is simply "none" — no hooks, no rules.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DIRECTIVES_DIR, HOOKS_FILE, RULES_FILE, commandsDigest, parseHooksFile, type WorkspaceHook } from "./hookConfig";

export interface WorkspaceDirectives {
  hooks: WorkspaceHook[];
  /** Why entries of `hooks.json` were skipped; empty when the file is clean or absent. */
  problems: string[];
  /** The rules file's text, trimmed; '' when absent. */
  rules: string;
  /** Fingerprint of the commands the hooks would run ('' when none). */
  digest: string;
}

export const NO_DIRECTIVES: WorkspaceDirectives = { hooks: [], problems: [], rules: "", digest: "" };

interface Cached<T> {
  version: string;
  value: T;
}

const cache = new Map<string, Cached<unknown>>();

/** Read a file through its version token; `fallback` when it does not exist. */
async function readVersioned<T>(file: string, fallback: T, decode: (raw: string) => T): Promise<T> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat || !stat.isFile()) {
    cache.delete(file);
    return fallback;
  }
  const version = `${stat.mtimeMs}:${stat.size}`;
  const hit = cache.get(file) as Cached<T> | undefined;
  if (hit && hit.version === version) return hit.value;
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw == null) return fallback;
  const value = decode(raw);
  cache.set(file, { version, value });
  return value;
}

/** Path of a directives file in a workspace. */
export function directivesPath(root: string, file: typeof HOOKS_FILE | typeof RULES_FILE): string {
  return path.join(root, DIRECTIVES_DIR, file);
}

/** The workspace's directives, or none when no folder is open. */
export async function loadWorkspaceDirectives(root: string): Promise<WorkspaceDirectives> {
  if (!root) return NO_DIRECTIVES;
  const [parsed, rules] = await Promise.all([
    readVersioned(directivesPath(root, HOOKS_FILE), { hooks: [], problems: [] }, parseHooksFile),
    readVersioned(directivesPath(root, RULES_FILE), "", (raw) => raw.trim()),
  ]);
  return { hooks: parsed.hooks, problems: parsed.problems, rules, digest: commandsDigest(parsed.hooks) };
}

/** Forget every cached read — a test, or a workspace switch. */
export function resetWorkspaceDirectivesCache(): void {
  cache.clear();
}
