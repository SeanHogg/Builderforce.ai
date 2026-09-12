/**
 * WHO MAY RUN A MUTATING BUILT-IN TOOL — the tool-path twin of the route gates.
 *
 * Most built-in tools do not replay an `/api/*` route; they call the service or the
 * table directly (`tasks.create`, `projects.update`, …). Those rows therefore never
 * pass `requirePermission('task:write')` or `requireRole(DEVELOPER)`, which meant a
 * workspace `viewer` could create a ticket through the Brain that the ticket route
 * would have refused. The `contributor` tier (a person seated by ONE shared canvas,
 * operator decision 2026-09-12) made that a real hole rather than a theoretical one:
 * the canvas chat is exactly where a contributor works, and it reaches these tools.
 *
 * The rule is the one the HTTP surface already applies: WORKSPACE writes are
 * `developer`+. Below that, only tools whose effect is confined to the caller's own
 * artefacts run — their Brain chats and uploads, and their own sessions. Canvas
 * edits never pass through here at all: they go through the creation-session routes,
 * which gate on the BOARD role (`application/creation/sessionAccess.ts`).
 *
 * A caller with no role (a cloud agent, a server-side job) is not decided here — its
 * authority is the run that launched it, and a replayed route still gates it.
 */

import { hasMinRole, TenantRole } from '../../domain/shared/types';

/**
 * Mutating tools whose writes touch only the CALLER'S OWN rows, so any member may
 * run them. Named tool by tool, not by namespace, because a namespace is not a
 * scope: `chats.link_ticket` only edits the caller's chat, but `chats.dispatch_agent`
 * in the same namespace starts a paid agent run, and `attachments.write` overwrites
 * a TENANT upload rather than the caller's. Every entry must be self-scoped by its
 * implementation (it filters on the caller's user id) or replay a route that gates
 * itself.
 */
const SELF_SCOPED_TOOLS: ReadonlySet<string> = new Set([
  'brain.create',          // a new Brain chat, owned by the caller
  'brain.update',          // rename/move the caller's own chat (userId-filtered)
  'brain.delete',          // archive the caller's own chat (userId-filtered)
  'brain.summarize',       // route replay — the summary route gates itself
  'chats.link_ticket',     // tie the caller's chat to a ticket; the ticket is not written
  'chats.unlink_ticket',
  'chats.consolidate',     // merge the caller's own chats
  'chats.invite_agent',    // add a participant to the caller's chat; starts nothing
  'my_sessions.revoke',    // the caller's own login sessions
  'my_sessions.revoke_others',
]);

export class BuiltinToolForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(tool: string, role: string) {
    super(`'${tool}' changes workspace data and requires at least the '${TenantRole.DEVELOPER}' role (caller has '${role}')`);
    this.name = 'BuiltinToolForbiddenError';
  }
}

/**
 * May a caller holding `role` run `tool`? Read-only tools are always allowed (their
 * rows scope reads to the tenant, and `builtinTaskVisibility` narrows further).
 */
export function mayRunBuiltinTool(tool: string, mutates: boolean, role: string | null | undefined): boolean {
  if (!mutates) return true;
  if (role == null) return true;
  if (hasMinRole(role, TenantRole.DEVELOPER)) return true;
  return SELF_SCOPED_TOOLS.has(tool);
}

/** Throw {@link BuiltinToolForbiddenError} unless {@link mayRunBuiltinTool} admits the call. */
export function assertMayRunBuiltinTool(tool: string, mutates: boolean, role: string | null | undefined): void {
  if (!mayRunBuiltinTool(tool, mutates, role)) throw new BuiltinToolForbiddenError(tool, String(role));
}
