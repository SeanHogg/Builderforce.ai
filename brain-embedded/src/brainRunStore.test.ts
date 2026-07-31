import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  subscribeRun,
  subscribeRunStore,
  getGlobalRunState,
  getRunStoreSize,
  resetBrainRunStore,
  windowed,
  compactTailStart,
  compactMiddleRange,
  assembleCompacted,
  pinnedDirectiveIndex,
  COMPACT_TAIL_TURNS,
} from './brainRunStore';
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

describe('cross-chat run state (the session-list / dropdown indicators)', () => {
  it('reports no live chats when the store is idle', () => {
    expect(getGlobalRunState()).toEqual({ running: [], awaiting: [] });
  });

  it('does not report an idle (subscribed-but-not-running) chat as live', () => {
    // A mounted view subscribes to a chat before any run starts — the cell exists
    // but is idle, so it must not surface as running/awaiting.
    const unsub = subscribeRun(7, () => {});
    expect(getGlobalRunState()).toEqual({ running: [], awaiting: [] });
    unsub();
  });

  it('subscribeRunStore returns a working unsubscribe (no notify after teardown)', () => {
    const listener = vi.fn();
    const unsub = subscribeRunStore(listener);
    unsub();
    // Touching a cell after unsubscribe must not call the removed listener.
    subscribeRun(1, () => {})();
    expect(listener).not.toHaveBeenCalled();
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

describe('auto-compaction partitioning (summarize the middle, never orphan a tool)', () => {
  const msg = (role: ChatCompletionMessage['role'], content = 'x'): ChatCompletionMessage => ({ role, content });

  it('walks the tail forward off a leading orphaned tool result', () => {
    // A tail that would start on a `tool` message (its assistant call is in the
    // summarized middle) must advance past it so nothing is orphaned.
    const convo = [msg('user'), msg('assistant'), msg('tool'), msg('assistant'), msg('user')];
    const start = compactTailStart(convo, 3); // last 3 = [tool, assistant, user]
    expect(convo[start].role).not.toBe('tool');
  });

  it('assembled output is [system, memo, active directive, ...tail] and never orphans a tool', () => {
    const convo: ChatCompletionMessage[] = [msg('user', 'task')];
    for (let i = 0; i < 30; i++) convo.push(msg(i % 2 === 0 ? 'assistant' : 'tool', `s${i}`));
    const out = assembleCompacted('SYS', convo, 'MEMO', COMPACT_TAIL_TURNS);
    expect(out[0]).toEqual({ role: 'system', content: 'SYS' });
    // Memo first (the compressed history), THEN the active directive verbatim — not the
    // other way round, so the model reads the directive as the current instruction.
    expect(out[1]).toEqual({ role: 'assistant', content: 'MEMO' });
    expect(out[2].role).toBe('user');
    expect(out[2].content).toBe('task');
    // The first tail message after the directive is never an orphaned tool result.
    expect(out[3].role).not.toBe('tool');
  });

  it('re-injects the MOST RECENT user directive, not the first, when several fell out of the tail', () => {
    // The opening request, then a superseding instruction, then a long tool loop that
    // pushes BOTH out of the verbatim tail. The active directive is the latest one.
    const convo: ChatCompletionMessage[] = [msg('user', 'run a self-diagnostic'), msg('assistant', 'ok')];
    convo.push(msg('user', 'now create the gap and fix the code'));
    for (let i = 0; i < 30; i++) convo.push(msg(i % 2 === 0 ? 'assistant' : 'tool', `s${i}`));
    const idx = pinnedDirectiveIndex(convo, COMPACT_TAIL_TURNS);
    expect(convo[idx].content).toBe('now create the gap and fix the code');
    const out = assembleCompacted('SYS', convo, 'MEMO', COMPACT_TAIL_TURNS);
    const directive = out[2];
    expect(directive.role).toBe('user');
    expect(directive.content).toBe('now create the gap and fix the code');
    // The stale opening request is NOT re-injected verbatim (it lives only in the memo).
    expect(out.filter((m) => m.content === 'run a self-diagnostic')).toHaveLength(0);
  });

  it('middle range covers the whole history before the recent tail', () => {
    const convo: ChatCompletionMessage[] = [msg('user', 'task')];
    for (let i = 0; i < 20; i++) convo.push(msg('assistant', `a${i}`));
    const { start, end } = compactMiddleRange(convo, COMPACT_TAIL_TURNS);
    expect(start).toBe(0); // the memo summarizes everything, incl. earlier user turns
    expect(end).toBe(convo.length - COMPACT_TAIL_TURNS); // before the recent tail
    expect(start).toBeLessThan(end);
  });

  it('does not re-inject the directive when the latest user turn already lives in the tail', () => {
    const convo = [msg('user', 'task'), msg('assistant'), msg('user', 'later')];
    // Latest user turn ('later') is inside the tail → nothing to re-inject.
    expect(pinnedDirectiveIndex(convo, COMPACT_TAIL_TURNS)).toBe(-1);
    const out = assembleCompacted('SYS', convo, 'MEMO', COMPACT_TAIL_TURNS);
    expect(out.filter((m) => m.content === 'later')).toHaveLength(1);
  });
});
