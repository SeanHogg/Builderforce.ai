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
 * Output is not captured (`stdio: "ignore"`): the records carry the exit code, and a
 * verbose check can never overflow a buffer and be misreported.
 */

import { execFile, spawn } from "child_process";

/** One command: the program and its arguments, never joined into a shell string. */
export type Argv = readonly string[];

export interface Runner {
  (argv: Argv, options: { cwd: string; timeout?: number }): Promise<{ exitCode?: number }>;
}

export interface ExecResult {
  exitCode?: number;
}

/** The conventional exit code of a command stopped by its time limit. */
export const DID_NOT_FINISH = 124;

/** The package-manager shims that are `.cmd` batch files on Windows. */
const WINDOWS_SHIMS = new Set(["pnpm", "npm", "yarn", "npx"]);

/** An argument cmd.exe would still expand or split inside double quotes. */
const CMD_UNSAFE = /["%\r\n\0]/;

/**
 * The spawn plan for one argv on this platform, or null when it cannot be launched safely.
 * Windows: ONLY a package-manager shim goes through `cmd.exe` as `<name>.cmd`; every other
 * program keeps its name and is spawned directly (`node` stays `node` — `node.cmd` does not exist).
 */
export function launchPlan(argv: Argv, platform: NodeJS.Platform = process.platform): { file: string; args: string[]; verbatim: boolean } | null {
  const [program, ...args] = argv;
  if (!program) return null;
  if (platform !== "win32" || !WINDOWS_SHIMS.has(program.toLowerCase())) return { file: program, args: [...args], verbatim: false };
  if ([program, ...args].some((a) => CMD_UNSAFE.test(a))) return null;
  const line = [`${program}.cmd`, ...args].map((a) => `"${a}"`).join(" ");
  return { file: "cmd.exe", args: ["/d", "/v:off", "/s", "/c", `"${line}"`], verbatim: true };
}

/** Kill the process and everything it started (cmd.exe → pnpm → tsc). */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => undefined);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL"); // the detached child leads its own process group
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** The real process runner: honours the timeout (killing the tree), reports the honest exit code. */
export const execRunner: Runner = (argv, options) =>
  new Promise((resolve) => {
    const plan = launchPlan(argv);
    // Refused before launch (an argument cmd would expand): nothing ran, so nothing is claimed.
    if (!plan) return resolve({ exitCode: DID_NOT_FINISH });
    let settled = false;
    const settle = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ exitCode });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(plan.file, plan.args, {
        cwd: options.cwd,
        stdio: "ignore",
        windowsHide: true,
        shell: false,
        windowsVerbatimArguments: plan.verbatim,
        detached: process.platform !== "win32",
      });
    } catch {
      return resolve({ exitCode: 1 }); // failed to start — non-zero, and never a pass
    }
    const timer = options.timeout
      ? setTimeout(() => {
          killTree(child.pid);
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
