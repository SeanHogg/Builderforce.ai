import { describe, expect, it } from 'vitest';
import { MAX_MODEL_FAILOVERS } from '@builderforce/agent-stall';
import {
  PIN_RELEASE_STATUSES,
  initialRunPolicy,
  nextTurn,
  offersHandOff,
  reduceRunPolicy,
  type RunPolicyEvent,
  type RunPolicyState,
} from './index.js';

/** Fold a sequence of events, as a host does over one run. */
function run(state: RunPolicyState, ...events: RunPolicyEvent[]): RunPolicyState {
  return events.reduce(reduceRunPolicy, state);
}

const TOOLS = { hasTools: true };

describe('nextTurn', () => {
  it('asks for the phase on a tool turn and chat on a tool-less one', () => {
    const s = initialRunPolicy();
    expect(nextTurn(s, TOOLS).role).toBe('plan');
    expect(nextTurn(s, { hasTools: false }).role).toBe('chat');
    expect(nextTurn(initialRunPolicy({ startPhase: 'code' }), TOOLS).role).toBe('code');
  });

  it('is strict only while a model is set', () => {
    expect(nextTurn(initialRunPolicy({ strictPin: true }), TOOLS)).toMatchObject({ model: undefined, strict: false });
    expect(nextTurn(initialRunPolicy({ pinnedModel: 'opus', strictPin: true }), TOOLS)).toMatchObject({ model: 'opus', strict: true });
    expect(nextTurn(initialRunPolicy({ pinnedModel: 'opus' }), TOOLS)).toMatchObject({ model: 'opus', strict: false });
  });

  it('treats an empty pin as auto-select', () => {
    expect(nextTurn(initialRunPolicy({ pinnedModel: '' }), TOOLS).model).toBeUndefined();
  });
});

describe('plan → code', () => {
  it('re-asks the turn as code when an auto-routed plan turn reaches for a code change', () => {
    const s = run(initialRunPolicy(), { type: 'code_change_attempted' });
    expect(s.outcome).toEqual({ kind: 'reask_as_coder' });
    expect(s.phase).toBe('code');
    expect(nextTurn(s, TOOLS).role).toBe('code');
  });

  it('a pinned model disables the implicit switch', () => {
    const s = run(initialRunPolicy({ pinnedModel: 'grok' }), { type: 'code_change_attempted' });
    expect(s.outcome).toEqual({ kind: 'none' });
    expect(s.phase).toBe('plan');
  });

  it('re-asks only once — a run already coding just carries on', () => {
    const s = run(initialRunPolicy(), { type: 'code_change_attempted' }, { type: 'code_change_attempted' });
    expect(s.outcome).toEqual({ kind: 'none' });
    expect(s.phase).toBe('code');
  });

  it('a locked model disables it too', () => {
    const s = run(
      initialRunPolicy({ lockAfterFirstSuccess: true }),
      { type: 'turn_succeeded', model: 'minimax' },
      { type: 'code_change_attempted' },
    );
    expect(s.outcome.kind).toBe('none');
    expect(s.phase).toBe('plan');
  });
});

describe('hand_off', () => {
  it('ends planning, and the menu stops offering it', () => {
    const s0 = initialRunPolicy();
    expect(offersHandOff(s0)).toBe(true);
    const s = run(s0, { type: 'hand_off' });
    expect(s.outcome).toEqual({ kind: 'handed_off' });
    expect(s.phase).toBe('code');
    expect(offersHandOff(s)).toBe(false);
  });

  it('is accepted under a pin — the explicit hand-off is the planner’s own call', () => {
    expect(run(initialRunPolicy({ pinnedModel: 'opus' }), { type: 'hand_off' }).phase).toBe('code');
  });

  it('is rejected once the plan is already handed off', () => {
    const s = run(initialRunPolicy(), { type: 'hand_off' }, { type: 'hand_off' });
    expect(s.outcome).toEqual({ kind: 'hand_off_rejected' });
  });

  it('verify_started moves the phase forward', () => {
    const s = run(initialRunPolicy({ startPhase: 'code' }), { type: 'verify_started' });
    expect(nextTurn(s, TOOLS).role).toBe('verify');
    expect(offersHandOff(s)).toBe(false);
  });
});

