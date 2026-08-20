/**
 * MEDIATION — the exit `disputed` never had.
 *
 * ── WHAT WAS MISSING ─────────────────────────────────────────────────────────────
 * `escrow.ts` put `disputed` in the state machine and then said, in its own header,
 * exactly why it stopped there: "`disputed` has no automatic exit ON PURPOSE. There is
 * no mediation flow yet, and a state machine that quietly times a dispute out in
 * somebody's favour is worse than one that stops and says a human is needed."
 *
 * This module is the human. It supplies the two moves escrow deliberately did not
 * declare — RAISE (from either side) and RESOLVE (by a mediator) — and nothing else.
 *
 * ── WHY THIS IS AN EXTENSION AND NOT A SECOND MACHINE ────────────────────────────
 * Every piece of vocabulary here comes from `escrow.ts` and is imported, never
 * restated: `MilestoneStatus`, `EscrowParty`, `EscrowRefusal`, `isHoldingFunds`,
 * `escrowMovement` and — the important one — `escrowLedgerReference`.
 *
 * That last import is what makes a ruling structurally safe. A resolution's money
 * movements are written under the SAME references an ordinary escrow release or
 * cancellation would use:
 *
 *      release in full / the freelancer's share of a split  →  escrow:<id>:release
 *      refund in full  / the client's share of a split      →  escrow:<id>:cancel
 *
 * `ledger_entries` is unique on (tenant_id, denomination, reference), so ONE milestone
 * can be paid at most once and refunded at most once, FOR ALL TIME, whether the money
 * moved through the ordinary path or through a ruling. A dispute module with its own
 * reference scheme would have been a second way to pay the same milestone, and the two
 * would not have collided.
 *
 * ── THE DIFF THIS MODULE WOULD PREFER TO NOT NEED ────────────────────────────────
 * `escrow.ts`'s `TRANSITIONS` table cannot express either new move: its `by` field is a
 * single `EscrowParty`, so "either side may raise" is inexpressible, and it has no verb
 * for a mediated outcome. The rules therefore live here, in the same shape (a declared
 * table, a pure evaluator, refusals as codes) so that the two read as one machine and
 * can be merged the moment `TRANSITIONS` grows a `by: EscrowParty[]`. Until then this
 * file is the authority for the two moves escrow does not declare, and escrow remains
 * the authority for the six it does — checked, not assumed: `evaluateDisputeRaise`
 * refuses any status escrow does not consider to be holding funds.
 *
 * ── WHY `reject` IS NOT THIS ─────────────────────────────────────────────────────
 * Escrow's `reject` also lands on `disputed`, and it stays exactly where it is. It is
 * the CLIENT saying "not yet" to a submission, whose natural next move is `submit`
 * again — escrow says so. A dispute is the other thing: a claim that needs a third
 * party. Both end in `disputed` because the money is held either way; only a dispute
 * has a `marketplace_disputes` row, and only a row can be resolved.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  disputeStatements,
  engagementMilestones,
  ledgerEntries,
  marketplaceDisputes,
  tenants,
} from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { resolveIsSuperadmin } from '../../infrastructure/auth/superadminFlag';
import { recordActivity, resolveHumanActor } from '../activity/activityLog';
import { notify } from '../notifications/notify';
import { createPayout, settlementMode, type SettlementMode } from '../integrations/payments';
import { invalidateEarnings } from '../finance/earningsLedger';
import {
  escrowLedgerReference,
  escrowMovement,
  isHoldingFunds,
  type EscrowParty,
  type EscrowRefusal,
  type MilestoneStatus,
} from './escrow';

const USD_CENTS = 'usd_cents';

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

export type DisputeStatus = 'open' | 'mediating' | 'resolved' | 'withdrawn';

/** Where a dispute can end up. Four, deliberately — a mediator picks from a list, and
 *  an open-ended settlement field is how two rulings of the same shape produce two
 *  different sets of ledger rows. */
export const DISPUTE_OUTCOMES = ['release_full', 'refund_full', 'split', 'restore'] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

export function isDisputeOutcome(value: unknown): value is DisputeOutcome {
  return typeof value === 'string' && (DISPUTE_OUTCOMES as readonly string[]).includes(value);
}

/** Who may file a position. The mediator files one too — their reasoning is part of
 *  the record, not a field on the ruling. */
export const STATEMENT_PARTIES = ['client', 'freelancer', 'mediator'] as const;
export type StatementParty = (typeof STATEMENT_PARTIES)[number];

export function isStatementParty(value: unknown): value is StatementParty {
  return typeof value === 'string' && (STATEMENT_PARTIES as readonly string[]).includes(value);
}

/**
 * Why a dispute move was refused.
 *
 * Extends `EscrowRefusal` rather than replacing it, so the route's existing
 * refusal→status mapping keeps working and a caller never has to learn a second
 * error vocabulary for the same subject.
 */
export type DisputeRefusal =
  | EscrowRefusal
  /** There is already a live dispute on this milestone. */
  | 'already_disputed'
  /** The milestone is not under dispute, so there is nothing to resolve or withdraw. */
  | 'not_disputed'
  /** The dispute has already been resolved or withdrawn. */
  | 'already_closed'
  /** The caller has no authority to mediate. */
  | 'not_mediator'
  /** A split that is not strictly between the two parties — see `awardFor`. */
  | 'bad_split'
  | 'not_found'
  | 'conflict';

