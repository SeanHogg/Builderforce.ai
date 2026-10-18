/**
 * "My workspaces" — THE list and THE create for the signed-in person's own
 * workspaces.
 *
 * Four list endpoints (`/api/auth/my-tenants`, `/api/tenants/mine`,
 * `GET /api/tenants`, `/api/vscode/tenants`) and three create endpoints
 * (`POST /api/tenants`, `/api/tenants/create`, `/api/vscode/tenants`) each
 * re-assembled these steps, and they had already drifted: only some landed
 * pending invitations, only one returned the account's default workspace, and
 * the trial fields existed on two of the four. Canonical paths are
 * `GET`/`POST /api/tenants`; the others are aliases over the same handlers
 * (see `presentation/routes/workspaceHandlers.ts`).
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { UserId } from '../../domain/shared/types';
import type { Tenant } from '../../domain/tenant/Tenant';
import { UserRepository } from '../../infrastructure/repositories/UserRepository';
import { provisionBuiltinAgents } from '../agent/provisionBuiltinAgents';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { landPendingInvitations, type MembershipSeating } from './pendingInvitationLanding';
import type { TenantService } from './TenantService';

export type MyWorkspaceRow = Awaited<ReturnType<TenantService['listTenantsForUser']>>[number];

export interface MyWorkspaces {
  /** The workspace this account opens automatically — only while it still belongs to it. */
  defaultTenantId: number | null;
  tenants: MyWorkspaceRow[];
}

type WorkspaceLister = Pick<TenantService, 'listTenantsForUser'> & MembershipSeating;

/**
 * The caller's workspaces. Lands any invitation addressed to the account FIRST,
 * so an invitee sees the workspace on this very request rather than being
 * pushed into "create a workspace" onboarding.
 */
export async function listMyWorkspaces(
  db: Db,
  env: Env,
  tenantService: WorkspaceLister,
  userId: string,
): Promise<MyWorkspaces> {
  await landPendingInvitations(db, env, tenantService, userId);
  const [tenants, storedDefault] = await Promise.all([
    tenantService.listTenantsForUser(userId),
    new UserRepository(db).getDefaultTenantId(userId as UserId),
  ]);
  // Leaving a workspace must not leave the account auto-landed on a token
  // exchange that will fail.
  const defaultTenantId = storedDefault !== null && tenants.some((t) => t.id === storedDefault) ? storedDefault : null;
  return { defaultTenantId, tenants };
}

export type CreateWorkspaceResult =
  | { ok: true; tenant: Tenant }
  | { ok: false; error: 'name_required' };

/**
 * Create a workspace owned by the caller. `TenantService.createTenant` owns the
 * slug, the aggregate and the membership announcement; the built-in agents
 * (Validator + Security) are seeded after, best-effort, so a seeding failure
 * never loses the workspace that was just created.
 */
export async function createWorkspace(
  db: Db,
  tenantService: Pick<TenantService, 'createTenant'>,
  input: { name: string | null | undefined; ownerUserId: string },
): Promise<CreateWorkspaceResult> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'name_required' };
  const tenant = await tenantService.createTenant({ name, ownerUserId: input.ownerUserId });
  await provisionBuiltinAgents(db, tenant.id as number).catch((error) => {
    reportCaughtError(error, { source: 'application/tenant/myWorkspaces.ts', operation: 'createWorkspace.provisionBuiltinAgents' });
  });
  return { ok: true, tenant };
}