describe('transport failures', () => {
  it('excludes a model that broke mid-stream from every later turn, and retries once', () => {
    let s = run(initialRunPolicy(), { type: 'transport_failed', kind: 'interrupted', model: 'grok' });
    expect(s.outcome).toEqual({ kind: 'retry_turn', broken: 'grok' });
    expect(nextTurn(s, TOOLS).excludeModels).toEqual(['grok']);
    s = run(s, { type: 'turn_succeeded', model: 'kimi' });
    // A broken model is never re-chosen — later turns still exclude it.
    expect(nextTurn(s, TOOLS).excludeModels).toEqual(['grok']);
    s = run(s, { type: 'transport_failed', kind: 'interrupted', model: 'kimi' });
    expect(nextTurn(s, TOOLS).excludeModels).toEqual(['grok', 'kimi']);
  });

  it('fails the turn when the retry fails too', () => {
    const s = run(
      initialRunPolicy(),
      { type: 'transport_failed', kind: 'interrupted', model: 'grok' },
      { type: 'transport_failed', kind: 'interrupted', model: 'kimi' },
    );
    expect(s.outcome).toEqual({ kind: 'fail_turn' });
  });

  it('retries a reached-gateway failure without excluding anyone', () => {
    const s = run(initialRunPolicy(), { type: 'transport_failed', kind: 'transport' });
    expect(s.outcome).toEqual({ kind: 'retry_turn' });
    expect(s.broken).toEqual([]);
  });

  it('never retries an unreachable gateway — no model was asked', () => {
    expect(run(initialRunPolicy(), { type: 'transport_failed', kind: 'unreachable' }).outcome).toEqual({ kind: 'fail_turn' });
  });

  it('does not route around a user pin', () => {
    const s = run(initialRunPolicy({ pinnedModel: 'opus', strictPin: true }), { type: 'transport_failed', kind: 'interrupted', model: 'opus', status: 429 });
    expect(s.outcome).toEqual({ kind: 'fail_turn' });
    expect(s.model).toBe('opus');
  });

  it('releases a releasable pin on 429/413/503 for the rest of the run', () => {
    for (const status of PIN_RELEASE_STATUSES) {
      const s = run(initialRunPolicy({ pinnedModel: 'opus', strictPin: true, pinReleasable: true }), { type: 'transport_failed', kind: 'transport', status });
      expect(s.outcome).toEqual({ kind: 'retry_turn', released: 'opus', status });
      expect(nextTurn(s, TOOLS)).toMatchObject({ model: undefined, strict: false });
    }
    expect(run(initialRunPolicy({ pinnedModel: 'opus', pinReleasable: true }), { type: 'transport_failed', kind: 'transport', status: 500 }).outcome)
      .toEqual({ kind: 'fail_turn' });
  });
});

describe('lockAfterFirstSuccess', () => {
  it('locks onto the resolved model, unlocks on a release status, and re-locks on the next success', () => {
    let s = initialRunPolicy({ lockAfterFirstSuccess: true });
    s = run(s, { type: 'turn_succeeded', model: 'minimax' });
    expect(nextTurn(s, TOOLS)).toMatchObject({ model: 'minimax', strict: false });
    expect(s.locked).toBe(true);
    s = run(s, { type: 'transport_failed', kind: 'transport', status: 413 });
    expect(s.outcome).toEqual({ kind: 'retry_turn', released: 'minimax', status: 413 });
    expect(nextTurn(s, TOOLS).model).toBeUndefined();
    s = run(s, { type: 'turn_succeeded', model: 'gemini' });
    expect(nextTurn(s, TOOLS).model).toBe('gemini');
  });

  it('does not lock without a resolved model, or over a strict pin', () => {
    expect(run(initialRunPolicy({ lockAfterFirstSuccess: true }), { type: 'turn_succeeded' }).model).toBeUndefined();
    const pinned = run(initialRunPolicy({ lockAfterFirstSuccess: true, pinnedModel: 'opus', strictPin: true }), { type: 'turn_succeeded', model: 'other' });
    expect(pinned.model).toBe('opus');
    expect(pinned.locked).toBe(false);
  });

  it('a locked model that breaks mid-stream is let go and routed around for the rest of the run', () => {
    let s = run(
      initialRunPolicy({ lockAfterFirstSuccess: true }),
      { type: 'turn_succeeded', model: 'minimax' },
      { type: 'transport_failed', kind: 'interrupted', model: 'minimax' },
    );
    expect(s.outcome).toEqual({ kind: 'retry_turn', broken: 'minimax', released: 'minimax' });
    expect(nextTurn(s, TOOLS)).toMatchObject({ model: undefined, excludeModels: ['minimax'] });
    // The retry failing too is the end of the turn.
    expect(run(s, { type: 'transport_failed', kind: 'interrupted', model: 'kimi' }).outcome).toEqual({ kind: 'fail_turn' });
    // A success re-locks onto whoever served it; the broken model stays excluded.
    s = run(s, { type: 'turn_succeeded', model: 'kimi' });
    expect(nextTurn(s, TOOLS)).toMatchObject({ model: 'kimi', excludeModels: ['minimax'] });
  });

  it('a locked model that fails in transport without a release status fails the turn', () => {
    const s = run(
      initialRunPolicy({ lockAfterFirstSuccess: true }),
      { type: 'turn_succeeded', model: 'minimax' },
      { type: 'transport_failed', kind: 'transport', status: 500 },
    );
    expect(s.outcome).toEqual({ kind: 'fail_turn' });
  });

  it('does not make the first lock strict when nothing was pinned', () => {
    const s = run(initialRunPolicy({ lockAfterFirstSuccess: true, strictPin: true }), { type: 'turn_succeeded', model: 'minimax' });
    expect(nextTurn(s, TOOLS)).toMatchObject({ model: 'minimax', strict: false });
  });
});

