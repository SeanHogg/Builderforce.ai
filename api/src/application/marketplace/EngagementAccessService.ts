/**
 * EngagementAccessService — makes an accepted engagement a REAL scoped access grant.
 *
 * Before this, `freelancer_engagements` was described as "the cross-tenant membership
 * bridge" but was consulted by nobody: a hired freelancer got a notification and a
 * row, and no actual entry into the employer's project. This service is the single
 * authority every engagement-scoped route consults to answer "may this freelancer
 * see / work this project's board?".
 *
 * The grant is deliberately NARROW (default access_scope = 'project'): an ACTIVE,
 * non-terminated engagement lets the freelancer view + work the ONE engaged project's
 * board — read its tickets, move a ticket to In Review (signal for review), and
 * present deliverable proposals — and nothing else in the employer's tenant. It never
 * hands the freelancer's own JWT the employer's tenant scope wholesale; callers pass
 * the freelancer's user id and the target project, and get back a scoped grant or null.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { freelancerEngagements } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export interface EngagementAccess {
  engagementId: string;
  tenantId: number;
  projectId: number | null;
  accessScope: 'project' | 'board_readonly' | 'tenant';
  freelancerUserId: string;
}

/** An engagement is a live access grant only while ACTIVE and not terminated. */
const ACTIVE = 'active';

function toAccess(row: {
  id: string; tenantId: number; projectId: number | null; accessScope: string; freelancerUserId: string;
}): EngagementAccess {
  const scope = (['project', 'board_readonly', 'tenant'].includes(row.accessScope)
    ? row.accessScope : 'project') as EngagementAccess['accessScope'];
  return {
    engagementId: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    accessScope: scope,
    freelancerUserId: row.freelancerUserId,
  };
}

export class EngagementAccessService {
  constructor(private readonly db: Db) {}

  /** Every workspace/project a user is currently hired into — the freelancer's "My
   *  Work" access list. Only ACTIVE, non-terminated engagements. */
  async activeForUser(userId: string): Promise<EngagementAccess[]> {
    const rows = await this.db
      .select({
        id: freelancerEngagements.id,
        tenantId: freelancerEngagements.tenantId,
        projectId: freelancerEngagements.projectId,
        accessScope: freelancerEngagements.accessScope,
        freelancerUserId: freelancerEngagements.freelancerUserId,
      })
      .from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.freelancerUserId, userId),
        eq(freelancerEngagements.status, ACTIVE),
        isNull(freelancerEngagements.terminatedAt),
      ));
    return rows.map(toAccess);
  }

  /** Load a specific engagement IFF it's an active grant owned by this user. */
  async getForUser(userId: string, engagementId: string): Promise<EngagementAccess | null> {
    const [row] = await this.db
      .select({
        id: freelancerEngagements.id,
        tenantId: freelancerEngagements.tenantId,
        projectId: freelancerEngagements.projectId,
        accessScope: freelancerEngagements.accessScope,
        freelancerUserId: freelancerEngagements.freelancerUserId,
      })
      .from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.id, engagementId),
        eq(freelancerEngagements.freelancerUserId, userId),
        eq(freelancerEngagements.status, ACTIVE),
        isNull(freelancerEngagements.terminatedAt),
      ))
      .limit(1);
    return row ? toAccess(row) : null;
  }

  /** Resolve access for a user to a specific project. Returns the grant when the user
   *  has an active engagement whose project_id matches (or a tenant-scoped engagement
   *  in that tenant). null = no access. */
  async resolveForProject(userId: string, tenantId: number, projectId: number): Promise<EngagementAccess | null> {
    const grants = await this.activeForUser(userId);
    // Exact project grant wins; otherwise a tenant-scoped grant in the same tenant.
    return (
      grants.find((g) => g.tenantId === tenantId && g.projectId === projectId) ??
      grants.find((g) => g.tenantId === tenantId && g.accessScope === 'tenant') ??
      null
    );
  }

  /** May this engagement's holder move a ticket (e.g. to In Review)? True unless the
   *  grant is read-only. Centralizes the write-gate so routes don't re-derive it. */
  canWrite(access: EngagementAccess): boolean {
    return access.accessScope !== 'board_readonly';
  }
}
