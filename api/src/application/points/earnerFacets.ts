/**
 * WHICH POINTS RULES APPLY TO THIS PERSON — derived, never stored.
 *
 * ── WHY THERE IS NO `earner_role` COLUMN ─────────────────────────────────────
 * The source product gated its points catalog on a `users.user_role` enum whose
 * four values (job seeker, recruiter, employer, creator) it also used for nav,
 * for pricing and for feature access. This platform already answers all four of
 * those questions from facts it stores for their own reasons:
 *
 *   • `users.available_for_hire` / `users.account_type` — is this person TALENT?
 *     (0269/0282: `available_for_hire` is the opt-in and is always true for a
 *     `freelancer` account, so reading both is reading one fact honestly.)
 *   • `tenant_members` — do they hold a seat in a workspace? A workspace seat is
 *     what "employer" meant: the side that posts the job and confirms the hire.
 *   • `party_roles` — the kernel's answer to "what role does this party hold",
 *     which already carries `recruiter` and `seller` as values (PRD 20 §3.2).
 *
 * Adding a fifth column would be a second answer to a question three tables
 * already answer, and the first time it disagreed with them somebody would earn
 * points they should not have. So the facets are COMPUTED, and this is the only
 * place that computes them.
 *
 * ── FACETS ARE A SET, NOT A CHOICE ───────────────────────────────────────────
 * The enum forced one value per person, which was wrong on the platform's own
 * terms: a builder who opted in to for-hire work is an employer AND talent, and
 * under the enum one of those two never earned. A set has no such tie to break.
 *
 * Pure resolver + one loader, deliberately split: the rule ("what do these facts
 * mean") is testable without a database, and the query is one round trip that
 * `awardPoints` caches per request.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { memberProfiles, partyRoles, tenantMembers, users } from '../../infrastructure/database/schema';
import type { EarnerFacet } from './pointsCatalog';

/** The facts the resolver reads. Named so the pure rule below can be tested
 *  against a literal instead of a database. */
export interface EarnerFacts {
  accountType: string | null;
  availableForHire: boolean;
  /** Holds at least one ACTIVE workspace seat. */
  hasWorkspaceSeat: boolean;
  /** Active `party_roles` this person holds, lowercased. */
  partyRoles: readonly string[];
}

/**
 * The rule. A person can hold several facets at once; an account with no signal
 * at all still earns the unrestricted rules, because a rule with an empty
 * `facets` list pays every signed-in earner and never consults this set.
 */
export function facetsFor(facts: EarnerFacts): Set<EarnerFacet> {
  const facets = new Set<EarnerFacet>();
  if (facts.availableForHire || facts.accountType === 'freelancer') facets.add('talent');
  if (facts.hasWorkspaceSeat) facets.add('employer');
  if (facts.partyRoles.includes('recruiter')) facets.add('recruiter');
  if (facts.partyRoles.includes('seller')) facets.add('creator');
  return facets;
}

/** The three reads the rule needs, as one round trip each and nothing more. */
export async function loadEarnerFacts(db: Db, tenantId: number, userId: string): Promise<EarnerFacts> {
  const [[user], seats, roles] = await Promise.all([
    db.select({ accountType: users.accountType, availableForHire: users.availableForHire })
      .from(users).where(eq(users.id, userId)).limit(1),
    db.select({ id: tenantMembers.id }).from(tenantMembers)
      .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.isActive, true))).limit(1),
    db.select({ role: partyRoles.role }).from(partyRoles)
      .where(and(
        eq(partyRoles.tenantId, tenantId),
        eq(partyRoles.partyRef, userId),
        eq(partyRoles.status, 'active'),
        inArray(partyRoles.role, ['recruiter', 'seller']),
      )),
  ]);

  return {
    accountType: user?.accountType ?? null,
    availableForHire: user?.availableForHire ?? false,
    hasWorkspaceSeat: seats.length > 0,
    partyRoles: roles.map((r) => r.role.toLowerCase()),
  };
}

/**
 * The earner's own IANA timezone, or null when unknown.
 *
 * Read from `member_profiles.timezone` — the column this platform already keeps
 * for capacity and work-hours planning — rather than from a new one, because "what
 * day is it for this person" has one right answer per person and a second column
 * would be a second answer. Null is a legitimate result and the streak falls back
 * to UTC; see the note in `streakEngine.localDay`.
 */
export async function loadEarnerTimezone(db: Db, tenantId: number, userId: string): Promise<string | null> {
  const [row] = await db.select({ timezone: memberProfiles.timezone })
    .from(memberProfiles)
    .where(and(
      eq(memberProfiles.tenantId, tenantId),
      eq(memberProfiles.memberRef, userId),
    ))
    .limit(1);
  return row?.timezone ?? null;
}

/** Does this person's facet set satisfy a rule's requirement? An EMPTY
 *  requirement is "anyone", which is why it is checked first and not folded
 *  into the intersection. */
export function facetsAllow(required: readonly EarnerFacet[], held: ReadonlySet<EarnerFacet>): boolean {
  if (required.length === 0) return true;
  return required.some((facet) => held.has(facet));
}
