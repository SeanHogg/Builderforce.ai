/** Types for `workspaceAgent.mjs` — the process that touches a run's working tree, as the shell user. */

export interface Workspace {
  /** Answer one request `{ op, ... }`; never throws. */
  handle(req: Record<string, unknown>): Promise<Record<string, unknown> & { ok: boolean; error?: string }>;
}

export function createWorkspace(workdir: string): Workspace;

/** Serve a workspace over newline-delimited JSON. */
export function serveWorkspace(workspace: Workspace, input: NodeJS.ReadableStream, output: NodeJS.WritableStream, onClose?: () => void): void;
