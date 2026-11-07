/**
 * The ONE rule for `brain_chat_messages.author_user_id` (PRD 42 Part E): a human turn is stamped with the
 * authenticated user; everything else is NULL ("unknown", never translated).
 *
 * A machine caller (`agentHost:<id>`, `agentHost:mcp`, `embed:<keyId>`) has no `users` row, so stamping its
 * subject would break the FK / varchar(36) and fail the whole insert.
 */
import { parseMachineSubject } from '../../infrastructure/auth/machineSubject';

export function messageAuthorFor(role: string, userId: string | null | undefined): string | null {
  if (role !== 'user' || !userId) return null;
  return parseMachineSubject(userId) === null ? userId : null;
}
