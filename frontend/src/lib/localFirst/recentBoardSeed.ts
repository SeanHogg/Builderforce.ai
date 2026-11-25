/**
 * Composition for recent-board seeding: the workspace's most recent boards, read over REST and put in
 * the device's replica (`domains/canvas/application/seedRecentBoards.ts` owns the rule).
 */

import { seedRecentBoards, RECENT_BOARD_SEED_LIMIT, type SeedRecentBoardsResult } from '@/domains/canvas/application/seedRecentBoards';
import { seedBoardFromSource } from '@/domains/canvas/infrastructure/localFirst/boardOpen';
import { listBoards } from '@/domains/canvas/infrastructure/localFirst/boardReplica';
import { createRestBoardSource } from '@/domains/canvas/infrastructure/localFirst/restBoardSource';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { reportLocalFirstFailure } from './reportLocalFirstFailure';
import { getStudioRuntime, studioDestination } from './studioRuntime';

/** Seed the signed-in workspace's recent boards. A guest, or a device with no durable store, seeds nothing. */
export async function seedRecentWorkspaceBoards(): Promise<SeedRecentBoardsResult> {
  const destination = studioDestination();
  const runtime = await getStudioRuntime();
  if (destination.kind !== 'bound' || !runtime) return { seeded: 0, failed: 0 };
  const source = createRestBoardSource();
  return seedRecentBoards({
    list: async () => (await creationSessionsApi.list('active', null, { offset: 0, limit: RECENT_BOARD_SEED_LIMIT })).sessions,
    heldIds: async () => new Set((await listBoards(runtime.store)).map((board) => board.boardId)),
    seed: (boardId) => seedBoardFromSource({ store: runtime.store, destination, source }, boardId),
    report: reportLocalFirstFailure,
  }).catch((error: unknown) => {
    // The list or the held-board read failed (offline, outage): reported, and the next sign-in tries again.
    reportLocalFirstFailure('seedRecentWorkspaceBoards', error);
    return { seeded: 0, failed: 0 };
  });
}