// ---------------------------------------------------------------------------
// The pure machine
// ---------------------------------------------------------------------------

export type DisputeVerdict =
  | { allowed: true; next: MilestoneStatus }
  | { allowed: false; reason: DisputeRefusal };

/**
 * MAY THIS PARTY RAISE A DISPUTE ON A MILESTONE IN THIS STATE?
 *
 * The condition is `isHoldingFunds` — escrow's own predicate, not a list copied out of
 * it. That is the whole rule and it is the right one: a dispute exists to decide where
 * held money goes, so there is nothing to mediate over a `draft` (nothing was ever
 * held), a `released` (it has already gone) or a `cancelled` (it has already come back).
 *
 * `disputed` is excluded even though escrow counts it as holding, because a second
 * dispute over one pot of money is two answers to one question. That refusal is
 * `already_disputed` and not `wrong_status`, so the surface can say "there is already
 * a dispute open" rather than something the person cannot act on.
 *
 * BOTH parties may raise, and that is the one thing escrow's transition table cannot
 * express — every move it declares belongs to exactly one side. A freelancer who has
 * delivered and cannot get an answer needs this move as much as a client who has been
 * handed nothing.
 */
export function evaluateDisputeRaise(request: {
  status: MilestoneStatus;
  party: EscrowParty;
  amountCents: number;
}): DisputeVerdict {
  if (request.status === 'disputed') return { allowed: false, reason: 'already_disputed' };
  if (!isHoldingFunds(request.status)) return { allowed: false, reason: 'wrong_status' };
  // A zero-value hold is not escrow, it is a checkbox — escrow refuses to FUND one and
  // this refuses to mediate one, for the same reason and with the same code.
  if (request.amountCents <= 0) return { allowed: false, reason: 'no_amount' };
  return { allowed: true, next: 'disputed' };
}

/** How much each side gets under a ruling. */
export interface DisputeAward {
  freelancerCents: number;
  clientCents: number;
}

/**
 * THE ARITHMETIC OF A RULING.
 *
 * Pure, total, and the only place the four outcomes turn into money. Returns null for
 * a split that is not strictly between the two parties: a "split" of the whole amount
 * to one side is one of the two FULL outcomes wearing the wrong name, and letting it
 * through would put a `split` in the record for a ruling that was not one — which is
 * the row somebody later reads to understand what the mediator decided.
 */
export function awardFor(
  outcome: DisputeOutcome,
  amountCents: number,
  splitFreelancerCents?: number | null,
): DisputeAward | null {
  const amount = Math.max(0, Math.floor(amountCents));
  switch (outcome) {
    case 'release_full': return { freelancerCents: amount, clientCents: 0 };
    case 'refund_full':  return { freelancerCents: 0, clientCents: amount };
    case 'restore':      return { freelancerCents: 0, clientCents: 0 };
    case 'split': {
      const share = Math.floor(Number(splitFreelancerCents ?? NaN));
      if (!Number.isFinite(share) || share <= 0 || share >= amount) return null;
      // The client's share is the REMAINDER, never a second input. Two independently
      // supplied halves are two numbers that can fail to add up, and the pot they must
      // add up to is somebody's held money.
      return { freelancerCents: share, clientCents: amount - share };
    }
  }
}

/**
 * Where the milestone lands after a ruling.
 *
 * `split` lands on `released` and that is the considered answer: money reached the
 * freelancer, which is what `released` means, and the client's share is a refund row
 * beside it. The alternative — a fifth milestone status — would mean a migration to the
 * CHECK constraint and a new state every existing consumer of `MilestoneStatus` would
 * have to learn, to describe a milestone that is already fully described by "the money
 * moved and the dispute record says how".
 *
 * `restore` returns the milestone to whatever it was before the dispute, which is why
 * `prior_status` is captured at RAISE time — by the time anyone rules, the row says
 * `disputed` and the previous state is unrecoverable from it.
 */
export function statusAfterRuling(outcome: DisputeOutcome, priorStatus: MilestoneStatus | null): MilestoneStatus {
  switch (outcome) {
    case 'release_full': return 'released';
    case 'split':        return 'released';
    case 'refund_full':  return 'cancelled';
    // Falls back to `submitted` rather than `funded`: a dispute is almost always raised
    // after work was delivered, and putting a delivered milestone back to `funded`
    // would silently discard the submission.
    case 'restore':      return priorStatus ?? 'submitted';
  }
}

/** One ledger row a ruling writes. Every field comes from `escrowMovement`. */
export interface DisputeLedgerLine {
  reference: string;
  entryKind: 'hold' | 'payout' | 'refund';
  accountKind: 'tenant' | 'user';
  /** Signed, ready to write. */
  amountCents: number;
}

/**
 * The ledger rows a ruling writes — the freelancer's share, then the client's.
 *
 * Both references are escrow's own (see the module header), so a ruling can never pay a
 * milestone that the ordinary path already paid, and a retried ruling collides in
 * Postgres rather than in a check somebody remembered to write.
 *
 * A zero share writes NO row. A ledger full of zero-value entries is a ledger nobody can
 * reconcile — the same argument `escrowMovement` makes by returning null for the
 * actions that move no money.
 */
