import { describe, expect, it } from 'vitest';
import { initialRunPolicy } from '@builderforce/run-policy';
import type { BrainToolSpec } from '../streamChatCompletion';
import { makeCell } from './runCell';
import { runTrace } from './runCells';
import type { BrainRunContext } from './brainRunContext';
import { forcedProgressTurn } from './progressBudget';
import { RunProgressGuard, progressGuardTurn } from './progressGuard';

// VS Code chat #146477: a finished, type-checked change was escalated into a forced
// "change tools only" turn (the model invented an edit) and then parked on ask_user.

const spec = (name: string): BrainToolSpec => ({ type: 'function', function: { name, description: '', parameters: { type: 'object', properties: {} } } }) as BrainToolSpec;
const SELECTED = ['read_file', 'search_code', 'edit_file', 'write_file', 'ask_user'].map(spec);
const CHANGE = 'remove the Welcome back text from the login page and move the pills to the right';

function runOf(opts: { codeChanged?: boolean } = {}): BrainRunContext {
  const c = makeCell();
  c.codeChanged = opts.codeChanged ?? false;
  return {
    c,
    canAskUser: true,
    metadata: { mode: 'work' },
    userRequest: CHANGE,
    usedTools: new Set<string>(),
    policy: initialRunPolicy({ startPhase: 'code' }),
    progress: new RunProgressGuard(true, true),
  } as unknown as BrainRunContext;
}

const forcedEvents = (run: BrainRunContext) => runTrace(run.c).filter((e) => e.label === 'loop.progress_forced');

describe('regression: chat #146477 — escalation never forces an edit on a run that already changed code', () => {
  it('regression: forcedProgressTurn returns null once the run has codeChanged', () => {
    expect(forcedProgressTurn(runOf({ codeChanged: true }), SELECTED, 'YOU ARE STUCK.')).toBeNull();
    // Unchanged for a run that has not made its change yet.
    expect(forcedProgressTurn(runOf(), SELECTED, 'YOU ARE STUCK.')?.forced).toBe('change');
  });

  it('regression: a run that handed off but changed nothing itself is still forced', () => {
    const run = runOf();
    run.usedTools.add('hand_off');
    expect(forcedProgressTurn(run, SELECTED, 'YOU ARE STUCK.')?.forced).toBe('change');
  });
});

describe('regression: chat #146477 — a verified run that goes idle finishes with a no-tools turn', () => {
  it('regression: progressGuardTurn on a finish offers no tools, requires no call, and carries the final-report note', () => {
    const run = runOf({ codeChanged: true });
    const g = run.progress;
    g.observe('edit_file', { edits: [{ path: 'src/a.tsx', old_string: 'x', new_string: 'y' }] }, { data: { ok: true } });
    expect(g.endTurn()).toBeNull();
    g.observe('run_command', { command: 'pnpm exec tsc --noEmit', background: true }, { data: { ok: true, background: true, id: 'job-1', status: 'running' } });
    expect(g.endTurn()).toBeNull();
    g.observe('command_status', { id: 'job-1' }, { data: { ok: true, id: 'job-1', status: 'exited', exitCode: 0, output: '' } });
    expect(g.endTurn()).toBeNull();
    const idle = () => {
      let action = null;
      for (let i = 0; i < 4 && !action; i++) {
        g.observe('git_status', {}, { data: { ok: true, stdout: '' } });
        action = g.endTurn();
      }
      return action;
    };
    // The first verified trip only asks (a multi-part task may have more to do) — a steer, nothing forced.
    expect(idle()?.kind).toBe('steer');
    expect(progressGuardTurn(run, 7, SELECTED)).toBeNull();
    expect(idle()?.kind).toBe('finish');

    const turn = progressGuardTurn(run, 11, SELECTED);
    expect(turn?.tools).toEqual([]);
    expect(turn?.toolChoice).toBeUndefined();
    expect(String(turn?.brief.content)).toMatch(/final report/i);
    // The note is the turn's brief — not shown again as a steer.
    expect(g.steerNote()).toBe('');
    expect(forcedEvents(run).map((e) => (e.args as { forced?: string }).forced)).toEqual(['finish']);
    // Taken once.
    expect(progressGuardTurn(run, 12, SELECTED)).toBeNull();
  });
});
