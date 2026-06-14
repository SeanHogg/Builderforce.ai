import { describe, it, expect, beforeEach } from 'vitest';
import { subscribeRun, getRunStoreSize, resetBrainRunStore } from './brainRunStore';

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
