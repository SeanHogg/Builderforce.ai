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

/** Only a builder gets a STARTER workspace — one seeded with a project to work in. */
export function accountTypeGetsWorkspace(accountType: string | null | undefined): boolean {
  return (accountType ?? 'standard') === 'standard';
}

/**
 * A for-hire account gets a workspace too — it just doesn't get a project.
 *
 * Their résumé is a Canvas object (PRD 18 T1 / PRD 20: an authored, shareable thing
 * IS the canvas), and every canvas object is tenant-scoped. Without a tenant of their
 * own a job seeker cannot own the one artefact the whole for-hire account exists to
 * produce — and `POST /api/creative/resume/import` (tenant-scoped) 401s for them.
 * So they get a workspace to HOLD things, not to build in: no starter project, and
 * `navGroupsForAccountType` still gives them the restricted shell. Owning a tenant
 * and being shown builder navigation are two different questions.
 */
export function accountTypeGetsPersonalWorkspace(accountType: string | null | undefined): boolean {
  return accountType === 'freelancer';
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
  return provisionOwnedWorkspace(env, db, user, { seedProject: true });
}

/**
 * Ensure a for-hire user owns a workspace to keep their own artefacts in.
 *
 * Same guarantees as {@link ensureStarterWorkspace} — idempotent, claim-guarded,
 * never throws — differing only in that it seeds no project.
 */
export async function ensurePersonalWorkspace(
  env: Env,
  db: Db,
  user: { id: string; email?: string | null; username?: string | null; displayName?: string | null; accountType?: string | null },
): Promise<StarterWorkspaceOutcome> {
  if (!accountTypeGetsPersonalWorkspace(user.accountType)) return { created: false, reason: 'not-a-builder' };
  return provisionOwnedWorkspace(env, db, user, { seedProject: false });
}

/**
 * The one provisioning path both entry points share. Kept private so "does this
 * account get a workspace" stays a question the two exported predicates answer,
 * and never a boolean a caller can pass in wrong.
 */
async function provisionOwnedWorkspace(
  env: Env,
  db: Db,
  user: { id: string; email?: string | null; username?: string | null; displayName?: string | null; accountType?: string | null },
  opts: { seedProject: boolean },
): Promise<StarterWorkspaceOutcome> {
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

    // A builder's workspace with no project is only half a landing place, so seed the
    // starter project through the same use case the REST create path uses (files
    // + board + Evermind). Best-effort: an empty workspace is still a workspace,
    // and the dashboard build prompt can create a project — so a project failure
    // must not roll back the workspace we just guaranteed. A for-hire account skips
    // this entirely: it holds a résumé, not a codebase.
    let projectCreated = false;
    if (opts.seedProject) {
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
          operation: 'provisionOwnedWorkspace.project',
          context: { userId: user.id, tenantId },
        });
      }
    }

    return { created: true, tenantId, projectCreated };
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/tenant/starterWorkspace.ts',
      operation: 'provisionOwnedWorkspace',
      context: { userId: user.id },
    });
    return { created: false, reason: 'failed' };
  }
}
