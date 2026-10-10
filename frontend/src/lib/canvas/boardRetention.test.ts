import { describe, it, expect } from 'vitest';
import { RELEASE_IDLE_MS, boardsToRelease, type RetainedBoard } from './boardRetention';

const server = (sessionId: string): RetainedBoard => ({ sessionId, persistence: 'server' });
const local = (sessionId: string): RetainedBoard => ({ sessionId, persistence: 'local' });
const NOW = 100_000;
const IDLE = NOW - RELEASE_IDLE_MS;

describe('boardsToRelease', () => {
  it('keeps everything while the stage is within its cap', () => {
    const decision = boardsToRelease([server('a'), server('b')], { activeKey: 'server:b', leftAt: new Map([['server:a', 0]]), busy: {}, now: NOW, cap: 3 });
    expect(decision).toEqual({ release: [], recheckAt: null });
  });

  it('releases the least recently on stage first, only as many as the cap needs', () => {
    const opened = [server('a'), server('b'), server('c'), server('d')];
    const leftAt = new Map([['server:a', IDLE - 10], ['server:b', IDLE - 20], ['server:c', IDLE - 5]]);
    const decision = boardsToRelease(opened, { activeKey: 'server:d', leftAt, busy: {}, now: NOW, cap: 3 });
    expect(decision.release).toEqual(['server:b']);
  });

  it('never releases the board on stage, a busy board or a browser-held board', () => {
    const opened = [server('busy'), local('guest'), server('on-stage'), server('extra')];
    const leftAt = new Map([['server:busy', 0], ['local:guest', 0], ['server:extra', IDLE + 1]]);
    const decision = boardsToRelease(opened, { activeKey: 'server:on-stage', leftAt, busy: { busy: true }, now: NOW, cap: 2 });
    expect(decision.release).toEqual([]);
    // `extra` is the only candidate and is not idle yet: check back when it is.
    expect(decision.recheckAt).toBe(IDLE + 1 + RELEASE_IDLE_MS);
  });

  it('does not release a board that has just left the stage', () => {
    const opened = [server('a'), server('b')];
    const decision = boardsToRelease(opened, { activeKey: 'server:b', leftAt: new Map([['server:a', NOW - 100]]), busy: {}, now: NOW, cap: 1 });
    expect(decision.release).toEqual([]);
    expect(decision.recheckAt).toBe(NOW - 100 + RELEASE_IDLE_MS);
  });
});
