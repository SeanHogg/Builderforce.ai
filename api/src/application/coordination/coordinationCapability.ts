/**
 * The cloud surface's backing for the `coordinate` capability, plus the WRITE GUARD
 * that makes coordination a correctness property rather than a courtesy.
 *
 * Two exports, and the second one is the important one:
 *
 *   • {@link buildCoordinationCapability} backs the four coordination tools
 *     (claim_resource / release_resource / workspace_note / workspace_read). These let
 *     an agent reserve work ahead of doing it and see what its peers hold.
 *
 *   • {@link guardRepoWrite} wraps a {@link RepoWriteCapability} so EVERY write —
 *     whether or not the model chose to claim first — implicitly takes an exclusive
 *     lease on the path and refuses if a peer holds it. Correctness cannot depend on a
 *     model calling a tool, so the lease is taken by the surface, not by the prompt.
 *
 * FAIL-OPEN ON INFRASTRUCTURE, FAIL-CLOSED ON CONFLICT. If the lease store itself
 * errors (`ok:false`), the guard lets the write through: losing the ability to lock
 * must not become an inability to work, and the pre-existing behaviour was no locking
 * at all. A genuine conflict (`granted:false`) refuses, and the refusal text tells the
 * model who holds the path and what to do instead — so a collision becomes a plan
 * rather than a retry loop.
 */

import { and, eq } from 'drizzle-orm';
import type {
  CoordinationCapability,
  LeaseClaimResult,
  LeaseInfo,
  RepoDeleteResult,
  RepoEditResult,
  RepoWriteCapability,
  RepoWriteResult,
  WorkspaceReadResult,
} from '@builderforce/agent-tools';
import { acquireLease, listLeases, releaseLease, type LeaseHolder } from './leaseService';
import { postNote, readNotes } from './blackboardService';
import { coordinationScopeKey } from '../../domain/coordination/resourceKey';
import { projects, tasks } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * One ticket's whole coordination picture — who holds what, and what the agents are
 * telling each other — for the operator UI.
 *
 * Lives here rather than in the route because a route may not query the database
 * (`check:layering`), and because the tenant-ownership check for a ticket is itself a
 * rule (`tasks` has no tenant_id; ownership runs through its project) that must not be
 * re-derived per caller. Returns null when the ticket is not this tenant's, which the
 * route renders as a 404 — an IDOR guard the caller cannot forget.
 */
export async function getTicketCoordination(
  env: Env,
  db: Db,
  tenantId: number,
  taskId: number,
): Promise<{ taskId: number; taskTitle: string; leases: LeaseInfo[]; notes: WorkspaceNote[] } | null> {
  const owned = await taskTitleIfInTenant(db, taskId, tenantId);
  if (owned == null) return null;
  const scopeKey = coordinationScopeKey(taskId);
  const [leases, notes] = await Promise.all([
    listLeases(env, db, tenantId, scopeKey),
    readNotes(env, db, tenantId, scopeKey, { limit: 50 }),
  ]);
  return {
    taskId,
    taskTitle: owned,
    leases: leases.ok ? (leases.leases ?? []) : [],
    notes: notes.ok ? (notes.notes ?? []) : [],
  };
}

/** One blackboard note as the read surface returns it. */
export type WorkspaceNote = NonNullable<WorkspaceReadResult['notes']>[number];

/** The ticket's title when it belongs to `tenantId`, else null. `tasks` carries no
 *  tenant_id — ownership is inherited from its project (see tenantScope.ts). */
async function taskTitleIfInTenant(db: Db, taskId: number, tenantId: number): Promise<string | null> {
  if (!Number.isFinite(taskId) || taskId <= 0) return null;
  const [row] = await db
    .select({ title: tasks.title })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, taskId), eq(projects.tenantId, tenantId)))
    .limit(1);
  return row?.title ?? null;
}

export function buildCoordinationCapability(args: { env: Env; db: Db; holder: LeaseHolder }): CoordinationCapability {
  const { env, db, holder } = args;
  return {
    claim: (resource, opts) => acquireLease(env, db, holder, resource, opts),
    release: (resource) => releaseLease(env, db, holder, resource),
    listClaims: () => listLeases(env, db, holder.tenantId, holder.scopeKey, holder.executionId),
    postNote: (key, content) =>
      postNote(
        env,
        db,
        { tenantId: holder.tenantId, scopeKey: holder.scopeKey, taskId: holder.taskId, executionId: holder.executionId, label: holder.label },
        key,
        content,
      ),
    readNotes: (query, limit) =>
      readNotes(env, db, holder.tenantId, holder.scopeKey, { query, limit, viewerExecutionId: holder.executionId }),
  };
}

/** Refusal text shared by all three guarded ops, so the guidance never drifts. */
function refusal(path: string, claim: LeaseClaimResult): string {
  return (
    claim.note
    ?? `'${path}' is currently held by ${claim.heldBy ?? 'another agent'} working this ticket. `
      + 'Do not retry — choose different work, or post a workspace_note describing the change you need them to make.'
  );
}

/**
 * Take the implicit write lease for one path. Returns null to PROCEED, or the refusal
 * message to return to the model.
 *
 * Exported because two code paths write to a ticket branch — the durable/Worker
 * capability provider (via {@link guardRepoWrite}) and the container's `write` op,
 * which relays through the Worker rather than using the provider. Both must take the
 * same lease or the guard is only half a guard, so the gate lives here once.
 */
export async function claimWriteLease(args: {
  env: Env;
  db: Db;
  holder: LeaseHolder;
  path: string;
  reason: string;
  onRefused?: (path: string, heldBy: string) => void;
}): Promise<string | null> {
  const claim = await acquireLease(args.env, args.db, args.holder, args.path, { mode: 'exclusive', reason: args.reason });
  if (!claim.ok) return null;       // store failure → fail open (see header)
  if (claim.granted) return null;   // ours (fresh or renewed)
  args.onRefused?.(args.path, claim.heldBy ?? 'another agent');
  return refusal(args.path, claim);
}

/**
 * Decorate a write capability with implicit leasing. The lease is taken per PATH and
 * held for the rest of the run (released in bulk when the run ends), because a partial
 * edit sequence — read, transform, write — is only safe if no peer touches the file
 * between the read and the write, and the agent may interleave other work in between.
 */
export function guardRepoWrite(
  inner: RepoWriteCapability,
  args: { env: Env; db: Db; holder: LeaseHolder; onRefused?: (path: string, heldBy: string) => void },
): RepoWriteCapability {
  const { env, db, holder } = args;

  /** null = proceed; string = refuse with this message. */
  const gate = (path: string, reason: string): Promise<string | null> =>
    claimWriteLease({ env, db, holder, path, reason, ...(args.onRefused ? { onRefused: args.onRefused } : {}) });

  return {
    async writeFile(path, content, summary): Promise<RepoWriteResult> {
      const blocked = await gate(path, summary ? `writing: ${summary}` : 'writing this file');
      if (blocked) return { ok: false, error: blocked };
      return inner.writeFile(path, content, summary);
    },
    async editFile(path, oldString, newString, replaceAll): Promise<RepoEditResult> {
      const blocked = await gate(path, 'editing this file');
      if (blocked) return { ok: false, error: blocked };
      return inner.editFile(path, oldString, newString, replaceAll);
    },
    async deleteFile(path, reason): Promise<RepoDeleteResult> {
      const blocked = await gate(path, reason ? `deleting: ${reason}` : 'deleting this file');
      if (blocked) return { ok: false, error: blocked };
      return inner.deleteFile(path, reason);
    },
  };
}
