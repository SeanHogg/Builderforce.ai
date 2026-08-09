/**
 * The ONE team roster (PRD 21 §4.1).
 *
 * `WorkforceCard` unified the *card*; nothing unified the *roster*. `AgentCard`
 * read `ide_agents`, `MemberCard` read the members path, and there was no single
 * list a footer, a presence pile or a drop target could read — nor a `kind`
 * discriminator that would let one renderer draw both. This is that list.
 *
 * It is a READ MODEL over the owners that already exist, not a third table: the
 * always-on seats come from `DOMAIN_MANIFEST` (PRD 20 §3 — the same column the
 * navigation is organised by), the humans from `tenant_members`, and the agents
 * from `ide_agents`. A new kind is a column value, not a new table (PRD 20 §0).
 *
 * WHY THE SEAT ROWS ARE LISTED EVEN WHEN NOTHING BACKS THEM. PRD 21 §2.6 rule 7:
 * "disable, never hide". A seat whose agent a workspace has not provisioned is
 * rendered visible and `locked`, because hiding it turns "not set up yet" into
 * "this product cannot do that". `DOMAIN_MANIFEST` is also the test for whether a
 * seat belongs in the footer at all: a domain owned by `Platform` has no one to
 * drag in, so it is a panel only and never appears here.
 *
 * CACHING (§6.3, and the platform's standing read-heavy rule). Served through
 * `getOrSetCached`; every write that changes who is on the team — agent
 * create/update/delete, hire/unhire, membership — invalidates
 * {@link teamRosterCacheKey}.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { ideAgents, tenantMembers, users, freelancerEngagements } from '../../infrastructure/database/schema';
import type { Env } from '../../env';
import { assignableWorkforceCacheKey } from '../kanban/assignableWorkforce';
import { DOMAIN_MANIFEST } from './DomainService';
import type { Domain } from './ObjectRegistry';

export type TeamMemberKind = 'human' | 'agent';
export type TeamAvailability = 'available' | 'busy' | 'unprovisioned';

/** One row shape for a person and for an agent — the whole point of the model. */
export interface TeamRosterMember {
  kind: TeamMemberKind;
  /** `users.id` for a human, `ide_agents.id` for an agent, `seat:<domain>` for an
   *  always-on seat that has no agent row behind it yet. */
  id: string;
  name: string;
  /** Workspace role for a human ('owner'/'developer'/…), seat title for an agent. */
  role: string | null;
  availability: TeamAvailability;
  avatarUrl: string | null;
  /** The PRD 20 §3 seat this row owns, when it owns one ('CFO', 'Manager', …). */
  seat: string | null;
  domain: Domain | null;
  /** Always-on seats render in the footer's first row, ahead of the invited team. */
  alwaysOn: boolean;
  /** Visible and disabled rather than absent — nothing is provisioned behind it. */
  locked: boolean;
}

export const teamRosterCacheKey = (tenantId: number): string => `roster:team:t:${tenantId}`;

/** Short TTL: membership changes rarely, and every write that can change it
 *  invalidates explicitly, so this only bounds the case nobody thought of. */
const TEAM_ROSTER_TTL_SECONDS = 120;

/**
 * Seat → the built-in agent that fills it (`ide_agents.builtin_kind`, migration
 * 0289). Only seats a provisioned agent genuinely fills are listed; the rest
 * render `locked` until PRD 19's tracks land theirs, which is the honest state
 * and the one rule 7 asks for.
 */
const SEAT_AGENT_KIND: Readonly<Record<string, string>> = {
  Manager: 'manager',
  Security: 'security',
  Support: 'incident_manager',
};

/** The seat that IS the board rather than a chip beside it (PRD 21 §4). */
const BOARD_SEAT = 'Brain';

/** The manifest's non-teammate owner: a domain owned by it is a panel only. */
const PLATFORM_SEAT = 'Platform';

/** An agent used within this window reads as mid-task rather than merely present. */
const BUSY_WINDOW_MS = 15 * 60 * 1000;

/** Engagement statuses that still count as a teammate (not declined/ended). */
const LIVE_ENGAGEMENT = ['invited', 'interviewing', 'active'];

/** The always-on seats, in manifest order — declared once, read by the footer. */
export function seatRoster(): Array<{ seat: string; domain: Domain }> {
  return Object.values(DOMAIN_MANIFEST)
    .filter((entry) => entry.seat !== PLATFORM_SEAT && entry.seat !== BOARD_SEAT)
    .map((entry) => ({ seat: entry.seat, domain: entry.domain }));
}

const humanName = (
  u: { displayName: string | null; username: string | null; email: string | null },
  fallback: string,
): string => u.displayName?.trim() || u.username?.trim() || u.email?.trim() || fallback;

const availabilityOf = (lastUsedAt: Date | null, now: number): TeamAvailability =>
  lastUsedAt != null && now - lastUsedAt.getTime() < BUSY_WINDOW_MS ? 'busy' : 'available';

/**
 * Build the roster. One read of each owner, composed here — the footer, the
 * presence pile and the canvas drop target all consume this single shape.
 *
 * `now` is a parameter so the busy window is testable without faking the clock.
 */
