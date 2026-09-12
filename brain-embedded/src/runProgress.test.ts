import { describe, it, expect } from 'vitest';
import { computeRunProgress, formatRunProgress, runProgressVerdict, hasEditIntent, isMutationTool } from './runProgress';
import { computeBrainDiagnostics, formatBrainDiagnostics, type BrainTraceEvent } from './brainTriage';
import type { BrainMessage } from './types';

let clock = 0;
function tool(label: string, args: unknown, opts: Partial<BrainTraceEvent> = {}): BrainTraceEvent {
  clock += 1000;
  return { ts: new Date(clock).toISOString(), category: 'tool', label, args, result: { ok: true }, ...opts };
}
function llm(opts: Partial<BrainTraceEvent> = {}): BrainTraceEvent {
  clock += 1000;
  return {
    ts: new Date(clock).toISOString(),
    category: 'llm',
    label: 'llm.complete',
    args: { model: 'kimi', step: 1, toolCalls: 1, advertisedTools: 67, catalogTools: 437 },
    textChars: 40,
    ...opts,
  };
}
function msg(role: BrainMessage['role'], content: string): BrainMessage {
  return { id: Math.random(), role, content } as BrainMessage;
}

/**
 * The run this whole module exists for: the agent read ONE css file seven times at
 * overlapping offsets, re-ran a search it had already run, made 26 calls, and
 * changed nothing — while every existing signal scored it clean.
 */
function spinningRun(): { events: BrainTraceEvent[]; messages: BrainMessage[] } {
  clock = 0;
  const path = 'frontend/src/components/home/LandingCanvasHero.module.css';
  const events: BrainTraceEvent[] = [];
  for (const offset of [1, 140, 141, 208, 240, 340, 440]) {
    events.push(llm(), tool('read_file', { path, offset }));
  }
  events.push(llm(), tool('search_code', { query: 'Board one-pager', path: 'frontend/src' }));
  events.push(llm(), tool('search_code', { query: 'Board one-pager', path: 'frontend/src' }));
  return {
    events,
    messages: [msg('user', 'In mobile mode on the front end, reduce the height of the scrolling box so the prompt is shown.')],
  };
}

describe('hasEditIntent', () => {
  it('reads a change request as an edit', () => {
    expect(hasEditIntent([msg('user', 'reduce the height of the scrolling box')])).toBe(true);
    expect(hasEditIntent([msg('user', 'Fix the gate in deliveryVerdict.ts')])).toBe(true);
  });

  it('does not read a question as an edit, even when it contains an edit verb', () => {
    expect(hasEditIntent([msg('user', 'Why did you change the height?')])).toBe(false);
    expect(hasEditIntent([msg('user', 'Where is the scrolling box defined?')])).toBe(false);
    expect(hasEditIntent([msg('user', 'How do I add a column?')])).toBe(false);
  });

  it('ignores the assistant restating the task', () => {
    expect(hasEditIntent([msg('assistant', "I'll reduce the height of the box.")])).toBe(false);
  });
});

describe('isMutationTool', () => {
  it('recognizes writers across both catalogs', () => {
    for (const name of ['edit_file', 'write_file', 'builtin_tasks_create', 'builtin_attachments_write']) {
      expect(isMutationTool(name)).toBe(true);
    }
  });

  it('does not mistake readers for writers', () => {
    for (const name of ['read_file', 'search_code', 'list_files', 'builtin_tasks_list']) {
      expect(isMutationTool(name)).toBe(false);
    }
  });
});

