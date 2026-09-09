/**
 * builtinTaskVisibility — the SECURITY-ticket visibility gate every built-in tool
 * that returns tickets must pass its rows through.
 *
 * It was a private helper inside `builtinMcpService`, which was fine while that file
 * held every ticket-returning tool. It no longer does: a second catalog module now
 * lists tickets too, and the only two ways to give it this gate were to import from
 * the catalog (a runtime cycle — the exact hazard `builtinToolContext` was split out
 * to avoid) or to write the check again. A second copy of an access-control decision
 * is the worst of the three: the copy that is forgotten is the one that leaks.
 *
 * Kept out of `builtinToolContext` deliberately — that module is the LIGHT one, so
 * that a registry which only reads tool ids does not drag an application service and
 * its dependency graph in behind it.
 */
import { TaskType } from '../../domain/shared/types';
import { SecurityTicketAccessService } from '../security/SecurityTicketAccessService';
import type { BuiltinCtx } from './builtinToolContext';

/**
 * Mask (don't drop) the access-restricted SECURITY tickets the MCP caller isn't
 * cleared for — the same surfaced-not-hidden model the HTTP board uses. The caller's
 * role rides in from ctx (a cloud agent runs as MANAGER and sees everything; a human
 * via Brain carries their real role), so this reuses the ONE shared visibility gate.
 *
 * Masked rows come back carrying `restricted: true`; a caller must treat that as
 * "render the row, read nothing else from it" rather than filtering it out, or the
 * surfaced-not-hidden contract silently becomes hidden.
 */
export async function maskSecurityTasks<T extends Record<string, unknown>>(
  ctx: BuiltinCtx,
  rows: T[],
): Promise<T[]> {
  if (!rows.some((r) => r.taskType === TaskType.SECURITY)) return rows;
  const viewer = { userId: ctx.userId ?? null, role: ctx.role, isAgent: false };
  return new SecurityTicketAccessService(ctx.db, ctx.env).applyVisibilityForViewer(ctx.tenantId, viewer, rows);
}
