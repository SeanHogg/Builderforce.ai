/**
 * What identifies a workspace to the per-workspace registries — build diagnostics, the
 * workspace command bus and file-change events. A storage project id for a durable
 * workspace; a `local:` key for one held in this browser (`localFileStore.ts`).
 *
 * Its own module, with no imports, so the registries can key on it without pulling the
 * API client into everything that records a build failure.
 */

/** A local (browser-held) workspace's id. Never collides with a storage project id. */
export type LocalWorkspaceId = `local:${string}`;

export type WorkspaceId = number | LocalWorkspaceId;

/** True for an id a registry may key on: a positive storage project id or a `local:` key. */
export function isWorkspaceId(value: unknown): value is WorkspaceId {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0;
  return typeof value === 'string' && value.startsWith('local:') && value.length > 'local:'.length;
}