describe('computeRunProgress', () => {
  it('counts revisits to the same target across DIFFERENT calls', () => {
    const { events, messages } = spinningRun();
    const p = computeRunProgress(events, messages);
    // Seven reads of one file are seven distinct calls — exact-duplicate detection
    // alone stays silent on them, which is why the target signature exists.
    const worst = p.repeatedTargets[0]!;
    expect(worst.label).toContain('read_file');
    expect(worst.count).toBe(7);
    expect(p.spinning).toBe(true);
  });

  it('counts a byte-identical repeat as an exact duplicate too', () => {
    const { events, messages } = spinningRun();
    expect(computeRunProgress(events, messages).duplicateCalls).toBe(1);
  });

  it('reports no effect when an edit request produced no successful mutation', () => {
    const { events, messages } = spinningRun();
    const p = computeRunProgress(events, messages);
    expect(p.editIntent).toBe(true);
    expect(p.mutationsAttempted).toBe(0);
    expect(p.noEffect).toBe(true);
  });

  it('clears both flags for a run that advanced and wrote', () => {
    clock = 0;
    const events = [
      llm(), tool('read_file', { path: 'a.css' }),
      llm(), tool('read_file', { path: 'b.css' }),
      llm(), tool('search_code', { query: 'height' }),
      llm(), tool('edit_file', { path: 'a.css' }),
    ];
    const p = computeRunProgress(events, [msg('user', 'reduce the height of the box')]);
    expect(p.spinning).toBe(false);
    expect(p.noEffect).toBe(false);
    expect(p.mutationsSucceeded).toBe(1);
    expect(p.revisitRatio).toBe(0);
  });

  it('does not flag a QUESTION that made no mutation', () => {
    clock = 0;
    const events = [llm(), tool('read_file', { path: 'a.css' })];
    const p = computeRunProgress(events, [msg('user', 'Where is the height set?')]);
    expect(p.editIntent).toBe(false);
    expect(p.noEffect).toBe(false);
  });

  it('does not call a short run a loop', () => {
    clock = 0;
    const events = [llm(), tool('read_file', { path: 'a.css' }), llm(), tool('read_file', { path: 'a.css' })];
    const p = computeRunProgress(events, [msg('user', 'fix the height')]);
    expect(p.repeatedTargets).toHaveLength(1);
    expect(p.spinning).toBe(false);
  });

  it('attributes time to the model and to tools separately', () => {
    clock = 0;
    const events = [llm({ durationMs: 2_000 }), tool('search_code', { query: 'x' }, { durationMs: 67_000 })];
    const p = computeRunProgress(events, []);
    expect(p.modelMs).toBe(2_000);
    expect(p.toolMs).toBe(67_000);
    expect(p.slowestStep).toEqual({ label: 'search_code', ms: 67_000 });
  });

  it('counts a FAILED mutation as attempted but not succeeded', () => {
    clock = 0;
    const events = [llm(), tool('edit_file', { path: 'a.css' }, { result: { ok: false, error: 'no such file' }, isError: true })];
    const p = computeRunProgress(events, [msg('user', 'fix the height')]);
    expect(p.mutationsAttempted).toBe(1);
    expect(p.mutationsSucceeded).toBe(0);
    expect(p.noEffect).toBe(true);
  });
});

/**
 * The shape the 2026-09-12 capture had: `git_status {}` answered "not a git
 * repository … re-run with `repo`" three times running, and the model made the
 * same bare call each time. Only 4 targeted calls, so the revisit-ratio loop
 * detector stays silent — the streak is the whole signal.
 */
function backToBackRun(): { events: BrainTraceEvent[]; messages: BrainMessage[] } {
  clock = 0;
  const notARepo = { ok: false, error: 'not a git repository at the workspace root — re-run with `repo` set' };
  const events: BrainTraceEvent[] = [];
  for (let i = 0; i < 3; i += 1) events.push(llm(), tool('git_status', {}, { result: notARepo, isError: true }));
  events.push(llm(), tool('list_files', { path: '' }));
  return { events, messages: [msg('user', 'Review the open tickets and merge the applicable ones to main.')] };
}

describe('back-to-back repeats', () => {
  it('records the longest streak of consecutive identical calls, with its failures', () => {
    const { events, messages } = backToBackRun();
    const p = computeRunProgress(events, messages);
    expect(p.longestStreak).toEqual({ label: 'git_status', count: 3, failed: 3 });
    expect(p.streaks).toBe(1);
    expect(p.stuckOnCall).toBe(true);
    // The streak alone makes it a loop — there are too few calls for the ratio to.
    expect(p.targetedCalls).toBeLessThan(6);
    expect(p.spinning).toBe(true);
  });

  it('treats a single immediate retry as a retry, not a stall', () => {
    clock = 0;
    const events = [
      llm(), tool('git_status', {}, { result: { ok: false, error: 'flake' }, isError: true }),
      llm(), tool('git_status', {}),
      llm(), tool('read_file', { path: 'a.ts' }),
    ];
    const p = computeRunProgress(events, [msg('user', 'fix it')]);
    expect(p.longestStreak).toEqual({ label: 'git_status', count: 2, failed: 1 });
    expect(p.stuckOnCall).toBe(false);
    expect(p.spinning).toBe(false);
  });

  it('is not fooled by argument key order, and closes the streak on a different call', () => {
    clock = 0;
    const events = [
      llm(), tool('search_code', { query: 'x', path: 'src' }),
      llm(), tool('search_code', { path: 'src', query: 'x' }),
      llm(), tool('read_file', { path: 'a.ts' }),
      llm(), tool('search_code', { query: 'x', path: 'src' }),
    ];
    const p = computeRunProgress(events, []);
    // Same call twice in a row (keys reordered), then broken by the read: one
    // streak of 2, and the later repeat is a duplicate but not a streak.
    expect(p.longestStreak).toEqual({ label: 'search_code', count: 2, failed: 0 });
    expect(p.streaks).toBe(1);
    expect(p.duplicateCalls).toBe(2);
  });

  it('counts every streak, and keeps the longest', () => {
    clock = 0;
    const events = [
      llm(), tool('a', {}), llm(), tool('a', {}),
      llm(), tool('b', {}),
      llm(), tool('c', {}), llm(), tool('c', {}), llm(), tool('c', {}), llm(), tool('c', {}),
    ];
    const p = computeRunProgress(events, []);
    expect(p.streaks).toBe(2);
    expect(p.longestStreak).toEqual({ label: 'c', count: 4, failed: 0 });
  });

  it('is null for a run that never repeated a call immediately', () => {
    const { events, messages } = spinningRun();
    // Seven reads of one file at DIFFERENT offsets are not identical calls.
    const p = computeRunProgress(events, messages);
    expect(p.longestStreak).toEqual({ label: 'search_code', count: 2, failed: 0 });
    clock = 0;
    const fresh = [llm(), tool('read_file', { path: 'a' }), llm(), tool('read_file', { path: 'b' })];
    expect(computeRunProgress(fresh, []).longestStreak).toBeNull();
  });

  it('names the streak on the Progress line', () => {
    const { events, messages } = backToBackRun();
    const line = formatRunProgress(computeRunProgress(events, messages))[0]!;
    expect(line).toContain('`git_status` ×3 BACK-TO-BACK (all 3 failed)');
  });

  it('leads the verdict with the streak and blames the ignored error, not context', () => {
    const { events, messages } = backToBackRun();
    const verdict = runProgressVerdict(computeRunProgress(events, messages))!;
    expect(verdict).toMatch(/^NO PROGRESS — it made the same call 3 times in a row/);
    expect(verdict).toContain('`git_status` ×3 BACK-TO-BACK (all 3 failed)');
    expect(verdict).toMatch(/ignoring the error it was given/);
    expect(verdict).not.toMatch(/Widen the read/);
  });

  it('outranks context exhaustion in the full diagnostics', () => {
    const { events, messages } = backToBackRun();
    const withPressure = events.map((e) =>
      e.category === 'llm' ? { ...e, usage: { prompt: 46_228, completion: 160 } } : { ...e, truncated: true, resultBytes: 19_000 },
    );
    const d = computeBrainDiagnostics(withPressure, undefined, messages);
    expect(d.likelyCause).toBe('no-progress');
    const report = formatBrainDiagnostics(d).join('\n');
    expect(report).toContain('BACK-TO-BACK');
    expect(report).not.toContain('Likely CONTEXT EXHAUSTION');
  });
});

