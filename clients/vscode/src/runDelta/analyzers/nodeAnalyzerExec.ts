/**
 * The editor's {@link AnalyzerExec} for the run delta's L3 analyzers and dynamic tier (agent-tools `delta/adapters`,
 * `delta/dynamic`): argument arrays through `execFile` (never a shell, so a path is never re-quoted), bounded output, a
 * timeout and an abort signal.
 *
 * NO HIJACK. A program is never launched by a bare name: `which` resolves it from `process.env.PATH` ONLY — skipping
 * `.`, every relative entry and every folder inside a repository the delta measures ({@link excludeFromPathSearch}) —
 * to an absolute file (on Windows a `.exe`/`.com`; a `.cmd` would need a shell). `node <entry>` runs the extension host's
 * own Node (`process.execPath` as Node). Runs that need no tree start in a neutral folder (the OS temp folder).
 *
 * A program that cannot be launched answers `started: false`; output past the bound is `overflow` (`output-too-large`),
 * never a timeout. Scratch folders are `mkdtemp` (private to the user).
 */

import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { AnalyzerExec, ExecResult } from "@builderforce/agent-tools";
import { runTree } from "../../process/killTree";

/** The most output one tool run may print (a whole-repo JSON report). */
const MAX_BUFFER = 256 * 1024 * 1024;
/** `newestMtime` looks at most this many entries (an offline database is a handful of files). */
const MAX_WALK = 10_000;

/** Repository roots whose folders are never searched for a program (the run could have written one there). */
const excludedRoots = new Set<string>();
const norm = (p: string): string => {
  const n = path.resolve(p).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? n.toLowerCase() : n;
};

/** A repository the delta measures: no PATH entry inside it is ever used to find a program. */
export function excludeFromPathSearch(root: string): void {
  excludedRoots.add(norm(root));
}

const inside = (dir: string, root: string): boolean => dir === root || dir.startsWith(`${root}/`);

/** The PATH folders a program may come from: absolute, not `.`, not inside an excluded repository. */
export function searchPath(env: NodeJS.ProcessEnv = process.env, excluded: Iterable<string> = excludedRoots): string[] {
  const raw = env.PATH ?? env.Path ?? "";
  const roots = [...excluded];
  return raw.split(path.delimiter).filter((d) => d && d !== "." && path.isAbsolute(d)).filter((d) => !roots.some((r) => inside(norm(d), r)));
}

async function isFile(p: string): Promise<boolean> {
  return fs.stat(p).then((s) => s.isFile(), () => false);
}

/** The absolute path of `program` on the search path; undefined when absent. A name with a separator is refused. */
export async function whichOnPath(program: string, dirs: readonly string[] = searchPath()): Promise<string | undefined> {
  if (!program || /[\\/]/.test(program)) return undefined;
  const names = process.platform === "win32" ? [`${program}.exe`, `${program}.com`] : [program];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (await isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function launch(argv: readonly string[], extra: Readonly<Record<string, string>> | undefined): { file: string; args: string[]; env: NodeJS.ProcessEnv } {
  const env = { ...process.env, ...(extra ?? {}) };
  if (argv[0] === "node") return { file: process.execPath, args: argv.slice(1), env: { ...env, ELECTRON_RUN_AS_NODE: "1" } };
  return { file: argv[0]!, args: argv.slice(1), env };
}

async function newest(dir: string): Promise<number | undefined> {
  let best: number | undefined;
  let seen = 0;
  const stack = [dir];
  while (stack.length > 0 && seen < MAX_WALK) {
    const at = stack.pop()!;
    const entries = await fs.readdir(at, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (++seen > MAX_WALK) break;
      const p = path.join(at, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        const m = await fs.stat(p).then((s) => s.mtimeMs, () => undefined);
        if (m !== undefined && (best === undefined || m > best)) best = m;
      }
    }
  }
  return best;
}

export const nodeAnalyzerExec: AnalyzerExec = {
  async run(argv, opts): Promise<ExecResult> {
    if (opts.signal?.aborted) return { started: true, exitCode: null, stdout: "", stderr: "", timedOut: true };
    const { file, args, env } = launch(argv, opts.env);
    // `runTree` (src/process/killTree.ts): on timeout, abort or overflow the WHOLE process tree is killed, not just the child.
    const r = await runTree(file, args, {
      cwd: opts.cwd, env, timeoutMs: opts.timeoutMs, maxBuffer: MAX_BUFFER,
      ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    if (!r.started) return { started: false, exitCode: null, stdout: "", stderr: "" };
    return {
      started: true, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr,
      ...(r.timedOut ? { timedOut: true } : {}), ...(r.overflow ? { overflow: true } : {}),
    };
  },
  which: (program) => whichOnPath(program),
  neutralCwd: () => tmpdir(),
  readText: (file) => fs.readFile(file, "utf8").catch(() => undefined),
  mtime: (file) => fs.stat(file).then((s) => s.mtimeMs, () => undefined),
  newestMtime: (dir) => newest(dir),
  async writeText(file, text) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, "utf8");
  },
  async tempDir() {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "bf-delta-"));
    return { path: dir.replace(/\\/g, "/"), dispose: () => fs.rm(dir, { recursive: true, force: true }) };
  },
};
