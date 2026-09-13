import { describe, it, expect } from 'vitest';
import {
  windowed,
  compactTailStart,
  compactTailStartForBudget,
  verbatimStart,
  assembleCompacted,
  pinnedDirectiveIndex,
  COMPACT_TAIL_TURNS,
} from './workingTranscript';
import type { ChatCompletionMessage } from './streamChatCompletion';

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
    const out = assembleCompacted('SYS', convo, 'MEMO', compactTailStart(convo, COMPACT_TAIL_TURNS));
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
    const idx = pinnedDirectiveIndex(convo, compactTailStart(convo, COMPACT_TAIL_TURNS));
    expect(convo[idx].content).toBe('now create the gap and fix the code');
    const out = assembleCompacted('SYS', convo, 'MEMO', COMPACT_TAIL_TURNS);
    const directive = out[2];
    expect(directive.role).toBe('user');
    expect(directive.content).toBe('now create the gap and fix the code');
    // The stale opening request is NOT re-injected verbatim (it lives only in the memo).
    expect(out.filter((m) => m.content === 'run a self-diagnostic')).toHaveLength(0);
  });

  it('keeps EVERY message from the covered end on — nothing falls between the memo and the tail', () => {
    // The old fold summarised "all but the last eight" on a turn count, so messages that
    // slid out of the tail between two folds were in neither the memo nor the tail.
    const convo: ChatCompletionMessage[] = [msg('user', 'task')];
    for (let i = 0; i < 30; i++) convo.push(msg('assistant', `a${i}`));
    const out = assembleCompacted('SYS', convo, 'MEMO', 5);
    // [system, memo, the covered directive 'task', ...convo[5..]]
    expect(out[2]).toEqual({ role: 'user', content: 'task' });
    expect(out.slice(3)).toEqual(convo.slice(5));
  });

  it('walks the verbatim start off tool results whose call the memo folded', () => {
    const convo = [msg('user'), msg('assistant'), msg('tool'), msg('tool'), msg('assistant')];
    expect(verbatimStart(convo, 2)).toBe(4);
    expect(verbatimStart(convo, 99)).toBe(convo.length);
  });

  it('sizes the compacted tail by tokens, never below the minimum tail', () => {
    // Small messages: far more than eight fit, so far more than eight are kept verbatim.
    const small: ChatCompletionMessage[] = [msg('user', 'task')];
    for (let i = 0; i < 30; i++) small.push(msg('assistant', 'short'));
    expect(small.length - compactTailStartForBudget(small, 10_000)).toBeGreaterThan(COMPACT_TAIL_TURNS);
    // Oversized messages: the minimum tail survives however large it is.
    const big: ChatCompletionMessage[] = [msg('user', 'task')];
    for (let i = 0; i < 30; i++) big.push(msg('assistant', 'x'.repeat(40_000)));
    expect(big.length - compactTailStartForBudget(big, 10_000)).toBe(COMPACT_TAIL_TURNS);
  });

  it('does not re-inject the directive when the latest user turn already lives in the tail', () => {
    const convo = [msg('user', 'task'), msg('assistant'), msg('user', 'later')];
    // Latest user turn ('later') is inside the tail → nothing to re-inject.
    expect(pinnedDirectiveIndex(convo, compactTailStart(convo, COMPACT_TAIL_TURNS))).toBe(-1);
    const out = assembleCompacted('SYS', convo, 'MEMO', COMPACT_TAIL_TURNS);
    expect(out.filter((m) => m.content === 'later')).toHaveLength(1);
  });
});
