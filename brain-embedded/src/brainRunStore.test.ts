import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  startRun,
  subscribeRun,
  subscribeRunStore,
  getGlobalRunState,
  getRunStoreSize,
  resetBrainRunStore,
  getRunSnapshot,
  getRunTrace,
  windowed,
  compactTailStart,
  compactMiddleRange,
  assembleCompacted,
  pinnedDirectiveIndex,
  COMPACT_TAIL_TURNS,
} from './brainRunStore';
import type { BrainStreamFn } from './brainRunStore';
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

describe('the host-injected tool-iteration ceiling (BrainRunRequest.maxIterations)', () => {
  /** A gateway that always asks for one more tool call, so only the cap ends the run. */
  const alwaysCallsATool = (): { stream: BrainStreamFn; turns: () => number } => {
    let turns = 0;
    const stream: BrainStreamFn = async (opts) => {
      turns += 1;
      const toolless = opts.tools === undefined;
      return {
        text: toolless ? 'Here is what I found.' : '',
        toolCalls: toolless ? [] : [{ id: `c${turns}`, name: 'read_file', args: '{}' }],
        finishReason: toolless ? 'stop' : 'tool_calls',
      };
    };
    return { stream, turns: () => turns };
  };

  const persistence = { sendMessages: async () => [] };

  it('stops at the host ceiling, then forces one final tools-free answer', async () => {
    const gateway = alwaysCallsATool();
    await startRun(4242, {
      resolvedSystemPrompt: 'sys',
      tools: [{ type: 'function', function: { name: 'read_file', description: 'read', parameters: {} } }],
      runTool: async () => ({ ok: true }),
      stream: gateway.stream,
      persistence,
      userTurn: 'read everything',
      maxIterations: 3,
    });
    // Three capped tool turns + the loop's always-speak closing synthesis.
    expect(gateway.turns()).toBe(4);
  });

  it('ignores a nonsensical ceiling rather than running a zero-turn (answerless) loop', async () => {
    const gateway = alwaysCallsATool();
    await startRun(4243, {
      resolvedSystemPrompt: 'sys',
      stream: gateway.stream,
      persistence,
      userTurn: 'hello',
      maxIterations: 0,
    });
    // Falls back to the shared default, so the run still produces a turn.
    expect(gateway.turns()).toBeGreaterThan(0);
  });
});

describe('the re-read loop guard', () => {
  const persistence = { sendMessages: async () => [] };
  const READ_TOOL = [{ type: 'function' as const, function: { name: 'read_file', description: 'read', parameters: {} } }];

  /**
   * A model that keeps reading ONE file at shifting offsets — the pattern the
   * exact-repeat dedupe cannot see, and the one that burns a run's whole budget
   * without producing a change.
   */
  const rereadsOneFile = (path: string): BrainStreamFn => {
    let turn = 0;
    return async (opts) => {
      turn += 1;
      if (opts.tools === undefined) return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
      return {
        text: '',
        toolCalls: [{ id: `c${turn}`, name: 'read_file', args: JSON.stringify({ path, offset: turn * 100 }) }],
        finishReason: 'tool_calls',
      };
    };
  };

  it('warns the model inside the tool result once it starts circling one file', async () => {
    const seen: string[] = [];
    // ONE closure for the whole run: rebuilding it per call would reset its offset
    // counter, turning the reads into EXACT repeats that the older dedupe already
    // catches — and so testing the wrong guard entirely.
    const model = rereadsOneFile('a.css');
    await startRun(4301, {
      resolvedSystemPrompt: 'sys',
      tools: READ_TOOL,
      runTool: async () => ({ ok: true, content: 'body' }),
      stream: async (opts, cb) => {
        // Capture what the model is actually handed back for each tool call.
        for (const m of opts.messages) if (m.role === 'tool') seen.push(String(m.content));
        return model(opts, cb);
      },
      persistence,
      userTurn: 'reduce the height',
      maxIterations: 6,
    });
    const advised = seen.filter((c) => c.includes('read') && c.includes('times in this run'));
    expect(advised.length).toBeGreaterThan(0);
    expect(seen.some((c) => c.includes('STOP RE-READING'))).toBe(true);
  });

  it('leaves a run that reads DIFFERENT files alone', async () => {
    const seen: string[] = [];
    let turn = 0;
    await startRun(4302, {
      resolvedSystemPrompt: 'sys',
      tools: READ_TOOL,
      runTool: async () => ({ ok: true, content: 'body' }),
      stream: async (opts) => {
        for (const m of opts.messages) if (m.role === 'tool') seen.push(String(m.content));
        turn += 1;
        if (opts.tools === undefined) return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
        return {
          text: '',
          toolCalls: [{ id: `c${turn}`, name: 'read_file', args: JSON.stringify({ path: `file-${turn}.css` }) }],
          finishReason: 'tool_calls',
        };
      },
      persistence,
      userTurn: 'survey the styles',
      maxIterations: 6,
    });
    expect(seen.some((c) => c.includes('times in this run'))).toBe(false);
    expect(seen.some((c) => c.includes('STOP RE-READING'))).toBe(false);
  });
});

