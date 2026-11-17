/**
 * The process runner the verifier's shell port uses. It returns the REAL process exit
 * code (never one parsed out of the model's own output) and applies the check's
 * wall-clock budget: a command that cannot finish is killed — its WHOLE process tree —
 * and reported exit 124 (`DID_NOT_FINISH`), which the evidence ledger records
 * "unavailable", never "pass" (OD-3).
 *
 * No shell strings: every command is an argument array (`Argv`), so a file path the
 * model named can never be expanded by a shell (`$(…)`, backticks, `%VAR%`, `!`).
 *
 * Windows: a package-manager shim (`pnpm`, `npm`, `yarn`, `npx`) is a `.cmd` batch file,
 * which cannot be spawned without a shell. It is launched through `cmd.exe /d /v:off /s /c`
 * with every argument quoted — and an argument cmd could still expand inside quotes
 * (`%`, `"`, a line break) is refused before anything starts. Every other program
 * (`node` — resolved to an absolute console node — and `git`) is spawned directly, no shell.
 *
 * Output is capped, not ignored: a ring buffer per stream keeps the last ~2 KB of stdout
 * and of stderr, combined into one ~2 KB tail ({@link combineOutputTail}) that never lets
 * one stream crowd out the other, and the shell hands the tail to the CALLER (a failing check record
 * carries it, so a refusal can quote why the check failed — never just "exit 1").
 * Pass records need no tail: the caller records it only on a fail. The cap is a ring
 * buffer, never unbounded: a verbose check can never overflow memory or be misreported.
 */

import { execFile, spawn } from "child_process";
import { existsSync, readFileSync, realpathSync } from "fs";
import { createRequire } from "module";
import * as path from "path";
import { anyNodePath, consoleNodePath, needsRunAsNode } from "../process/consoleNode";
import { killTree } from "../process/killTree";
import { whichOnPathCached } from "../process/programSearch";

/** One command: the program and its arguments, never joined into a shell string. */
export type Argv = readonly string[];

/** What ran: the REAL exit code, plus the last of the output — on a fail, why it failed. */
export interface Runner {
  (argv: Argv, options: { cwd: string; timeout?: number }): Promise<{ exitCode?: number; tail?: string }>;
}

export interface ExecResult {
  exitCode?: number;
  tail?: string;
}

/** The conventional exit code of a command stopped by its time limit. */
export const DID_NOT_FINISH = 124;

/** The most combined output kept on a check: a bounded ring, never unbounded. */
export const OUTPUT_TAIL_LIMIT = 2048;

/**
 * The combined tail of a run, at most `limit` chars: the end of stdout followed by the end of
 * stderr. When both overflow, each keeps half; budget one stream does not use goes to the
 * other — so stderr is never crowded out by a verbose stdout, nor stdout by a verbose stderr.
 */
export function combineOutputTail(stdout: string, stderr: string, limit: number = OUTPUT_TAIL_LIMIT): string {
  const errKeep = Math.min(stderr.length, Math.max(Math.floor(limit / 2), limit - stdout.length));
  const outKeep = Math.min(stdout.length, limit - errKeep);
  return stdout.slice(stdout.length - outKeep) + stderr.slice(stderr.length - errKeep);
}

/** The package-manager shims that are `.cmd` batch files on Windows. */
const WINDOWS_SHIMS = new Set(["pnpm", "npm", "yarn", "npx"]);

