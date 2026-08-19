import { describe, expect, it } from 'vitest';
import {
  PIPELINE_FAMILIES,
  PIPELINE_FAMILY_KEYS,
  fallbackOutcome,
  familyForDealKind,
  pipelineFamily,
} from './pipelineFamilies';

/**
 * The families are DATA, and these are the properties the engine reads them for.
 *
 * Every one of them is a real failure if it stops holding: a kind in two families
 * would put one deal on two boards, a terminal stage that is not in its own ladder
 * would make a deal unclosable, and a `placement` silently classified as sales
 * would inflate the single number a sales board exists to show.
 */
describe('pipeline families', () => {
  it('claims every declared key', () => {
    expect(Object.keys(PIPELINE_FAMILIES).sort()).toEqual([...PIPELINE_FAMILY_KEYS].sort());
  });

  it('never claims the same deal kind twice', () => {
    const kinds = Object.values(PIPELINE_FAMILIES).flatMap((family) => family.kinds);
    expect(kinds.length).toBe(new Set(kinds).size);
  });

  it('declares terminal stages that are actually in its own ladder', () => {
    for (const family of Object.values(PIPELINE_FAMILIES)) {
      expect(family.fallbackStages, family.key).toContain(family.wonStage);
      expect(family.fallbackStages, family.key).toContain(family.lostStage);
      expect(family.wonStage, family.key).not.toBe(family.lostStage);
    }
  });

  it('maps only the two terminal stages to a terminal outcome', () => {
    for (const family of Object.values(PIPELINE_FAMILIES)) {
      for (const stage of family.fallbackStages) {
        const expected = stage === family.wonStage ? 'won' : stage === family.lostStage ? 'lost' : 'open';
        expect(fallbackOutcome(family, stage), `${family.key}/${stage}`).toBe(expected);
      }
    }
  });

  it('reads the family off a deal kind, and refuses one no family claims', () => {
    expect(familyForDealKind('sales')?.key).toBe('sales');
    expect(familyForDealKind('expansion')?.key).toBe('sales');
    expect(familyForDealKind('investment')?.key).toBe('raise');
    // `placement` rides the same table by design (PRD 20 §3.3) and is NOT a sales
    // pipeline — projecting it onto one would inflate the board's own number.
    expect(familyForDealKind('placement')).toBeNull();
    expect(familyForDealKind('nonsense')).toBeNull();
  });

  it('defaults an unknown or absent family to sales', () => {
    // `/api/pipeline` with no query parameter has always meant the sales board, and
    // an unrecognised value must not become a third answer.
    expect(pipelineFamily(undefined).key).toBe('sales');
    expect(pipelineFamily('nonsense').key).toBe('sales');
    expect(pipelineFamily('raise').key).toBe('raise');
  });

  it('keeps the raise from being segmented by a column a raise does not populate', () => {
    // Every investor came from a person, so `source` is empty on an allocation and
    // laning by it would draw one unnamed lane per empty string.
    expect(PIPELINE_FAMILIES.raise.defaultLaneBy).toBe('none');
    expect(PIPELINE_FAMILIES.raise.partyRole).toBe('investor');
    expect(PIPELINE_FAMILIES.sales.partyRole).toBe('customer');
  });
});
