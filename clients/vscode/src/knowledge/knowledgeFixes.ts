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

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { knipFixCommand } from "@builderforce/agent-tools";
import { sourcePathOf } from "@builderforce/agent-tools/knowledge";
import { runGit } from "@builderforce/agent-tools/node-git-history";
import type { Finding } from "@seanhogg/builderforce-memory/knowledge";
import { assertInsideRoot } from "./knowledgeFixPaths";
import type { KnowledgeFixResult } from "./knowledgeProtocol";
import { runShell } from "./knowledgeShell";
import { fixText } from "./knowledgeFixText";
import { snapshotFix, type FixSnapshot } from "./knowledgeFixUndo";

/** The finding kinds a codemod exists for, and the knip fix types each runs. */
const FIXABLE: Record<string, readonly ("exports" | "files")[]> = {
  "unused-export": ["exports"],
  "unused-file": ["files"],
};

const KNIP_TIMEOUT_MS = 10 * 60_000;

/** A git step that worked, or the reason it did not (git's own message). */
export type GitResult = { ok: true } | { ok: false; reason: string };

/** One changed path of `git status`: its two-letter code and root-relative path. */
export interface StatusEntry { code: string; path: string }

export interface FixPorts {
  /** `git status --porcelain=v1 -z --untracked-files=all` over the root; undefined when git failed (never read that as clean). */
  status(): Promise<StatusEntry[] | undefined>;
  /** True when the repository has a HEAD commit; false on any failure. */
  hasHead(): Promise<boolean>;
  /** `git switch -c name`: the branch was created and checked out (changes carry over), or why not (the fix then applies in place and says so). */
  createBranch?(name: string): Promise<GitResult>;
  /** The branch HEAD is on; undefined when detached or git failed. */
  currentBranch?(): Promise<string | undefined>;
  /** `git switch branch`: back to a branch (undo returns the person to where they started). */
  switchTo?(branch: string): Promise<GitResult>;
  /** `git branch -d name`: drops a fix branch that carries no commit (an abandoned fix). */
  deleteBranch?(name: string): Promise<GitResult>;
  /** Root-relative files with unsaved changes in an editor. */
  dirtyBuffers(): string[];
  /** Starts recording the person's saves under the root; `stop()` ends it and returns the root-relative paths saved. */
  watchSaves(): { stop(): string[] };
  /** Runs a shell command in the root; rejects when it could not run or failed. */
  run(command: string): Promise<void>;
  /** `git --literal-pathspecs checkout HEAD -- paths`; rejects on failure or on a path that reaches outside the root. */
  restore(paths: string[]): Promise<void>;
  /** The commit HEAD is at; undefined when git failed. */
  headSha?(): Promise<string | undefined>;
  /** Per path, the git blob sha of the file as it is now, or "missing" when there is no file. */
  hashObjects?(paths: string[]): Promise<Record<string, string>>;
  /** Which of the paths exist in HEAD (`git ls-tree`). */
  inHead?(paths: string[]): Promise<Set<string>>;
  /** Takes paths out of the index without touching the files. */
  unstage?(paths: string[]): Promise<void>;
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
export function serialized<T>(rootId: string, work: () => Promise<T>): Promise<T> {
  const run = (locks.get(rootId) ?? Promise.resolve()).catch(() => undefined).then(work);
  locks.set(rootId, run);
  void run.finally(() => { if (locks.get(rootId) === run) locks.delete(rootId); }).catch(() => undefined);
  return run;
}

/** Applies the finding's codemod. `record` (when the host can undo) stores the snapshot taken under the lock and returns the id the result carries. */
export function applyKnipFix(ports: FixPorts, rootId: string, finding: Finding, record?: (snapshot: FixSnapshot) => string): Promise<KnowledgeFixResult> {
  const fixTypes = FIXABLE[finding.kind];
  if (!fixTypes) return Promise.reject(new Error(fixText.noAutomaticFix(finding.kind)));
  const wanted = new Set(finding.nodes.flatMap((ref) => {
    const path = sourcePathOf(ref, rootId);
    return path ? [path] : [];
  }));
  if (wanted.size === 0) return Promise.reject(new Error(fixText.noFileOfFolder()));
  return serialized(rootId, () => fix(ports, wanted, fixTypes, fixBranchName(finding, wanted, new Date()), record));
}

/**
 * `fix/<kind>-<slug>-<yyyymmddhhmmss>-<hash>`: the kind, the first file's name, the time to the second
 * and a hash of the finding id, so two fixes of one finding (or two findings on one file) never
 * collide on a branch name. Pure.
 */
export function fixBranchName(finding: Pick<Finding, "id" | "kind">, wanted: ReadonlySet<string>, now: Date): string {
  const first = [...wanted][0] ?? "";
  const clean = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const slug = clean((first.split("/").pop() ?? "").replace(/\.[^.]*$/, "")).slice(0, 24);
  let h = 5381;
  for (const c of finding.id) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  return `fix/${clean(finding.kind)}-${slug ? slug + "-" : ""}${stamp}-${h.toString(36).padStart(6, "0").slice(0, 8)}`;
}

async function fix(ports: FixPorts, wanted: ReadonlySet<string>, fixTypes: readonly ("exports" | "files")[], branchName: string, record?: (snapshot: FixSnapshot) => string): Promise<KnowledgeFixResult> {
  if (!(await ports.hasHead())) throw new Error(fixText.noCommit());
  const before = await ports.status();
  if (before === undefined) throw new Error(fixText.statusUnreadable());
  if (before.length > 0) {
    throw new Error(fixText.treeChanges(`${before.slice(0, 3).map((e) => e.path).join(", ")}${before.length > 3 ? ", ..." : ""}`));
  }
  const buffers = ports.dirtyBuffers();
  if (buffers.length > 0) throw new Error(fixText.saveFirst(buffers.slice(0, 3).join(", ")));

  // Branch first (the tree is clean, so nothing is carried that is not the fix). A failure applies in place AND is reported.
  const origin = ports.createBranch ? await ports.currentBranch?.() : undefined;
  const made = ports.createBranch ? await ports.createBranch(branchName) : undefined;
  const branch = made?.ok ? branchName : undefined;
  const branchError = made && !made.ok ? made.reason : undefined;
  const leaveBranch = async (): Promise<void> => { if (branch && origin) await ports.switchTo?.(origin); };
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
    await leaveBranch().catch(() => undefined);
    throw new Error(fixText.notUndoneCleanly(why));
  }
  if (runError !== undefined) {
    await leaveBranch().catch(() => undefined);
    throw runError;
  }
  const { changed, conflicts } = outcome!;
  /** Back to where the person started, and the fix branch (no commits: it IS the origin) deleted. True when both held. */
  const abandonBranch = async (): Promise<boolean> => {
    if (!branch || !origin || !ports.switchTo) return false;
    const back = await ports.switchTo(origin).catch(() => undefined);
    if (!back?.ok) return false;
    await ports.deleteBranch?.(branch).catch(() => undefined);
    return true;
  };
  // knip changed nothing the finding names: an undo-capable host would hold no record, so no
  // empty fix branch is left behind.
  if (record && changed.length === 0) {
    const kept = branch && !(await abandonBranch());
    return { ...(kept ? { branch } : {}), ...(branchError ? { branchError } : {}), changed, ...(conflicts.length > 0 ? { conflicts } : {}), note: fixText.fixNote() };
  }
  let fixId: string | undefined;
  if (record) {
    try {
      const snapshot = await snapshotFix(ports, changed, branch ? origin : undefined);
      // A host that CAN snapshot (headSha + hashObjects) but got none: git failed, so there is no undo.
      if (!snapshot && ports.headSha && ports.hashObjects) throw new Error(fixText.headUnreadable());
      fixId = snapshot ? record(snapshot) : undefined;
    } catch (error) {
      // No undo record: never leave the fix applied on its branch. Revert it, go back, drop the branch.
      await revertPaths(ports, changed);
      await abandonBranch();
      throw new Error(fixText.notRecorded(error instanceof Error ? error.message : String(error)));
    }
  }
  return { ...(branch ? { branch } : {}), ...(branchError ? { branchError } : {}), ...(fixId ? { fixId } : {}), changed, ...(conflicts.length > 0 ? { conflicts } : {}), note: fixText.fixNote() };
}

