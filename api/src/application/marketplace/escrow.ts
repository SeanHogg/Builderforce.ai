/**
 * THE ESCROW STATE MACHINE, and the gate that makes fixed-price work safe to start.
 *
 * ── THE PROBLEM IT SOLVES ────────────────────────────────────────────────────────
 * Only hourly work could be transacted: a freelancer logged time, the client approved
 * a timecard, a payout was attempted. A fixed bid had no equivalent — no deliverables,
 * no proof the money existed, no acceptance event. So the two sides of every fixed
 * engagement were asked to fully trust each other, and the platform had nothing to say
 * when that failed.
 *
 * Escrow is the answer, and it is one property: MONEY IS HELD BEFORE WORK IS EXPECTED.
 * Everything below exists to make that property checkable rather than promised.
 *
 * ── WHY THIS MODULE IS PURE ──────────────────────────────────────────────────────
 * It decides; it never writes. `milestones.ts` is the only thing that touches rows and
 * the ledger, and it asks this module whether a move is legal first. That split is what
 * makes the machine testable as a table — every transition, including every REFUSAL,
 * is asserted without a database — and it is the same seam `canvasApprovalGate.ts`
 * draws for the same reason: a rule that can only be exercised through its writer is a
 * rule nobody writes the unhappy-path tests for.
 *
 * ── THE MOVES, AND WHO MAY MAKE THEM ─────────────────────────────────────────────
 *
 *      draft ──fund──▶ funded ──submit──▶ submitted ──approve──▶ approved ──release──▶ released
 *        │                │                   │
 *        │                │                   └──reject──▶ disputed
 *        │                └──cancel──▶ cancelled  (refund: the hold returns to the client)
 *        └──cancel──▶ cancelled                   (no money ever moved)
 *
 * Two asymmetries are deliberate and are the whole point of the design:
 *
 *   • Only the CLIENT can fund, approve, reject and cancel. Only the FREELANCER can
 *     submit. Neither party can move the money on their own — the client cannot mark
 *     work delivered, and the freelancer cannot mark it accepted.
 *   • `approved` and `released` are two states, not one. Approval is the client's
 *     decision and is irreversible; release is the money actually moving, which can
 *     fail (the payout provider is an env-gated stub — see `integrations/payments.ts`).
 *     Collapsing them would make a failed payout look like a withheld approval, and the
 *     freelancer would be told the client had not accepted work that they had.
 *
 * `disputed` has no automatic exit ON PURPOSE. There is no mediation flow yet (logged
 * as P2 in the parity audit), and a state machine that quietly times a dispute out in
 * somebody's favour is worse than one that stops and says a human is needed.
 */

/** Where a milestone is. Mirrors the CHECK constraint in migration 0924. */
export type MilestoneStatus =
  | 'draft'
  | 'funded'
  | 'submitted'
  | 'approved'
  | 'released'
  | 'cancelled'
  | 'disputed';

export const MILESTONE_STATUSES: readonly MilestoneStatus[] =
  ['draft', 'funded', 'submitted', 'approved', 'released', 'cancelled', 'disputed'];

/** What somebody is trying to do to a milestone. */
export type MilestoneAction = 'fund' | 'submit' | 'approve' | 'reject' | 'release' | 'cancel';

/**
 * Which side of the engagement is acting.
 *
 * `client` is anyone acting with the employer's tenant authority; `freelancer` is the
 * engaged user. Deliberately NOT a platform role: the question escrow asks is "whose
 * money is this", and a tenant ADMIN and a tenant MEMBER are the same answer.
 */
export type EscrowParty = 'client' | 'freelancer';

interface TransitionRule {
  from: readonly MilestoneStatus[];
  to: MilestoneStatus;
  by: EscrowParty;
  /** True when the move causes money to move, so the caller knows to write a ledger
   *  entry rather than only a status. */
  movesMoney: boolean;
}

/**
 * The legal moves, declared once.
 *
 * A table rather than a switch so that "what can happen to a funded milestone" is a
 * question with a readable answer, and so adding a state is one row rather than an
 * edit spread across every caller.
 */
