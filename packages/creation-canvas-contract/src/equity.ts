/**
 * THE ownership vocabulary — share classes, instruments, events and vesting, read by
 * the canvas, the API and the projection that folds them.
 *
 * ── WHAT THIS EXISTS TO PREVENT ──────────────────────────────────────────────────
 * `grep cap_table` across the schema returned nothing, and the canvas `capTable` was a
 * hand-typed `holders: {holder, instrument, shares, percent}` array whose own hint asked
 * the model to *"say so in `summary`"* when the percentages did not total 100 — an
 * object that documents its own inability to be right. Every downstream consequence
 * followed from that one shape: a pool top-up, a priced round, a departure and a
 * buy-back were all RE-TYPING, so a cap table could not survive its second event; there
 * was no vesting anywhere (`grep 409a|safe_note|equity_grant` was empty, and `vesting`
 * appeared only as prose inside `offer.equity`); and `fundingRound.roundType: 'safe'`
 * was a label over nothing, because the instrument a pre-seed company actually issues
 * could not be represented at all.
 *
 * ── THE THREE RULES THIS MODULE ENCODES ──────────────────────────────────────────
 * 1. **A quantity is never stored on the thing it belongs to.** `equity_grants` holds
 *    the TERMS of an award — class, holder, price, vesting schedule — and no share
 *    count. The count lives in the append-only event ledger, so "how many shares does
 *    Ana hold" is a fold and not a number somebody edited. This is the "no stored
 *    totals" rule migration 0464 states for `work_estimates.lines`, applied to the one
 *    table where a wrong total is a legal problem rather than a display bug.
 * 2. **Vested-to-date is COMPUTED, always.** {@link vestedQuantity} is pure and takes
 *    the schedule plus an instant. Nothing writes a vested figure anywhere.
 * 3. **A conversion is modelled, not asserted.** {@link convertInstrument} says what a
 *    SAFE becomes at a given priced round, from the cap and discount actually on it —
 *    so a priced round can be modelled against what came before it.
 *
 * Declared HERE, in the package both the frontend and the API already import, for the
 * same reason `parties.ts` is: a canvas `equityGrant`, an `/api/equity` body and an
 * `equity_events.event_kind` mean the same thing on purpose rather than by coincidence.
 */

// ---------------------------------------------------------------------------
// What a company issues
// ---------------------------------------------------------------------------

/**
 * The classes of stock a company authorises.
 *
 * `option-pool` is a class and not a flag: a pool has its own authorised count, is
 * diluted by its own grants, and the number a founder is asked for — "what is your
 * unallocated pool" — is authorised minus granted WITHIN it. Modelling it as a boolean
 * on common stock makes that subtraction impossible to express.
 */
export const SHARE_CLASS_KINDS = ['common', 'preferred', 'option-pool'] as const;
export type ShareClassKind = typeof SHARE_CLASS_KINDS[number];

/**
 * What a holder actually holds.
 *
 * `option` and `rsu` are separate from `common` because they are NOT shares until they
 * are exercised or settled: they dilute on a fully diluted basis and carry no vote, and
 * a cap table that reports them as common overstates both the holder's control and the
 * company's issued count.
 */
export const EQUITY_INSTRUMENTS = ['common', 'preferred', 'option', 'rsu', 'warrant'] as const;
export type EquityInstrument = typeof EQUITY_INSTRUMENTS[number];

/**
 * The append-only ledger's verbs — FO-D2.
 *
 * One row per THING THAT HAPPENED, never an edit to a holding. A pool top-up, a round,
 * a departure and a buy-back were all re-typing before this list existed; each is now a
 * row, which is also what makes a historical cap table askable ("what did we own in
 * March") rather than a question the data cannot answer.
 *
 *   issue       shares or options created and given to a holder
 *   transfer    an existing holding moves between two holders. ONE row, not two: a
 *               transfer that can be half-recorded is how a share count leaks.
 *   cancel      unvested options returned on a departure, or a grant voided
 *   exercise    options become shares. The option count falls and the share count
 *               rises by the same quantity, which is why it is one verb.
 *   repurchase  the company buys shares back. They leave the fold entirely rather
 *               than moving to a "treasury" holder nobody would recognise.
 *   pool-increase   authorised pool grows. Has no holder, which is exactly why the
 *               event's holder columns are nullable.
 *   conversion  a SAFE or note becomes equity at a priced round — the event
 *               {@link convertInstrument} produces the numbers for.
 */
export const EQUITY_EVENT_KINDS = [
  'issue', 'transfer', 'cancel', 'exercise', 'repurchase', 'pool-increase', 'conversion',
] as const;
export type EquityEventKind = typeof EQUITY_EVENT_KINDS[number];

