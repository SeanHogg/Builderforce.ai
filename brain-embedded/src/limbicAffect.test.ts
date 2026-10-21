import { describe, expect, it } from 'vitest';
import { LIMBIC_BLOCK_HEADER, limbicSetpoints, neutralLimbicState } from '@seanhogg/builderforce-memory-engine/limbic';
import { limbicTraits } from '@builderforce/agent-tools';
import { personalitySetpoints, turnAffectBlock } from './limbicAffect';

/**
 * The per-turn affect is appraised ON THE DEVICE (no `/api/limbic/block` per turn), by
 * Evermind's own limbic — so it must answer the same as the gateway's appraisal did,
 * signed out and offline included.
 */
describe('turnAffectBlock', () => {
  it('appraises a risky turn into an affect block, with no profile at all (anonymous)', () => {
    const block = turnAffectBlock('drop the production database and force-push');
    expect(block.startsWith(LIMBIC_BLOCK_HEADER)).toBe(true);
  });

  it('adds nothing for an empty turn or a turn at rest', () => {
    expect(turnAffectBlock('   ')).toBe('');
    expect(turnAffectBlock('hello there', neutralLimbicState())).toBe('');
  });

  it('seeds the appraisal from the personality, as the gateway route does', () => {
    const profile = { vector: { openness: 95, riskTolerance: 95 } };
    expect(personalitySetpoints(profile)).toEqual(limbicSetpoints(limbicTraits(profile)));
    expect(personalitySetpoints(null)).toEqual(neutralLimbicState());
  });
});
