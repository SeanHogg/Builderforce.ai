import { describe, expect, it } from 'vitest';
import { byoAwareModel } from './tenantProxy';

// byoAwareModel is the gate EVERY tenant-facing site relies on to decide whether an
// explicit model (an agent base model, a workflow node config, a compile-run pin) is
// honored or dropped in favour of the connected-account seed. It is the single decision
// that prevents the drift bug (a default `@cf/qwen` base model shadowing a connected
// Claude subscription), so it is unit-pinned here for every branch.
describe('byoAwareModel', () => {
  it('no explicit model → undefined (let complete() seed the connected flagship)', () => {
    expect(byoAwareModel(undefined, new Set(['anthropic']))).toBeUndefined();
    expect(byoAwareModel('', new Set(['anthropic']))).toBeUndefined();
    expect(byoAwareModel('   ', new Set(['anthropic']))).toBeUndefined();
  });

  it('non-BYO explicit model while an account is connected → undefined (connected account wins)', () => {
    // The reported bug: a default `@cf/qwen` base model must NOT be passed through when
    // a Claude subscription is connected — it would shadow the connected flagship.
    expect(byoAwareModel('@cf/qwen/qwen3-30b-a3b-fp8', new Set(['anthropic']))).toBeUndefined();
    expect(byoAwareModel('openai/gpt-4.1', new Set(['anthropic']))).toBeUndefined();
  });

  it('explicit model ON the connected account → honored (a deliberate BYO pick)', () => {
    expect(byoAwareModel('claude-opus-5', new Set(['anthropic']))).toBe('claude-opus-5');
    expect(byoAwareModel('  claude-opus-5  ', new Set(['anthropic']))).toBe('claude-opus-5');
    expect(byoAwareModel('direct/openai/gpt-4.1', new Set(['openai']))).toBe('direct/openai/gpt-4.1');
  });

  it('a SUPERSEDED pin is honored as its live successor, not dispatched stale', () => {
    // Stored pins outlive the model they name. Rewriting inside byoAwareModel keeps the
    // BYO gate and the dispatched id on ONE model — otherwise a months-old agent
    // base_model rides a retired id into the chain and is silently filtered out of it.
    expect(byoAwareModel('claude-opus-4-8', new Set(['anthropic']))).toBe('claude-opus-5');
    expect(byoAwareModel('  claude-opus-4-8  ', new Set(['anthropic']))).toBe('claude-opus-5');
  });

  it('nothing connected → any explicit model is honored (normal plan routing)', () => {
    expect(byoAwareModel('@cf/qwen/qwen3-30b-a3b-fp8', new Set())).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(byoAwareModel('openai/gpt-4.1', undefined)).toBe('openai/gpt-4.1');
  });
});
