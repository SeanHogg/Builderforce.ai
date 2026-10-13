import { describe, expect, it } from 'vitest';
import { billableUnits, newUnitIndexes, REPLAY_UNIT_BYTES } from './billing';

describe('billableUnits', () => {
  it('charges one unit for any recording up to 2 MiB, including an empty one', () => {
    expect(billableUnits(0)).toBe(1);
    expect(billableUnits(-5)).toBe(1);
    expect(billableUnits(Number.NaN)).toBe(1);
    expect(billableUnits(1)).toBe(1);
    expect(billableUnits(REPLAY_UNIT_BYTES)).toBe(1);
  });

  it('counts each further 2 MiB again', () => {
    expect(billableUnits(REPLAY_UNIT_BYTES + 1)).toBe(2);
    expect(billableUnits(REPLAY_UNIT_BYTES * 3)).toBe(3);
    expect(billableUnits(REPLAY_UNIT_BYTES * 3 + 1)).toBe(4);
  });
});

describe('newUnitIndexes', () => {
  it('names unit 1 for a brand-new recording', () => {
    expect(newUnitIndexes(0, 10_000)).toEqual([1]);
  });

  it('names nothing while the recording stays inside the units already charged', () => {
    expect(newUnitIndexes(1, REPLAY_UNIT_BYTES)).toEqual([]);
    expect(newUnitIndexes(2, REPLAY_UNIT_BYTES + 5)).toEqual([]);
  });

  it('names exactly the boundary units crossed', () => {
    expect(newUnitIndexes(1, REPLAY_UNIT_BYTES + 1)).toEqual([2]);
    expect(newUnitIndexes(1, REPLAY_UNIT_BYTES * 3 + 1)).toEqual([2, 3, 4]);
  });
});
