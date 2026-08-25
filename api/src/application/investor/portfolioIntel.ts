/**
 * Peer comparables, pad attachments and the module registry (PRD 19 §9).
 *
 * Three tables in `investor` that Builderforce declared and never read. They are
 * only loosely related, and this module says so rather than inventing a theme:
 * what they share is the domain and the fact that each is a small, self-contained
 * capability that does not justify a module of its own.
 *
 * ── COMPARABLES ARE HOW A VALUATION IS ARGUED ───────────────────────────────
 * `investor_peer_comparables` carries a peer's revenue, growth and multiple
 * against one of YOUR companies. {@link impliedValuation} multiplies the peer
 * multiple by the company's own revenue — which is the whole method, and it is
 * written out here rather than hidden, because the number's only use is being
 * defended in a room. {@link comparableSpread} reports the range rather than a
 * single point: a valuation quoted as one number is a valuation nobody believes.
 *
 * ── ATTACHMENTS HANG OFF THE PAD'S OBJECT ID ────────────────────────────────
 * `scratch_pad_attachments.pad_object_id` references `objects`, not a pad table,
 * which is what lets a pad be any registered object. `placement` is the position
 * on the pad and is stored opaquely: layout is the surface's business, and a
 * service that interpreted it would have to change every time the canvas does.
 *
 * ── `modules` IS A REGISTRY, AND `required_rung` IS ITS POINT ───────────────
 * BurnRateOS's `systemAdmin` read this to decide which modules a workspace sees.
 * `required_rung` gates on the tenant's progression rather than on a plan, which
 * is the distinction worth keeping: gating on PLAN is pricing and belongs to
 * `PlanLimits`, gating on RUNG is progressive disclosure and belongs here.
 * {@link visibleModules} therefore takes the rung as an argument and never reads
 * a plan — the two must not merge, or a pricing change silently rearranges the
 * navigation.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  companies,
  investorPeerComparables,
  modules,
  scratchPadAttachments,
} from '../../infrastructure/database/schema';
import { scopedToNullableTenant, scopedToTenant } from '../../infrastructure/database/tenantScope';

export class PortfolioIntelError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'PortfolioIntelError';
  }
}

const dec = (n: number | null | undefined): string | null =>
  n === null || n === undefined ? null : String(n);
const numOf = (v: string | null): number | null => (v === null ? null : Number(v));

// ── Peer comparables ────────────────────────────────────────────────────────

export async function addComparable(
  db: Db,
  tenantId: number,
  companyId: number,
  input: { peerName: string; sector?: string | null; revenue?: number | null; growthRate?: number | null; multiple?: number | null },
) {
  const peerName = input.peerName.trim();
  if (!peerName) throw new PortfolioIntelError('peerName is required');

  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(scopedToTenant(companies, tenantId, eq(companies.id, companyId)))
    .limit(1);
  if (!company) throw new PortfolioIntelError('company not found', 404);

  const [row] = await db
    .insert(investorPeerComparables)
    .values({
      tenantId,
      companyId,
      peerName: peerName.slice(0, 255),
      sector: input.sector ?? null,
      revenue: dec(input.revenue),
      growthRate: dec(input.growthRate),
      multiple: dec(input.multiple),
    })
    .returning();
  if (!row) throw new PortfolioIntelError('could not add the comparable');
  return row;
}

export async function comparablesFor(db: Db, tenantId: number, companyId: number) {
  return db
    .select()
    .from(investorPeerComparables)
    .where(scopedToTenant(investorPeerComparables, tenantId, eq(investorPeerComparables.companyId, companyId)))
    .orderBy(desc(investorPeerComparables.multiple));
}

/**
 * The spread of peer multiples — median, quartiles, and the count behind them.
 *
 * A range rather than a point, and the count is returned beside it because three
 * comparables and thirty support very different claims. Peers with no multiple
 * are excluded from the statistics rather than treated as zero, which would drag
 * every quartile toward nothing.
 */