describe('live run activity (the animated in-flight indicator)', () => {
  const persistence = { sendMessages: async () => [] };

  it('publishes the tool step WHILE it runs, and clears it when the run ends', async () => {
    const phases: string[] = [];
    const unsubscribe = subscribeRun(4401, () => {
      const a = getRunSnapshot(4401).activity;
      const key = a ? `${a.phase}:${a.label ?? ''}` : 'idle';
      if (phases[phases.length - 1] !== key) phases.push(key);
    });

    let turn = 0;
    await startRun(4401, {
      resolvedSystemPrompt: 'sys',
      tools: [{ type: 'function', function: { name: 'search_code', description: 's', parameters: {} } }],
      runTool: async () => {
        // Observed from INSIDE the call: the whole point is that the step is visible
        // while it is executing, not once it has settled into the trace.
        const live = getRunSnapshot(4401).activity;
        expect(live?.phase).toBe('tool');
        expect(live?.label).toBe('search_code');
        expect(live?.detail).toBe('Board one-pager');
        return { ok: true };
      },
      stream: async (opts) => {
        turn += 1;
        if (opts.tools === undefined || turn > 1) return { text: 'Found it.', toolCalls: [], finishReason: 'stop' };
        return {
          text: '',
          toolCalls: [{ id: 'c1', name: 'search_code', args: JSON.stringify({ query: 'Board one-pager' }) }],
          finishReason: 'tool_calls',
        };
      },
      persistence,
      userTurn: 'find the board card',
    });
    unsubscribe();

    expect(phases).toContain('thinking:');
    expect(phases).toContain('tool:search_code');
    // A finished run must never leave an indicator claiming work is in flight.
    expect(phases[phases.length - 1]).toBe('idle');
    expect(getRunSnapshot(4401).activity).toBeNull();
  });

  it('flips to `writing` on the first streamed token', async () => {
    let sawWriting = false;
    await startRun(4402, {
      resolvedSystemPrompt: 'sys',
      stream: async (_opts, cb) => {
        cb?.onTextDelta?.('Hel');
        sawWriting = getRunSnapshot(4402).activity?.phase === 'writing';
        return { text: 'Hello', toolCalls: [], finishReason: 'stop' };
      },
      persistence,
      userTurn: 'hi',
    });
    expect(sawWriting).toBe(true);
  });
});

describe('a bare "Fix" after an unfinished proposal', () => {
  const persistence = { sendMessages: async () => [] };
  const PROPOSAL = "I found the exact issue but hit the tool-call budget before applying the edit — so nothing has been changed on disk yet. Re-run me and I'll apply the edit.";

  /** Capture the system prompt the model was actually handed. */
  function captureSystem() {
    const seen: string[] = [];
    const stream: BrainStreamFn = async (opts) => {
      const sys = opts.messages.find((m) => m.role === 'system');
      if (sys && typeof sys.content === 'string') seen.push(sys.content);
      return { text: 'ok', toolCalls: [], finishReason: 'stop' };
    };
    return { stream, seen };
  }

  it('tells the run to carry out the previous proposal instead of asking what to fix', async () => {
    const { stream, seen } = captureSystem();
    await startRun(4501, {
      resolvedSystemPrompt: 'sys',
      seed: [
        { role: 'user', content: 'reduce the height of the scrolling box on mobile' },
        { role: 'assistant', content: PROPOSAL },
      ],
      stream,
      persistence,
      userTurn: 'Fix',
    });
    expect(seen[0]).toMatch(/bare directive/i);
    expect(seen[0]).toMatch(/do NOT ask the user what to fix/i);
  });

  it('leaves a normal turn alone', async () => {
    const { stream, seen } = captureSystem();
    await startRun(4502, {
      resolvedSystemPrompt: 'sys',
      seed: [{ role: 'assistant', content: PROPOSAL }],
      stream,
      persistence,
      userTurn: 'Actually, use 56vh instead and only below 900px',
    });
    expect(seen[0]).not.toMatch(/bare directive/i);
  });

  it('does not fire when the previous turn had nothing outstanding', async () => {
    // "Fix" after a COMPLETED turn is genuinely ambiguous, and inventing a referent
    // for it would be worse than the model asking.
    const { stream, seen } = captureSystem();
    await startRun(4503, {
      resolvedSystemPrompt: 'sys',
      seed: [{ role: 'assistant', content: 'Done — the cap is now min(56vh, 480px) and the tests pass.' }],
      stream,
      persistence,
      userTurn: 'Fix',
    });
    expect(seen[0]).not.toMatch(/bare directive/i);
  });
});