export function rulingLedgerLines(milestoneId: string, award: DisputeAward): DisputeLedgerLine[] {
  const lines: DisputeLedgerLine[] = [];
  const toFreelancer = escrowMovement('release');
  const toClient = escrowMovement('cancel');
  if (award.freelancerCents > 0 && toFreelancer) {
    lines.push({
      reference: escrowLedgerReference(milestoneId, 'release'),
      entryKind: toFreelancer.entryKind,
      accountKind: toFreelancer.accountKind,
      amountCents: toFreelancer.sign * award.freelancerCents,
    });
  }
  if (award.clientCents > 0 && toClient) {
    lines.push({
      reference: escrowLedgerReference(milestoneId, 'cancel'),
      entryKind: toClient.entryKind,
      accountKind: toClient.accountKind,
      amountCents: toClient.sign * award.clientCents,
    });
  }
  return lines;
}

/**
 * WHO MAY RULE.
 *
 * `platform` — a platform operator (superadmin). The only genuinely NEUTRAL mediator
 *   this product has, because both parties to an escrow dispute are inside the
 *   engagement: the client IS the workspace, so a workspace role can never be a third
 *   party to its own dispute.
 * `workspace` — the workspace OWNER. Allowed, because a self-hosted deployment has no
 *   platform operator at all and a dispute with no possible resolver is worse than one
 *   resolved by an interested party — but recorded as `workspace` authority on the row
 *   so the asymmetry is visible to the freelancer rather than hidden behind the word
 *   "mediator".
 * `none` — anybody else.
 *
 * Pure, so the table is asserted without a request.
 */
export type MediatorAuthority = 'platform' | 'workspace' | 'none';

export function mediatorAuthority(role: string | null | undefined, isSuperadmin: boolean): MediatorAuthority {
  if (isSuperadmin) return 'platform';
  return role === 'owner' ? 'workspace' : 'none';
}

/**
 * The same decision, resolved against the platform-superadmin flag.
 *
 * Lives HERE rather than in the route because the flag is an infrastructure read and
 * `check-layering.mjs` holds presentation to calling the application layer instead —
 * and because "who may rule" is a rule about disputes, not about HTTP. The route
 * supplies the two things only it knows (the token's role and subject) and gets back
 * the verdict.
 */
export async function resolveMediatorAuthority(
  env: Env,
  role: string | null | undefined,
  userId: string,
): Promise<MediatorAuthority> {
  return mediatorAuthority(role, await resolveIsSuperadmin(env, userId));
}

// ---------------------------------------------------------------------------
// The rows a surface reads
// ---------------------------------------------------------------------------

export interface DisputeStatement {
  party: StatementParty;
  authorRef: string;
  position: string;
  evidence: { label: string; url: string }[];
  filedAtISO: string;
}

export interface DisputeView {
  id: number;
  tenantId: number;
  workspaceName: string | null;
  milestoneId: string | null;
  milestoneTitle: string | null;
  amountCents: number;
  currency: string;
  raisedByRef: string;
  raisedByParty: EscrowParty;
  reason: string;
  detail: string | null;
  priorStatus: MilestoneStatus | null;
  status: DisputeStatus;
  outcome: DisputeOutcome | null;
  awardFreelancerCents: number;
  awardClientCents: number;
  mediatorUserId: string | null;
  resolution: string | null;
  resolvedAtISO: string | null;
  createdAtISO: string;
  statements: DisputeStatement[];
  /** How a ruling's money would actually settle today. */
  settlement: SettlementMode;
}

const disputeColumns = {
  id: marketplaceDisputes.id,
  tenantId: marketplaceDisputes.tenantId,
  milestoneId: marketplaceDisputes.milestoneId,
  raisedByRef: marketplaceDisputes.raisedByRef,
  raisedByParty: marketplaceDisputes.raisedByParty,
  reason: marketplaceDisputes.reason,
  detail: marketplaceDisputes.detail,
  amountDisputedCents: marketplaceDisputes.amountDisputedCents,
  priorStatus: marketplaceDisputes.priorStatus,
  status: marketplaceDisputes.status,
  outcome: marketplaceDisputes.outcome,
  awardFreelancerCents: marketplaceDisputes.awardFreelancerCents,
  awardClientCents: marketplaceDisputes.awardClientCents,
  mediatorUserId: marketplaceDisputes.mediatorUserId,
  resolution: marketplaceDisputes.resolution,
  resolvedAt: marketplaceDisputes.resolvedAt,
  createdAt: marketplaceDisputes.createdAt,
} as const;

type DisputeRow = {
  [K in keyof typeof disputeColumns]: unknown;
} & { milestoneTitle?: unknown; milestoneAmount?: unknown; milestoneCurrency?: unknown; workspaceName?: unknown };

