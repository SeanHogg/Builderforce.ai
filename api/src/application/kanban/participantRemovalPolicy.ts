export interface RemovableParticipant {
  id: string;
  roleKey: string;
  responsibility: string;
  required: boolean;
  source: string;
}

export type ParticipantRemovalDecision =
  | { allowed: true }
  | { allowed: false; code: 'not_removable' | 'sole_required_role'; message: string };

export function decideParticipantRemoval(
  target: RemovableParticipant,
  participants: RemovableParticipant[],
): ParticipantRemovalDecision {
  if (target.source !== 'assessment' && target.source !== 'manual') {
    return {
      allowed: false,
      code: 'not_removable',
      message: 'Only assessment or manually added participants can be removed.',
    };
  }
  if (!target.required) return { allowed: true };

  const replacementExists = participants.some((participant) =>
    participant.id !== target.id
    && participant.required
    && participant.roleKey === target.roleKey
    && participant.responsibility === target.responsibility);
  if (replacementExists) return { allowed: true };

  return {
    allowed: false,
    code: 'sole_required_role',
    message: `Cannot remove the sole required ${target.roleKey} (${target.responsibility}) participant; add or reassign a replacement first.`,
  };
}
