/**
 * SecurityTicketAccessService — the ONE place that decides who may see the
 * access-restricted SECURITY tickets the Security agent files, and the ONE filter
 * every task read surface runs so the rule is never duplicated.
 *
 * Model (migration 0291, `security_ticket_access`): default-DENY. A tenant opts
 * whole audiences in — humans / hired agents / talent — and/or names specific users
 * or agents on an allowlist. Tenant Owner/Manager ALWAYS see security tickets (they
 * administer access), independent of the config. Everyone else sees a security
 * ticket only if their audience is enabled or they are explicitly allowlisted.
 *
 * DRY: `canView` is the single predicate; `filterTasks` is the single list filter.
 * HTTP task routes and the built-in MCP `tasks.*` tools both call these — a caller
 * who is not permitted simply never receives the row.
 */
import { eq } from 'drizzle-orm';
import { securityTicketAccess } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { TaskType, TenantRole, hasMinRole } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** Whole-population opt-ins. All false ⇒ only Owner/Manager (+ allowlist) can see. */
export interface SecurityAudiences {
  humans: boolean;
  hired: boolean;
  talent: boolean;
}

export interface SecurityAccessConfig {
  audiences: SecurityAudiences;
  allowUserIds: string[];
  allowAgentRefs: string[];
}

/** The caller whose visibility is being decided. Assembled once per request by
 *  resolveTicketViewer (routes) or from the MCP call context (built-in tools). */
export interface TicketViewer {
  userId?: string | null;
  role?: TenantRole | string | null;
  /** users.account_type — 'freelancer' ⇒ talent; otherwise a human member. */
  accountType?: string | null;
  /** True when the caller is an agent run (cloud/on-prem), not a human. */
  isAgent?: boolean;
  /** ide_agents.id of the acting agent, for allowlist + built-in-agent checks. */
  agentRef?: string | null;
  /** builtin_kind of the acting agent — the Security agent ('security') always sees. */
  builtinKind?: string | null;
}

const DEFAULT_CONFIG: SecurityAccessConfig = {
  audiences: { humans: false, hired: false, talent: false },
  allowUserIds: [],
  allowAgentRefs: [],
};

const cacheKey = (tenantId: number): string => `security-access:tenant:${tenantId}`;

/** Coerce whatever the JSONB column deserialises to into a clean config shape. */
function normalize(row: {
  audiences: unknown; allowUserIds: unknown; allowAgentRefs: unknown;
} | undefined): SecurityAccessConfig {
  if (!row) return DEFAULT_CONFIG;
  const a = (row.audiences ?? {}) as Partial<SecurityAudiences>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  return {
    audiences: { humans: !!a.humans, hired: !!a.hired, talent: !!a.talent },
    allowUserIds: arr(row.allowUserIds),
    allowAgentRefs: arr(row.allowAgentRefs),
  };
}

export class SecurityTicketAccessService {
  constructor(private readonly db: Db, private readonly env?: Env) {}

  /** The tenant's access config (cached read-through; default-deny when unset). */
  async getConfig(tenantId: number): Promise<SecurityAccessConfig> {
    const load = async (): Promise<SecurityAccessConfig> => {
      const [row] = await this.db
        .select({
          audiences: securityTicketAccess.audiences,
          allowUserIds: securityTicketAccess.allowUserIds,
          allowAgentRefs: securityTicketAccess.allowAgentRefs,
        })
        .from(securityTicketAccess)
        .where(eq(securityTicketAccess.tenantId, tenantId))
        .limit(1);
      return normalize(row);
    };
    if (!this.env) return load();
    return getOrSetCached(this.env, cacheKey(tenantId), load, { kvTtlSeconds: 300 });
  }

  /** Upsert the config and invalidate the cache so the next read is fresh. */
  async setConfig(
    tenantId: number,
    cfg: Partial<SecurityAccessConfig>,
    updatedBy?: string | null,
  ): Promise<SecurityAccessConfig> {
    const current = await this.getConfig(tenantId);
    const next: SecurityAccessConfig = {
      audiences: { ...current.audiences, ...(cfg.audiences ?? {}) },
      allowUserIds: cfg.allowUserIds ? cfg.allowUserIds.map((x) => String(x)) : current.allowUserIds,
      allowAgentRefs: cfg.allowAgentRefs ? cfg.allowAgentRefs.map((x) => String(x)) : current.allowAgentRefs,
    };
    await this.db
      .insert(securityTicketAccess)
      .values({
        tenantId,
        audiences: next.audiences,
        allowUserIds: next.allowUserIds,
        allowAgentRefs: next.allowAgentRefs,
        updatedAt: new Date(),
        updatedBy: updatedBy ?? undefined,
      })
      .onConflictDoUpdate({
        target: securityTicketAccess.tenantId,
        set: {
          audiences: next.audiences,
          allowUserIds: next.allowUserIds,
          allowAgentRefs: next.allowAgentRefs,
          updatedAt: new Date(),
          updatedBy: updatedBy ?? undefined,
        },
      });
    if (this.env) await invalidateCached(this.env, cacheKey(tenantId)).catch(() => {});
    return next;
  }

  /**
   * The single visibility predicate. Owner/Manager always; else the acting Security
   * agent, an explicit allowlist grant, or an enabled audience for the viewer's
   * population (agent ⇒ hired, freelancer ⇒ talent, otherwise human member).
   */
  static canView(viewer: TicketViewer, cfg: SecurityAccessConfig): boolean {
    // Owner/Manager administer access and always see security tickets.
    const role = viewer.role as TenantRole | undefined;
    if (role && hasMinRole(role, TenantRole.MANAGER)) return true;
    // The Security agent itself (files the findings) always sees them.
    if (viewer.builtinKind === 'security') return true;
    // Explicit allowlist grants.
    if (viewer.isAgent && viewer.agentRef && cfg.allowAgentRefs.includes(viewer.agentRef)) return true;
    if (!viewer.isAgent && viewer.userId && cfg.allowUserIds.includes(viewer.userId)) return true;
    // Whole-audience opt-in for the viewer's population.
    if (viewer.isAgent) return cfg.audiences.hired;
    if (viewer.accountType === 'freelancer') return cfg.audiences.talent;
    return cfg.audiences.humans;
  }

  /** Drop the security tickets `viewer` may not see; every other task passes through. */
  static filterTasks<T extends { taskType?: string | null }>(
    tasks: T[],
    viewer: TicketViewer,
    cfg: SecurityAccessConfig,
  ): T[] {
    // Fast path: a viewer who may see security tickets keeps the full list.
    if (SecurityTicketAccessService.canView(viewer, cfg)) return tasks;
    return tasks.filter((t) => t.taskType !== TaskType.SECURITY);
  }

  /** Convenience: load config + filter in one call (the shape routes use). */
  async filterForViewer<T extends { taskType?: string | null }>(
    tenantId: number,
    viewer: TicketViewer,
    tasks: T[],
  ): Promise<T[]> {
    // Skip the config read entirely when the list holds no security tickets.
    if (!tasks.some((t) => t.taskType === TaskType.SECURITY)) return tasks;
    const cfg = await this.getConfig(tenantId);
    return SecurityTicketAccessService.filterTasks(tasks, viewer, cfg);
  }
}