function toView(row: DisputeRow, statements: DisputeStatement[], settlement: SettlementMode): DisputeView {
  return {
    id: Number(row.id),
    tenantId: Number(row.tenantId),
    workspaceName: (row.workspaceName as string | null) ?? null,
    milestoneId: (row.milestoneId as string | null) ?? null,
    milestoneTitle: (row.milestoneTitle as string | null) ?? null,
    amountCents: Number(row.milestoneAmount ?? row.amountDisputedCents ?? 0),
    currency: (row.milestoneCurrency as string | null) ?? 'USD',
    raisedByRef: String(row.raisedByRef ?? ''),
    raisedByParty: (row.raisedByParty as EscrowParty) ?? 'client',
    reason: String(row.reason ?? ''),
    detail: (row.detail as string | null) ?? null,
    priorStatus: (row.priorStatus as MilestoneStatus | null) ?? null,
    status: (row.status as DisputeStatus) ?? 'open',
    outcome: (row.outcome as DisputeOutcome | null) ?? null,
    awardFreelancerCents: Number(row.awardFreelancerCents ?? 0),
    awardClientCents: Number(row.awardClientCents ?? 0),
    mediatorUserId: (row.mediatorUserId as string | null) ?? null,
    resolution: (row.resolution as string | null) ?? null,
    resolvedAtISO: row.resolvedAt instanceof Date ? row.resolvedAt.toISOString() : null,
    createdAtISO: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(0).toISOString(),
    statements,
    settlement,
  };
}

/** The joined projection every read below shares — one query shape, so the client
 *  list, the worker list and the detail page cannot disagree about a dispute. */
function disputeSelect(db: Db) {
  return db.select({
    ...disputeColumns,
    milestoneTitle: engagementMilestones.title,
    milestoneAmount: engagementMilestones.amountCents,
    milestoneCurrency: engagementMilestones.currency,
    workspaceName: tenants.name,
  }).from(marketplaceDisputes)
    .leftJoin(engagementMilestones, eq(engagementMilestones.id, marketplaceDisputes.milestoneId))
    .leftJoin(tenants, eq(tenants.id, marketplaceDisputes.tenantId));
}

/** Every filing on a set of disputes, in ONE query — never one per dispute. */
async function statementsFor(db: Db, disputeIds: readonly number[]): Promise<Map<number, DisputeStatement[]>> {
  const byDispute = new Map<number, DisputeStatement[]>();
  if (disputeIds.length === 0) return byDispute;
  const rows = await db.select({
    disputeId: disputeStatements.disputeId,
    party: disputeStatements.party,
    authorRef: disputeStatements.authorRef,
    position: disputeStatements.position,
    evidence: disputeStatements.evidence,
    createdAt: disputeStatements.createdAt,
    tenantId: disputeStatements.tenantId,
  }).from(disputeStatements)
    // Scoped by the dispute ids the caller has ALREADY been authorised to read, which is
    // a narrower predicate than a tenant filter: a statement is only reachable through
    // its dispute, and every read below resolves that dispute under its own scope first.
    .where(acrossTenants(disputeStatements, 'subject_own_rows', inArray(disputeStatements.disputeId, [...disputeIds])));
  for (const row of rows) {
    const list = byDispute.get(Number(row.disputeId)) ?? [];
    list.push({
      party: row.party as StatementParty,
      authorRef: String(row.authorRef),
      position: String(row.position),
      evidence: normaliseEvidence(row.evidence),
      filedAtISO: row.createdAt.toISOString(),
    });
    byDispute.set(Number(row.disputeId), list);
  }
  return byDispute;
}

/** `[{ label, url }]`, defensively — the column is jsonb and a hand-written row could
 *  hold anything. A surface must never be handed a shape it will crash on. */
export function normaliseEvidence(raw: unknown): { label: string; url: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { label: string; url: string }[] = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url.trim().slice(0, 2000) : '';
    if (!url) continue;
    const label = typeof record.label === 'string' && record.label.trim()
      ? record.label.trim().slice(0, 200)
      : url;
    out.push({ label, url });
  }
  return out;
}

