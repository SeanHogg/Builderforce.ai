/**
 * Approvals that belong to the person who raised them.
 *
 * Most approvals are governance: an agent asks the TEAM, and a manager decides. Some
 * are not. A Self-Directed Agent in Synapse drives one person's own desktop — their
 * mouse, their keyboard, their logged-in apps — and when it reaches a step that needs a
 * go-ahead it raises that question to its owner's account so they can answer it from
 * their phone. Nobody else may answer it (not a manager, not an auto-approval rule), and
 * nobody else should even see it in the queue: the description names what is happening
 * on someone's machine.
 *
 * Kept in the domain layer so the route, the notifier and any future caller agree on
 * which action types these are and who may act on them.
 */
export const SELF_OWNED_ACTION_TYPES: readonly string[] = ['synapse.step'];

export function isSelfOwnedApproval(actionType: string | null | undefined): boolean {
  return typeof actionType === 'string' && SELF_OWNED_ACTION_TYPES.includes(actionType);
}

/**
 * Whether `userId` may see — and therefore act on — an approval row. Team approvals are
 * visible to the tenant (the route's own role gates still apply); a self-owned one only
 * to the user who raised it.
 */
export function isApprovalVisibleTo(
  row: { actionType: string | null; requestedBy: string | null },
  userId: string | null | undefined,
): boolean {
  if (!isSelfOwnedApproval(row.actionType)) return true;
  return !!userId && row.requestedBy === userId;
}