export function isEquityEventKind(value: unknown): value is EquityEventKind {
  return typeof value === 'string' && (EQUITY_EVENT_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Vesting — FO-D3
// ---------------------------------------------------------------------------

/** How often a tranche vests after the cliff. `none` is a fully vested grant — a
 *  founder's already-earned stock, or an investor's purchased shares. */
export const VESTING_FREQUENCIES = ['none', 'monthly', 'quarterly', 'annual'] as const;
export type VestingFrequency = typeof VESTING_FREQUENCIES[number];

/**
 * What happens to unvested shares on a change of control.
 *
 * Carried because it is the term most often agreed in a conversation and recorded
 * nowhere — and because the two triggers mean genuinely different things: `single`
 * accelerates on the acquisition alone, `double` needs the acquisition AND a
 * termination. A cap table that cannot tell them apart cannot model an exit.
 */
export const ACCELERATION_KINDS = ['none', 'single-trigger', 'double-trigger'] as const;
export type AccelerationKind = typeof ACCELERATION_KINDS[number];

/** A grant's vesting terms. Every field is a TERM; nothing here is a computed figure. */
export interface VestingSchedule {
  /** ISO date the clock starts. Usually a start date, not the grant date. */
  startAt: string | null;
  /** Total length of the schedule in months. 0 or null means fully vested on day one. */
  durationMonths: number | null;
  /** Nothing vests until this many months have passed, and then that whole portion
   *  vests at once. The date it lands is what a `due-within` trigger watches. */
  cliffMonths: number | null;
  frequency: VestingFrequency;
  acceleration: AccelerationKind;
}

const MS_PER_DAY = 86_400_000;

/** Add whole months to an ISO date, clamping the day to the target month's length so
 *  a 31 January start does not silently roll into March. */
export function addMonths(iso: string, months: number): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const from = new Date(ms);
  const day = from.getUTCDate();
  const target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * The date a grant's cliff lands, or null when it has none.
 *
 * Exported because it is the value a `trigger` watches: the canvas writes it onto the
 * `equityGrant` card as `cliffAt` (a `deadline` field, per `DEADLINE_FIELD_NAMES`) so
 * the nightly sweep — which reads saved rows and cannot run a derivation — sees the
 * same date the card shows.
 */
export function cliffDate(schedule: VestingSchedule): string | null {
  if (!schedule.startAt || !schedule.cliffMonths || schedule.cliffMonths <= 0) return null;
  return addMonths(schedule.startAt, schedule.cliffMonths);
}

/** Whole months elapsed between two ISO dates, never negative. */
function monthsElapsed(startIso: string, asOfIso: string): number {
  const start = new Date(Date.parse(startIso));
  const asOf = new Date(Date.parse(asOfIso));
  if (Number.isNaN(start.getTime()) || Number.isNaN(asOf.getTime())) return 0;
  let months = (asOf.getUTCFullYear() - start.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - start.getUTCMonth());
  if (asOf.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** Months per tranche for a frequency. `none` never tranches — see below. */
const TRANCHE_MONTHS: Readonly<Record<VestingFrequency, number>> = {
  none: 0, monthly: 1, quarterly: 3, annual: 12,
};

/**
 * How much of a grant has VESTED by a given instant — computed, never stored.
 *
 * The shape every real schedule has: nothing before the cliff, the whole cliff portion
 * at once on the cliff date, then one tranche per period, and the full quantity at the
 * end of the term. Returns whole units, rounded DOWN — a fractional share is not a
 * thing, and rounding up would report a holder as vested in a share they cannot sell.
 *
 * `frequency: 'none'` or no duration means fully vested from `startAt`, which is the
 * correct reading for purchased shares and for a founder's already-earned stock.
 *
 * `accelerated` is passed by the CALLER rather than inferred: acceleration is a
 * change-of-control event, and a function that decided on its own that one had happened
 * would report a holder fully vested on a date nobody agreed.
 */
export function vestedQuantity(
  quantity: number,
  schedule: VestingSchedule,
  asOf: string,
  accelerated = false,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (accelerated && schedule.acceleration !== 'none') return Math.floor(quantity);

  const { startAt, durationMonths, cliffMonths, frequency } = schedule;
  if (!startAt) return 0;
  const duration = Number(durationMonths ?? 0);
  if (frequency === 'none' || duration <= 0) {
    return Date.parse(asOf) >= Date.parse(startAt) ? Math.floor(quantity) : 0;
  }

  const elapsed = monthsElapsed(startAt, asOf);
  const cliff = Math.max(0, Number(cliffMonths ?? 0));
  if (elapsed < cliff) return 0;
  if (elapsed >= duration) return Math.floor(quantity);

  const tranche = TRANCHE_MONTHS[frequency] || 1;
  // Periods COMPLETED, floored to the tranche — a monthly schedule five months in has
  // vested five months; a quarterly one has vested one quarter, not one and two thirds.
  const vestedMonths = Math.min(duration, Math.floor(elapsed / tranche) * tranche);
  // The cliff portion is included by construction: at `elapsed === cliff` the floor
  // above already yields the cliff's own months, which is what "vests all at once" means.
  return Math.floor((quantity * Math.max(vestedMonths, cliff)) / duration);
}

/** Days from now until a grant's cliff — negative once passed, null when there is no
 *  cliff. The one number a founder is asked for and cannot currently answer. */
export function daysToCliff(schedule: VestingSchedule, nowMs: number): number | null {
  const cliff = cliffDate(schedule);
  if (!cliff) return null;
  const ms = Date.parse(cliff);
  return Number.isFinite(ms) ? Math.round((ms - nowMs) / MS_PER_DAY) : null;
}

// ---------------------------------------------------------------------------
// Convertibles — FO-D4
// ---------------------------------------------------------------------------

/**
 * A SAFE or a convertible note.
 *
 * TWO values and not one, because they behave differently at maturity and only one of
 * them accrues: a note is DEBT with an interest rate and a maturity date the company
 * must do something about, and a SAFE is neither. A single "convertible" value would
 * make "what is due when" unanswerable for the instrument that has an answer.
 */
export const CONVERTIBLE_KINDS = ['safe', 'note'] as const;
export type ConvertibleKind = typeof CONVERTIBLE_KINDS[number];

/** The terms of one convertible. Nothing here is a share count: what it converts INTO
 *  is produced by {@link convertInstrument} and recorded as a `conversion` event. */
export interface ConvertibleTerms {
  kind: ConvertibleKind;
  principal: number;
  /** The valuation the holder's money buys in at, at most. Null means uncapped. */
  valuationCap: number | null;
  /** Percent off the round price, 0–100. Null means none. */
  discountPercent: number | null;
  /**
   * Post-money SAFE (the YC 2018 form) versus pre-money.
   *
   * Decisive, not cosmetic: on a post-money SAFE the holder's percentage is fixed and
   * the FOUNDERS absorb the dilution from every other SAFE in the stack; on a pre-money
   * one the SAFEs dilute each other. Founders routinely discover the difference at the
   * priced round, which is precisely when it is too late — so it is a stored term.
   */
  postMoney: boolean;
  /** Simple annual interest, for a note. Null or 0 for a SAFE. */
  interestRate: number | null;
  /** ISO date the money landed — the accrual start for a note. */
  issuedAt: string | null;
}

export interface ConversionResult {
  /** Principal plus accrued interest at the conversion date. */
  convertedAmount: number;
  /** The per-share price this instrument actually converts at. */
  conversionPrice: number;
  shares: number;
  /** Which term produced the price, so the answer explains itself rather than
   *  presenting a number the holder has to re-derive to trust. */
  basis: 'cap' | 'discount' | 'round-price';
}

/**
 * What one convertible becomes at a priced round.
 *
 * The holder gets the BETTER of the cap price and the discounted round price, which is
 * the standard term on every form of both instruments — and the reason the basis is
 * returned: "why did I get that many shares" is the first question asked, and a number
 * with no basis is the answer that gets re-derived in a spreadsheet.
 *
 * `preMoneyShares` is the fully diluted count the cap price is measured against. A cap
 * with no share count behind it is not a price, so an absent or zero count falls back to
 * the round price rather than dividing by zero and reporting infinity.
 */
export function convertInstrument(
  terms: ConvertibleTerms,
  roundPricePerShare: number,
  preMoneyShares: number,
  conversionDate: string,
): ConversionResult {
  const principal = Math.max(0, Number(terms.principal) || 0);
  const rate = Math.max(0, Number(terms.interestRate) || 0);
  const issuedMs = terms.issuedAt ? Date.parse(terms.issuedAt) : NaN;
  const convertedMs = Date.parse(conversionDate);
  const years = Number.isFinite(issuedMs) && Number.isFinite(convertedMs) && convertedMs > issuedMs
    ? (convertedMs - issuedMs) / (365 * MS_PER_DAY)
    : 0;
  // Simple, not compound: it is what a seed note's own text says, and compounding a
  // number the paper does not compound overstates the holder's shares.
  const convertedAmount = principal * (1 + rate / 100 * years);

  const roundPrice = Number(roundPricePerShare) > 0 ? Number(roundPricePerShare) : 0;
  const candidates: Array<{ price: number; basis: ConversionResult['basis'] }> = [];
  if (roundPrice > 0) candidates.push({ price: roundPrice, basis: 'round-price' });
  if (terms.discountPercent && roundPrice > 0) {
    candidates.push({ price: roundPrice * (1 - Math.min(99, terms.discountPercent) / 100), basis: 'discount' });
  }
  if (terms.valuationCap && preMoneyShares > 0) {
    candidates.push({ price: terms.valuationCap / preMoneyShares, basis: 'cap' });
  }

  if (!candidates.length) return { convertedAmount, conversionPrice: 0, shares: 0, basis: 'round-price' };
  // Lowest price wins — that is what "the better of" means from the holder's side.
  const best = candidates.reduce((a, b) => (b.price < a.price ? b : a));
  return {
    convertedAmount,
    conversionPrice: best.price,
    shares: best.price > 0 ? Math.floor(convertedAmount / best.price) : 0,
    basis: best.basis,
  };
}

// ---------------------------------------------------------------------------
// The fold — FO-D1
// ---------------------------------------------------------------------------

/** One row of the append-only ledger, in the shape the fold needs and no more. */
export interface EquityLedgerEvent {
  eventKind: string;
  /** The class the quantity LEAVES, or the sole class for a single-legged event. */
  shareClassRef: string | null;
  /** The class it ARRIVES in when that differs — an exercise moves options out of the
   *  pool and common shares in, which is one event and two classes. Absent means the
   *  same class, which is the transfer case. */
  toShareClassRef?: string | null;
  fromHolderRef: string | null;
  toHolderRef: string | null;
  quantity: number;
  effectiveAt: string;
}

/** A position, per (holder, class). Every number here is produced by the fold. */
export interface EquityPosition {
  holderRef: string;
  shareClassRef: string;
  quantity: number;
}

/**
 * Which legs each verb has.
 *
 * Declared as DATA rather than written as a seven-branch switch, for the same reason
 * `payables.ts` declares its legal transitions that way: a reviewer can see the whole
 * ledger's arithmetic at once, and adding a verb is an entry rather than a branch
 * somebody has to remember to add to the fold AND to the validator.
 *
 * `pool-increase` has NEITHER leg, deliberately: it raises a class's authorised count,
 * which is a property of the class and not of any holder. Reporting it as a holding
 * under a "pool" pseudo-holder is how an unallocated pool comes to look owned.
 */
export const EQUITY_EVENT_LEGS: Readonly<Record<EquityEventKind, { debit: boolean; credit: boolean }>> = {
  issue:           { debit: false, credit: true },
  conversion:      { debit: false, credit: true },
  'pool-increase': { debit: false, credit: false },
  transfer:        { debit: true,  credit: true },
  exercise:        { debit: true,  credit: true },
  cancel:          { debit: true,  credit: false },
  repurchase:      { debit: true,  credit: false },
};

/**
 * Fold the ledger into positions as of an instant.
 *
 * THE function the cap table is a projection of, and the reason the register's entry
 * says "a cap table that survives its second event": an event nobody has to re-type is
 * an event that cannot be typed differently the second time.
 *
 * An `asOf` in the past is what makes "what did we own in March" answerable — the same
 * traversal, with a cutoff, rather than a second stored history.
 */
export function foldEquityEvents(
  events: readonly EquityLedgerEvent[],
  asOf?: string,
): EquityPosition[] {
  const cutoff = asOf ? Date.parse(asOf) : Number.POSITIVE_INFINITY;
  const positions = new Map<string, EquityPosition>();

  const move = (holderRef: string | null | undefined, shareClassRef: string | null | undefined, delta: number): void => {
    if (!holderRef || !delta) return;
    const classRef = shareClassRef ?? '';
    const key = `${holderRef}|${classRef}`;
    const current = positions.get(key) ?? { holderRef, shareClassRef: classRef, quantity: 0 };
    current.quantity += delta;
    positions.set(key, current);
  };

  for (const event of events) {
    const at = Date.parse(event.effectiveAt);
    if (Number.isFinite(cutoff) && Number.isFinite(at) && at > cutoff) continue;
    const legs = EQUITY_EVENT_LEGS[event.eventKind as EquityEventKind];
    if (!legs) continue;
    const quantity = Number(event.quantity) || 0;
    if (legs.debit) move(event.fromHolderRef, event.shareClassRef, -quantity);
    if (legs.credit) move(event.toHolderRef, event.toShareClassRef ?? event.shareClassRef, quantity);
  }

  // A position that folds to zero or below is GONE, not a row reading 0: a departed
  // holder on a cap table is noise, and a negative one is a data error the projection
  // must not present as ownership.
  return [...positions.values()].filter((position) => position.quantity > 0);
}