async function hydrate(db: Db, env: Env, rows: DisputeRow[]): Promise<DisputeView[]> {
  const settlement = settlementMode(env);
  const statements = await statementsFor(db, rows.map((row) => Number(row.id)));
  return rows.map((row) => toView(row, statements.get(Number(row.id)) ?? [], settlement));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every dispute in this workspace — the CLIENT's and the mediator's queue. */
export async function listTenantDisputes(db: Db, env: Env, tenantId: number, limit = 100): Promise<DisputeView[]> {
  const rows = await disputeSelect(db)
    .where(scopedToTenant(marketplaceDisputes, tenantId))
    .orderBy(desc(marketplaceDisputes.createdAt))
    .limit(Math.min(200, Math.max(1, limit)));
  return hydrate(db, env, rows as unknown as DisputeRow[]);
}

/**
 * Every dispute this FREELANCER is party to.
 *
 * Cross-tenant by design: a for-hire account works for many client workspaces and is a
 * member of none, so "my disputes" spans every tenant that has hired them. The access
 * predicate is the milestone's `freelancer_user_id` — the verified subject from the web
 * JWT — which returns rows for exactly one person.
 *
 * Joined through the milestone rather than filtered on `raised_by_ref`, because a
 * freelancer is party to a dispute the CLIENT raised just as much as to one they raised
 * themselves, and filtering on the raiser would hide exactly the disputes they most
 * need to answer.
 */
export async function listFreelancerDisputes(db: Db, env: Env, userId: string, limit = 100): Promise<DisputeView[]> {
  const rows = await disputeSelect(db)
    .where(acrossTenants(marketplaceDisputes, 'subject_own_rows',
      eq(engagementMilestones.freelancerUserId, userId)))
    .orderBy(desc(marketplaceDisputes.createdAt))
    .limit(Math.min(200, Math.max(1, limit)));
  return hydrate(db, env, rows as unknown as DisputeRow[]);
}

/** One dispute, scoped to the workspace that owns it. */
export async function readDispute(db: Db, env: Env, tenantId: number, disputeId: number): Promise<DisputeView | null> {
  const rows = await disputeSelect(db)
    .where(scopedToTenant(marketplaceDisputes, tenantId, eq(marketplaceDisputes.id, disputeId)))
    .limit(1);
  const views = await hydrate(db, env, rows as unknown as DisputeRow[]);
  return views[0] ?? null;
}

/**
 * The tenant a dispute belongs to, IF this freelancer is party to it.
 *
 * The same shape (and the same reason) as `milestoneTenantForFreelancer`: the freelancer
 * half of the API holds a web JWT and therefore no tenant, so rather than let a route
 * accept one from the request — an IDOR wearing a parameter — the dispute is resolved BY
 * the acting user and the tenant comes back from the row.
 */
export async function disputeTenantForFreelancer(db: Db, disputeId: number, userId: string): Promise<number | null> {
  const [row] = await db
    .select({ tenantId: marketplaceDisputes.tenantId })
    .from(marketplaceDisputes)
    .innerJoin(engagementMilestones, eq(engagementMilestones.id, marketplaceDisputes.milestoneId))
    .where(acrossTenants(marketplaceDisputes, 'subject_own_rows',
      and(
        eq(marketplaceDisputes.id, disputeId),
        eq(engagementMilestones.freelancerUserId, userId),
      )!,
    ))
    .limit(1);
  return row ? Number(row.tenantId) : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type DisputeResult =
  | { ok: true; dispute: DisputeView }
  | { ok: false; reason: DisputeRefusal };

interface MilestoneFacts {
  id: string;
  tenantId: number;
  engagementId: string | null;
  freelancerUserId: string | null;
  title: string;
  amountCents: number;
  currency: string;
  status: MilestoneStatus;
}

async function readMilestone(db: Db, tenantId: number, milestoneId: string): Promise<MilestoneFacts | null> {
  const [row] = await db.select({
    id: engagementMilestones.id,
    tenantId: engagementMilestones.tenantId,
    engagementId: engagementMilestones.engagementId,
    freelancerUserId: engagementMilestones.freelancerUserId,
    title: engagementMilestones.title,
    amountCents: engagementMilestones.amountCents,
    currency: engagementMilestones.currency,
    status: engagementMilestones.status,
  }).from(engagementMilestones)
    .where(scopedToTenant(engagementMilestones, tenantId, eq(engagementMilestones.id, milestoneId)))
    .limit(1);
  return row ? { ...row, status: row.status as MilestoneStatus } as MilestoneFacts : null;
}

export interface RaiseDisputeInput {
  tenantId: number;
  milestoneId: string;
  /** Which side is acting — established by which token authenticated the request, never
   *  taken from the body. */
  party: EscrowParty;
  actorUserId: string;
  reason: string;
  detail?: string | null;
}

/**
 * EITHER PARTY RAISES A DISPUTE. The funds stay held.
 *
 * Order: read → ask the machine → write the dispute → move the milestone. The dispute
 * row is written FIRST and the status second, guarded on the status we decided against,
 * for the same reason `moveMilestone` writes money before status: the two are not in one
 * transaction (neon-http has none) and the survivable half-failure is the one that leaves
 * a visible, retryable record. A dispute row with a milestone that still says `funded` is
 * a mediator's queue item somebody can act on; a `disputed` milestone with no dispute row
 * is a state with no exit at all — precisely what this module exists to remove.
 *
 * NO MONEY MOVES. That is the point of a dispute: the hold stays exactly where it was
 * until somebody rules.
 */
export async function raiseDispute(env: Env, db: Db, input: RaiseDisputeInput): Promise<DisputeResult> {
  const milestone = await readMilestone(db, input.tenantId, input.milestoneId);
  if (!milestone) return { ok: false, reason: 'not_found' };

  const verdict = evaluateDisputeRaise({
    status: milestone.status,
    party: input.party,
    amountCents: milestone.amountCents,
  });
  if (!verdict.allowed) return { ok: false, reason: verdict.reason };

  const reason = input.reason.trim().slice(0, 200);
  if (!reason) return { ok: false, reason: 'unknown_action' };

  const [created] = await db.insert(marketplaceDisputes).values({
    tenantId: input.tenantId,
    milestoneId: milestone.id,
    raisedByRef: input.actorUserId,
    raisedByParty: input.party,
    reason,
    detail: input.detail?.slice(0, 4000) ?? null,
    amountDisputedCents: milestone.amountCents,
    priorStatus: milestone.status,
    status: 'open',
  })
    // The partial unique index on (milestone_id) WHERE status IN ('open','mediating')
    // is what actually stops two simultaneous raises; this absorbs the collision so the
    // loser gets a refusal code rather than a 500.
    .onConflictDoNothing()
    .returning({ id: marketplaceDisputes.id });
  if (!created) return { ok: false, reason: 'already_disputed' };

  const [moved] = await db.update(engagementMilestones)
    .set({ status: 'disputed', updatedAt: new Date() })
    .where(scopedToTenant(engagementMilestones, input.tenantId,
      eq(engagementMilestones.id, milestone.id),
      // Optimistic guard: a concurrent escrow move produces one winner and one update
      // that touches zero rows, with no transaction involved.
      eq(engagementMilestones.status, milestone.status),
    ))
    .returning({ id: engagementMilestones.id });
  if (!moved) return { ok: false, reason: 'conflict' };

  await announceDispute(env, db, {
    tenantId: input.tenantId,
    milestone,
    actorUserId: input.actorUserId,
    party: input.party,
    verb: 'raised',
    title: `Dispute opened: ${milestone.title}`,
    body: reason,
    disputeId: created.id,
  });

  const view = await readDispute(db, env, input.tenantId, created.id);
  return view ? { ok: true, dispute: view } : { ok: false, reason: 'not_found' };
}

export interface FileStatementInput {
  tenantId: number;
  disputeId: number;
  party: StatementParty;
  authorRef: string;
  position: string;
  evidence?: unknown;
}

/**
 * File (or revise) one side's position.
 *
 * An UPSERT on (tenant, dispute, party) rather than an append: a dispute is a filing,
 * not a conversation, and two rows for one side are two answers to "what does the client
 * say". A revision replaces the position and the audit trail keeps the history —
 * `activity_log` is the platform's one audit store and every revision appends there.
 *
 * Refuses a CLOSED dispute. Filing against a ruling that has already moved money is not
 * a position, it is a record nobody will act on, and accepting it silently is how a
 * person concludes their evidence was ignored.
 */
export async function fileDisputeStatement(env: Env, db: Db, input: FileStatementInput): Promise<DisputeResult> {
  const [dispute] = await db.select({ id: marketplaceDisputes.id, status: marketplaceDisputes.status })
    .from(marketplaceDisputes)
    .where(scopedToTenant(marketplaceDisputes, input.tenantId, eq(marketplaceDisputes.id, input.disputeId)))
    .limit(1);
  if (!dispute) return { ok: false, reason: 'not_found' };
  if (dispute.status === 'resolved' || dispute.status === 'withdrawn') {
    return { ok: false, reason: 'already_closed' };
  }

  const position = input.position.trim().slice(0, 8000);
  if (!position) return { ok: false, reason: 'unknown_action' };
  const evidence = normaliseEvidence(input.evidence);

  await db.insert(disputeStatements).values({
    tenantId: input.tenantId,
    disputeId: input.disputeId,
    party: input.party,
    authorRef: input.authorRef,
    position,
    evidence,
  }).onConflictDoUpdate({
    target: [disputeStatements.tenantId, disputeStatements.disputeId, disputeStatements.party],
    set: { authorRef: input.authorRef, position, evidence, updatedAt: new Date() },
  });

  await recordActivity(env, db, {
    tenantId: input.tenantId,
    // Classified and named by the ONE resolver every audit write shares — a tenant
    // member is `human`, an engaged freelancer is `hire` with their engagement id, and
    // neither is something this module should be deciding for itself.
    actor: await resolveHumanActor(env, db, input.tenantId, input.authorRef),
    verb: 'dispute.statement_filed',
    targetType: 'dispute',
    targetId: input.disputeId,
    targetLabel: `Dispute #${input.disputeId}`,
    summary: `${input.party} filed a position`,
    metadata: { party: input.party, evidenceCount: evidence.length },
  });

  const view = await readDispute(db, env, input.tenantId, input.disputeId);
  return view ? { ok: true, dispute: view } : { ok: false, reason: 'not_found' };
}

/** Take the dispute into mediation. The assignment is the event that moves `open` →
 *  `mediating`, which is what lets both sides see that somebody has picked it up. */
export async function assignMediator(
  env: Env,
  db: Db,
  input: { tenantId: number; disputeId: number; mediatorUserId: string; authority: MediatorAuthority },
): Promise<DisputeResult> {
  if (input.authority === 'none') return { ok: false, reason: 'not_mediator' };
  const [updated] = await db.update(marketplaceDisputes)
    .set({ status: 'mediating', mediatorUserId: input.mediatorUserId, updatedAt: new Date() })
    .where(scopedToTenant(marketplaceDisputes, input.tenantId,
      eq(marketplaceDisputes.id, input.disputeId),
      inArray(marketplaceDisputes.status, ['open', 'mediating']),
    ))
    .returning({ id: marketplaceDisputes.id });
  if (!updated) return { ok: false, reason: 'already_closed' };

  await recordActivity(env, db, {
    tenantId: input.tenantId,
    actor: await resolveHumanActor(env, db, input.tenantId, input.mediatorUserId),
    verb: 'dispute.mediator_assigned',
    targetType: 'dispute',
    targetId: input.disputeId,
    targetLabel: `Dispute #${input.disputeId}`,
    summary: `Mediation started (${input.authority} authority)`,
    metadata: { authority: input.authority },
  });

  const view = await readDispute(db, env, input.tenantId, input.disputeId);
  return view ? { ok: true, dispute: view } : { ok: false, reason: 'not_found' };
}

export interface ResolveDisputeInput {
  tenantId: number;
  disputeId: number;
  mediatorUserId: string;
  authority: MediatorAuthority;
  outcome: DisputeOutcome;
  /** The freelancer's share, for `split` only. Ignored otherwise. */
  splitFreelancerCents?: number | null;
  resolution?: string | null;
}

/**
 * THE RULING — and the only place in this module that moves money.
 *
 * The order is the same one `moveMilestone` defends and for the same reason: MONEY
 * FIRST, then status. The two are not in one transaction, and ledger-then-status leaves
 * a movement recorded against a milestone that still reads `disputed` — visible,
 * reconcilable and retryable, where the retry collides on the unique reference and only
 * the status moves. Status-then-ledger would close a dispute over money that never went
 * anywhere.
 *
 * The payout call is best-effort and NON-BLOCKING, exactly as a release is: a missing
 * provider does not block a ruling, because the ledger entry is the platform's own
 * record either way and refusing to rule because no webhook is configured would strand
 * every self-hosted deployment with a dispute that can never end.
 */
export async function resolveDispute(env: Env, db: Db, input: ResolveDisputeInput): Promise<DisputeResult> {
  if (input.authority === 'none') return { ok: false, reason: 'not_mediator' };

  const [dispute] = await db.select({
    id: marketplaceDisputes.id,
    status: marketplaceDisputes.status,
    milestoneId: marketplaceDisputes.milestoneId,
    priorStatus: marketplaceDisputes.priorStatus,
  }).from(marketplaceDisputes)
    .where(scopedToTenant(marketplaceDisputes, input.tenantId, eq(marketplaceDisputes.id, input.disputeId)))
    .limit(1);
  if (!dispute) return { ok: false, reason: 'not_found' };
  if (dispute.status === 'resolved' || dispute.status === 'withdrawn') {
    return { ok: false, reason: 'already_closed' };
  }
  if (!dispute.milestoneId) return { ok: false, reason: 'not_found' };

  const milestone = await readMilestone(db, input.tenantId, dispute.milestoneId);
  if (!milestone) return { ok: false, reason: 'not_found' };
  if (milestone.status !== 'disputed') return { ok: false, reason: 'not_disputed' };

  const award = awardFor(input.outcome, milestone.amountCents, input.splitFreelancerCents);
  if (!award) return { ok: false, reason: 'bad_split' };

  // 1 · The money.
  for (const line of rulingLedgerLines(milestone.id, award)) {
    await db.insert(ledgerEntries).values({
      tenantId: milestone.tenantId,
      accountKind: line.accountKind,
      accountRef: line.accountKind === 'user'
        ? (milestone.freelancerUserId ?? '')
        : String(milestone.tenantId),
      denomination: USD_CENTS,
      amount: String(line.amountCents),
      entryKind: line.entryKind,
      reference: line.reference,
      memo: `Dispute ${input.outcome} — ${milestone.title}`,
      metadata: {
        source: 'dispute_resolution',
        disputeId: input.disputeId,
        milestoneId: milestone.id,
        engagementId: milestone.engagementId,
        outcome: input.outcome,
      },
    }).onConflictDoNothing({
      target: [ledgerEntries.tenantId, ledgerEntries.denomination, ledgerEntries.reference],
    });
  }

  if (award.freelancerCents > 0) {
    await createPayout(env, {
      invoiceId: milestone.id,
      amountCents: award.freelancerCents,
      currency: milestone.currency,
      freelancerUserId: milestone.freelancerUserId ?? '',
      tenantId: milestone.tenantId,
    });
  }

  // 2 · The milestone, guarded on the state we ruled against.
  const nextStatus = statusAfterRuling(input.outcome, dispute.priorStatus as MilestoneStatus | null);
  const now = new Date();
  const [moved] = await db.update(engagementMilestones)
    .set({
      status: nextStatus,
      updatedAt: now,
      ...(nextStatus === 'released' ? { releasedAt: now } : {}),
      ...(nextStatus === 'cancelled' ? { cancelledAt: now } : {}),
    })
    .where(scopedToTenant(engagementMilestones, input.tenantId,
      eq(engagementMilestones.id, milestone.id),
      eq(engagementMilestones.status, 'disputed'),
    ))
    .returning({ id: engagementMilestones.id });
  if (!moved) return { ok: false, reason: 'conflict' };

  // 3 · The record.
  await db.update(marketplaceDisputes)
    .set({
      status: 'resolved',
      outcome: input.outcome,
      awardFreelancerCents: award.freelancerCents,
      awardClientCents: award.clientCents,
      mediatorUserId: input.mediatorUserId,
      resolution: input.resolution?.slice(0, 8000) ?? null,
      resolvedBy: input.mediatorUserId,
      resolvedAt: now,
      updatedAt: now,
    })
    .where(scopedToTenant(marketplaceDisputes, input.tenantId, eq(marketplaceDisputes.id, input.disputeId)));

  await recordActivity(env, db, {
    tenantId: input.tenantId,
    actor: await resolveHumanActor(env, db, input.tenantId, input.mediatorUserId),
    verb: 'dispute.resolved',
    targetType: 'dispute',
    targetId: input.disputeId,
    targetLabel: `Dispute #${input.disputeId}`,
    summary: `Ruled ${input.outcome}`,
    metadata: {
      outcome: input.outcome,
      authority: input.authority,
      awardFreelancerCents: award.freelancerCents,
      awardClientCents: award.clientCents,
      milestoneId: milestone.id,
      settlement: settlementMode(env),
    },
  });

  if (milestone.freelancerUserId) {
    await notify(db, env, {
      userId: milestone.freelancerUserId,
      tenantId: input.tenantId,
      kind: 'dispute_resolved',
      title: `Dispute resolved: ${milestone.title}`,
      body: input.resolution ?? null,
      ref: milestone.engagementId,
    });
    // The books this person reads have just changed in a way no TTL should hide.
    await invalidateEarnings(env, milestone.freelancerUserId);
  }

  const view = await readDispute(db, env, input.tenantId, input.disputeId);
  return view ? { ok: true, dispute: view } : { ok: false, reason: 'not_found' };
}

/**
 * The raiser calls it off.
 *
 * Only the party who raised it may withdraw, which is why `actorUserId` is compared
 * against `raised_by_ref` in the predicate rather than checked afterwards: the other
 * side withdrawing somebody else's dispute would be the counterparty deciding a claim
 * against themselves is over.
 *
 * Puts the milestone back where it was. No money moves — nothing moved when it opened.
 */
export async function withdrawDispute(
  env: Env,
  db: Db,
  input: { tenantId: number; disputeId: number; actorUserId: string },
): Promise<DisputeResult> {
  const [dispute] = await db.select({
    id: marketplaceDisputes.id,
    status: marketplaceDisputes.status,
    milestoneId: marketplaceDisputes.milestoneId,
    priorStatus: marketplaceDisputes.priorStatus,
  }).from(marketplaceDisputes)
    .where(scopedToTenant(marketplaceDisputes, input.tenantId,
      eq(marketplaceDisputes.id, input.disputeId),
      eq(marketplaceDisputes.raisedByRef, input.actorUserId),
    ))
    .limit(1);
  if (!dispute) return { ok: false, reason: 'not_found' };
  if (dispute.status === 'resolved' || dispute.status === 'withdrawn') {
    return { ok: false, reason: 'already_closed' };
  }

  const now = new Date();
  await db.update(marketplaceDisputes)
    .set({ status: 'withdrawn', resolvedBy: input.actorUserId, resolvedAt: now, updatedAt: now })
    .where(scopedToTenant(marketplaceDisputes, input.tenantId, eq(marketplaceDisputes.id, input.disputeId)));

  if (dispute.milestoneId) {
    await db.update(engagementMilestones)
      .set({ status: (dispute.priorStatus as MilestoneStatus | null) ?? 'submitted', updatedAt: now })
      .where(scopedToTenant(engagementMilestones, input.tenantId,
        eq(engagementMilestones.id, dispute.milestoneId),
        eq(engagementMilestones.status, 'disputed'),
      ));
  }

  await recordActivity(env, db, {
    tenantId: input.tenantId,
    actor: await resolveHumanActor(env, db, input.tenantId, input.actorUserId),
    verb: 'dispute.withdrawn',
    targetType: 'dispute',
    targetId: input.disputeId,
    targetLabel: `Dispute #${input.disputeId}`,
    summary: 'Withdrawn by the party who raised it',
  });

  const view = await readDispute(db, env, input.tenantId, input.disputeId);
  return view ? { ok: true, dispute: view } : { ok: false, reason: 'not_found' };
}

/** Tell the other side, and write the audit line. Best-effort, like every other
 *  announcement in this subsystem — a notification failure must never undo a dispute. */
async function announceDispute(
  env: Env,
  db: Db,
  input: {
    tenantId: number;
    milestone: MilestoneFacts;
    actorUserId: string;
    party: EscrowParty;
    verb: string;
    title: string;
    body: string | null;
    disputeId: number;
  },
): Promise<void> {
  await recordActivity(env, db, {
    tenantId: input.tenantId,
    actor: await resolveHumanActor(env, db, input.tenantId, input.actorUserId),
    verb: `dispute.${input.verb}`,
    targetType: 'dispute',
    targetId: input.disputeId,
    targetLabel: `Dispute #${input.disputeId}`,
    summary: input.title,
    metadata: { party: input.party, milestoneId: input.milestone.id },
  });
  // The party that did NOT act is the one who needs telling. Only the freelancer is
  // reachable by user id from here — the client side is the workspace, whose members
  // read the dispute queue rather than a personal notification.
  if (input.party === 'client' && input.milestone.freelancerUserId) {
    await notify(db, env, {
      userId: input.milestone.freelancerUserId,
      tenantId: input.tenantId,
      kind: `dispute_${input.verb}`,
      title: input.title,
      body: input.body,
      ref: input.milestone.engagementId,
    });
  }
}

/** How many disputes in this workspace are still waiting on a mediator — the number a
 *  queue badge renders. One indexed COUNT, served by `idx_marketplace_disputes_status`. */
export async function openDisputeCount(db: Db, tenantId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`count(*)` })
    .from(marketplaceDisputes)
    .where(scopedToTenant(marketplaceDisputes, tenantId,
      inArray(marketplaceDisputes.status, ['open', 'mediating'])));
  return Number(row?.total ?? 0);
}
