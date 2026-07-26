import { describe, it, expect, vi, beforeEach } from 'vitest';
import { coordinateTicket } from './coordinateTicket';
import { maybeAutoRunOnLaneEntry } from '../swimlane/laneEntryTrigger';
import { findCanonicalBoard } from '../swimlane/canonicalBoard';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RuntimeService } from '../runtime/RuntimeService';

/**
 * The HUMAN override, end to end in two links.
 *
 * "Dispatch reviewers" (`POST /api/kanban/tasks/:id/coordinate`, manager-gated) was inert
 * on exactly the tickets it exists for: a ticket whose last runs failed has its reviewer
 * dispatch refused by the failure breaker inside `dispatchCloudRunForTask`, so the click
 * reported `dispatched: false` and no reviewer could ever be asked. `force` now rides
 * from the route to the role dispatch — route → coordinateTicket → maybeAutoRunOnLaneEntry
 * → enforceLaneRequirements → requestRoleRun. Each link is a one-line pass-through, and a
 * one-line pass-through is exactly what silently disappears in a refactor.
 *
 * The gate's own use of the flag is covered by `requestRoleRun.test.ts` ("never forces the
 * dispatcher unless the caller asked for the override").
 */

vi.mock('../swimlane/laneEntryTrigger', () => ({ maybeAutoRunOnLaneEntry: vi.fn() }));
vi.mock('../swimlane/canonicalBoard', () => ({ findCanonicalBoard: vi.fn() }));
vi.mock('../kanban/ticketParticipants', () => ({
  TicketParticipantsService: class { async listParticipants() { return []; } },
}));

const mockLaneEntry = vi.mocked(maybeAutoRunOnLaneEntry);
const mockBoard = vi.mocked(findCanonicalBoard);

const env = {} as Env;
const runtime = {} as RuntimeService;

/** Minimal Drizzle stand-in: `select().from().where().limit()` resolves the task row. */
const dbWithTask = (row: { projectId: number; status: string }) => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
}) as unknown as Db;

beforeEach(() => {
  mockLaneEntry.mockReset();
  mockBoard.mockReset();
  mockLaneEntry.mockResolvedValue(false);
  // No canonical board ⇒ the lifecycle rewind and the stage-advance both no-op, leaving
  // the plain "drive the current lane" call this asserts on.
  mockBoard.mockResolvedValue(null as never);
});

describe('coordinateTicket → lane trigger', () => {
  it('passes the human override through when the caller forced the tick', async () => {
    await coordinateTicket(env, dbWithTask({ projectId: 11, status: 'requirements' }), runtime, {
      tenantId: 1, taskId: 169, force: true,
    });

    expect(mockLaneEntry).toHaveBeenCalledWith(env, expect.anything(), runtime, expect.objectContaining({
      taskId: 169, status: 'requirements', force: true,
    }));
  });

  /** Autonomous callers (the manager's coordinate remedy, the sign-off route) must not
   *  force — the breaker is what stops them re-asking a failing ticket forever. */
  it('does NOT force for an autonomous tick', async () => {
    await coordinateTicket(env, dbWithTask({ projectId: 11, status: 'requirements' }), runtime, {
      tenantId: 1, taskId: 169,
    });

    expect(mockLaneEntry.mock.calls[0]![3]).not.toHaveProperty('force');
  });
});