const TRANSITIONS: Readonly<Record<MilestoneAction, TransitionRule>> = {
  // The client puts the money up. This is the ONLY thing that authorises work.
  fund:    { from: ['draft'],                  to: 'funded',    by: 'client',     movesMoney: true },
  // The freelancer says it is done. Allowed from `disputed` as well: a rejection is
  // feedback, and the natural next move is to fix it and resubmit — an escrow that
  // forced a dispute to be resolved before the obvious remedy could be offered would
  // send every disagreement to a mediation flow that does not exist yet.
  submit:  { from: ['funded', 'disputed'],     to: 'submitted', by: 'freelancer', movesMoney: false },
  // The client accepts. Irreversible, and separate from the payout (see the header).
  approve: { from: ['submitted'],              to: 'approved',  by: 'client',     movesMoney: false },
  // The client does not accept. Money stays held — it is neither paid nor refunded.
  reject:  { from: ['submitted'],              to: 'disputed',  by: 'client',     movesMoney: false },
  // The money reaches the freelancer. Retryable: a failed payout leaves `approved`.
  release: { from: ['approved'],               to: 'released',  by: 'client',     movesMoney: true },
  // Called off. NOT allowed once work has been submitted — a client must approve or
  // reject what they were given, and cancelling out from under a submission is how
  // escrow becomes a way to take work for free.
  //
  // `movesMoney` is TRUE here but is narrowed per-state by `evaluateEscrow`: cancelling
  // a `draft` refunds nothing because nothing was ever held, and writing a zero-value
  // refund row for it would put entries in the ledger that reconcile to nothing.
  cancel:  { from: ['draft', 'funded'],        to: 'cancelled', by: 'client',     movesMoney: true },
};

export type EscrowVerdict =
  | { allowed: true; next: MilestoneStatus; movesMoney: boolean }
  | { allowed: false; reason: EscrowRefusal };

/** Why a move was refused. A code rather than a sentence so the route can map it to a
 *  status and the UI can translate it. */
export type EscrowRefusal =
  /** The action is not defined for any state. */
  | 'unknown_action'
  /** The milestone is not in a state this action can be applied to. */
  | 'wrong_status'
  /** The other party owns this move. */
  | 'wrong_party'
  /** A funded milestone must carry a positive amount — there is nothing to hold. */
  | 'no_amount';

export interface EscrowRequest {
  action: MilestoneAction;
  status: MilestoneStatus;
  party: EscrowParty;
  amountCents: number;
}

/**
 * May this party make this move on a milestone in this state?
 *
 * Order of refusals matters and is asserted in the tests: PARTY is checked before
 * STATUS so that a freelancer trying to approve their own work is told they are not
 * allowed to, rather than being told the milestone is in the wrong state — which would
 * leak that the move would otherwise have succeeded and would send them looking for
 * the wrong fix.
 */
export function evaluateEscrow(request: EscrowRequest): EscrowVerdict {
  const rule = TRANSITIONS[request.action];
  if (!rule) return { allowed: false, reason: 'unknown_action' };
  if (rule.by !== request.party) return { allowed: false, reason: 'wrong_party' };
  if (!rule.from.includes(request.status)) return { allowed: false, reason: 'wrong_status' };
  // A zero-value hold is not escrow, it is a checkbox. Refused at funding rather than
  // at release so the client learns before the freelancer has been told to start.
  if (request.action === 'fund' && request.amountCents <= 0) return { allowed: false, reason: 'no_amount' };
  // Cancelling an unfunded draft is a state change only — see the `cancel` rule.
  const movesMoney = rule.movesMoney && !(request.action === 'cancel' && request.status === 'draft');
  return { allowed: true, next: rule.to, movesMoney };
}

/** Every action this party could take on a milestone in this state — what the UI
 *  renders as buttons, so a surface cannot offer a move the machine would refuse. */
export function availableEscrowActions(status: MilestoneStatus, party: EscrowParty): MilestoneAction[] {
  return (Object.keys(TRANSITIONS) as MilestoneAction[])
    .filter((action) => evaluateEscrow({ action, status, party, amountCents: 1 }).allowed);
}

// ---------------------------------------------------------------------------
// The funded-before-work gate
// ---------------------------------------------------------------------------

/**
 * States in which the client's money is HELD by the platform.
 *
 * `approved` is included and that is the subtle one: approval does not move money, so
 * an approved-but-unreleased milestone is still holding the client's funds. Leaving it
 * out would under-report the escrow balance by exactly the amount most at risk.
 */
const HOLDING_STATUSES: ReadonlySet<MilestoneStatus> = new Set<MilestoneStatus>(
  ['funded', 'submitted', 'approved', 'disputed'],
);

/** True while the platform is holding this milestone's money. */
export function isHoldingFunds(status: MilestoneStatus): boolean {
  return HOLDING_STATUSES.has(status);
}

export interface MilestoneMoney {
  status: MilestoneStatus;
  amountCents: number;
}

export interface EscrowSummary {
  /** Agreed across every milestone that has not been cancelled. */
  agreedCents: number;
  /** Currently held by the platform — the number that answers "is my money safe". */
  heldCents: number;
  /** Paid out. */
  releasedCents: number;
  /** Accepted but not yet paid — what the freelancer is owed right now. */
  owedCents: number;
  /** Agreed but never funded. The client's outstanding obligation. */
  unfundedCents: number;
}

/**
 * Roll a schedule up into the five numbers both sides ask about.
 *
 * Computed, never stored — the same argument `SpecField.derive` makes on the canvas:
 * a stored total is one somebody edits a row out from under, and an escrow balance that
 * disagrees with the milestones printed beneath it is the worst number in the product.
 */
