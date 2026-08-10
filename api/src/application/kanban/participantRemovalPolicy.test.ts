import { describe, expect, it } from 'vitest';
import { decideParticipantRemoval, type RemovableParticipant } from './participantRemovalPolicy';

const participant = (overrides: Partial<RemovableParticipant> = {}): RemovableParticipant => ({
  id: 'one', roleKey: 'engineer', responsibility: 'owner', required: true, source: 'assessment', ...overrides,
});

describe('participant removal policy', () => {
  it('blocks removal of the sole required role slot', () => {
    expect(decideParticipantRemoval(participant(), [participant()])).toMatchObject({
      allowed: false,
      code: 'sole_required_role',
    });
  });

  it('allows removal when another required slot covers the same role and responsibility', () => {
    const target = participant();
    expect(decideParticipantRemoval(target, [target, participant({ id: 'two' })])).toEqual({ allowed: true });
  });

  it('allows optional manual slots but never template slots', () => {
    const optional = participant({ required: false, source: 'manual' });
    expect(decideParticipantRemoval(optional, [optional])).toEqual({ allowed: true });
    expect(decideParticipantRemoval(participant({ source: 'template' }), [])).toMatchObject({
      allowed: false,
      code: 'not_removable',
    });
  });
});
