/**
 * `applyFix` (PRD 38, Option B+ Contract 4): only the finding kinds that have a
 * deterministic codemod are applied here - `unused-export` and `unused-file`, through the
 * pinned knip `--fix` (`knipFixCommand`, next to the analyzer pins). Every other kind
 * rejects, and the view falls back to `onCompose`.
 *
 * knip fixes the whole project, so the fix is guarded and SCOPED:
 *
 *   precondition  the work tree must be COMPLETELY clean (`git status --porcelain=v1 -z
 *                 --untracked-files=all` is empty: nothing modified, staged or untracked),
 *                 the repo must have a HEAD commit, and no editor under the root may hold
 *                 unsaved changes. Any git failure refuses - a failed read is never "clean";
 *   one at a time per root (a second fix waits for the first);
 *   during        the person's saves under the root are recorded;
 *   after         ALWAYS (also when knip fails or times out): every changed path the finding
 *                 does not name is put back from HEAD (files knip created are deleted) -
 *                 unless the person saved it during the run, which is kept and reported as a
 *                 conflict. A restore that fails rejects loudly.
 *
 * Because the tree was clean, HEAD IS the state before, so nothing of the person's is lost.
 */

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { knipFixCommand } from "@builderforce/agent-tools";
import { sourcePathOf } from "@builderforce/agent-tools/knowledge";
import { runGit } from "@builderforce/agent-tools/node-git-history";
import type { Finding } from "@seanhogg/builderforce-memory/knowledge";
import type { KnowledgeFixResult } from "./knowledgeProtocol";

/** The finding kinds a codemod exists for, and the knip fix types each runs. */
const FIXABLE: Record<string, readonly ("exports" | "files")[]> = {
  "unused-export": ["exports"],
  "unused-file": ["files"],
};

const KNIP_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_CAP = 256 * 1024;
const FIX_NOTE = "knip removes every unused export in each of these files, not only the one the finding names.";

/** One changed path of `git status`: its two-letter code and root-relative path. */
export interface StatusEntry { code: string; path: string }

export interface FixPorts {
  /** `git status --porcelain=v1 -z --untracked-files=all` over the root; undefined when git failed (never read that as clean). */
  status(): Promise<StatusEntry[] | undefined>;
  /** True when the repository has a HEAD commit; false on any failure. */
  hasHead(): Promise<boolean>;
  /** Root-relative files with unsaved changes in an editor. */
  dirtyBuffers(): string[];
  /** Starts recording the person's saves under the root; `stop()` ends it and returns the root-relative paths saved. */
  watchSaves(): { stop(): string[] };
  /** Runs a shell command in the root; rejects when it could not run or failed. */
  run(command: string): Promise<void>;
  /** `git checkout HEAD -- paths`; rejects on failure. */
  restore(paths: string[]): Promise<void>;
  /** Deletes files knip created; rejects on failure. */
  remove(paths: string[]): Promise<void>;
}

export const isFixableKind = (kind: string): boolean => kind in FIXABLE;

/** `git status --porcelain=v1 -z` output as entries, the prefix of the root inside the repo removed. Pure. */
export function parseStatusZ(out: string, prefix: string): StatusEntry[] {
  const fields = out.split("\0");
  const entries: StatusEntry[] = [];
  const rel = (p: string): string => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p);
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (field.length < 4) continue;
    const code = field.slice(0, 2);
    entries.push({ code, path: rel(field.slice(3)) });
    // A rename or copy carries its origin as the next field.
    if (code[0] === "R" || code[0] === "C" || code[1] === "R" || code[1] === "C") {
      const origin = fields[++i];
      if (origin) entries.push({ code: " D", path: rel(origin) });
    }
  }
  return entries;
}

/** Did knip actually run? Exit 0, or exit 1 with a report on stdout and no launcher/npm failure. */
export function knipRanOk(code: number | null, stdout: string, stderr: string): boolean {
  if (code === 0) return true;
  if (code !== 1) return false;
  if (/npm (ERR|error)|command not found|is not recognized|ENOENT|Cannot find (module|package)|ERR_MODULE_NOT_FOUND/i.test(`${stderr}\n${stdout}`)) return false;
  return stdout.trim().length > 0;
}

const locks = new Map<string, Promise<unknown>>();

/** Runs `work` after every earlier fix of the same root finished. */
function serialized<T>(rootId: string, work: () => Promise<T>): Promise<T> {
  const run = (locks.get(rootId) ?? Promise.resolve()).catch(() => undefined).then(work);
  locks.set(rootId, run);
  void run.finally(() => { if (locks.get(rootId) === run) locks.delete(rootId); }).catch(() => undefined);
  return run;
}

export function applyKnipFix(ports: FixPorts, rootId: string, finding: Finding): Promise<KnowledgeFixResult> {
  const fixTypes = FIXABLE[finding.kind];
  if (!fixTypes) return Promise.reject(new Error(`There is no automatic fix for "${finding.kind}".`));
  const wanted = new Set(finding.nodes.flatMap((ref) => {
    const path = sourcePathOf(ref, rootId);
    return path ? [path] : [];
  }));
  if (wanted.size === 0) return Promise.reject(new Error("The finding names no file of this folder."));
  return serialized(rootId, () => fix(ports, wanted, fixTypes));
}

