/**
 * Who may USE a paid marketplace skill — the ONE entitlement check, beside the checkout
 * that grants it (`skillCommerce`).
 *
 * An ASSIGNMENT is not proof of purchase: any manager can write one. What proves a
 * workspace may run a paid skill's folder is a `marketplace_purchases` row — the
 * workspace's own (`tenant_id`), or a user-scoped one (`tenant_id` NULL, which is what
 * `completeSkillCheckout` writes) bought by an active member of the workspace — or the
 * listing's author being a member (a seller never buys their own skill). A free listing,
 * or a name that is not a marketplace listing at all (a workspace or builtin skill), needs
 * nothing.
 *
 * Every gate calls this: the skill library's marketplace resolution and every writer of
 * a skill assignment (the assignment port, `/api/artifact-assignments`, the
 * `artifact_assignments.assign` MCP tool).
 */

import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { marketplacePurchases, marketplaceSkills, tenantMembers } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** A paid skill assigned (or loaded) by a workspace that has not bought it. */
export class SkillPaymentRequired extends Error {
  readonly status = 402;
  readonly code = 'skill_payment_required';
  constructor(readonly slug: string) {
    super(`"${slug}" is a paid marketplace skill this workspace has not purchased. Buy it from the marketplace first.`);
  }
}

/**
 * Of `slugs`, the ones this workspace may USE — every free or non-marketplace name, and
 * each paid listing it is entitled to. Three queries whatever the number of slugs (the
 * listings, the matching purchases, the authors among the members), never one per slug.
 */
export async function paidSkillEntitlements(db: Db, tenantId: number, slugs: readonly string[]): Promise<Set<string>> {
  const wanted = [...new Set(slugs)];
  const entitled = new Set(wanted);
  if (wanted.length === 0) return entitled;

  const listings = await db
    .select({ slug: marketplaceSkills.slug, priceCents: marketplaceSkills.priceCents, authorId: marketplaceSkills.authorId })
    .from(marketplaceSkills)
    .where(inArray(marketplaceSkills.slug, wanted))
    .limit(wanted.length);
  const paid = listings.filter((l) => (l.priceCents ?? 0) > 0);
  if (paid.length === 0) return entitled;
  for (const l of paid) entitled.delete(l.slug);

  const activeMembers = db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true)));
  const authorIds = [...new Set(paid.map((l) => l.authorId).filter((a): a is string => !!a))];

  const [purchased, authors] = await Promise.all([
    db
      .select({ slug: marketplacePurchases.artifactSlug })
      .from(marketplacePurchases)
      .where(and(
        eq(marketplacePurchases.artifactType, 'skill'),
        inArray(marketplacePurchases.artifactSlug, paid.map((l) => l.slug)),
        or(eq(marketplacePurchases.tenantId, tenantId), inArray(marketplacePurchases.userId, activeMembers)),
      )),
    authorIds.length === 0
      ? Promise.resolve([] as { userId: string }[])
      : db
        .select({ userId: tenantMembers.userId })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true), inArray(tenantMembers.userId, authorIds))),
  ]);
  for (const p of purchased) entitled.add(p.slug);
  const memberAuthors = new Set(authors.map((a) => a.userId));
  for (const l of paid) if (l.authorId && memberAuthors.has(l.authorId)) entitled.add(l.slug);
  return entitled;
}

/** {@link paidSkillEntitlements} for one slug. */
export async function hasPaidSkillEntitlement(db: Db, tenantId: number, slug: string): Promise<boolean> {
  return (await paidSkillEntitlements(db, tenantId, [slug])).has(slug);
}

/**
 * Drop the paid skills a workspace is not entitled to from a set about to be RENDERED
 * (a prompt, a catalog). Covers assignments written before assignments were gated; each
 * withheld slug is reported so it is observable, never silent.
 */
export async function withholdUnpaidSkills(db: Db, tenantId: number, slugs: readonly string[], surface: string): Promise<string[]> {
  if (slugs.length === 0) return [];
  const entitled = await paidSkillEntitlements(db, tenantId, slugs);
  const withheld = slugs.filter((s) => !entitled.has(s));
  if (withheld.length > 0) {
    reportCaughtError(new SkillPaymentRequired(withheld.join(', ')), {
      source: 'application/marketplace/skillEntitlement.ts',
      operation: `withholdUnpaidSkills.${surface}`,
      level: 'warning',
      context: { logMessage: '[skills] paid skill assigned without a purchase — withheld', details: { tenantId, withheld } },
    });
  }
  return slugs.filter((s) => entitled.has(s));
}

/** Refuse a skill assignment the workspace is not entitled to. No-op for anything else. */
export async function assertSkillAssignable(db: Db, tenantId: number, artifactType: string, slug: string): Promise<void> {
  if (artifactType !== 'skill') return;
  if (!await hasPaidSkillEntitlement(db, tenantId, slug)) throw new SkillPaymentRequired(slug);
}
