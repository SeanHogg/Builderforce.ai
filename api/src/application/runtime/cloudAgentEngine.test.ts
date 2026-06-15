import { describe, it, expect } from 'vitest';
import { isCodingModelDegraded, agentAllowsHostExecution } from './cloudAgentEngine';
import { CODING_MODEL_POOL, CODING_BACKSTOP_MODELS } from '../llm/LlmProxyService';

describe('agentAllowsHostExecution', () => {
  it('blocks a cloud-only agent from a pinned host', () => {
    expect(agentAllowsHostExecution('cloud')).toBe(false);
  });
  it('permits host/both/legacy (undefined) agents', () => {
    expect(agentAllowsHostExecution('host')).toBe(true);
    expect(agentAllowsHostExecution('both')).toBe(true);
    expect(agentAllowsHostExecution(undefined)).toBe(true);
  });
});

describe('isCodingModelDegraded', () => {
  it('does NOT flag a curated coding-pool model', () => {
    for (const m of CODING_MODEL_POOL) {
      expect(isCodingModelDegraded(m)).toBe(false);
    }
  });

  it('flags a non-coder model the run was somehow served by', () => {
    // The coding cascade can no longer resolve onto a non-coder on its own — both
    // the appended fallback (CODING_PREMIUM_FALLBACK_MODELS) and the backstop
    // (CODING_BACKSTOP_MODELS) are coders-only. So this signal now only fires for a
    // non-coder that reached the run by another route (e.g. an explicit non-coder
    // pin); the general gemini backstop is exactly such a model.
    expect(isCodingModelDegraded('google/gemini-2.5-flash-lite')).toBe(true);
    expect(isCodingModelDegraded('googleai/gemini-2.5-flash')).toBe(true);
    expect(isCodingModelDegraded('google/gemini-2.0-flash')).toBe(true);
  });

  it('does NOT flag any coding-backstop model (the floor is coders-only)', () => {
    for (const m of CODING_BACKSTOP_MODELS) {
      expect(CODING_MODEL_POOL.includes(m)).toBe(true);
      expect(isCodingModelDegraded(m)).toBe(false);
    }
  });

  it('does NOT flag when no resolved model was reported (unknown, not degraded)', () => {
    expect(isCodingModelDegraded(undefined)).toBe(false);
    expect(isCodingModelDegraded('')).toBe(false);
    expect(isCodingModelDegraded('default')).toBe(false);
  });
});