export async function loadTeamRoster(db: Db, tenantId: number, now = Date.now()): Promise<TeamRosterMember[]> {
  const [agentRows, humanRows, hireRows] = await Promise.all([
    db
      .select({
        id: ideAgents.id,
        name: ideAgents.name,
        title: ideAgents.title,
        builtinKind: ideAgents.builtinKind,
        lastUsedAt: ideAgents.lastUsedAt,
      })
      .from(ideAgents)
      .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.status, 'active'))),
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        username: users.username,
        email: users.email,
        avatarUrl: users.avatarUrl,
        role: tenantMembers.role,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true))),
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        username: users.username,
        email: users.email,
        avatarUrl: users.avatarUrl,
      })
      .from(freelancerEngagements)
      .innerJoin(users, eq(users.id, freelancerEngagements.freelancerUserId))
      .where(and(
        eq(freelancerEngagements.tenantId, tenantId),
        inArray(freelancerEngagements.status, LIVE_ENGAGEMENT),
      )),
  ]);

  const agentByKind = new Map(
    agentRows.filter((a) => a.builtinKind).map((a) => [a.builtinKind as string, a]),
  );

  // 1 · the always-on seats, in manifest order, backed by an agent where one exists
  const claimedAgentIds = new Set<string>();
  const seats: TeamRosterMember[] = seatRoster().map(({ seat, domain }) => {
    const backing = SEAT_AGENT_KIND[seat] ? agentByKind.get(SEAT_AGENT_KIND[seat]) : undefined;
    if (backing) claimedAgentIds.add(backing.id);
    return {
      kind: 'agent',
      id: backing?.id ?? `seat:${domain}`,
      name: backing?.name?.trim() || seat,
      role: backing?.title?.trim() || seat,
      availability: backing ? availabilityOf(backing.lastUsedAt, now) : 'unprovisioned',
      avatarUrl: null,
      seat,
      domain,
      alwaysOn: true,
      locked: backing == null,
    };
  });

  // 2 · the workspace's other agents — hired, built or bought
  const agents: TeamRosterMember[] = agentRows
    .filter((a) => !claimedAgentIds.has(a.id))
    .map((a) => ({
      kind: 'agent' as const,
      id: a.id,
      name: a.name?.trim() || a.id,
      role: a.title?.trim() || null,
      availability: availabilityOf(a.lastUsedAt, now),
      avatarUrl: null,
      seat: null,
      domain: null,
      alwaysOn: false,
      locked: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 3 · the humans — members first, then live engagements, deduped by user id
  const humans = new Map<string, TeamRosterMember>();
  for (const h of humanRows) {
    humans.set(h.id, {
      kind: 'human',
      id: h.id,
      name: humanName(h, h.id),
      role: h.role ?? null,
      availability: 'available',
      avatarUrl: h.avatarUrl ?? null,
      seat: null,
      domain: null,
      alwaysOn: false,
      locked: false,
    });
  }
  for (const h of hireRows) {
    if (humans.has(h.id)) continue;
    humans.set(h.id, {
      kind: 'human',
      id: h.id,
      name: humanName(h, h.id),
      role: 'hire',
      availability: 'available',
      avatarUrl: h.avatarUrl ?? null,
      seat: null,
      domain: null,
      alwaysOn: false,
      locked: false,
    });
  }

  return [
    ...seats,
    ...[...humans.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ...agents,
  ];
}

/** The cached read the route serves. */
export async function getTeamRoster(db: Db, env: Env, tenantId: number): Promise<TeamRosterMember[]> {
  return getOrSetCached(env, teamRosterCacheKey(tenantId), () => loadTeamRoster(db, tenantId), {
    kvTtlSeconds: TEAM_ROSTER_TTL_SECONDS,
  });
}

/** Called by every write that changes who is on the team. */
export async function invalidateTeamRoster(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, teamRosterCacheKey(tenantId));
}

/**
 * THE invalidation for "who is on this team" — the footer roster and the
 * assignable-workforce union the pickers read are two projections of one fact,
 * so a write that changes membership must clear both or they disagree.
 *
 * One helper rather than two calls at each site, for the reason the hire path
 * already learned the hard way: a hand-rolled list at each write drifts, and the
 * drift is invisible until someone hires an agent and cannot assign it.
 */
export async function invalidateTeamCaches(env: Env, tenantId: number): Promise<void> {
  await Promise.all([
    invalidateCached(env, teamRosterCacheKey(tenantId)),
    invalidateCached(env, assignableWorkforceCacheKey(tenantId)),
  ]);
}

/**
 * The port. Bound once in `src/index.ts` and handed to the route group, which
 * therefore never sees `Db`, `Env` or a table name — the same contract
 * `createDomainService` and `createObjectRegistry` keep, and the reason the
 * layering baseline does not grow by one when this file lands.
 *
 * Its own port rather than a method on `DomainService` because the dependency
 * runs the other way: this module reads `DOMAIN_MANIFEST`, so folding it back
 * into that file would make the pair circular.
 */
export function createTeamRosterService(db: Db, env: Env) {
  return {
    list: (tenantId: number) => getTeamRoster(db, env, tenantId),
    invalidate: (tenantId: number) => invalidateTeamRoster(env, tenantId),
  };
}

export type TeamRosterService = ReturnType<typeof createTeamRosterService>;
