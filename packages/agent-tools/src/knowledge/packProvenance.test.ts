import { describe, expect, it } from 'vitest';
import { provenanceLine } from './packProvenance.js';

const fmt = (iso: string) => `D(${iso.slice(0, 10)})`;

describe('provenanceLine', () => {
  it('is null when there is no provenance or none of the three parts', () => {
    expect(provenanceLine(undefined, fmt)).toBeNull();
    expect(provenanceLine({}, fmt)).toBeNull();
    expect(provenanceLine({ policy: 'strict' }, fmt)).toBeNull();
    expect(provenanceLine({ reviewedBy: '  ', reviewedAt: 'not a date' }, fmt)).toBeNull();
  });

  it('uses the full sentence when every part is present', () => {
    expect(provenanceLine({ reviewedBy: 'Ada', judgeModel: 'claude-x', reviewedAt: '2026-11-01T10:00:00Z' }, fmt))
      .toEqual({ key: 'provenanceByWithOn', values: { reviewer: 'Ada', model: 'claude-x', date: 'D(2026-11-01)' } });
  });

  it.each([
    [{ reviewedBy: 'Ada', judgeModel: 'm' }, 'provenanceByWith'],
    [{ reviewedBy: 'Ada', reviewedAt: '2026-11-01' }, 'provenanceByOn'],
    [{ reviewedBy: 'Ada' }, 'provenanceBy'],
    [{ judgeModel: 'm', reviewedAt: '2026-11-01' }, 'provenanceWithOn'],
    [{ judgeModel: 'm' }, 'provenanceWith'],
    [{ reviewedAt: '2026-11-01' }, 'provenanceOn'],
  ] as const)('shows only the parts present: %j', (provenance, key) => {
    expect(provenanceLine(provenance, fmt)?.key).toBe(key);
  });

  it('only formats a date that parses', () => {
    expect(provenanceLine({ judgeModel: 'm', reviewedAt: 'garbage' }, fmt)).toEqual({ key: 'provenanceWith', values: { model: 'm' } });
  });
});
