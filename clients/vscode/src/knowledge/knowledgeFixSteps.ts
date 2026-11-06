/**
 * The staged fix flow's checks in the editor: ONE of the four (build, types, lint, tests), run
 * through the project's own package script.
 *
 * A check is the project's script, never one we invent: no matching script in `package.json`
 * means the check is `skipped` (and nothing is spawned), not passed. The package manager is the
 * one the NEAREST lockfile names, searched upward to the repository top, so a pnpm monorepo
 * folder uses pnpm. Undo lives in `knowledgeFixUndo.ts`.
 */

import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fixText } from "./knowledgeFixText";
import type { KnowledgeCheckReply } from "./knowledgeProtocol";
import { DETAIL_CAP, runShell, ShellFailure } from "./knowledgeShell";

const CHECK_TIMEOUT_MS = 15 * 60_000;
const MAX_LEVELS = 12;

/** The package scripts that stand for each SCRIPT check (the re-scan and the review are not scripts), first match wins. */
const SCRIPTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  types: ["typecheck", "type-check", "tsc"],
  tests: ["test"],
});

export const isCheckId = (id: string): boolean => Object.hasOwn(SCRIPTS, id);

export type PackageManager = "pnpm" | "yarn" | "npm";

/** `pnpm run build` / `yarn run build` / `npm run build`, or undefined when the project has no script for the check. Pure. */
export function checkCommand(check: string, scripts: Readonly<Record<string, unknown>> | undefined, manager: PackageManager): string | undefined {
  if (!isCheckId(check)) return undefined;
  const name = SCRIPTS[check]!.find((s) => typeof scripts?.[s] === "string");
  return name ? `${manager} run ${name}` : undefined;
}

const LOCKS: readonly (readonly [string, PackageManager])[] = [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["package-lock.json", "npm"]];

async function has(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/** The package manager of the nearest lockfile from `rootPath` up to (and including) the repository top; npm when none. */
export async function detectManager(rootPath: string): Promise<PackageManager> {
  let dir = rootPath;
  for (let i = 0; i < MAX_LEVELS; i++) {
    for (const [file, manager] of LOCKS) if (await has(join(dir, file))) return manager;
    if (await has(join(dir, ".git")) || await has(join(dir, "pnpm-workspace.yaml"))) break;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return "npm";
}

/** The command a check would run in this folder, or undefined when the project has no script for it (nothing to confirm, nothing to spawn). */
export async function resolveCheck(rootPath: string, check: string): Promise<string | undefined> {
  if (!isCheckId(check)) throw new Error(fixText.noSuchCheck(check));
  let scripts: Record<string, unknown> | undefined;
  try { scripts = (JSON.parse(await readFile(join(rootPath, "package.json"), "utf8")) as { scripts?: Record<string, unknown> }).scripts; } catch { scripts = undefined; }
  return checkCommand(check, scripts, await detectManager(rootPath));
}

/** Runs the resolved command: pass on exit 0, fail with what happened and the output tail (at most 2 KB) otherwise. */
export async function execCheck(rootPath: string, command: string, signal?: AbortSignal): Promise<KnowledgeCheckReply> {
  try {
    await runShell(command, rootPath, { timeoutMs: CHECK_TIMEOUT_MS, label: command, ok: (code) => code === 0, ...(signal ? { signal } : {}) });
    return { status: "pass" };
  } catch (error) {
    if (!(error instanceof ShellFailure)) return { status: "fail", detail: String(error instanceof Error ? error.message : error).slice(0, DETAIL_CAP) };
    return { status: "fail", detail: `${error.message}${error.output ? `\n${error.output}` : ""}`.slice(-DETAIL_CAP) };
  }
}
