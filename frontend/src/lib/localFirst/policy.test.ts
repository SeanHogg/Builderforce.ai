import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PLATFORM_DENIED,
  decide,
  refusePlatform,
  type PolicyDecision,
  type PolicySnapshot,
} from './policy';

function granted(capability: string, execution: 'local' | 'platform'): PolicySnapshot {
  return { capabilities: [{ capability, execution }] };
}

function denial(run: () => void): { message: string; code?: string } {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return { message: (error as Error).message, code: (error as { code?: string }).code };
  }
  expect.unreachable('denied policy must throw');
}

describe('decide', () => {
  it('denies when there is no policy snapshot', () => {
    expect(decide('ticket-create', null)).toEqual({ action: 'denied', reason: 'no_policy_snapshot' });
    expect(decide('ticket-create', undefined)).toEqual({ action: 'denied', reason: 'no_policy_snapshot' });
    expect(decide('synchronize', null).action).toBe('denied');
    expect(Object.isFrozen(decide('synchronize', null))).toBe(true);
  });

  it('denies a capability the snapshot does not grant', () => {
    const snapshot: PolicySnapshot = {
      capabilities: [{ capability: 'ticket-create', execution: 'local' }],
    };
    expect(decide('project-create', snapshot)).toEqual({
      action: 'denied',
      reason: 'capability_not_granted',
    });
    expect(decide('ticket-create', { capabilities: [] })).toEqual({
      action: 'denied',
      reason: 'capability_not_granted',
    });
    expect(decide('ticket-create', { capabilities: {} })).toEqual({
      action: 'denied',
      reason: 'capability_not_granted',
    });
    expect(decide('ticket-create', { capabilities: ['project-create'] })).toEqual({
      action: 'denied',
      reason: 'capability_not_granted',
    });
  });

  it('never defaults a missing or malformed grant to allow', () => {
    // A snapshot that carries no usable capabilities, or one that names the
    // capability with something other than a local/platform execution, is
    // denied — there is no path through this function that reaches 'platform'
    // without an explicit `execution: 'platform'`.
    const malformed: readonly unknown[] = [
      { capabilities: undefined },
      { capabilities: 'synchronize' },
      { capabilities: { synchronize: true } },
      { capabilities: [{ capability: 'synchronize', execution: 'allow' }] },
      { capabilities: [{ capability: 'synchronize' }] },
      { capabilities: [{ capability: 'synchronize', execution: null }] },
      // Entries that name no capability at all — including non-strings, which
      // must not be coerced into a grant.
      { capabilities: [null, 7, {}, { capability: 'other', execution: 'platform' }] },
    ];
    for (const snapshot of malformed) {
      const decision = decide('synchronize', snapshot as unknown as PolicySnapshot);
      expect(decision).toEqual({ action: 'denied', reason: 'capability_not_granted' });
      expect(decision.action).not.toBe('platform');
    }
    expect(decide('', granted('', 'platform')).action).toBe('denied');
  });

  it('classifies an explicit local grant as local, including a bare name', () => {
    expect(decide('ticket-create', granted('ticket-create', 'local'))).toEqual({
      action: 'local',
      reason: 'local_granted',
    });
    expect(decide('memory-recall', { capabilities: ['memory-recall'] })).toEqual({
      action: 'local',
      reason: 'local_granted',
    });
    expect(decide('local-file-read', { capabilities: { 'local-file-read': 'local' } })).toEqual({
      action: 'local',
      reason: 'local_granted',
    });
  });

  it('classifies a platform call only when the grant says platform', () => {
    expect(decide('synchronize', granted('synchronize', 'platform'))).toEqual({
      action: 'platform',
      reason: 'platform_granted',
    });
    expect(decide('gateway-inference', { capabilities: { 'gateway-inference': 'platform' } })).toEqual({
      action: 'platform',
      reason: 'platform_granted',
    });
    expect(decide('synchronize', { capabilities: ['synchronize'] }).action).toBe('local');
  });

  it('denies a capability that is both local and platform rather than allowing the platform', () => {
    const snapshot: PolicySnapshot = {
      capabilities: [
        'synchronize',
        { capability: 'synchronize', execution: 'platform' },
      ],
    };
    expect(decide('synchronize', snapshot)).toEqual({
      action: 'denied',
      reason: 'capability_not_granted',
    });
  });
});

describe('refusePlatform', () => {
  it('throws platform_denied when the decision is denied', () => {
    const decision = decide('synchronize', null);
    const error = denial(() => refusePlatform(decision));
    expect(error.message).toBe(PLATFORM_DENIED);
    expect(error.code).toBe('platform_denied');
    expect(decision.action).toBe('denied');
  });

  it('throws platform_denied for a capability the snapshot did not grant', () => {
    const decision: PolicyDecision = decide('git-push', { capabilities: [] });
    expect(decision).toEqual({ action: 'denied', reason: 'capability_not_granted' });
    expect(denial(() => refusePlatform(decision)).code).toBe(PLATFORM_DENIED);
  });

  it('does not throw for an explicit local or platform decision', () => {
    expect(refusePlatform(decide('ticket-create', granted('ticket-create', 'local')))).toBeUndefined();
    expect(refusePlatform(decide('synchronize', granted('synchronize', 'platform')))).toBeUndefined();
  });

  it('throws when the decision is missing, so a gap cannot call the platform', () => {
    expect(denial(() => refusePlatform(undefined as unknown as PolicyDecision)).code).toBe(PLATFORM_DENIED);
    expect(denial(() => refusePlatform({ action: 'allow' } as unknown as PolicyDecision)).code).toBe(PLATFORM_DENIED);
  });
});

describe('the policy module', () => {
  it('does not import a network client', () => {
    const source = readFileSync(new URL('./policy.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/import\s+[^;]*\bfetch\b/);
    expect(source).not.toMatch(/from\s+['"]node:(https?|http|net)['"]/);
  });
});
