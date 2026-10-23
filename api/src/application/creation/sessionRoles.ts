/**
 * The board-role vocabulary — one declaration, read by the gate (`sessionAccess.ts`)
 * and by the member store (`sessionMembers.ts`, whose `keep-higher` conflict policy
 * compares ranks in SQL). Its own module so neither of those has to import the other
 * for five words and their order.
 */

export type SessionRole = 'viewer' | 'commenter' | 'editor' | 'runner' | 'owner';

/** Ordered, so "at least an editor" is a comparison rather than a set membership test. */
export const SESSION_ROLE_RANK: Record<SessionRole, number> = {
  viewer: 0, commenter: 1, editor: 2, runner: 3, owner: 4,
};

export function isSessionRole(value: unknown): value is SessionRole {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SESSION_ROLE_RANK, value);
}