/** An argument cmd.exe would still expand or split inside double quotes. */
const CMD_UNSAFE = /["%\r\n\0]/;

/** The npm CLI entry a shim runs. */
type NpmCli = "npx-cli.js" | "npm-cli.js";

/**
 * The absolute path to the npm CLI entry a shim would run — `npx-cli.js` / `npm-cli.js` —
 * resolved from the package that owns the command's cwd (its `node_modules`), so the
 * pnpm-managed `npm` dep is found even when it is not linked at the workspace root.
 *
 * `pnpm` never links `npm` into a package's `node_modules`, so the cwd `createRequire`
 * usually resolves nothing for `npm/bin/…` (it does for the runner, e.g. `vitest`, but not
 * for `npm`). When that lookup misses we fall through to the npm that sits beside the console
 * `node` executable `nodePath` (the plan's resolved node — never `Code.exe`'s folder, which has no npm). That
 * `<node-dir>/node_modules/npm/bin` layout holds for the official Windows installer and nvm-windows;
 * a shim-based install (Chocolatey, Scoop, Volta) puts a shim on PATH rather than node itself, so
 * there the lookup misses and the cmd shim is tried instead. Without this the verifier's `npx`/`npm` checks
 * fell through to the `.cmd` shim, which cannot resolve its own location and died with
 * `Cannot find module …/npm/bin/npx-cli.js` (exit 1) on every pre-push test check.
 */
function resolveNpmCli(cwd: string, cli: NpmCli, nodePath: string): string | null {
  // A resolved entry can be a SYMLINK into pnpm's store (`node_modules/.pnpm/<pkg>@<ver>/…`).
  // The CLI's first statement is `require('./npm-prefix.js')`, resolved relative to the entry's
  // OWN REAL DIRECTORY — so the prefix module must exist at the entry's realpath, not beside the
  // symlink. A partial store package can ship `npx-cli.js` without `npm-prefix.js`: validating
  // beside the symlink accepts it, then `node <entry>` dies with `Cannot find module
  // …/npm/bin/npm-prefix.js` (exit 1, no findings). Resolve the realpath first and validate —
  // and SPAWN — that, so the target always loads.
  const entryLoads = (p: string): string | null => {
    // A partial store package can be missing the CLI entry itself, not just its sibling
    // `npm-prefix.js`: `existsSync` on the realpath catches that (a dangling symlink realpaths
    // to nothing), so a broken local `npm` never wins over the complete global one below.
    let real: string;
    try {
      real = realpathSync(p);
    } catch {
      return null;
    }
    return existsSync(real) && existsSync(path.join(path.dirname(real), "npm-prefix.js")) ? real : null;
  };
  const tryResolve = (fromDir: string): string | null => {
    // A modern `npm` (≥11) ships an `exports` map that blocks `createRequire().resolve('npm/bin/…')`
    // with ERR_PACKAGE_PATH_NOT_EXPORTED, so a package-managed npm the dep resolver could not
    // subpath-resolve was silently skipped and the check fell through to the cmd shim. Resolve
    // the entry by EXPLICIT realpath from the owning package instead, which never consults exports.
    try {
      return entryLoads(path.join(fromDir, "node_modules", "npm", "bin", cli));
    } catch {
      return null; // not resolvable from here — try the next source
    }
  };
  // 1. A package-managed `npm` dep first (its own node_modules), else the install that owns
  //    the running node. Both the cwd and its realpath: pnpm's isolated `node-linker` keeps the
  //    real package under `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>`, so a bare cwd
  //    resolves nothing while the realpath does.
  let realCwd: string;
  try {
    realCwd = realpathSync(cwd);
  } catch {
    realCwd = cwd;
  }
  return tryResolve(cwd) ?? (realCwd === cwd ? null : tryResolve(realCwd))
    // 2. The npm that sits beside the console node — `<node-dir>/node_modules/npm/bin`.
    ?? entryLoads(path.join(path.dirname(nodePath), "node_modules", "npm", "bin", cli));
}

/**
 * The owning package's OWN bin for the `npx --no-install <pkg>` shape, resolved from the cwd's
 * own node_modules upward. Node's walk-up rule applies: a directory that does not actually
 * contain the package is SKIPPED — so a stale, cache-only ancestor `node_modules` (one that
 * holds only `.vite`/`.vitest-cache`) cannot shadow the owning package's install.
 *
 * Why this exists: the verifier's targeted-test tier runs `npx --no-install vitest …`. Spawning
 * the resolved `npx-cli.js` (a pnpm-store npm) lets THAT npx walk up from the cwd and stop at
 * such a stale ancestor, synthesizing `<ancestor>/<pkg>/<bin>.mjs` — `Cannot find module` on
 * every pre-push test check. Resolving the bin here pins the runner to the owning package, and
 * spawning it under node directly keeps the launch shell-free.
 *
 * The package.json is read directly (never through an `exports` map, which can block
 * subpath resolution), and the realpath of the store-symlinked package dir is used, mirroring
 * {@link resolveNpmCli}'s symlink handling. Any failure resolves null — the caller falls back
 * to the npx-cli path.
 */
const PACKAGE_NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

function resolvePackageBin(cwd: string, pkg: string): string | null {
  if (!PACKAGE_NAME_RE.test(pkg)) return null;
  // Only an ABSOLUTE cwd may seed the walk-up: a relative one resolves against whatever
  // directory the process happens to run in, so a synthetic/foreign path (a Windows "C:\r"
  // evaluated on a POSIX host, where it is one relative directory name) would walk up INTO
  // THE REAL CWD and find that machine's own node_modules — resolving the caller's test
  // double to an unrelated real binary. Production callers always pass an absolute workspace
  // root; anything else falls through to the npx-cli path.
  if (!path.isAbsolute(cwd)) return null;
  let dir = cwd;
  for (let i = 0; i < 32; i += 1) {
    const candidate = path.join(dir, "node_modules", pkg, "package.json");
    if (existsSync(candidate)) {
      try {
        const real = realpathSync(candidate);
        const bin = (JSON.parse(readFileSync(real, "utf8")) as { bin?: string | Record<string, string> }).bin;
        const rel = typeof bin === "string" ? bin : bin?.[pkg] ?? (bin && Object.keys(bin).length === 1 ? Object.values(bin)[0] : undefined);
        if (!rel) return null;
        const abs = path.join(path.dirname(real), rel);
        return existsSync(abs) ? abs : null;
      } catch {
        return null; // unreadable or malformed: the caller falls back to the npx-cli path
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * The spawn plan for one argv on this platform, or null when it cannot be launched safely.
 * Windows: a package-manager shim is a `.cmd` batch file, which cannot be spawned without a
 * shell — EXCEPT `npx`/`npm`, which under `cmd.exe /d /v:off /s /c` with verbatim quoting
 * mis-resolve their own location and die with `Cannot find module …/npm/bin/npx-cli.js`
 * (exit 1, no findings). They are spawned directly instead: the console `node` executable
 * ({@link consoleNodePath} — never the GUI-subsystem `Code.exe`, whose console-less children
 * would open visible windows for npx's own `cmd.exe /c vitest …`) plus the resolved CLI entry,
 * no shell. The node is resolved ONCE per plan and handed to `resolveCli`, so the "npm beside
 * node" lookup uses the same node the plan launches.
 *
 * Windows, no hijack: a program spawned by bare name is searched by libuv in the cwd — the
 * verified repository — BEFORE PATH, so a planted `node.exe` / `git.exe` there would run. A bare
 * `node` is therefore ANY node found on PATH ({@link anyNodePath} — no version floor, that guards
 * only our npx/npm CLIs), and every other non-shim bare name (`git`, …) is resolved to an absolute
 * path on PATH ({@link whichOnPathCached}: PATH only, never `.` or a relative entry); only when it
 * is not found there does the bare name go through unchanged. The cmd shim runs through the
 * absolute system shell ({@link systemCmdPath}) with {@link spawnEnvFor}'s
 * `NoDefaultCurrentDirectoryInExePath`. Off Windows every program keeps its name. `resolveCli`,
 * `nodePath`, `which`, `cmdPath` and `anyNode` are injectable for tests.
 */
export function launchPlan(
  argv: Argv,
  platform: NodeJS.Platform = process.platform,
  cwd?: string,
  resolveCli: (cwd: string, cli: NpmCli, nodePath: string) => string | null = resolveNpmCli,
  nodePath: () => string = consoleNodePath,
  which: (program: string) => string | undefined = whichOnPathCached,
  cmdPath: () => string = () => systemCmdPath(),
  anyNode: () => string = anyNodePath,
): { file: string; args: string[]; verbatim: boolean } | null {
  const [program, ...args] = argv;
  if (!program) return null;
  if (platform !== "win32") return { file: program, args: [...args], verbatim: false };
  const name = program.toLowerCase();
  if (name === "node") return { file: anyNode(), args: [...args], verbatim: false };
  if (!WINDOWS_SHIMS.has(name)) return { file: which(program) ?? program, args: [...args], verbatim: false };
  if (name === "npx" || name === "npm") {
    const node = nodePath();
    // `npx --no-install <pkg> …`: spawn the pkg's OWN bin under node, pinned to the owning
    // package's node_modules — a stale ancestor cache dir must not shadow the resolution.
    if (name === "npx" && args[0] === "--no-install") {
      const bin = resolvePackageBin(cwd ?? process.cwd(), args[1] ?? "");
      if (bin) return { file: node, args: [bin, ...args.slice(2)], verbatim: false };
    }
    const cli = resolveCli(cwd ?? process.cwd(), name === "npx" ? "npx-cli.js" : "npm-cli.js", node);
    if (cli) return { file: node, args: [cli, ...args], verbatim: false };
    // The CLI could not be resolved: fall through to the cmd shim (may still work when the
    // shim's own directory resolution succeeds).
  }
  if ([program, ...args].some((a) => CMD_UNSAFE.test(a))) return null;
  const line = [`${program}.cmd`, ...args].map((a) => `"${a}"`).join(" ");
  return { file: cmdPath(), args: ["/d", "/v:off", "/s", "/c", `"${line}"`], verbatim: true };
}

/**
 * The absolute system shell for the cmd-shim plan — never a bare `cmd.exe`, which libuv would search
 * for in the cwd (the verified repository) first. `ComSpec` when it is an absolute drive/UNC path ending
 * in `\cmd.exe`; otherwise `<SystemRoot>\System32\cmd.exe` (SystemRoot defaulting to `C:\Windows`).
 */
export function systemCmdPath(env: NodeJS.ProcessEnv = process.env): string {
  const comSpec = env.ComSpec ?? env.COMSPEC;
  if (comSpec && /^([a-z]:\\|\\\\)/i.test(comSpec) && /\\cmd\.exe$/i.test(comSpec)) return comSpec;
  return path.win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows", "System32", "cmd.exe");
}

/**
 * The spawn environment for a plan; undefined = inherit unchanged. The cmd-shim plan (the only verbatim
 * one) gets `NoDefaultCurrentDirectoryInExePath=1`, so cmd.exe never resolves `pnpm.cmd` & co. from the
 * verified repository's cwd. The host's own non-node executable (the last-resort node) gets
 * `ELECTRON_RUN_AS_NODE=1`, so it runs as Node instead of opening an editor window.
 */
export function spawnEnvFor(
  plan: { file: string; verbatim: boolean },
  base: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv | undefined {
  if (plan.verbatim) return { ...base, NoDefaultCurrentDirectoryInExePath: "1" };
  if (needsRunAsNode(plan.file, execPath, platform)) return { ...base, ELECTRON_RUN_AS_NODE: "1" };
  return undefined;
}

/** The real process runner: honours the timeout (killing the tree), reports the honest exit code. */
export const execRunner: Runner = (argv, options) =>
  new Promise((resolve) => {
    const plan = launchPlan(argv, process.platform, options.cwd);
    // Refused before launch (an argument cmd would expand): nothing ran, so nothing is claimed.
    if (!plan) return resolve({ exitCode: DID_NOT_FINISH });
    let settled = false;
    const settle = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // The tail rides every result; the CALLER records it on a failing check only.
      const tail = combineOutputTail(stdoutTail, stderrTail);
      resolve({ exitCode, tail: tail.trim() ? tail : undefined });
    };
    let child: ReturnType<typeof spawn>;
    // A bounded ring PER STREAM of the last OUTPUT_TAIL_LIMIT chars: kept only so a FAILING
    // check can say WHY — the slice (not the accumulation) is stored, so memory is flat no
    // matter how verbose the command. Per stream, not one interleaved ring: stdout and stderr
    // are independent pipes whose data events arrive in no fixed order, so a single ring let
    // late stdout chunks push the stderr (usually the reason) out of the tail entirely.
    let stdoutTail = "";
    let stderrTail = "";
    const env = spawnEnvFor(plan);
    try {
      child = spawn(plan.file, plan.args, {
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
        windowsVerbatimArguments: plan.verbatim,
        detached: process.platform !== "win32",
        ...(env ? { env } : {}),
      });
    } catch {
      return resolve({ exitCode: 1, tail: "" }); // failed to start — non-zero, and never a pass
    }
    child.stdout?.on("data", (chunk: unknown) => {
      stdoutTail = (stdoutTail + String(chunk)).slice(-OUTPUT_TAIL_LIMIT);
    });
    child.stderr?.on("data", (chunk: unknown) => {
      stderrTail = (stderrTail + String(chunk)).slice(-OUTPUT_TAIL_LIMIT);
    });
    const timer = options.timeout
      ? setTimeout(() => {
          // Kill the process and everything it started (cmd.exe → pnpm → tsc); never started: nothing to kill.
          if (child.pid !== undefined) killTree(child.pid);
          // Stopped by its time limit: "unavailable", never a fail or a pass. Resolved now —
          // never left waiting on a grandchild that outlives the kill.
          settle(DID_NOT_FINISH);
        }, options.timeout)
      : undefined;
    child.on("error", () => settle(1));
    // Settle on "close", not "exit": "exit" fires the instant the process dies, but the
    // piped stdio can still hold undrained output — settling there drops the trailing
    // bytes from the tail (a large-output check that ends on stderr lost its last chunk
    // on POSIX timing, where the final data events land after "exit"). "close" fires only
    // when the streams are drained, so the ring buffer is complete. The timeout path
    // settles directly and is unaffected.
    child.on("close", (code) => settle(typeof code === "number" ? code : 1));
  });

/** git's own budget per plumbing query. */
const GIT_TIMEOUT_MS = 30_000;

/**
 * The host's git for the GitPort: `execFile` (no shell, no quoting surface — `git.exe` is a
 * real executable on Windows, not a `.cmd` shim), stdout plus the real exit code. On Windows
 * git is resolved to an absolute path on PATH first (libuv would search the cwd — the
 * repository — before PATH); the bare name only when it is not found there. A remembered path
 * that has since vanished (ENOENT) is forgotten and the query retried ONCE with a fresh lookup.
 */
export const gitRunner = (args: readonly string[], opts: { cwd: string }): Promise<{ stdout: string; exitCode: number }> =>
  new Promise((resolve) => {
    const run = (retried: boolean): void => {
      const git = process.platform === "win32" ? whichOnPathCached("git") ?? "git" : "git";
      execFile(git, ["--no-optional-locks", ...args], { cwd: opts.cwd, windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
        const code = (error as { code?: unknown } | null)?.code;
        if (code === "ENOENT" && git !== "git" && !retried) {
          whichOnPathCached.invalidate("git");
          return run(true);
        }
        resolve({ stdout: String(stdout ?? ""), exitCode: !error ? 0 : typeof code === "number" ? code : 1 });
      });
    };
    run(false);
  });
