import { describe, it, expect, beforeEach } from 'vitest';
import { subscribeRun, getRunStoreSize, resetBrainRunStore, windowed } from './brainRunStore';
import type { ChatCompletionMessage } from './streamChatCompletion';

// These tests pin the memory-eviction contract. They assume MAX_CELLS = 50
// (see brainRunStore.ts); update the literals if that cap changes.
const CAP = 50;

beforeEach(resetBrainRunStore);

describe('brainRunStore cell eviction', () => {
  it('evicts least-recently-used idle cells beyond the cap', () => {
    // Subscribe-then-immediately-unsubscribe leaves each cell idle (no listener,
    // not running) and thus evictable once the cap is exceeded.
    for (let i = 1; i <= CAP + 12; i++) {
      const unsub = subscribeRun(i, () => {});
      unsub();
    }
    expect(getRunStoreSize()).toBe(CAP);
  });

  it('never evicts a cell that still has an active subscriber, even past the cap', () => {
    // Keep every subscription live: no cell is idle, so none can be evicted and
    // the store is allowed to grow past the cap rather than drop live state.
    const unsubs: Array<() => void> = [];
    for (let i = 1; i <= CAP + 10; i++) unsubs.push(subscribeRun(i, () => {}));
    expect(getRunStoreSize()).toBe(CAP + 10);
    unsubs.forEach((u) => u());
  });

  it('keeps a re-touched idle chat and evicts an older one instead (LRU recency)', () => {
    // Fill to the cap with idle cells.
    for (let i = 1; i <= CAP; i++) subscribeRun(i, () => {})();
    // Re-touch chat 1 so it becomes most-recent; chat 2 is now the oldest idle.
    subscribeRun(1, () => {})();
    // One more new cell forces a single eviction — the oldest idle (chat 2).
    subscribeRun(CAP + 1, () => {})();
    expect(getRunStoreSize()).toBe(CAP);
  });
});

describe('windowed history (must begin with a user turn)', () => {
  const msg = (role: ChatCompletionMessage['role'], content = 'x'): ChatCompletionMessage => ({ role, content });

  it('keeps a normal short conversation intact', () => {
    const convo = [msg('user'), msg('assistant'), msg('user'), msg('assistant')];
    expect(windowed(convo)).toEqual(convo);
  });

  it('drops a leading orphaned tool result', () => {
    const convo = [msg('tool'), msg('user'), msg('assistant')];
    expect(windowed(convo)[0].role).toBe('user');
  });

  it('drops a leading assistant turn so the payload starts at a user turn (the googleai 400)', () => {
    // After a long tool-loop slid the user turn out of the last-N slice, the
    // window would otherwise start on an assistant tool-call turn — which Gemini
    // rejects with INVALID_ARGUMENT.
    const convo = [msg('assistant'), msg('tool'), msg('user'), msg('assistant'), msg('tool')];
    expect(windowed(convo)[0].role).toBe('user');
  });

  it('anchors to the last user turn when the window has none (tool loop > window)', () => {
    // 90 assistant/tool messages after a single user turn: the last-80 slice has
    // no user turn, so we fall back to the most recent user turn in the full
    // transcript rather than emit a user-less (invalid) request.
    const convo: ChatCompletionMessage[] = [msg('user', 'go')];
    for (let i = 0; i < 90; i++) convo.push(msg(i % 2 === 0 ? 'assistant' : 'tool'));
    const w = windowed(convo);
    expect(w[0].role).toBe('user');
    expect(w[0].content).toBe('go');
  });
});