export async function comparableSpread(db: Db, tenantId: number, companyId: number) {
  const [row] = await db
    .select({
      peers: sql<number>`count(*)::int`,
      medianMultiple: sql<number | null>`percentile_cont(0.5) within group (order by ${investorPeerComparables.multiple})`,
      p25Multiple: sql<number | null>`percentile_cont(0.25) within group (order by ${investorPeerComparables.multiple})`,
      p75Multiple: sql<number | null>`percentile_cont(0.75) within group (order by ${investorPeerComparables.multiple})`,
      medianGrowth: sql<number | null>`percentile_cont(0.5) within group (order by ${investorPeerComparables.growthRate})`,
    })
    .from(investorPeerComparables)
    .where(scopedToTenant(investorPeerComparables, tenantId, and(
      eq(investorPeerComparables.companyId, companyId),
      sql`${investorPeerComparables.multiple} is not null`,
    )));

  return row ?? { peers: 0, medianMultiple: null, p25Multiple: null, p75Multiple: null, medianGrowth: null };
}

/**
 * What the peer set implies this company is worth.
 *
 * Multiple times the company's own ARR, at the 25th, 50th and 75th percentile of
 * the peer set. The method is written out because the number's only purpose is to
 * be argued in a room, and an implied valuation whose derivation is hidden is one
 * that loses the argument.
 *
 * Returns nulls when the company has no ARR or the peer set has no multiples —
 * never a zero, which would read as "worthless" rather than "not enough data".
 */
export async function impliedValuation(db: Db, tenantId: number, companyId: number) {
  const [company] = await db
    .select({ id: companies.id, name: companies.name, arr: companies.arr })
    .from(companies)
    .where(scopedToTenant(companies, tenantId, eq(companies.id, companyId)))
    .limit(1);
  if (!company) throw new PortfolioIntelError('company not found', 404);

  const spread = await comparableSpread(db, tenantId, companyId);
  const arr = company.arr === null ? null : Number(company.arr);
  const at = (m: number | null) => (arr === null || m === null ? null : arr * m);

  return {
    company: { id: company.id, name: company.name, arr },
    peers: spread.peers,
    method: 'peer revenue multiple × this company\'s ARR',
    low: at(spread.p25Multiple),
    mid: at(spread.medianMultiple),
    high: at(spread.p75Multiple),
    multiples: { p25: spread.p25Multiple, median: spread.medianMultiple, p75: spread.p75Multiple },
    // Stated so a surface can caveat rather than imply precision.
    basis: spread.peers === 0 ? 'no comparables' : `${spread.peers} comparable(s)`,
  };
}

// ── Pad attachments ─────────────────────────────────────────────────────────

export async function attachToPad(
  db: Db,
  tenantId: number,
  input: { padObjectId: string; artifactId?: string | null; label?: string | null; placement?: unknown; addedBy?: string | null },
) {
  const [row] = await db
    .insert(scratchPadAttachments)
    .values({
      tenantId,
      padObjectId: input.padObjectId,
      artifactId: input.artifactId ?? null,
      label: input.label ?? null,
      // Opaque: layout belongs to the surface — see the module docstring.
      placement: input.placement ?? null,
      addedBy: input.addedBy ?? null,
    })
    .returning();
  if (!row) throw new PortfolioIntelError('could not attach to the pad');
  return row;
}

export async function padAttachments(db: Db, tenantId: number, padObjectId: string) {
  return db
    .select()
    .from(scratchPadAttachments)
    .where(scopedToTenant(scratchPadAttachments, tenantId, eq(scratchPadAttachments.padObjectId, padObjectId)))
    .orderBy(asc(scratchPadAttachments.createdAt));
}

/** Move or relabel one attachment. Placement is replaced wholesale rather than
 *  merged: a partial layout update is how two clients end up disagreeing about
 *  where something sits. */
