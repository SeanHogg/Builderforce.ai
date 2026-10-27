import { describe, expect, it } from 'vitest';
import { initialRunPolicy, nextTurn, reduceRunPolicy, type RunPolicyEvent, type RunPolicyState } from './index.js';

function run(state: RunPolicyState, ...events: RunPolicyEvent[]): RunPolicyState {
  return events.reduce(reduceRunPolicy, state);
}

const TOOLS = { hasTools: true };
const PHASES = { plan: 'planner', code: 'coder', verify: 'reviewer' } as const;

describe('phaseModels — every phase is read by nextTurn', () => {
  it('asks the plan model while planning and the code model once coding', () => {
    let s = initialRunPolicy({ phaseModels: PHASES });
    expect(nextTurn(s, TOOLS)).toMatchObject({ role: 'plan', model: 'planner', strict: false });
    s = run(s, { type: 'hand_off' });
    expect(nextTurn(s, TOOLS)).toMatchObject({ role: 'code', model: 'coder', strict: false });
    s = run(s, { type: 'verify_started' });
    expect(nextTurn(s, TOOLS)).toMatchObject({ role: 'verify', model: 'reviewer' });
  });

  it('a pinned model wins over the plan / code models', () => {
    const s = initialRunPolicy({ pinnedModel: 'mine', strictPin: true, phaseModels: PHASES });
    expect(nextTurn(s, TOOLS).model).toBe('mine');
    expect(nextTurn(run(s, { type: 'hand_off' }), TOOLS).model).toBe('mine');
  });

  it('a stall failover is not undone by the code model', () => {
    const s = run(
      initialRunPolicy({ startPhase: 'code', phaseModels: PHASES }),
      { type: 'stalled', resolvedModel: 'coder', pick: () => 'rescuer' },
    );
    expect(s.outcome).toMatchObject({ kind: 'failed_over', to: 'rescuer' });
    expect(nextTurn(s, TOOLS).model).toBe('rescuer');
  });

  it('a fixed-role run is never handed the code model', () => {
    const s = initialRunPolicy({ startPhase: 'code', fixedRole: 'explore', phaseModels: PHASES });
    expect(nextTurn(s, TOOLS)).toMatchObject({ role: 'explore', model: undefined });
  });

  it('a phase model that broke mid-stream is routed around for the rest of the run', () => {
    const s = run(
      initialRunPolicy({ startPhase: 'code', phaseModels: PHASES }),
      { type: 'transport_failed', kind: 'interrupted', model: 'coder' },
    );
    expect(nextTurn(s, TOOLS)).toMatchObject({ model: undefined, excludeModels: ['coder'] });
  });

  it('a release status on the phase model drops it for the rest of the run', () => {
    const s = run(
      initialRunPolicy({ startPhase: 'code', phaseModels: PHASES }),
      { type: 'transport_failed', kind: 'transport', model: 'coder', status: 429 },
    );
    expect(s.outcome).toMatchObject({ kind: 'retry_turn' });
    expect(nextTurn(s, TOOLS)).toMatchObject({ model: undefined, excludeModels: ['coder'] });
  });

  it('the review excludes the code model that wrote the change', () => {
    const s = run(
      initialRunPolicy({ startPhase: 'code', phaseModels: { code: 'coder' } }),
      { type: 'verify_started' },
    );
    expect(s.authorModel).toBe('coder');
    expect(nextTurn(s, TOOLS)).toMatchObject({ role: 'verify', model: undefined, excludeModels: ['coder'] });
  });

  it('no phase models keeps the auto-routed request unchanged', () => {
    const s = initialRunPolicy({ startPhase: 'code' });
    expect(nextTurn(s, TOOLS)).toEqual({ role: 'code', model: undefined, strict: false, excludeModels: [] });
  });
});