describe('declining backends', () => {
  const opts = { pinnedModel: 'evermind/p1', strictPin: true, pinReleasable: true, decliningModelPrefixes: ['evermind/'] };

  it('a 400 from a declining backend releases the pin like a release status', () => {
    const s = run(initialRunPolicy(opts), { type: 'transport_failed', kind: 'transport', status: 400 });
    expect(s.outcome).toEqual({ kind: 'retry_turn', released: 'evermind/p1', status: 400 });
    expect(nextTurn(s, TOOLS)).toMatchObject({ model: undefined, strict: false });
  });

  it('a 400 from any other model is a refused request and fails fast', () => {
    expect(run(initialRunPolicy({ ...opts, pinnedModel: 'opus' }), { type: 'transport_failed', kind: 'transport', status: 400 }).outcome)
      .toEqual({ kind: 'fail_turn' });
    // Not even under auto-routing: the same request gets the same answer from anyone.
    expect(run(initialRunPolicy(), { type: 'transport_failed', kind: 'transport', status: 401 }).outcome).toEqual({ kind: 'fail_turn' });
  });

  it('a 408 is still the model’s failure and is retried under auto-routing', () => {
    expect(run(initialRunPolicy(), { type: 'transport_failed', kind: 'transport', status: 408 }).outcome).toEqual({ kind: 'retry_turn' });
  });
});

describe('fixedRole', () => {
  it('asks for the delegated role on every tool turn, and chat without tools', () => {
    const s = initialRunPolicy({ fixedRole: 'explore', startPhase: 'code' });
    expect(nextTurn(s, TOOLS).role).toBe('explore');
    expect(nextTurn(s, { hasTools: false }).role).toBe('chat');
  });
});

describe('excludeModels', () => {
  it('routes around a session’s known failures from the first turn', () => {
    const s = initialRunPolicy({ excludeModels: ['grok', 'grok', ''] });
    expect(nextTurn(s, TOOLS).excludeModels).toEqual(['grok']);
  });
});

