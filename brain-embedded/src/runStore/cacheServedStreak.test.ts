import { describe, expect, it } from 'vitest';
import { initialRunPolicy, reduceRunPolicy, type RunPhase } from '@builderforce/run-policy';
import type { BrainToolSpec } from '../streamChatCompletion';
import { makeCell } from './runCell';
import type { RunLoopContext } from './runLoopContext';
import { CACHE_SERVED_STREAK, CacheServedStreak, MAX_NO_PROGRESS_TURNS, noProgressTurn } from './cacheServedStreak';

const spec = (name: string): BrainToolSpec => ({ type: 'function', function: { name, description: '', parameters: { type: 'object', properties: {} } } }) as BrainToolSpec;
const SELECTED = ['read_file', 'search_code', 'edit_file', 'write_file', 'ask_user'].map(spec);

function runIn(phase: RunPhase, userRequest = 'complete the implementation'): RunLoopContext {
  return {
    c: makeCell(),
    canAskUser: true,
    metadata: { mode: 'work' },
    userRequest,
    usedTools: new Set<string>(),
    policy: initialRunPolicy({ startPhase: phase }),
    cacheStreak: new CacheServedStreak(),
  } as unknown as RunLoopContext;
}

/** `n` cache answers, two to a turn — a run circling over several turns. */
const circle = (run: RunLoopContext, n = CACHE_SERVED_STREAK) => {
  for (let i = 0; i < n; i++) run.cacheStreak.served(Math.floor(i / 2));
};
const names = (tools: readonly BrainToolSpec[] | undefined) => (tools ?? []).map((t) => t.function.name);

describe('CacheServedStreak', () => {
  it('counts cache answers and clears on a call the host ran', () => {
    const s = new CacheServedStreak();
    for (let i = 0; i < CACHE_SERVED_STREAK - 1; i++) s.served(i);
    s.ran();
    s.served(9);
    expect(s.count).toBe(1);
    expect(s.due()).toBe(false);
  });

  it('is not circling when one turn fans out every repeat', () => {
    const s = new CacheServedStreak();
    for (let i = 0; i < CACHE_SERVED_STREAK + 2; i++) s.served(4);
    expect(s.due()).toBe(false);
    s.served(5);
    expect(s.due()).toBe(true);
  });

  it(`is due at ${CACHE_SERVED_STREAK} in a row, at most ${MAX_NO_PROGRESS_TURNS} times a run`, () => {
    const s = new CacheServedStreak();
    let fired = 0;
    for (let round = 0; round < MAX_NO_PROGRESS_TURNS + 2; round++) {
      for (let i = 0; i < CACHE_SERVED_STREAK; i++) s.served(round * 10 + i);
      if (s.due()) {
        s.consume();
        fired++;
      }
    }
    expect(fired).toBe(MAX_NO_PROGRESS_TURNS);
  });
});

describe('noProgressTurn', () => {
  it('is nothing while the run is still making real calls', () => {
    const run = runIn('code');
    circle(run, CACHE_SERVED_STREAK - 1);
    expect(noProgressTurn(run, 3, SELECTED)).toBeNull();
  });

  it('forces the hand-off while planning (chat #5739 run 5: 52 plan turns of cache answers)', () => {
    const run = runIn('plan');
    circle(run);
    const turn = noProgressTurn(run, 9, [...SELECTED, spec('hand_off')]);
    expect(names(turn?.tools)).toEqual(['hand_off']);
    expect(turn?.toolChoice).toBe('required');
    expect(run.policy.handOffForced).toBe(true);
    expect(run.c.trace.some((e) => e.label === 'loop.no_progress')).toBe(true);
  });

  it('ends planning and forces the change once the forced hand-off was ignored', () => {
    const run = runIn('plan');
    circle(run);
    noProgressTurn(run, 9, SELECTED);
    circle(run);
    const turn = noProgressTurn(run, 12, [...SELECTED, spec('hand_off')]);
    expect(run.policy.phase).toBe('code');
    expect(names(turn?.tools)).toEqual(['edit_file', 'write_file', 'ask_user']);
  });

  it('forces the change tools while coding', () => {
    const run = runIn('code');
    circle(run);
    const turn = noProgressTurn(run, 30, SELECTED);
    expect(names(turn?.tools)).toEqual(['edit_file', 'write_file', 'ask_user']);
    expect(run.policy.changeForced).toBe(true);
  });

  it('keeps the streak for a turn that can force the change', () => {
    const run = runIn('code');
    circle(run);
    expect(noProgressTurn(run, 30, [spec('read_file')])).toBeNull();
    expect(names(noProgressTurn(run, 31, SELECTED)?.tools)).toEqual(['edit_file', 'write_file', 'ask_user']);
  });

  it('never forces a run that has already made its change, or handed it off', () => {
    const edited = runIn('code');
    edited.c.codeChanged = true;
    circle(edited);
    expect(noProgressTurn(edited, 30, SELECTED)).toBeNull();
    const handedOff = runIn('code');
    handedOff.usedTools.add('hand_off');
    circle(handedOff);
    expect(noProgressTurn(handedOff, 30, SELECTED)).toBeNull();
  });

  it('never forces a review — verifying re-reads the author files by design', () => {
    const run = runIn('code');
    run.policy = reduceRunPolicy(run.policy, { type: 'verify_started' });
    circle(run);
    expect(noProgressTurn(run, 30, SELECTED)).toBeNull();
  });

  it('never forces a run that was asked a question', () => {
    const run = runIn('code', 'how does the steer path carry attachments?');
    circle(run);
    expect(noProgressTurn(run, 30, SELECTED)).toBeNull();
  });

  it('names ask_user in the brief only when it is offered', () => {
    const run = runIn('code');
    run.canAskUser = false;
    circle(run);
    const turn = noProgressTurn(run, 30, SELECTED);
    expect(names(turn?.tools)).toEqual(['edit_file', 'write_file']);
    expect(String(turn?.brief.content)).not.toContain('ask_user');
  });
});
