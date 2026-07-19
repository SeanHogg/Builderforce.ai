/**
 * Pre-finish gates for the cloud tool loop — the deterministic guards that decide
 * whether a `finish` is honored or blocked back to the agent.
 *
 *  • assertsUnrunVerification — honesty gate (claims a check passed that can't run).
 *  • hasNoCodeDeliverable     — completeness self-review (ROADMAP #38): a code-bound
 *    run finishing with no real code deliverable, only the seeded PRD or nothing.
 *  • policyGateCallKey        — governance gate identity: which `require-approval`
 *    decisions a human has already answered.
 *
 * All pure, so they're unit-tested in isolation here (the loop wiring just picks the
 * block message and re-prompts).
 */
import { describe, it, expect } from 'vitest';
import { assertsUnrunVerification, hasNoCodeDeliverable, policyGateCallKey } from './cloudAgentTools';

describe('hasNoCodeDeliverable (ROADMAP #38 completeness self-review)', () => {
  it('flags an empty deliverable set (nothing written)', () => {
    expect(hasNoCodeDeliverable(new Set())).toBe(true);
  });

  it('flags a PRD-only branch (the seeded PRD.md is not a code deliverable)', () => {
    // execution #20 footgun: a PR with PRD.md but no actual code change.
    expect(hasNoCodeDeliverable(new Set(['PRD.md']))).toBe(true);
  });

  it('passes once any real code file was committed', () => {
    expect(hasNoCodeDeliverable(new Set(['PRD.md', 'src/feature.ts']))).toBe(false);
    expect(hasNoCodeDeliverable(new Set(['src/feature.ts']))).toBe(false);
  });
});

describe('assertsUnrunVerification (honesty gate) — unchanged contract', () => {
  it('blocks a summary claiming a check passed', () => {
    expect(assertsUnrunVerification('The typecheck now passes and all tests are green.')).toBe(true);
  });
  it('allows an honest summary that does not claim a check passed', () => {
    expect(assertsUnrunVerification('Implemented the new route; CI on the PR will verify it.')).toBe(false);
  });
});

describe('policyGateCallKey (require-approval is once-per-CALL, not once-per-run)', () => {
  it('gives the SAME key to a retried identical call, so an approval is not re-asked', () => {
    const a = policyGateCallKey('g1', 'run_command', { command: 'ls -la' });
    const b = policyGateCallKey('g1', 'run_command', { command: 'ls -la' });
    expect(a).toBe(b);
  });

  it('is argument-order independent (the model may emit keys in any order)', () => {
    const a = policyGateCallKey('g1', 'write_file', { path: 'a.ts', content: 'x' });
    const b = policyGateCallKey('g1', 'write_file', { content: 'x', path: 'a.ts' });
    expect(a).toBe(b);
  });

  it('gives DIFFERENT keys to different arguments — the actual bug: approving one call must not pre-approve another', () => {
    const approved = policyGateCallKey('g1', 'run_command', { command: 'ls' });
    const dangerous = policyGateCallKey('g1', 'run_command', { command: 'rm -rf /' });
    expect(dangerous).not.toBe(approved);
    // The asked-set semantics the loop relies on.
    expect(new Set([approved]).has(dangerous)).toBe(false);
  });

  it('gives different keys to different tools and different gates', () => {
    expect(policyGateCallKey('g1', 'write_file', { p: 1 })).not.toBe(policyGateCallKey('g1', 'delete_file', { p: 1 }));
    expect(policyGateCallKey('g1', 'write_file', { p: 1 })).not.toBe(policyGateCallKey('g2', 'write_file', { p: 1 }));
  });

  it('distinguishes nested and array argument shapes', () => {
    expect(policyGateCallKey('g', 't', { a: { b: 1 } })).not.toBe(policyGateCallKey('g', 't', { a: { b: 2 } }));
    expect(policyGateCallKey('g', 't', { a: [1, 2] })).not.toBe(policyGateCallKey('g', 't', { a: [2, 1] }));
    expect(policyGateCallKey('g', 't', { a: [1, 2] })).toBe(policyGateCallKey('g', 't', { a: [1, 2] }));
  });

  it('is a plain serializable string (it round-trips through CloudLoopState as JSON)', () => {
    const key = policyGateCallKey('g1', 'run_command', { command: 'ls' });
    expect(typeof key).toBe('string');
    expect(JSON.parse(JSON.stringify([key]))).toEqual([key]);
  });

  it('handles empty and undefined-valued arguments without collapsing distinct calls', () => {
    expect(policyGateCallKey('g', 't', {})).toBe(policyGateCallKey('g', 't', { x: undefined }));
    expect(policyGateCallKey('g', 't', {})).not.toBe(policyGateCallKey('g', 't', { x: null }));
  });
});
