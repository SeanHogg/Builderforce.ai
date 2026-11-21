/**
 * MK-09 D2 / W6 / W7 / E6 / B1 — the decision modules, including the dropped-handoff race.
 * The 15-minute queued reaper deadline is not the D2 test.
 */
import { describe, expect, it } from 'vitest';
import { QUEUED_DEADLINE_MS } from './staleExecutionReaper';
import {
  DROPPED_HANDOFF_REASON,
  HANDOFF_START_TIMEOUT_MS,
  droppedHandoff,
  withFirstTick,
  withHandoffRecorded,
} from './handoffStartTimeout';
import { gitHubErrorCode, providerAuthFromText, providerAuthOutcome, PROVIDER_AUTH_FAILED } from './providerAuthFailure';
import { mergeabilityRecord, parsePrMergeability, withPrMergeability } from './prMergeability';
import {
  AGENT_BUDGET_EXHAUSTED,
  DEFAULT_CLOUD_AGENT_BUDGET_MILLICENTS,
  MODEL_NOT_ENTITLED,
  agentBudgetCeiling,
  agentBudgetRefusal,
  modelEntitlementRefusal,
} from './dispatchEntitlements';

const T = Date.parse('2026-11-21T12:00:00.000Z');

describe('MK-09-D2 dropped CloudRunner handoff', () => {
  it('is a shorter deadline than the 15-minute queued reaper', () => {
    expect(HANDOFF_START_TIMEOUT_MS).toBeLessThan(QUEUED_DEADLINE_MS);
    expect(HANDOFF_START_TIMEOUT_MS).not.toBe(QUEUED_DEADLINE_MS);
  });

  it('fails closed when a recorded handoff never ticks, and not before', () => {
    const payload = withHandoffRecorded('{"executor":"durable"}', new Date(T).toISOString());
    expect(droppedHandoff({ payload, status: 'running', nowMs: T + HANDOFF_START_TIMEOUT_MS - 1, updatedAtMs: T })).toEqual({ fail: false });
    expect(droppedHandoff({ payload, status: 'submitted', nowMs: T + HANDOFF_START_TIMEOUT_MS, updatedAtMs: T })).toEqual({
      fail: true,
      reason: DROPPED_HANDOFF_REASON,
    });
  });

  it('a first tick, or any later write, clears the race', () => {
    const recorded = withHandoffRecorded(undefined, new Date(T).toISOString());
    const ticked = withFirstTick(recorded, new Date(T + 1_000).toISOString());
    expect(droppedHandoff({ payload: ticked, status: 'running', nowMs: T + HANDOFF_START_TIMEOUT_MS + 5_000, updatedAtMs: T })).toEqual({ fail: false });
    expect(droppedHandoff({
      payload: recorded,
      status: 'running',
      nowMs: T + HANDOFF_START_TIMEOUT_MS + 5_000,
      updatedAtMs: T + 30_000,
    })).toEqual({ fail: false });
  });
});

describe('MK-09-W7 provider auth', () => {
  it('maps 401 and 403 to provider_auth_failed with a re-auth prompt', () => {
    for (const status of [401, 403]) {
      expect(gitHubErrorCode(status)).toBe(PROVIDER_AUTH_FAILED);
      expect(providerAuthOutcome(status)).toEqual({
        outcome: PROVIDER_AUTH_FAILED,
        prompt: expect.stringMatching(/[Rr]econnect/),
      });
    }
    expect(gitHubErrorCode(404)).toBe('not_found');
    expect(gitHubErrorCode(500)).toBe('provider_error');
    expect(providerAuthFromText('401: Bad credentials')?.outcome).toBe(PROVIDER_AUTH_FAILED);
    expect(providerAuthFromText('merge conflict')).toBeNull();
  });
});

describe('MK-09-W6 mergeability', () => {
  it('records whether the PR merges cleanly against its base', () => {
    expect(mergeabilityRecord({ mergeable: true, mergeableState: 'clean' })).toMatchObject({ mergesCleanly: true });
    expect(mergeabilityRecord({ mergeable: false, mergeableState: 'dirty' })).toMatchObject({ mergesCleanly: false });
    expect(mergeabilityRecord({ mergeable: null, mergeableState: null })).toMatchObject({ mergesCleanly: false });
    const stamped = withPrMergeability('{"executor":"durable"}', mergeabilityRecord({ mergeable: true, mergeableState: 'clean' }));
    expect(parsePrMergeability(stamped)).toMatchObject({ mergesCleanly: true, mergeable: true });
  });
});

describe('MK-09-E6 model entitlement', () => {
  it('refuses an unentitled premium model and allows an entitled or non-premium one', () => {
    expect(modelEntitlementRefusal({ model: 'anthropic/claude-opus-4', isPremium: true, premiumEntitled: false })).toMatchObject({
      reason: MODEL_NOT_ENTITLED,
    });
    expect(modelEntitlementRefusal({ model: 'anthropic/claude-opus-4', isPremium: true, premiumEntitled: true })).toBeNull();
    expect(modelEntitlementRefusal({ model: 'openai/gpt-4o-mini', isPremium: false, premiumEntitled: false })).toBeNull();
  });
});

describe('MK-09-B1 per-agent budget', () => {
  it('refuses when the agent ceiling is spent, independent of any other cap', () => {
    expect(agentBudgetRefusal(DEFAULT_CLOUD_AGENT_BUDGET_MILLICENTS, DEFAULT_CLOUD_AGENT_BUDGET_MILLICENTS)).toMatchObject({
      reason: AGENT_BUDGET_EXHAUSTED,
    });
    expect(agentBudgetRefusal(1, DEFAULT_CLOUD_AGENT_BUDGET_MILLICENTS)).toBeNull();
    expect(agentBudgetCeiling({})).toBe(DEFAULT_CLOUD_AGENT_BUDGET_MILLICENTS);
    expect(agentBudgetCeiling({ CLOUD_AGENT_BUDGET_MILLICENTS: '10' })).toBe(10);
  });
});
