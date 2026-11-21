import { describe, expect, it } from 'vitest';
import { initialRunPolicy } from '@builderforce/run-policy';
import type { BrainToolSpec } from '../streamChatCompletion';
import { makeCell } from './runCell';
import type { BrainRunContext } from './brainRunContext';
import { budgeted, progressed } from './progressBudget';
import { RunProgressGuard, progressGuardTurn } from './progressGuard';

// VS Code chat #165961: the planner was forced to hand off (read_only_streak, trip 2). The hand-off was INLINE — no coder was
// started, the run itself took the task — yet `progressed` counted the `hand_off` call as the change. So the coder's first stall
// (trip 3, a finish) was not deferred for a forced change turn: it finished with ZERO edits and its ticket open, announcing
// "The fix is not in the tree", and the final no-tool report (chat #128305's final turn) closed the run.

const spec = (name: string): BrainToolSpec => ({ type: 'function', function: { name, description: '', parameters: { type: 'object', properties: {} } } }) as BrainToolSpec;
const SELECTED = ['read_file', 'search_code', 'edit_file', 'write_file', 'ask_user'].map(spec);
const REQUEST = 'fix the regression where an interrupted run loses its title, and add unit tests';
const names = (tools: readonly BrainToolSpec[] | undefined) => (tools ?? []).map((t) => t.function.name);

function handedOffRun(inline: boolean): BrainRunContext {
  const run = {
    c: makeCell(),
    canAskUser: true,
    metadata: { mode: 'work' },
    userRequest: REQUEST,
    usedTools: new Set<string>(),
    policy: initialRunPolicy({ startPhase: 'code' }),
    progress: new RunProgressGuard(true),
  } as unknown as BrainRunContext;
  // The planner's two trips (steer, then the escalation its forced hand-off took) are spent.
  for (let i = 0; i < 4; i++) readTurn(run.progress, `plan${i}`);
  run.progress.takeDue();
  run.usedTools.add('hand_off');
  run.handOffInline = inline;
  return run;
}

/** A turn that claims readiness and only reads a new file. */
function readTurn(g: RunProgressGuard, id: string) {
  g.noteTurnText('Now I have everything I need.');
  g.observe('read_file', { path: `src/${id}.ts` }, { data: { ok: true } });
  return g.endTurn();
}

/** Coder turns until the next trip. */
function stallCoder(run: BrainRunContext, from: number): void {
  for (let i = from; i < from + 2; i++) readTurn(run.progress, `code${i}`);
}

describe('regression: chat #165961 — a coder after an INLINE hand-off owes the change', () => {
  it('regression: chat #165961 — an inline hand-off is not progress; a fan-out is', () => {
    expect(budgeted(handedOffRun(true))).toBe(true);
    expect(progressed(handedOffRun(true))).toBe(false);
    expect(progressed(handedOffRun(false))).toBe(true);
  });

  it('regression: chat #165961 — the coder that stops with zero edits is not accepted: its finish is deferred for ONE forced change turn, then the run ends cleanly on a no-tool final report', () => {
    const run = handedOffRun(true);
    stallCoder(run, 0);
    const deferred = progressGuardTurn(run, 20, SELECTED);
    expect(deferred?.finishing).toBeUndefined();
    expect(names(deferred?.tools)).toEqual(['edit_file', 'write_file']);
    expect(deferred?.toolChoice).toBe('required');
    expect(run.progress.finishing).toBe(false);
    // The next trip really finishes: no tools, the run's final report (chat #128305 — never sent back by a gate).
    stallCoder(run, 2);
    const final = progressGuardTurn(run, 23, SELECTED);
    expect(final?.tools).toEqual([]);
    expect(final?.finishing).toBe(true);
    expect(run.progress.finishing).toBe(true);
  });

  it('regression: chat #165961 — a fan-out hand-off still finishes at its coder\'s trip 3 (the coders made the change)', () => {
    const run = handedOffRun(false);
    stallCoder(run, 0);
    const turn = progressGuardTurn(run, 20, SELECTED);
    expect(turn?.tools).toEqual([]);
    expect(turn?.finishing).toBe(true);
  });
});
