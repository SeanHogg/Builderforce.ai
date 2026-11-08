/** Types for `sandboxCore.mjs` — lets the api's TypeScript tests drive the run sandbox. */

export interface SandboxBox {
  readonly spec: Record<string, unknown>;
  readonly workdir: string;
  readonly branch: string | null;
}

/** Registers `kill` with the transport (a cancel); returns the function that unregisters it. */
export type SandboxOnAbort = (kill: () => void) => (() => void) | void;

export function createSandboxBox(args: {
  spec: Record<string, unknown>;
  workdir: string;
  branch?: string | null;
  /** Put before every background job id (`<prefix>job-N`); transports pass a per-boot one. */
  jobIdPrefix?: string;
  emit?: (toolName: string, detail: unknown, result: string) => void;
}): SandboxBox;

export function serveSandbox(box: SandboxBox, path: string, body: Record<string, unknown>, onAbort?: SandboxOnAbort): Promise<Record<string, unknown>>;

/** Kill every background job the run left running. */
export function closeSandboxBox(box: SandboxBox): Promise<void>;

/** A fresh per-boot prefix for background job ids, so ids never alias across a restart. */
export function bootJobIdPrefix(): string;

/** The environment a model-run shell gets: `env` minus the credential variables (BUILDERFORCE_*, the Actions OIDC/runtime tokens). */
export function shellEnv(env?: Record<string, string | undefined>): Record<string, string | undefined>;

/** The unprivileged user model-run shells run as (`BUILDERFORCE_SHELL_USER`), or null ⇒ the server's own user. */
export function shellUser(env?: Record<string, string | undefined>): string | null;

/** The argv + env that start a model-run shell command: `sudo -n -u <user> env -i KEY=VAL… bash -lc …` with a shell user, plain `bash -lc` without. */
export function shellInvocation(
  command: string,
  opts?: { env?: Record<string, string | undefined>; user?: string | null; extraEnv?: Record<string, string> },
): { file: string; args: string[]; env: Record<string, string | undefined> };

/** THE spawn for every shell the model can influence (foreground, background job, preview server). */
export function spawnShell(
  command: string,
  opts?: { cwd?: string; stdio?: unknown; extraEnv?: Record<string, string>; env?: Record<string, string | undefined> },
): import('node:child_process').ChildProcess;

/** GitHub Actions: create the unprivileged shell user and open the checkout to its group; throws (fail closed) when it cannot. */
export function provisionShellUser(args: { user: string; workdir: string }): string;

/** Where, and as whom, the server talks git to the Worker's container-git proxy (credential-free URL + run token). */
export function gitAuthOf(spec: Record<string, unknown>): { url: string; token: string | null };

/** `git <args>` run by the server itself with the run token supplied for that one command only (never in a URL, on disk or in the shell's environ). */
export function runGit(args: string[], cwd: string, auth?: { url: string; token: string | null } | null): Promise<{ exitCode: number; output: string }>;

/** Remove a persisted `actions/checkout` credential from the checkout's `.git/config` (an absent key is fine). */
export function scrubCheckoutCredentials(workdir: string): Promise<{ ok: boolean; output?: string }>;