export async function updateAttachment(
  db: Db,
  tenantId: number,
  id: number,
  patch: { label?: string | null; placement?: unknown },
) {
  const values: Record<string, unknown> = {};
  if (patch.label !== undefined) values.label = patch.label;
  if (patch.placement !== undefined) values.placement = patch.placement;
  if (Object.keys(values).length === 0) throw new PortfolioIntelError('nothing to update');

  const [row] = await db
    .update(scratchPadAttachments)
    .set(values)
    .where(scopedToTenant(scratchPadAttachments, tenantId, eq(scratchPadAttachments.id, id)))
    .returning();
  if (!row) throw new PortfolioIntelError('attachment not found', 404);
  return row;
}

export async function detach(db: Db, tenantId: number, id: number) {
  const [row] = await db
    .delete(scratchPadAttachments)
    .where(scopedToTenant(scratchPadAttachments, tenantId, eq(scratchPadAttachments.id, id)))
    .returning({ id: scratchPadAttachments.id });
  if (!row) throw new PortfolioIntelError('attachment not found', 404);
  return { detached: id };
}

// ── Module registry ─────────────────────────────────────────────────────────

/**
 * The modules a workspace may see at a given rung.
 *
 * Takes the rung as an ARGUMENT and never reads a plan — see the module
 * docstring. `required_rung` is progressive disclosure; plan gating is
 * `PlanLimits`, and merging them means a pricing change quietly rearranges
 * somebody's navigation.
 *
 * `tenant_id` is nullable because the platform ships a default registry and a
 * tenant may add to it, so this uses the nullable-tenant helper.
 */
export async function visibleModules(db: Db, tenantId: number | null, rung: number) {
  return db
    .select()
    .from(modules)
    .where(scopedToNullableTenant(modules, tenantId, sql`${modules.requiredRung} <= ${rung}`))
    .orderBy(asc(modules.position), asc(modules.key));
}

/** Every module, including ones above the current rung — the operator view, and
 *  what a "coming next" prompt reads. */
export async function allModules(db: Db, tenantId: number | null) {
  return db
    .select()
    .from(modules)
    .where(scopedToNullableTenant(modules, tenantId))
    .orderBy(asc(modules.position), asc(modules.key));
}

export async function upsertModule(
  db: Db,
  tenantId: number | null,
  input: { key: string; name: string; description?: string | null; domain?: string | null; requiredRung?: number; position?: number },
) {
  const key = input.key.trim().toLowerCase();
  if (!key) throw new PortfolioIntelError('key is required');
  if ((input.requiredRung ?? 0) < 0) throw new PortfolioIntelError('requiredRung must not be negative');

  const [existing] = await db
    .select({ id: modules.id })
    .from(modules)
    .where(scopedToNullableTenant(modules, tenantId, eq(modules.key, key)))
    .limit(1);

  const values = {
    tenantId,
    key: key.slice(0, 64),
    name: input.name.trim().slice(0, 200),
    description: input.description ?? null,
    domain: input.domain ?? null,
    requiredRung: input.requiredRung ?? 0,
    position: input.position ?? 0,
  };

  const [row] = existing
    ? await db.update(modules).set(values)
      .where(scopedToNullableTenant(modules, tenantId, eq(modules.id, existing.id))).returning()
    : await db.insert(modules).values(values).returning();
  if (!row) throw new PortfolioIntelError('could not save the module');
  return row;
}

/** How many modules each rung unlocks — the shape of the disclosure ladder, and
 *  the read that shows a rung nobody ever reaches. */
export async function rungLadder(db: Db, tenantId: number | null) {
  return db
    .select({
      requiredRung: modules.requiredRung,
      moduleCount: sql<number>`count(*)::int`,
    })
    .from(modules)
    .where(scopedToNullableTenant(modules, tenantId))
    .groupBy(modules.requiredRung)
    .orderBy(asc(modules.requiredRung));
}
