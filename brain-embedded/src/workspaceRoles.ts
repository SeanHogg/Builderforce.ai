/**
 * Which workspace roles may manage a project's settings — ONE answer for every surface
 * that gates controls on it (the Evermind console in VS Code and in Synapse). Mirrors the
 * API's `requireRole(MANAGER)`; a UX gate only — the controls disable, the API decides.
 */
const MANAGER_ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'manager']);

/** Whether a workspace role (any case) may manage the workspace's project settings. */
export function isManagerRole(role: string | null | undefined): boolean {
  return typeof role === 'string' && MANAGER_ROLES.has(role.toLowerCase());
}
