/**
 * Board "live" read cache — reads the board refetches on every realtime push (ticket
 * owners, lane agents). ONE version token per (tenant, project); the token is bumped by
 * `broadcastProjectChanged`, the single seam EVERY project change event goes through
 * (task create/update/move, execution lifecycle, staffing and owner writes), so a read
 * can never outlive the change that the push announced.
 */
import type { Env } from '../../env';
import { getOrSetCached } from './readThroughCache';
import { bumpVersion, versionToken } from './versionToken';

export const boardLiveVersionKey = (tenantId: number | string, projectId: number | string): string =>
  `board-live:${tenantId}:${projectId}`;

/** Orphan every cached live read of the project. Best-effort; no-op without an Env. */
export function bumpBoardLiveRoster(
  env: Env | undefined,
  tenantId: number | string,
  projectId: number | string,
): Promise<void> {
  return bumpVersion(boardLiveVersionKey(tenantId, projectId), 'bumpBoardLiveRoster', env);
}

/** Read-through under the project's live token. Without an Env it goes to the loader. */
export async function readBoardLive<T>(
  env: Env | undefined,
  tenantId: number,
  projectId: number,
  suffix: string,
  load: () => Promise<T>,
): Promise<T> {
  if (!env) return load();
  const version = await versionToken(env, boardLiveVersionKey(tenantId, projectId));
  return getOrSetCached(env, `board-live:${tenantId}:${projectId}:${version}:${suffix}`, load);
}