describe('runProgressVerdict', () => {
  it('names the loop and steers AWAY from the context/model remedies', () => {
    const { events, messages } = spinningRun();
    const verdict = runProgressVerdict(computeRunProgress(events, messages))!;
    expect(verdict).toContain('NO PROGRESS');
    expect(verdict).toContain('read_file');
    expect(verdict).toMatch(/not context pressure/i);
    expect(verdict).toMatch(/rather than shrinking context or switching models/i);
  });

  it('is null for a run that advanced', () => {
    clock = 0;
    const events = [llm(), tool('read_file', { path: 'a.css' }), llm(), tool('edit_file', { path: 'a.css' })];
    expect(runProgressVerdict(computeRunProgress(events, [msg('user', 'fix the height')]))).toBeNull();
  });
});

describe('formatRunProgress', () => {
  it('always states reach, and names the repeated targets when there are any', () => {
    const { events, messages } = spinningRun();
    const lines = formatRunProgress(computeRunProgress(events, messages)).join('\n');
    expect(lines).toContain('Progress:');
    expect(lines).toContain('Revisited:');
    expect(lines).toContain('NOTHING WAS CHANGED');
    expect(lines).toContain('Time:');
  });
});

describe('the verdict this replaced', () => {
  it('reports NO PROGRESS, not context exhaustion, for the spinning run', () => {
    const { events, messages } = spinningRun();
    // Give it the context-exhaustion symptoms the real capture had: a big prompt peak
    // and truncated tool results. Both are CONSEQUENCES of the re-reading, and the old
    // ranking let them capture the verdict.
    const withPressure = events.map((e) =>
      e.category === 'llm'
        ? { ...e, usage: { prompt: 33_023, completion: 160 } }
        : { ...e, truncated: true, resultBytes: 19_000 },
    );
    const d = computeBrainDiagnostics(withPressure, undefined, messages);
    expect(d.likelyCause).toBe('no-progress');
    const report = formatBrainDiagnostics(d).join('\n');
    expect(report).toContain('NO PROGRESS');
    expect(report).not.toContain('Likely CONTEXT EXHAUSTION');
  });

  it('does not blame a run that is still executing for having written nothing', () => {
    clock = 0;
    // An edit request, two reads, no write — but the run has not finished.
    const events = [llm(), tool('read_file', { path: 'a.css' }), llm(), tool('read_file', { path: 'b.css' })];
    const messages = [msg('user', 'reduce the height of the box')];
    expect(computeBrainDiagnostics(events, undefined, messages).likelyCause).toBe('no-progress');
    expect(computeBrainDiagnostics(events, undefined, messages, { running: true }).likelyCause).not.toBe('no-progress');
  });

  it('still reports context exhaustion when the run did NOT spin', () => {
    clock = 0;
    const events = [
      llm({ usage: { prompt: 40_000, completion: 10 }, finishReason: 'length' }),
      tool('read_file', { path: 'a.css' }, { truncated: true, resultBytes: 30_000 }),
    ];
    expect(computeBrainDiagnostics(events, undefined, [msg('user', 'What does this file do?')]).likelyCause)
      .toBe('context-exhaustion');
  });
});
