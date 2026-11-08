import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ bumpBoardLiveRoster: vi.fn(async () => undefined) }));
vi.mock('../cache/boardLiveCache', () => ({ bumpBoardLiveRoster: mocks.bumpBoardLiveRoster }));

import { broadcastProjectChanged } from './broadcastRoom';

describe('broadcastProjectChanged', () => {
  beforeEach(() => mocks.bumpBoardLiveRoster.mockClear());

  it("orphans the project's cached board reads in the same seam that pushes the event", async () => {
    const env = {} as never;
    await broadcastProjectChanged(env, 4, 12);
    expect(mocks.bumpBoardLiveRoster).toHaveBeenCalledWith(env, 4, 12);
  });

  it('does nothing without a tenant or project', async () => {
    await broadcastProjectChanged({} as never, null, 12);
    await broadcastProjectChanged({} as never, 4, undefined);
    expect(mocks.bumpBoardLiveRoster).not.toHaveBeenCalled();
  });
});
