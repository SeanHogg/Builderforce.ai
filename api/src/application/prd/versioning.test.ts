import { describe, expect, it } from 'vitest';
import {
  nextVersionNumber,
  assertNotFrozen,
  buildFrozenSnapshot,
  FrozenVersionError,
  type SnapshotableSpec,
} from './versioning';

describe('nextVersionNumber', () => {
  it('starts at 1 when there are no existing versions', () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it('is monotonic — always exceeds the current maximum', () => {
    expect(nextVersionNumber([1, 2, 3])).toBe(4);
    expect(nextVersionNumber([3, 1, 2])).toBe(4);
  });

  it('handles gaps without reusing skipped numbers', () => {
    expect(nextVersionNumber([1, 5, 2])).toBe(6);
  });

  it('handles duplicate version numbers', () => {
    expect(nextVersionNumber([2, 2, 2])).toBe(3);
  });

  it('ignores non-finite / invalid entries', () => {
    expect(nextVersionNumber([NaN, Infinity, 4])).toBe(5);
  });
});

describe('assertNotFrozen', () => {
  it('does not throw for an unfrozen version', () => {
    expect(() => assertNotFrozen({ frozen: false })).not.toThrow();
  });

  it('throws FrozenVersionError when frozen (freeze-on-execute immutability)', () => {
    expect(() => assertNotFrozen({ frozen: true })).toThrow(FrozenVersionError);
  });
});

describe('buildFrozenSnapshot', () => {
  const now = new Date('2026-05-31T12:00:00.000Z');
  const spec: SnapshotableSpec = {
    id:        'spec-uuid',
    tenantId:  7,
    segmentId: 'seg-uuid',
    prd:       '# PRD',
    archSpec:  '# Arch',
    taskList:  '[{"t":1}]',
  };

  it('produces a frozen=true payload with frozenAt set to now', () => {
    const out = buildFrozenSnapshot(spec, 3, now);
    expect(out.frozen).toBe(true);
    expect(out.frozenAt).toBe(now);
    expect(out.version).toBe(3);
    expect(out.specId).toBe('spec-uuid');
    expect(out.tenantId).toBe(7);
    expect(out.segmentId).toBe('seg-uuid');
    expect(out.prd).toBe('# PRD');
    expect(out.archSpec).toBe('# Arch');
    expect(out.taskList).toBe('[{"t":1}]');
    expect(out.origin).toBe('prd_first');
    expect(out.createdBy).toBeNull();
  });

  it('defaults nullable fields and respects origin/createdBy overrides', () => {
    const out = buildFrozenSnapshot(
      { id: 's', tenantId: 1 },
      1,
      now,
      { origin: 'generated_from_ticket', createdBy: 'agent:prd-author' },
    );
    expect(out.prd).toBeNull();
    expect(out.archSpec).toBeNull();
    expect(out.taskList).toBeNull();
    expect(out.segmentId).toBeNull();
    expect(out.origin).toBe('generated_from_ticket');
    expect(out.createdBy).toBe('agent:prd-author');
  });
});
