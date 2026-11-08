import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  findOrCreateBoard: vi.fn(),
  seedLaneStaffingFromWorkforce: vi.fn(),
  invalidateSwimlaneOrdinals: vi.fn(),
  invalidateBoardLanesCache: vi.fn(),
}));
vi.mock('../swimlane/findOrCreateBoard', () => ({ findOrCreateBoard: m.findOrCreateBoard }));
vi.mock('../swimlane/seedLaneStaffing', () => ({ seedLaneStaffingFromWorkforce: m.seedLaneStaffingFromWorkforce }));
vi.mock('../swimlane/laneOrdinals', () => ({ invalidateSwimlaneOrdinals: m.invalidateSwimlaneOrdinals }));
vi.mock('../swimlane/boardReads', () => ({ invalidateBoardLanesCache: m.invalidateBoardLanesCache }));
vi.mock('./templateEntitlement', async (orig) => ({
  ...(await orig<typeof import('./templateEntitlement')>()),
  assertTemplateEntitled: vi.fn().mockResolvedValue(undefined),
}));

import { KanbanTemplateService } from './kanbanTemplateService';
import type { Env } from '../../env';

/** A chainable Drizzle fake: every statement resolves to an empty result; `batch` records that it ran. */
function fakeDb() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const k of ['select', 'from', 'where', 'update', 'set', 'insert', 'values', 'delete']) chain[k] = self;
  chain.then = (resolve: (v: unknown[]) => unknown) => resolve([]);
  return Object.assign(chain, { batch: vi.fn().mockResolvedValue(undefined) });
}

describe('KanbanTemplateService.applyToProject - cache invalidation', () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
    m.findOrCreateBoard.mockResolvedValue({ board: { id: 'board-1', segmentId: null }, created: false });
    m.seedLaneStaffingFromWorkforce.mockResolvedValue({ staffed: 0 });
  });

  it('drops the project\'s tenant-keyed lane-routing / ordinal caches after the board flag is rewritten, and hands findOrCreateBoard the env', async () => {
    const env = {} as Env;
    const svc = new KanbanTemplateService(fakeDb() as never);

    await svc.applyToProject(env, 7, 42, 'standard-swe', 'Proj');

    expect(m.findOrCreateBoard).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: 7, projectId: 42, env }));
    expect(m.invalidateSwimlaneOrdinals).toHaveBeenCalledWith(env, 42, 7);
    expect(m.invalidateBoardLanesCache).toHaveBeenCalledWith(env, 7, 'board-1');
  });
});
