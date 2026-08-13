import { describe, expect, it } from 'vitest';
import { basisIsStale, basisNotice, hashFrame, materialize, nextDatasetVersion, rowBasis } from './canvasDatasetVersion';
import { MAX_MATERIALIZED_ROWS } from './canvasTabularData';

const frame = { columns: ['a', 'b'], rows: [{ a: 1, b: 'x' }, { a: 2, b: 'y' }] };

describe('hashFrame', () => {
  it('is stable across calls and sensitive to a changed cell', () => {
    expect(hashFrame(frame)).toBe(hashFrame({ columns: ['a', 'b'], rows: [{ a: 1, b: 'x' }, { a: 2, b: 'y' }] }));
    expect(hashFrame(frame)).not.toBe(hashFrame({ columns: ['a', 'b'], rows: [{ a: 1, b: 'x' }, { a: 3, b: 'y' }] }));
  });

  it('treats a reordered column as a different frame', () => {
    // A re-export that moved a column is a different frame for "does this chart still
    // mean what it meant", even though every cell is unchanged.
    expect(hashFrame(frame)).not.toBe(hashFrame({ columns: ['b', 'a'], rows: frame.rows }));
  });

  it('does not collide when a value shifts across a cell boundary', () => {
    const left = { columns: ['a', 'b'], rows: [{ a: 'xy', b: '' }] };
    const right = { columns: ['a', 'b'], rows: [{ a: 'x', b: 'y' }] };
    expect(hashFrame(left)).not.toBe(hashFrame(right));
  });
});

describe('rowBasis', () => {
  it('reports a complete frame as untruncated', () => {
    expect(rowBasis(frame)).toMatchObject({ basisRows: 2, sourceRows: 2, truncated: false });
  });

  it('records what was left behind when the source is larger', () => {
    expect(rowBasis(frame, 5_000)).toMatchObject({ basisRows: 2, sourceRows: 5_000, truncated: true });
  });

  it('ignores a source count smaller than what it was given', () => {
    expect(rowBasis(frame, 1).sourceRows).toBe(2);
  });
});

describe('materialize', () => {
  it('applies the ceiling and records the truncation in one place', () => {
    const rows = Array.from({ length: MAX_MATERIALIZED_ROWS + 250 }, (_, index) => ({ a: index, b: 'x' }));
    const { source, basis } = materialize(['a', 'b'], rows);
    expect(source.rows).toHaveLength(MAX_MATERIALIZED_ROWS);
    expect(basis.truncated).toBe(true);
    expect(basis.sourceRows).toBe(MAX_MATERIALIZED_ROWS + 250);
    expect(basis.basisRows).toBe(MAX_MATERIALIZED_ROWS);
  });
});

describe('nextDatasetVersion', () => {
  it('starts at 1 so "the first import" is a statement an artifact can cite', () => {
    expect(nextDatasetVersion(undefined)).toBe(1);
    expect(nextDatasetVersion(null)).toBe(1);
    expect(nextDatasetVersion('nonsense')).toBe(1);
  });

  it('increments an existing version', () => {
    expect(nextDatasetVersion(1)).toBe(2);
    expect(nextDatasetVersion(7)).toBe(8);
  });
});

describe('staleness', () => {
  it('compares the hash, not the version', () => {
    // A re-import with identical rows must not mark every chart stale; an in-place edit
    // with no version bump absolutely must.
    const basis = rowBasis(frame);
    expect(basisIsStale(basis, basis.datasetHash)).toBe(false);
    expect(basisIsStale(basis, 'deadbeef')).toBe(true);
  });

  it('says nothing when there is nothing to say', () => {
    const basis = rowBasis(frame);
    expect(basisNotice(basis, basis.datasetHash)).toBeNull();
  });

  it('leads with truncation, which is the more serious caveat', () => {
    const basis = rowBasis(frame, 9_000);
    expect(basisNotice(basis, 'deadbeef')).toEqual({ key: 'truncated', values: { basisRows: 2, sourceRows: 9_000 } });
  });
});