async function fix(ports: FixPorts, wanted: ReadonlySet<string>, fixTypes: readonly ("exports" | "files")[]): Promise<KnowledgeFixResult> {
  if (!(await ports.hasHead())) throw new Error("This repository has no commit yet, so a fix cannot be undone safely. Make a first commit, then try again.");
  const before = await ports.status();
  if (before === undefined) throw new Error("Git status could not be read, so nothing was changed.");
  if (before.length > 0) {
    throw new Error(`The work tree has changes (${before.slice(0, 3).map((e) => e.path).join(", ")}${before.length > 3 ? ", ..." : ""}). Commit or stash your changes first, then try again.`);
  }
  const buffers = ports.dirtyBuffers();
  if (buffers.length > 0) throw new Error(`Save or close the editors with unsaved changes first: ${buffers.slice(0, 3).join(", ")}.`);

  const watch = ports.watchSaves();
  let runError: unknown;
  let saved: string[] = [];
  let outcome: { changed: string[]; conflicts: string[] } | undefined;
  let restoreError: unknown;
  try {
    await ports.run(knipFixCommand(fixTypes));
  } catch (error) {
    runError = error;
  } finally {
    saved = watch.stop();
    try {
      outcome = await settle(ports, wanted, new Set(saved));
    } catch (error) {
      restoreError = error;
    }
  }
  if (restoreError !== undefined) {
    const why = restoreError instanceof Error ? restoreError.message : String(restoreError);
    throw new Error(`The fix could not be undone cleanly: ${why} Check the work tree with git status.`);
  }
  if (runError !== undefined) throw runError;
  return { changed: outcome!.changed, ...(outcome!.conflicts.length > 0 ? { conflicts: outcome!.conflicts } : {}), note: FIX_NOTE };
}

/** After knip: put every stray change back (except what the person saved) and report what stayed. */
async function settle(ports: FixPorts, wanted: ReadonlySet<string>, saved: ReadonlySet<string>): Promise<{ changed: string[]; conflicts: string[] }> {
  const after = await ports.status();
  if (after === undefined) throw new Error("Git status could not be read after the fix.");
  const changed: string[] = [];
  const conflicts: string[] = [];
  const restore: string[] = [];
  const remove: string[] = [];
  for (const entry of after) {
    if (wanted.has(entry.path)) { changed.push(entry.path); continue; }
    if (saved.has(entry.path)) { conflicts.push(entry.path); continue; }
    if (entry.code === "??") remove.push(entry.path); else restore.push(entry.path);
  }
  if (restore.length > 0) await ports.restore(restore);
  if (remove.length > 0) await ports.remove(remove);
  return { changed, conflicts };
}

/** The git, file and shell ports of a folder; the editor-bound ones (`dirtyBuffers`, `watchSaves`) come from the caller. */
export function nodeFixPorts(rootPath: string): Pick<FixPorts, "status" | "hasHead" | "run" | "restore" | "remove"> {
  const orThrow = async (args: string[]): Promise<string> => {
    const run = await runGit(rootPath, args);
    if (run.stdout === undefined) throw new Error(`git ${args[0]} failed${run.stderr ? `: ${run.stderr.trim().slice(0, 300)}` : ""}`);
    return run.stdout;
  };
  return {
    async hasHead() {
      return (await runGit(rootPath, ["rev-parse", "--verify", "HEAD"])).stdout !== undefined;
    },
    async status() {
      const prefix = await runGit(rootPath, ["rev-parse", "--show-prefix"]);
      const out = await runGit(rootPath, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
      if (prefix.stdout === undefined || out.stdout === undefined) return undefined;
      return parseStatusZ(out.stdout, prefix.stdout.trim());
    },
    run: (command) => runShell(command, rootPath),
    restore: async (paths) => { await orThrow(["checkout", "HEAD", "--", ...paths]); },
    remove: async (paths) => { for (const p of paths) await rm(join(rootPath, p), { force: true }); },
  };
}

/** Runs `command` through the shell; kills the whole process tree on timeout; rejects unless knip ran. */
function runShell(command: string, cwd: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const windows = process.platform === "win32";
    const child = spawn(command, { cwd, shell: true, windowsHide: true, detached: !windows, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const keep = (text: string, chunk: Buffer): string => (text.length < OUTPUT_CAP ? text + chunk.toString("utf8") : text);
    child.stdout.on("data", (c: Buffer) => { stdout = keep(stdout, c); });
    child.stderr.on("data", (c: Buffer) => { stderr = keep(stderr, c); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (windows && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    }, KNIP_TIMEOUT_MS);
    child.on("error", (error) => { clearTimeout(timer); reject(new Error(`knip could not run: ${error.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`knip did not finish within ${KNIP_TIMEOUT_MS / 60_000} minutes.`));
      else if (knipRanOk(code, stdout, stderr)) resolve();
      else reject(new Error(`knip could not run (exit ${code}): ${(stderr || stdout).trim().slice(-500)}`));
    });
  });
}
