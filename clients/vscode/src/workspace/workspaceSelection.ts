/**
 * The workspace (tenant) the editor currently acts in - a vscode-free leaf.
 *
 * `bfApi/session.ts` owns the selection and WRITES it here whenever the effective workspace
 * changes; gateway request code READS it. It exists so the gateway's auth headers can name
 * the workspace without importing the session module, which builds vscode event emitters at
 * import time and so cannot be loaded wherever the gateway helpers are (tests, headless runs).
 */
let current: number | undefined;

/** The workspace gateway calls name in `x-builderforce-workspace`; undefined = none known. */
export function getCurrentWorkspace(): number | undefined {
  return current;
}

/** Record the effective workspace. Written by `bfApi/session.ts` only. */
export function setCurrentWorkspace(tenantId: number | undefined): void {
  current = tenantId;
}
