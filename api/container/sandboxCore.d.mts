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
