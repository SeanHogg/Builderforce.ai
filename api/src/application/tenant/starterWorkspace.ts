import { reportCaughtError } from '../observability/caughtErrorReporter';
import { ProjectService } from '../project/ProjectService';
import { provisionProject } from '../project/provisionProject';
import { TenantService } from './TenantService';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { TenantRepository } from '../../infrastructure/repositories/TenantRepository';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * Zero-setup onboarding, server side.
 *
 * A signed-up builder must never be able to exist without a workspace: with all
 * friction removed there is no step for them to abandon, so a `users` row with
 * zero `tenant_members` rows can only mean provisioning never ran. It used to
 * run ONLY in the browser (the onboarding gate's effect), which made it
 * conditional on the user coming back to the web app, clearing the terms and
 * role gates, and three network calls all succeeding — so every drop-off left a
 * workspace-less account behind.
 *
 * This is the single server-side use case that guarantees it instead. It is
 * idempotent and safe to call on any request: every signup door calls it at
 * account creation, and `GET /api/auth/me` calls it again as a self-heal so
 * accounts created before this existed (or by a create that failed midway)
 * repair themselves on the owner's next visit.
 */

export type StarterWorkspaceOutcome =
  | { created: true; tenantId: number; projectCreated: boolean }
  | { created: false; reason: 'not-a-builder' | 'already-has-workspace' | 'in-progress' | 'failed' };

/** Short-lived claim key so two concurrent callers can't both provision. */
const claimKey = (userId: string) => `starter-workspace-claim:user:${userId}`;
const CLAIM_TTL_SECONDS = 60;

/** Default starter project name for a brand-new workspace. */
export const STARTER_PROJECT_NAME = 'My first project';

/**
 * Human-readable name for a brand-new builder's first workspace. Derived from
 * who they are rather than a generic "Default" so the workspace switcher reads
 * like theirs from the first second.
 */
export function starterWorkspaceName(user: { displayName?: string | null; username?: string | null; email?: string | null }): string {
  const identity = (
    user.displayName?.trim()
    || user.username?.trim()
    || user.email?.split('@')[0]?.trim()
    || ''
  ).slice(0, 60);
  if (!identity) return 'My workspace';
  return /workspace$/i.test(identity) ? identity : `${identity}'s Workspace`;
}

/** Only a builder gets a workspace — a hired/sales account has a different shell. */
export function accountTypeGetsWorkspace(accountType: string | null | undefined): boolean {
  return (accountType ?? 'standard') === 'standard';
}

/**
 * Ensure this user owns at least one workspace containing at least one project.
 *
 * Never throws: a provisioning failure must not fail the signup, login or `/me`
 * request it rides on — the caller has already done the thing the user asked
 * for. The failure is reported and the next `/me` retries it.
 */
export async function ensureStarterWorkspace(
  env: Env,
  db: Db,
  user: { id: string; email?: string | null; username?: string | null; displayName?: string | null; accountType?: string | null },
): Promise<StarterWorkspaceOutcome> {
  if (!accountTypeGetsWorkspace(user.accountType)) return { created: false, reason: 'not-a-builder' };

  try {
    const tenantRepo = new TenantRepository(db);
    const existing = await tenantRepo.findByUserId(user.id);
    if (existing.length > 0) return { created: false, reason: 'already-has-workspace' };

    // Two tabs (or a signup redirect racing the first `/me`) would otherwise both
    // read zero workspaces and both create one. Claim the user for a minute; the
    // TTL means a crashed run self-releases and the next `/me` retries.
    if (await peekCached<boolean>(env, claimKey(user.id))) return { created: false, reason: 'in-progress' };
    await setCached(env, claimKey(user.id), true, { kvTtlSeconds: CLAIM_TTL_SECONDS, l1TtlMs: CLAIM_TTL_SECONDS * 1_000 });

    const tenantService = new TenantService(tenantRepo, buildPaymentProvider(env), env);
    const tenant = await tenantService.createTenant({
      name: starterWorkspaceName(user),
      ownerUserId: user.id,
    });
    const tenantId = tenant.id as number;

    // A workspace with no project is only half a landing place, so seed the
    // starter project through the same use case the REST create path uses (files
    // + board + Evermind). Best-effort: an empty workspace is still a workspace,
    // and the dashboard build prompt can create a project — so a project failure
    // must not roll back the workspace we just guaranteed.
    let projectCreated = false;
    try {
      const projectService = new ProjectService(new ProjectRepository(db));
      const project = await projectService.createProject({
        tenantId,
        key: await projectService.buildUniqueKey(tenantId, STARTER_PROJECT_NAME),
        name: STARTER_PROJECT_NAME,
      });
      await provisionProject(env, db, tenantId, project);
      projectCreated = true;
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/tenant/starterWorkspace.ts',
        operation: 'ensureStarterWorkspace.project',
        context: { userId: user.id, tenantId },
      });
    }

    return { created: true, tenantId, projectCreated };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/tenant/starterWorkspace.ts',
      operation: 'ensureStarterWorkspace',
      context: { userId: user.id },
    });
    return { created: false, reason: 'failed' };
  }
}
