/**
 * soleRoleGuard — Prevent removing required participants who are the sole instance of their role.
 *
 * PRD: "Implement a system that prevents the removal of required participants if they
 * are the sole representative of their role. This will ensure that critical roles are
 * always filled, maintaining the integrity and continuity of the project or task."
 *
 * A required participant can only be removed when:
 * 1. They are NOT required, OR
 * 2. Another participant shares the same roleKey AND responsibility
 *
 * This module contains the PURE logic (testable without DB), separate from the service
 * that calls it.
 */
import type { ManifestParticipant } from './ticketParticipants';
import type { Responsibility } from './types';

/**
 * Check if the participant is the sole required instance of their role+responsibility combo.
 *
 * @param participants - All participants on the ticket (from listParticipants)
 * @param targetRoleKey - The roleKey of the participant being removed
 * @param targetResponsibility - The responsibility of the participant being removed
 * @returns true if removal should be blocked
 */
export function isOnlyRequiredParticipant(
  participants: ManifestParticipant[],
  targetRoleKey: string,
  targetResponsibility: Responsibility,
): boolean {
  // Find the participant being removed
  const target = participants.find(
    (p) => p.roleKey === targetRoleKey && p.responsibility === targetResponsibility,
  );

  // Non-required participants can always be removed
  if (!target?.required) {
    return false;
  }

  // Count other REQUIRED participants with the same role+responsibility
  const othersWithSameRole = participants.filter(
    (p) =>
      p.id !== target.id &&
      p.roleKey === targetRoleKey &&
      p.responsibility === targetResponsibility &&
      p.required,
  );

  // If no other required participant shares this role+responsibility, block removal
  return othersWithSameRole.length === 0;
}

/**
 * Build a user-friendly reason string for why removal was blocked.
 */
export function soleRoleBlockReason(
  roleName: string,
  responsibility: string,
): string {
  return (
    `Cannot remove the required ${roleName} (${responsibility}) participant — ` +
    `they are the sole instance of this role. ` +
    `Please reassign the role to another participant before removing.`
  );
}