describe('a run that ships its change closes its own ticket', () => {
  const persistence = { sendMessages: async () => [] };
  const TICKET = [{ kind: 'task', ref: '2394', status: 'in_review', exists: true }];

  /** A run that edits a file, then commits + pushes, then checks git status. */
  function shippingRun(statusOutput: string) {
    const calls: { name: string; args: unknown }[] = [];
    let turn = 0;
    const stream: BrainStreamFn = async (opts) => {
      turn += 1;
      if (opts.tools === undefined) return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
      const plan = [
        { name: 'edit_file', args: { path: 'a.css', old_string: 'x', new_string: 'y' } },
        { name: 'run_command', args: { command: 'git add -A && git commit -m "x" && git push' } },
        { name: 'git_status', args: {} },
      ][turn - 1];
      if (!plan) return { text: 'Done.', toolCalls: [], finishReason: 'stop' };
      return { text: '', toolCalls: [{ id: `c${turn}`, name: plan.name, args: JSON.stringify(plan.args) }], finishReason: 'tool_calls' };
    };
    const runTool = async (name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === 'builtin_chats_list_tickets') return TICKET;
      if (name === 'git_status') return { ok: true, action: 'status', output: statusOutput };
      return { ok: true };
    };
    return { stream, runTool, calls };
  }

  it('moves the linked in_review ticket to done, with the reason on the step', async () => {
    const { stream, runTool, calls } = shippingRun('## main...origin/main');
    await startRun(4601, {
      resolvedSystemPrompt: 'sys',
      projectId: 11,
      tools: [
        { type: 'function', function: { name: 'edit_file', description: 'e', parameters: {} } },
        { type: 'function', function: { name: 'run_command', description: 'r', parameters: {} } },
        { type: 'function', function: { name: 'git_status', description: 'g', parameters: {} } },
      ],
      runTool,
      stream,
      persistence,
      userTurn: 'reduce the height and push to main',
      maxIterations: 6,
    });
    // The TOOL receives only the status change...
    const done = calls.find((c) => c.name === 'builtin_tasks_update' && (c.args as { status?: string }).status === 'done');
    expect(done).toBeDefined();
    expect(done!.args).toMatchObject({ id: 2394, status: 'done' });
    // ...while the recorded STEP carries why, so a ticket that closed itself is never
    // an unexplained status change in the board's history.
    const step = getRunTrace(4601).find(
      (e) => e.label === 'builtin_tasks_update' && (e.args as { status?: string })?.status === 'done',
    );
    expect(step?.args).toMatchObject({ id: 2394, status: 'done', auto: true, reason: 'shipped-to-base-branch' });
  });

  it('leaves the ticket in review when the work stayed on a branch', async () => {
    const { stream, runTool, calls } = shippingRun('## feature/x...origin/feature/x');
    await startRun(4602, {
      resolvedSystemPrompt: 'sys',
      projectId: 11,
      tools: [
        { type: 'function', function: { name: 'edit_file', description: 'e', parameters: {} } },
        { type: 'function', function: { name: 'run_command', description: 'r', parameters: {} } },
        { type: 'function', function: { name: 'git_status', description: 'g', parameters: {} } },
      ],
      runTool,
      stream,
      persistence,
      userTurn: 'reduce the height and push the branch',
      maxIterations: 6,
    });
    expect(calls.some((c) => c.name === 'builtin_tasks_update' && (c.args as { status?: string }).status === 'done')).toBe(false);
  });
});
