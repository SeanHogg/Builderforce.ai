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
 * (`node`, `git`) is spawned directly, no shell.
 *
 * Output is capped, not ignored: a ring buffer keeps the last ~2 KB of combined
 * stdout/stderr, and the shell hands the tail to the CALLER (a failing check record
 * carries it, so a refusal can quote why the check failed — never just "exit 1").
 * Pass records need no tail: the caller records it only on a fail. The cap is a ring
 * buffer, never unbounded: a verbose check can never overflow memory or be misreported.
 */

import { execFile, spawn } from "child_process";
import { existsSync } from "fs";
import { createRequire } from "module";
import * as path from "path";
import { killTree } from "../process/killTree";

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

/** The package-manager shims that are `.cmd` batch files on Windows. */
const WINDOWS_SHIMS = new Set(["pnpm", "npm", "yarn", "npx"]);

/** An argument cmd.exe would still expand or split inside double quotes. */
const CMD_UNSAFE = /["%\r\n\0]/;

/**
 * The absolute path to the npm CLI entry a shim would run — `npx-cli.js` / `npm-cli.js` —
 * resolved from the package that owns the command's cwd (its `node_modules`), so the
 * pnpm-managed `npm` dep is found even when it is not linked at the workspace root.
 */
function resolveNpmCli(cwd: string, cli: "npx-cli.js" | "npm-cli.js"): string | null {
  // A package-managed `npm` dep first (its own node_modules), else the install that owns
  // the running node — the npm CLI entry sits in `<node-dir>/node_modules/npm/bin`.
  try {
    const p = createRequire(path.join(cwd, "package.json")).resolve(`npm/bin/${cli}`);
    if (existsSync(p)) return p;
  } catch {
    /* fall through to the node's own npm */
  }
  const alongsideNode = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", cli);
  return existsSync(alongsideNode) ? alongsideNode : null;
}

/**
 * The spawn plan for one argv on this platform, or null when it cannot be launched safely.
 * Windows: a package-manager shim is a `.cmd` batch file, which cannot be spawned without a
 * shell — EXCEPT `npx`/`npm`, which under `cmd.exe /d /v:off /s /c` with verbatim quoting
 * mis-resolve their own location and die with `Cannot find module …/npm/bin/npx-cli.js`
 * (exit 1, no findings). They are spawned directly instead: the `node` executable plus the
 * resolved CLI entry, no shell. Every non-shim program (`node`, `git`) keeps its name and
 * is spawned directly too. `resolveCli` is injectable for tests; it defaults to {@link resolveNpmCli}.
 */
export function launchPlan(
  argv: Argv,
  platform: NodeJS.Platform = process.platform,
  cwd?: string,
  resolveCli: (cwd: string, cli: "npx-cli.js" | "npm-cli.js") => string | null = resolveNpmCli,
): { file: string; args: string[]; verbatim: boolean } | null {
  const [program, ...args] = argv;
  if (!program) return null;
  if (platform !== "win32" || !WINDOWS_SHIMS.has(program.toLowerCase())) return { file: program, args: [...args], verbatim: false };
  const shim = program.toLowerCase();
  if (shim === "npx" || shim === "npm") {
    const cli = resolveCli(cwd ?? process.cwd(), shim === "npx" ? "npx-cli.js" : "npm-cli.js");
    if (cli) return { file: process.execPath, args: [cli, ...args], verbatim: false };
    // The CLI could not be resolved: fall through to the cmd shim (may still work when the
    // shim's own directory resolution succeeds).
  }
  if ([program, ...args].some((a) => CMD_UNSAFE.test(a))) return null;
  const line = [`${program}.cmd`, ...args].map((a) => `"${a}"`).join(" ");
  return { file: "cmd.exe", args: ["/d", "/v:off", "/s", "/c", `"${line}"`], verbatim: true };
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
      resolve({ exitCode, tail: tail.trim() ? tail : undefined });
    };
    let child: ReturnType<typeof spawn>;
    // A bounded ring of the last OUTPUT_TAIL_LIMIT chars of combined stdout+stderr:
    // kept only so a FAILING check can say WHY — the slice (not the accumulation) is
    // stored, so memory is flat no matter how verbose the command.
    let tail = "";
    try {
      child = spawn(plan.file, plan.args, {
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
        windowsVerbatimArguments: plan.verbatim,
        detached: process.platform !== "win32",
      });
    } catch {
      return resolve({ exitCode: 1, tail: "" }); // failed to start — non-zero, and never a pass
    }
    const onData = (chunk: unknown): void => {
      tail = (tail + String(chunk)).slice(-OUTPUT_TAIL_LIMIT);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
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
    child.on("exit", (code) => settle(typeof code === "number" ? code : 1));
  });

/** git's own budget per plumbing query. */
const GIT_TIMEOUT_MS = 30_000;

/**
 * The host's git for the GitPort: `execFile` (no shell, no quoting surface — `git.exe` is a
 * real executable on Windows, not a `.cmd` shim), stdout plus the real exit code.
 */
export const gitRunner = (args: readonly string[], opts: { cwd: string }): Promise<{ stdout: string; exitCode: number }> =>
  new Promise((resolve) => {
    execFile("git", ["--no-optional-locks", ...args], { cwd: opts.cwd, windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      const code = (error as { code?: unknown } | null)?.code;
      resolve({ stdout: String(stdout ?? ""), exitCode: !error ? 0 : typeof code === "number" ? code : 1 });
    });
  });
