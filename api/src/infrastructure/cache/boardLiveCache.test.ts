import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bumpVersion: vi.fn(async () => undefined),
  getOrSetCached: vi.fn(async (_e: unknown, _k: string, load: () => Promise<unknown>) => load()),
}));
vi.mock('./versionToken', () => ({ bumpVersion: mocks.bumpVersion, versionToken: async () => 'v3' }));
vi.mock('./readThroughCache', () => ({ getOrSetCached: mocks.getOrSetCached }));

import { bumpBoardLiveRoster, boardLiveVersionKey, readBoardLive } from './boardLiveCache';

describe('boardLiveCache', () => {
  beforeEach(() => { mocks.bumpVersion.mockClear(); mocks.getOrSetCached.mockClear(); });

  it('keys the read by tenant, project, token and suffix', async () => {
    const env = {} as never;
    await readBoardLive(env, 1, 9, 'owners:b1', async () => 'x');
    expect(mocks.getOrSetCached.mock.calls[0]?.[1]).toBe('board-live:1:9:v3:owners:b1');
  });

  it('goes straight to the loader without an Env', async () => {
    expect(await readBoardLive(undefined, 1, 9, 's', async () => 'y')).toBe('y');
    expect(mocks.getOrSetCached).not.toHaveBeenCalled();
  });

  it('bumps the project token', async () => {
    const env = {} as never;
    await bumpBoardLiveRoster(env, 1, 9);
    expect(mocks.bumpVersion).toHaveBeenCalledWith(boardLiveVersionKey(1, 9), 'bumpBoardLiveRoster', env);
  });
});
