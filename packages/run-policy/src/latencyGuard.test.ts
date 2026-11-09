import { describe, expect, it } from 'vitest';
import {
  LATENCY_SAMPLE_WINDOW,
  guardedPick,
  initialRunPolicy,
  latencyEligible,
  p50,
  recordLatency,
  reduceRunPolicy,
  withinLatencyBudget,
  type RunPolicyEvent,
  type RunPolicyState,
} from './index.js';

const KIMI = 'local/kimi-code/kimi-for-coding';
const FLASH = 'direct/minimax/MiniMax-M3.1-Flash-Preview';
const QWEN = 'direct/qwen/qwen3.8-max';

function run(state: RunPolicyState, ...events: RunPolicyEvent[]): RunPolicyState {
  return events.reduce(reduceRunPolicy, state);
}

describe('p50 / recordLatency', () => {
  it('takes the median and ignores junk', () => {
    expect(p50(undefined)).toBeUndefined();
    expect(p50([])).toBeUndefined();
    expect(p50([5, 1, 9])).toBe(5);
    expect(p50([4, 2, 8, 6])).toBe(5);
    expect(p50([Number.NaN, -1, 7])).toBe(7);
  });

  it('keeps a bounded window per model, most recent last', () => {
    let s = recordLatency(undefined, KIMI, 1);
    for (let i = 2; i <= LATENCY_SAMPLE_WINDOW + 3; i++) s = recordLatency(s, KIMI, i);
    expect(s[KIMI]).toHaveLength(LATENCY_SAMPLE_WINDOW);
    expect(s[KIMI]!.at(-1)).toBe(LATENCY_SAMPLE_WINDOW + 3);
    expect(recordLatency(s, '', 5)).toBe(s);
    expect(recordLatency(s, KIMI, Number.NaN)).toBe(s);
  });
});

describe('withinLatencyBudget', () => {
  const latency = { [KIMI]: [6_000, 5_500, 6_500], [FLASH]: [97_000, 46_000, 25_000], [QWEN]: [12_000] };

  it('refuses a candidate whose p50 is more than 3x the primary while the primary serves', () => {
    expect(withinLatencyBudget(FLASH, { primary: KIMI, latency })).toBe(false);
    expect(withinLatencyBudget(QWEN, { primary: KIMI, latency })).toBe(true);
    expect(latencyEligible([FLASH, QWEN, KIMI], { primary: KIMI, latency })).toEqual([QWEN, KIMI]);
  });

  it('steps aside when the primary is unavailable (error, 429, down)', () => {
    expect(withinLatencyBudget(FLASH, { primary: KIMI, latency, primaryUnavailable: true })).toBe(true);
  });

  it('treats an unmeasured model as no evidence of slowness', () => {
    expect(withinLatencyBudget('direct/x/unmeasured', { primary: KIMI, latency })).toBe(true);
    expect(withinLatencyBudget(FLASH, { primary: 'direct/x/unmeasured', latency })).toBe(true);
    expect(withinLatencyBudget(FLASH, { primary: undefined, latency })).toBe(true);
  });

  it('a guarded pick walks past slow candidates and gives up when only slow ones remain', () => {
    const order = [FLASH, QWEN];
    const pick = (skip: readonly string[]) => order.find((m) => !skip.includes(m));
    expect(guardedPick(pick, [], { primary: KIMI, latency })).toBe(QWEN);
    expect(guardedPick(pick, [QWEN], { primary: KIMI, latency })).toBeUndefined();
  });
});

describe('the run policy fails over latency-aware on code and verify turns', () => {
  /** A coding run where Kimi acted at ~6s a turn and MiniMax Flash acted at 25–97s. */
  function codingRun(): RunPolicyState {
    return run(
      initialRunPolicy({ preferProvenFailover: true, startPhase: 'code' }),
      { type: 'turn_succeeded', model: KIMI, acted: true, durationMs: 6_000 },
      { type: 'turn_succeeded', model: FLASH, acted: true, durationMs: 97_000 },
      { type: 'turn_succeeded', model: KIMI, acted: true, durationMs: 5_800 },
      { type: 'turn_succeeded', model: FLASH, acted: true, durationMs: 46_000 },
    );
  }

  it('records each served turn duration against the model that served it', () => {
    const s = codingRun();
    expect(s.latency?.[KIMI]).toEqual([6_000, 5_800]);
    expect(s.latency?.[FLASH]).toEqual([97_000, 46_000]);
  });

  it('a stall on the primary does not hand the turn to the slow proven model', () => {
    const s = reduceRunPolicy(codingRun(), { type: 'stalled', resolvedModel: KIMI });
    expect(s.outcome.kind).toBe('failover_exhausted');
  });

  it('a stall still fails over to a proven model within budget', () => {
    const s = run(
      codingRun(),
      { type: 'turn_succeeded', model: QWEN, acted: true, durationMs: 12_000 },
      { type: 'stalled', resolvedModel: KIMI },
    );
    expect(s.outcome).toMatchObject({ kind: 'failed_over', to: QWEN });
  });

  it('the host picker is walked past slow models too', () => {
    const s = reduceRunPolicy(
      run(initialRunPolicy({ startPhase: 'code' }), { type: 'turn_succeeded', model: KIMI, acted: true, durationMs: 6_000 }, { type: 'turn_succeeded', model: FLASH, durationMs: 60_000 }),
      { type: 'stalled', resolvedModel: KIMI, pick: (skip) => [FLASH, QWEN].find((m) => !skip.includes(m)) },
    );
    expect(s.outcome).toMatchObject({ kind: 'failed_over', to: QWEN });
  });

  it('an unavailable primary may fail over to the slow model — any model beats none', () => {
    const s = reduceRunPolicy(codingRun(), { type: 'stalled', resolvedModel: KIMI, primaryUnavailable: true });
    expect(s.outcome).toMatchObject({ kind: 'failed_over', to: FLASH });
  });

  it('a planning turn is not latency-guarded', () => {
    const s = run(
      initialRunPolicy({ preferProvenFailover: true }),
      { type: 'turn_succeeded', model: KIMI, acted: true, durationMs: 6_000 },
      { type: 'turn_succeeded', model: FLASH, acted: true, durationMs: 97_000 },
      { type: 'stalled', resolvedModel: KIMI },
    );
    expect(s.outcome).toMatchObject({ kind: 'failed_over', to: FLASH });
  });

  it('a host seed is the starting evidence', () => {
    const s = run(
      initialRunPolicy({ preferProvenFailover: true, startPhase: 'verify', latencySeed: { [KIMI]: [6_000], [FLASH]: [90_000] } }),
      { type: 'turn_succeeded', model: KIMI, acted: true },
      { type: 'turn_succeeded', model: FLASH, acted: true },
      { type: 'stalled', resolvedModel: KIMI },
    );
    expect(s.outcome.kind).toBe('failover_exhausted');
  });
});