/** Puts these root-relative paths back to HEAD (a file knip created is deleted). */
async function revertPaths(ports: FixPorts, paths: readonly string[]): Promise<void> {
  const want = new Set(paths);
  const entries = ((await ports.status()) ?? []).filter((e) => want.has(e.path));
  const restore = entries.filter((e) => e.code !== "??").map((e) => e.path);
  const remove = entries.filter((e) => e.code === "??").map((e) => e.path);
  if (restore.length > 0) await ports.restore(restore);
  if (remove.length > 0) await ports.remove(remove);
}

/** After knip: put every stray change back (except what the person saved) and report what stayed. */
async function settle(ports: FixPorts, wanted: ReadonlySet<string>, saved: ReadonlySet<string>): Promise<{ changed: string[]; conflicts: string[] }> {
  const after = await ports.status();
  if (after === undefined) throw new Error(fixText.statusUnreadableAfter());
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
export function nodeFixPorts(rootPath: string): Required<Pick<FixPorts, "status" | "hasHead" | "createBranch" | "currentBranch" | "switchTo" | "deleteBranch" | "run" | "restore" | "remove" | "headSha" | "hashObjects" | "inHead" | "unstage">> {
  const orThrow = async (args: string[]): Promise<string> => {
    const run = await runGit(rootPath, args);
    if (run.stdout === undefined) throw new Error(fixText.gitFailed(args[0] ?? "", run.stderr ? `: ${run.stderr.trim().slice(0, 300)}` : ""));
    return run.stdout;
  };
  return {
    async hasHead() {
      return (await runGit(rootPath, ["rev-parse", "--verify", "HEAD"])).stdout !== undefined;
    },
    async createBranch(name) {
      const run = await runGit(rootPath, ["switch", "-c", name]);
      return run.stdout !== undefined ? { ok: true } : { ok: false, reason: (run.stderr ?? "").trim().slice(0, 300) };
    },
    async currentBranch() {
      const run = await runGit(rootPath, ["symbolic-ref", "--short", "-q", "HEAD"]);
      return run.stdout?.trim() || undefined;
    },
    async switchTo(branch) {
      const run = await runGit(rootPath, ["switch", branch]);
      return run.stdout !== undefined ? { ok: true } : { ok: false, reason: (run.stderr ?? "").trim().slice(0, 300) };
    },
    async deleteBranch(name) {
      // `-d` (not `-D`): git refuses a branch with commits not on HEAD, so only an empty fix branch goes.
      const run = await runGit(rootPath, ["branch", "-d", name]);
      return run.stdout !== undefined ? { ok: true } : { ok: false, reason: (run.stderr ?? "").trim().slice(0, 300) };
    },
    async status() {
      const prefix = await runGit(rootPath, ["rev-parse", "--show-prefix"]);
      const out = await runGit(rootPath, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
      if (prefix.stdout === undefined || out.stdout === undefined) return undefined;
      return parseStatusZ(out.stdout, prefix.stdout.trim());
    },
    run: (command) => runShell(command, rootPath, { ok: knipRanOk, timeoutMs: KNIP_TIMEOUT_MS }),
    // Literal pathspecs: a name like `app/[id]/page.tsx` or `a*.ts` is that file, never a glob.
    async restore(paths) {
      for (const p of paths) await assertInsideRoot(rootPath, p);
      await orThrow(["--literal-pathspecs", "checkout", "HEAD", "--", ...paths]);
    },
    async remove(paths) {
      for (const p of paths) await assertInsideRoot(rootPath, p);
      for (const p of paths) await rm(join(rootPath, p), { force: true });
    },
    async headSha() {
      const out = await runGit(rootPath, ["rev-parse", "--verify", "HEAD"]);
      return out.stdout?.trim() || undefined;
    },
    async hashObjects(paths) {
      const out: Record<string, string> = {};
      for (const p of paths) {
        await assertInsideRoot(rootPath, p);
        const run = await runGit(rootPath, ["hash-object", "--", p]);
        out[p] = run.stdout?.trim() || "missing";
      }
      return out;
    },
    async inHead(paths) {
      const run = await runGit(rootPath, ["--literal-pathspecs", "ls-tree", "-r", "--name-only", "-z", "HEAD", "--", ...paths]);
      if (run.stdout === undefined) throw new Error(fixText.lsTreeFailed());
      return new Set(run.stdout.split("\0").filter((x) => x !== ""));
    },
    async unstage(paths) {
      await orThrow(["--literal-pathspecs", "rm", "-r", "-f", "--cached", "--ignore-unmatch", "--", ...paths]);
    },
  };
}