describe('stall failover', () => {
  const pick = (order: string[]) => (tried: readonly string[]) => order.find((m) => !tried.includes(m));

  it('fails over to a different model and records both the asked-for and resolved ids', () => {
    const s = run(initialRunPolicy(), { type: 'stalled', resolvedModel: 'grok', pick: pick(['grok', 'claude']) });
    expect(s.outcome).toEqual({ kind: 'failed_over', from: 'grok', to: 'claude', attempt: 1, of: MAX_MODEL_FAILOVERS });
    expect(nextTurn(s, TOOLS).model).toBe('claude');
    expect(s.tried).toEqual(['grok']);
  });

  it('stops at the failover cap', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    let s = initialRunPolicy({ pinnedModel: 'a' });
    for (let i = 0; i < MAX_MODEL_FAILOVERS; i += 1) {
      s = run(s, { type: 'stalled', resolvedModel: s.model, pick: pick(order) });
      expect(s.outcome.kind).toBe('failed_over');
    }
    s = run(s, { type: 'stalled', resolvedModel: s.model, pick: pick(order) });
    expect(s.outcome.kind).toBe('failover_exhausted');
    expect(s.failovers).toBe(MAX_MODEL_FAILOVERS);
    expect(s.tried).toEqual(order.slice(0, MAX_MODEL_FAILOVERS + 1));
  });

  it('honours a configured cap', () => {
    const s = run(initialRunPolicy({ maxFailovers: 0 }), { type: 'stalled', resolvedModel: 'grok', pick: pick(['claude']) });
    expect(s.outcome).toEqual({ kind: 'failover_exhausted', tried: ['grok'] });
  });

  it('never hands back a model already tried, even from a careless picker', () => {
    const s = run(initialRunPolicy(), { type: 'stalled', resolvedModel: 'grok', pick: () => 'grok' });
    expect(s.outcome.kind).toBe('failover_exhausted');
  });

  it('draws from the model surface when the host passes no picker', () => {
    const s = run(initialRunPolicy(), { type: 'stalled', resolvedModel: 'grok', surface: { codingModels: ['grok', 'sonnet'] } });
    expect(s.outcome).toMatchObject({ kind: 'failed_over', to: 'sonnet' });
  });

  it('prefers a model that already acted in this run, most recent first, and pins it strictly when asked', () => {
    const s = run(
      initialRunPolicy({ preferProvenFailover: true, strictFailover: true, lockAfterFirstSuccess: true }),
      { type: 'turn_succeeded', model: 'kimi', acted: true },
      { type: 'turn_succeeded', model: 'claude', acted: true },
      { type: 'turn_succeeded', model: 'grok', acted: false },
      { type: 'stalled', resolvedModel: 'grok', pick: pick(['sonnet']) },
    );
    expect(s.outcome).toMatchObject({ kind: 'failed_over', to: 'claude' });
    expect(nextTurn(s, TOOLS)).toMatchObject({ model: 'claude', strict: true });
  });

  it('falls back to the host picker once no proven model is left, skipping broken models', () => {
    const s = run(
      initialRunPolicy({ preferProvenFailover: true, excludeModels: ['kimi'] }),
      { type: 'turn_succeeded', model: 'grok', acted: true },
      { type: 'stalled', resolvedModel: 'grok', pick: pick(['kimi', 'sonnet']) },
    );
    expect(s.outcome).toMatchObject({ kind: 'failed_over', to: 'sonnet' });
  });

  it('never offers a proven model the run has since excluded', () => {
    const s = run(
      initialRunPolicy({ preferProvenFailover: true }),
      { type: 'turn_succeeded', model: 'kimi', acted: true },
      { type: 'transport_failed', kind: 'interrupted', model: 'kimi' },
      { type: 'stalled', resolvedModel: 'grok' },
    );
    expect(s.outcome.kind).toBe('failover_exhausted');
  });

  it('lets go of a LOCK when nothing is left to fail over to, but keeps a pin', () => {
    const locked = run(
      initialRunPolicy({ lockAfterFirstSuccess: true }),
      { type: 'turn_succeeded', model: 'minimax' },
      { type: 'stalled', resolvedModel: 'minimax' },
    );
    expect(locked.outcome.kind).toBe('failover_exhausted');
    expect(nextTurn(locked, TOOLS).model).toBeUndefined();
    const pinned = run(initialRunPolicy({ pinnedModel: 'opus' }), { type: 'stalled', resolvedModel: 'opus' });
    expect(pinned.outcome.kind).toBe('failover_exhausted');
    expect(pinned.model).toBe('opus');
  });

  it('returns to the pin, as configured, when a failover target is spent too', () => {
    const s = run(
      initialRunPolicy({ pinnedModel: 'opus', strictPin: true, preferProvenFailover: true, strictFailover: true }),
      { type: 'turn_succeeded', model: 'kimi', acted: true },
      { type: 'stalled', resolvedModel: 'opus' },
      { type: 'stalled', resolvedModel: 'kimi' },
    );
    expect(s.outcome.kind).toBe('failover_exhausted');
    expect(nextTurn(s, TOOLS)).toMatchObject({ model: 'opus', strict: true });
  });

  it('never returns to a pin a release status already dropped', () => {
    const s = run(
      initialRunPolicy({ pinnedModel: 'opus', strictPin: true, pinReleasable: true, lockAfterFirstSuccess: true }),
      { type: 'transport_failed', kind: 'transport', status: 429 },
      { type: 'turn_succeeded', model: 'sonnet' },
      { type: 'stalled', resolvedModel: 'sonnet' },
    );
    expect(s.outcome.kind).toBe('failover_exhausted');
    expect(nextTurn(s, TOOLS).model).toBeUndefined();
  });

  it('does not mutate the state it was given', () => {
    const s0 = initialRunPolicy();
    run(s0, { type: 'stalled', resolvedModel: 'grok', pick: pick(['claude']) });
    expect(s0.tried).toEqual([]);
    expect(s0.model).toBeUndefined();
  });
});
