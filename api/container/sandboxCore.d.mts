/** Types for `sandboxCore.mjs` — lets the api's TypeScript tests drive the run sandbox. */

export interface WorkspaceClient {
  /** One request to the workspace helper (the only code that touches the working tree, run as the shell user). */
  call(req: Record<string, unknown>): Promise<Record<string, unknown> & { ok: boolean; error?: string }>;
  close(): void;
}

export interface SandboxBox {
  readonly spec: Record<string, unknown>;
  readonly workdir: string;
  readonly branch: string | null;
  readonly workspace: WorkspaceClient;
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
  /** The workspace helper script (`workspaceAgent.mjs`); required. */
  helperPath: string;
}): SandboxBox;

export function serveSandbox(box: SandboxBox, path: string, body: Record<string, unknown>, onAbort?: SandboxOnAbort): Promise<Record<string, unknown>>;

/** Kill every background job this box tracks, release the workspace helper and the mirror; `destroy` also deletes the workspace. */
export function closeSandboxBox(box: SandboxBox, opts?: { destroy?: boolean }): Promise<void>;

/** A fresh per-boot prefix for background job ids, so ids never alias across a restart. */
export function bootJobIdPrefix(): string;

/** The environment a model-run shell gets: an allowlist of `env` plus the names in `BUILDERFORCE_SHELL_ENV`. */
export function shellEnv(env?: Record<string, string | undefined>): Record<string, string | undefined>;

/** The unprivileged user model-run shells run as (`BUILDERFORCE_SHELL_USER`), or null ⇒ the server's own user. */
export function shellUser(env?: Record<string, string | undefined>): string | null;

/** The argv + env that start a model-run shell command: `sudo -n -u <user> env -i KEY=VAL… bash -lc …` with a shell user, plain `bash -lc` without. */
export function shellInvocation(
  command: string,
  opts?: { env?: Record<string, string | undefined>; user?: string | null; extraEnv?: Record<string, string> },
): { file: string; args: string[]; env: Record<string, string | undefined> };

/** THE spawn for every shell the model can influence (foreground, background job, preview server, workspace helper). */
export function spawnShell(
  command: string,
  opts?: { cwd?: string; stdio?: unknown; extraEnv?: Record<string, string>; env?: Record<string, string | undefined> },
): import('node:child_process').ChildProcess;

/** GitHub Actions: create the isolated shell user, hand it the checkout and prove the isolation; throws (fail closed). */
export function provisionShellUser(args: { user: string; workdir: string }): string;
/** Prove, as the shell user, that it cannot sudo, write the Docker socket or read the server's environ, and can write the workspace. Throws. */
export function verifyShellIsolation(args: { user: string; workdir: string; serverPid?: number; parentPid?: number; pathDirs?: string[] }): void;
/** Give the checkout back to the runner without its `.git`. */
export function releaseShellWorkspace(args: { workdir: string }): void;
/** Kill every process the shell user owns — only where `BUILDERFORCE_SHELL_SWEEP=1` (the Actions runner). */
export function sweepShellProcesses(): Promise<void>;

/** Where, and as whom, the server talks git to the Worker's container-git proxy; null when the spec names no remote. */
export function gitAuthOf(spec: Record<string, unknown>): { url: string; token: string | null } | null;

/** ONE git command in the private mirror: explicit minimal env (no `process.env` spread), no system/global config, hooks off, https only when authenticated. */
export function mirrorGitCommand(
  dir: string,
  args: string[],
  auth?: { url: string; token: string | null } | null,
  source?: Record<string, string | undefined>,
): { args: string[]; env: Record<string, string>; cwd: string };

/** Remove a persisted `actions/checkout` credential from the checkout's `.git/config` (an absent key is fine). */
export function scrubCheckoutCredentials(workdir: string): Promise<{ ok: boolean; output?: string }>;

/** Open the workspace from the mirror (bundle in, clone as the shell user). */
export function cloneWorkspace(box: SandboxBox): Promise<{ ok: boolean; branch: string | null; output: string }>;
/** Fast-forward the workspace to the run branch as the remote holds it. */
export function absorbHead(box: SandboxBox): Promise<boolean>;

/** The `git bundle create` argv for `branches`, excluding what the other side holds (`basis`: branch → sha). */
export function bundleCreateArgs(file: string, branches: string[], basis?: Record<string, string>): string[];

/** The fixed, root-owned directories privileged binaries are resolved from (never the inherited PATH). */
export const TRUSTED_PATH: string;
/** `name` as an absolute path in the trusted directories (git: also /usr/local/bin); resolved once. Bare name on Windows. */
export function trustedBinary(name: string, platform?: string): string;
/** Synchronous teardown for a signal handler: kill the shell user's processes, release the checkout. Returns a failure message or null; never throws. */
export function teardownShellSync(args: { user: string; workdir: string }): string | null;

/** Import `refs/heads/<head>` from a server-chosen bundle file into a mirror (`bundle verify` + `unbundle` + `update-ref`; no file transport). */
export function importBundle(m: { repo: string; privateDir: string }, file: string, head: string): Promise<{ ok: true; sha: string } | { ok: false; error: string }>;

/** The isolation probe's bash script and positional args. A parent pid of 0 or 1 (node as PID 1 in the container) skips the parent-environ check. */
export function isolationProbe(args: { workdir: string; serverPid: number; parentPid: number; pathDirs: string[] }): { script: string; args: string[] };
