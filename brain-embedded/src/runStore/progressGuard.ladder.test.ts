import { afterEach, describe, expect, it } from 'vitest';
import { initialRunPolicy } from '@builderforce/run-policy';
import type { BrainToolSpec } from '../streamChatCompletion';
import { makeCell } from './runCell';
import { runTrace } from './runCells';
import type { RunLoopContext } from './runLoopContext';
import { budgeted } from './progressBudget';
import { RunProgressGuard, progressGuardTurn } from './progressGuard';

// PRD 35 WS8p accept: how the editor maps A3's ladder onto what it has — a question run is
// steered and never forced to change anything; a run that cannot ask is steered instead of
// asked; a hand-off keeps the claim; the lever turns it off on the device.

const spec = (name: string): BrainToolSpec => ({ type: 'function', function: { name, description: '', parameters: { type: 'object', properties: {} } } }) as BrainToolSpec;
const SELECTED = ['read_file', 'search_code', 'edit_file', 'write_file', 'ask_user'].map(spec);
const READY = 'Now I have everything I need.';
const CHANGE = 'update the PRD with the WS8p design';
const QUESTION = 'what does the read cache cover?';

function runOf(opts: { userRequest?: string; canAskUser?: boolean } = {}): RunLoopContext {
  return {
    c: makeCell(),
    canAskUser: opts.canAskUser ?? true,
    metadata: { mode: 'work' },
    userRequest: opts.userRequest ?? CHANGE,
    usedTools: new Set<string>(),
    policy: initialRunPolicy({ startPhase: 'code' }),
    progress: new RunProgressGuard(true),
  } as unknown as RunLoopContext;
}

/** A turn that claims readiness and only reads a new file. */
function unkeptTurn(g: RunProgressGuard, i: number) {
  g.noteTurnText(READY);
  g.observe('read_file', { path: `docs/f${i}.md` }, { data: { ok: true } });
  return g.endTurn();
}

const forcedEvents = (run: RunLoopContext) => runTrace(run.c).filter((e) => e.label === 'loop.progress_forced');
const names = (tools: readonly BrainToolSpec[] | undefined) => (tools ?? []).map((t) => t.function.name);

describe('progressGuardTurn — the ladder on the editor', () => {
  it('forces the change tools on a change request when the escalation is due', () => {
    const run = runOf();
    for (let i = 0; i < 4; i++) unkeptTurn(run.progress, i);
    const turn = progressGuardTurn(run, 4, SELECTED);
    expect(names(turn?.tools)).toEqual(['edit_file', 'write_file', 'ask_user']);
    expect(turn?.toolChoice).toBe('required');
    expect(forcedEvents(run)).toHaveLength(1);
  });

  it('steers a question run instead of forcing it to change anything', () => {
    const run = runOf({ userRequest: QUESTION });
    expect(budgeted(run)).toBe(false);
    for (let i = 0; i < 4; i++) unkeptTurn(run.progress, i);
    expect(progressGuardTurn(run, 4, SELECTED)).toBeNull();
    expect(run.progress.steerNote()).toContain('PROGRESS CHECK 2');
    expect(forcedEvents(run)).toHaveLength(0);
    expect(run.policy).toEqual(initialRunPolicy({ startPhase: 'code' }));
  });

  it('asks the person on the third trip, with ask_user alone', () => {
    const run = runOf();
    for (let i = 0; i < 4; i++) unkeptTurn(run.progress, i);
    progressGuardTurn(run, 4, SELECTED);
    for (let i = 4; i < 6; i++) unkeptTurn(run.progress, i);
    const turn = progressGuardTurn(run, 6, SELECTED);
    expect(names(turn?.tools)).toEqual(['ask_user']);
    expect(String(turn?.brief.content)).toContain('Stop the run');
  });

  it('steers a run that cannot ask instead of asking it', () => {
    const run = runOf({ canAskUser: false });
    for (let i = 0; i < 4; i++) unkeptTurn(run.progress, i);
    progressGuardTurn(run, 4, SELECTED);
    for (let i = 4; i < 6; i++) unkeptTurn(run.progress, i);
    expect(progressGuardTurn(run, 6, SELECTED)).toBeNull();
    expect(run.progress.steerNote()).toContain('PROGRESS CHECK 3');
    expect(forcedEvents(run).some((e) => (e.args as { forced?: string }).forced === 'ask_user')).toBe(false);
  });
});

describe('RunProgressGuard — what keeps a claim', () => {
  it('a hand-off after the claim clears the count', () => {
    const g = new RunProgressGuard(true);
    expect(unkeptTurn(g, 0)).toBeNull();
    g.noteTurnText(READY);
    g.observe('hand_off', { summary: 's', tasks: [{ title: 't' }] }, { data: { ok: true } });
    expect(g.endTurn()).toBeNull();
    // The count started over: one more unkept claim is the first again, not a trip.
    expect(unkeptTurn(g, 1)).toBeNull();
  });
});

describe('lever a3_progress_detector on the device', () => {
  const KEY = 'COST_LEVER_A3_PROGRESS_DETECTOR';
  const before = process.env[KEY];
  afterEach(() => {
    if (before === undefined) delete process.env[KEY];
    else process.env[KEY] = before;
  });

  it('is on by default and trips', () => {
    delete process.env[KEY];
    const g = new RunProgressGuard();
    const actions = [0, 1].map((i) => unkeptTurn(g, i));
    expect(actions[1]).toMatchObject({ kind: 'steer', signal: { kind: 'unkept_ready' } });
  });

  it('off in the env turns the guard off', () => {
    process.env[KEY] = 'off';
    const g = new RunProgressGuard();
    for (let i = 0; i < 8; i++) expect(unkeptTurn(g, i)).toBeNull();
    expect(g.steerNote()).toBe('');
  });
});
