/**
 * The register exists to answer questions the document could not, so the
 * roll-up — not the row shape — is what is asserted here.
 */
import { describe, it, expect } from 'vitest';
import { rollupRegister } from './rfpRegister';
import type { RfpRegisterEntry } from './types';

const entry = (over: Partial<RfpRegisterEntry> & { id: string }): RfpRegisterEntry => ({
  responseId: 'r1', requestId: 'q1', kind: 'risk', title: 'Scope ambiguity',
  severity: 'medium', dependencyType: null, detail: null, status: 'open',
  ownerUserId: null, position: 0, createdAt: '2026-08-18T00:00:00.000Z',
  ...over,
});

describe('rollupRegister', () => {
  it('counts exposure by kind, severity and status', () => {
    const rollup = rollupRegister([
      entry({ id: '1', severity: 'high' }),
      entry({ id: '2', severity: 'low', status: 'mitigated' }),
      entry({ id: '3', kind: 'dependency', severity: null, dependencyType: 'third_party' }),
    ]);
    expect(rollup.totalRisks).toBe(2);
    expect(rollup.totalDependencies).toBe(1);
    expect(rollup.bySeverity).toEqual({ low: 1, medium: 0, high: 1 });
    expect(rollup.byStatus.open).toBe(2);
    expect(rollup.byStatus.mitigated).toBe(1);
    expect(rollup.byDependencyType.third_party).toBe(1);
  });

  it('counts only OPEN high risks as exposure — a mitigated one is not carried', () => {
    const rollup = rollupRegister([
      entry({ id: '1', severity: 'high' }),
      entry({ id: '2', severity: 'high', status: 'mitigated' }),
      entry({ id: '3', severity: 'high', status: 'closed' }),
    ]);
    expect(rollup.openHighRisks).toBe(1);
  });

  it('surfaces a risk raised on more than one response, keyed on the normalised title', () => {
    const rollup = rollupRegister([
      entry({ id: '1', responseId: 'r1', title: 'Scope ambiguity' }),
      entry({ id: '2', responseId: 'r2', title: '  scope ambiguity ' }),
      entry({ id: '3', responseId: 'r3', title: 'Scope Ambiguity', severity: 'high' }),
      entry({ id: '4', responseId: 'r1', title: 'One-off thing' }),
    ]);
    expect(rollup.recurring).toHaveLength(1);
    expect(rollup.recurring[0]).toMatchObject({ responses: 3, kind: 'risk', worstSeverity: 'high' });
  });

  it('does not call a risk recurring because ONE response listed it twice', () => {
    const rollup = rollupRegister([
      entry({ id: '1', responseId: 'r1', title: 'Access to test data' }),
      entry({ id: '2', responseId: 'r1', title: 'Access to test data', position: 1 }),
    ]);
    expect(rollup.recurring).toEqual([]);
  });

  it('keeps a risk and a dependency of the same name apart', () => {
    const rollup = rollupRegister([
      entry({ id: '1', responseId: 'r1', title: 'Third-party API' }),
      entry({ id: '2', responseId: 'r2', title: 'Third-party API', kind: 'dependency', severity: null, dependencyType: 'third_party' }),
    ]);
    expect(rollup.recurring).toEqual([]);
  });
});
