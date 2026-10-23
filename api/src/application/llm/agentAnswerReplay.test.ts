import { beforeEach, describe, expect, it, vi } from 'vitest';
import { replayAgentAnswer } from './agentAnswerReplay';

const doubles = vi.hoisted(() => ({
  resolve: vi.fn(),
  useActual: false,
}));

vi.mock('./projectMemory', async () => {
  const actual = await vi.importActual<typeof import('./projectMemory')>('./projectMemory');
  return {
    ...actual,
    resolveMemoryAnswer: (...args: Parameters<typeof actual.resolveMemoryAnswer>) =>
      doubles.useActual ? actual.resolveMemoryAnswer(...args) : doubles.resolve(...args),
  };
});

const env = {};
const db = {};
const base = { tenantId: 7, projectId: 42, principal: { userId: 5, agentHostId: null }, question: 'what does resolveMembership return?' };

beforeEach(() => {
  doubles.resolve.mockReset();
  doubles.useActual = false;
});

describe('replayAgentAnswer (B4)', () => {
  it('replays a Q&A-cache hit as a memory answer', async () => {
    doubles.resolve.mockResolvedValueOnce({ text: ' The membership row, or null. ', source: 'qa-cache' });
    expect(await replayAgentAnswer(env, db, base)).toEqual({ answer: ' The membership row, or null. ', source: 'memory' });
  });

  it('scopes the lookup to the principal and bars the tool-less Evermind leg', async () => {
    doubles.resolve.mockResolvedValueOnce(null);
    await replayAgentAnswer(env, db, { ...base, principal: { userId: 5, agentHostId: 'h1', role: 'admin' } });
    const [, , tenantId, projectId, question, deps] = doubles.resolve.mock.calls[0]!;
    expect([tenantId, projectId, question]).toEqual([7, 42, base.question]);
    expect(deps).toEqual({ toolsAvailable: true, principal: { userId: '5', agentHostId: 'h1', role: 'admin' } });
  });

  it('never replays an Evermind answer', async () => {
    doubles.resolve.mockResolvedValueOnce({ text: 'from weights', source: 'evermind', evermindVersion: 3 });
    expect(await replayAgentAnswer(env, db, base)).toBeNull();
  });

  it('is null with no project or an empty question, without touching memory', async () => {
    expect(await replayAgentAnswer(env, db, { ...base, projectId: null })).toBeNull();
    expect(await replayAgentAnswer(env, db, { ...base, projectId: 0 })).toBeNull();
    expect(await replayAgentAnswer(env, db, { ...base, question: '   ' })).toBeNull();
    expect(doubles.resolve).not.toHaveBeenCalled();
  });

  it('swallows nothing silently: a failure is logged and read as a miss', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    doubles.resolve.mockRejectedValueOnce(new Error('db down'));
    expect(await replayAgentAnswer(env, db, base)).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('refuses a work order through the real memory-first gate', async () => {
    doubles.useActual = true;
    // memoryReplayable bars it before any read, so an empty db double is enough.
    expect(await replayAgentAnswer(env, db, { ...base, question: 'reduce the height of the box' })).toBeNull();
  });
});