export function summariseEscrow(milestones: readonly MilestoneMoney[]): EscrowSummary {
  const summary: EscrowSummary = { agreedCents: 0, heldCents: 0, releasedCents: 0, owedCents: 0, unfundedCents: 0 };
  for (const milestone of milestones) {
    const amount = Number.isFinite(milestone.amountCents) ? Math.max(0, milestone.amountCents) : 0;
    if (milestone.status === 'cancelled') continue;
    summary.agreedCents += amount;
    if (isHoldingFunds(milestone.status)) summary.heldCents += amount;
    if (milestone.status === 'released') summary.releasedCents += amount;
    if (milestone.status === 'approved') summary.owedCents += amount;
    if (milestone.status === 'draft') summary.unfundedCents += amount;
  }
  return summary;
}

export type WorkGateVerdict =
  /** Work is authorised — at least one milestone is funded. */
  | { authorised: true; reason: 'funded' }
  /** Not a fixed-price engagement; escrow does not govern it. */
  | { authorised: true; reason: 'not_fixed_price' }
  /** Fixed-price, but nothing has been funded yet. */
  | { authorised: false; reason: 'nothing_funded' }
  /** Fixed-price with no schedule at all — nothing has been agreed to fund. */
  | { authorised: false; reason: 'no_milestones' };

/**
 * MAY WORK START?
 *
 * The gate the parity audit called "funded-before-work", stated as a decision rather
 * than as advice. It answers only for FIXED-price engagements: hourly work is governed
 * by timecards and always passes, which is why the verdict names its reason instead of
 * returning a bare boolean — a caller that cannot tell "authorised because funded" from
 * "authorised because escrow does not apply" will eventually show a freelancer an
 * escrow badge on an hourly job.
 *
 * Deliberately per-ENGAGEMENT and not per-milestone: a schedule is funded incrementally
 * (fund the first milestone, work, release, fund the next), so requiring the WHOLE
 * schedule up front would make escrow unusable for exactly the long engagements it is
 * most needed on.
 */
export function evaluateWorkGate(
  engagementType: string | null | undefined,
  milestones: readonly MilestoneMoney[],
): WorkGateVerdict {
  if (engagementType !== 'fixed_bid') return { authorised: true, reason: 'not_fixed_price' };
  if (milestones.length === 0) return { authorised: false, reason: 'no_milestones' };
  const anyFunded = milestones.some((milestone) => isHoldingFunds(milestone.status) || milestone.status === 'released');
  return anyFunded ? { authorised: true, reason: 'funded' } : { authorised: false, reason: 'nothing_funded' };
}

// ---------------------------------------------------------------------------
// The ledger contract
// ---------------------------------------------------------------------------

/**
 * The `ledger_entries.reference` a money-moving escrow action writes.
 *
 * The reference is UNIQUE per (tenant, denomination) — so this string is the
 * idempotency key, and a retried release collides in the DATABASE rather than in a
 * check somebody remembered to write. That is the same rule `listingCommerce` follows
 * and the reason the knowledge-checkout webhook was required to land on it.
 *
 * Keyed on the ACTION as well as the milestone because one milestone legitimately
 * moves money more than once (fund, then release), and a reference that named only the
 * milestone would make the release look like a replay of the funding.
 */
export function escrowLedgerReference(milestoneId: string, action: MilestoneAction): string {
  return `escrow:${milestoneId}:${action}`;
}

/** How a money-moving action appears in the ledger. */
export interface EscrowLedgerMovement {
  /** `hold` when funds are captured, `payout` when they reach the freelancer,
   *  `refund` when they return to the client. All three already exist in
   *  `ledger_entries.entry_kind`; none of them is new vocabulary. */
  entryKind: 'hold' | 'payout' | 'refund';
  /** Who the entry is against. */
  accountKind: 'tenant' | 'user';
  /** Signed: a hold debits the client, a payout credits the freelancer. */
  sign: 1 | -1;
}

/**
 * What each money-moving action writes.
 *
 * Returns null for the actions that move no money, so a caller cannot accidentally
 * write a zero-value ledger row for an approval — a ledger full of no-ops is a ledger
 * nobody can reconcile.
 */
export function escrowMovement(action: MilestoneAction): EscrowLedgerMovement | null {
  switch (action) {
    // The client's money leaves their available balance and is held.
    case 'fund':    return { entryKind: 'hold',   accountKind: 'tenant', sign: -1 };
    // The hold becomes the freelancer's money.
    case 'release': return { entryKind: 'payout', accountKind: 'user',   sign: 1 };
    // The hold returns to the client.
    case 'cancel':  return { entryKind: 'refund', accountKind: 'tenant', sign: 1 };
    default:        return null;
  }
}
