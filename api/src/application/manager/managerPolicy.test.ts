import { describe, it, expect } from 'vitest';
import {
  resolveEffectiveManagerPolicy,
  resolveManagerKind,
  normalizePrMergePolicy,
  DEFAULT_MANAGER_POLICY,
} from './managerPolicy';

describe('resolveManagerKind', () => {
  it('maps ref prefixes to a kind, defaulting to system', () => {
    expect(resolveManagerKind('u:123')).toBe('human');
    expect(resolveManagerKind('c:agent-abc')).toBe('agent');
    expect(resolveManagerKind('h:5')).toBe('agent');
    expect(resolveManagerKind(null)).toBe('system');
    expect(resolveManagerKind('  ')).toBe('system');
  });
});

describe('normalizePrMergePolicy', () => {
  it('accepts valid policies and defaults the rest', () => {
    expect(normalizePrMergePolicy('on_green')).toBe('on_green');
    expect(normalizePrMergePolicy('queue')).toBe('queue');
    expect(normalizePrMergePolicy('bogus')).toBe('immediate');
    expect(normalizePrMergePolicy(undefined)).toBe('immediate');
  });
});

describe('resolveEffectiveManagerPolicy', () => {
  it('returns the tenant default when no row exists', () => {
    expect(resolveEffectiveManagerPolicy(null)).toEqual(DEFAULT_MANAGER_POLICY);
  });
  it('folds a row over the default and derives managerKind', () => {
    const eff = resolveEffectiveManagerPolicy({
      managerRef: 'c:ada',
      enabled: true,
      prMergePolicy: 'queue',
      autoAssign: false,
      autoBusinessValue: true,
      autoPrioritize: true,
      managerType: 'qa',
    });
    expect(eff.managerKind).toBe('agent');
    expect(eff.prMergePolicy).toBe('queue');
    expect(eff.autoAssign).toBe(false);
    expect(eff.managerType).toBe('qa');
  });
  it('normalizes an invalid persisted policy string', () => {
    const eff = resolveEffectiveManagerPolicy({
      managerRef: null, enabled: true, prMergePolicy: 'garbage',
      autoAssign: true, autoBusinessValue: true, autoPrioritize: true,
      managerType: 'not-a-type',
    });
    expect(eff.prMergePolicy).toBe('immediate');
    expect(eff.managerKind).toBe('system');
    expect(eff.managerType).toBe('general');
  });
});
