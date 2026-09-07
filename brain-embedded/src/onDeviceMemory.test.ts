import { describe, expect, it, vi } from 'vitest';
import {
  composeEvermindHooks,
  onDeviceMemoryHooks,
  ON_DEVICE_ANSWER_THRESHOLD,
  type OnDeviceAnswerStore,
} from './onDeviceMemory';

function store(hit?: { response: string; score: number }): OnDeviceAnswerStore & { stored: [string, string][] } {
  const stored: [string, string][] = [];
  return {
    stored,
    lookup: async () => hit,
    store: async (q, r) => { stored.push([q, r]); },
  };
}

describe('onDeviceMemoryHooks', () => {
  it('replays a near-identical question from the local store, as a cache hit', async () => {
    const hooks = onDeviceMemoryHooks(async () => store({ response: 'It is 42.', score: 0.99 }));
    const answer = await hooks.answer?.('what is the answer', { toolsAvailable: true });
    // `qa-cache`, not `evermind`: this tier replays, it never generates — the honest
    // provenance is what stops the timeline claiming a local model wrote the reply.
    expect(answer).toEqual({ text: 'It is 42.', source: 'qa-cache' });
  });

  it('refuses a merely SIMILAR question', async () => {
    // 0.93 would be a hit for the cost cache and is a wrong answer for a person.
    const hooks = onDeviceMemoryHooks(async () => store({ response: 'It is 42.', score: 0.93 }));
    expect(ON_DEVICE_ANSWER_THRESHOLD).toBeGreaterThan(0.93);
    await expect(hooks.answer?.('a different question', { toolsAvailable: true })).resolves.toBeNull();
  });

  it('answers nothing when the device cannot provide a store', async () => {
    const hooks = onDeviceMemoryHooks(async () => null);
    await expect(hooks.answer?.('anything', { toolsAvailable: false })).resolves.toBeNull();
    await expect(hooks.cacheAnswer?.('q', 'a')).resolves.toBeUndefined();
  });

  it('never lets a failing store fail the turn', async () => {
    const hooks = onDeviceMemoryHooks(async () => { throw new Error('WebGPU died'); });
    await expect(hooks.answer?.('anything', { toolsAvailable: false })).resolves.toBeNull();
  });
});

describe('composeEvermindHooks', () => {
  it('asks the nearest tier first and falls through to the next', async () => {
    const local = { answer: vi.fn(async () => null) };
    const server = { answer: vi.fn(async () => ({ text: 'from the server', source: 'qa-cache' as const })) };
    const hooks = composeEvermindHooks(local, server);
    await expect(hooks?.answer?.('q', { toolsAvailable: true })).resolves.toEqual({
      text: 'from the server',
      source: 'qa-cache',
    });
    expect(local.answer).toHaveBeenCalled();
  });

  it('stops at the first tier that answers', async () => {
    const local = { answer: async () => ({ text: 'local', source: 'qa-cache' as const }) };
    const server = { answer: vi.fn(async () => ({ text: 'server', source: 'qa-cache' as const })) };
    const hooks = composeEvermindHooks(local, server);
    await expect(hooks?.answer?.('q', { toolsAvailable: true })).resolves.toEqual({ text: 'local', source: 'qa-cache' });
    expect(server.answer).not.toHaveBeenCalled();
  });

  it('writes a remembered answer to EVERY tier, and one failure does not stop the others', async () => {
    const failing = { cacheAnswer: vi.fn(() => { throw new Error('nope'); }) };
    const working = { cacheAnswer: vi.fn() };
    composeEvermindHooks(failing, working)?.cacheAnswer?.('q', 'a');
    expect(failing.cacheAnswer).toHaveBeenCalledWith('q', 'a');
    expect(working.cacheAnswer).toHaveBeenCalledWith('q', 'a');
  });

  it('takes recall from the tier that has a corpus, and yields nothing when no tier does', async () => {
    const recall = vi.fn(async () => null);
    expect(composeEvermindHooks({ answer: async () => null }, { recall })?.recall).toBe(recall);
    expect(composeEvermindHooks(undefined, null)).toBeUndefined();
  });

  it('answers null through a compose with no answering tier at all', async () => {
    const hooks = composeEvermindHooks({ recall: async () => null });
    expect(hooks?.answer).toBeUndefined();
    await expect(hooks?.recall('q')).resolves.toBeNull();
  });
});
