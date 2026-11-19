/**
 * Exit waterfall — who gets what at a given exit value (PRD 25 §6.3 / §25a.4 C1).
 *
 * PURE: no I/O, no stored totals. Takes the cap-table projection (`CapTableHolder[]`,
 * `ShareClassRow[]` from `equity.ts`) and an exit, and returns payouts per class and per
 * holder, the breakpoints at which each class's preference is satisfied / converts, and a
 * per-holder multiple. Sensitivity is the same function mapped over a range; goal-seek is a
 * bisection over it.
 *
 * ── MODEL ───────────────────────────────────────────────────────────────────
 *  1. net = max(0, exitValue − debt). Debt is senior to every class.
 *  2. Preferred classes (kind `preferred`, or any class with a liquidation multiple > 0
 *     that is not common/option) are walked by `seniority` ASCENDING (lower number = paid
 *     first; equal seniority = pari passu, split pro rata to the claim).
 *     Claim = liquidationMultiple × invested, where invested = shares × pricePerShare.
 *  3. Non-participating preferred chooses the better of (a) its preference or (b) converting
 *     to common. Conversion is resolved by fixed-point iteration: a class converts when its
 *     pro-rata share of the residual common pool, computed with it converted, exceeds its
 *     preference.
 *  4. Participating preferred takes its preference AND then shares the residual pro rata with
 *     common (as-converted). `participating` carries no cap in the stored terms, so an
 *     optional `participationCap` (a multiple of invested, total return incl. preference) may
 *     be supplied per class by the caller; above the cap the class stops participating — and
 *     converts instead when converting beats the cap.
 *  5. Options / RSUs / warrants count only when vested by `asOf` (or all of them under
 *     `accelerated`) and in the money (strike < residual per-share price). Exercise proceeds
 *     are added to the distributable pool (treasury-style, iterated to a fixed point).
 *
 * Missing is `null`, never 0: a holder with nothing invested has `multiple: null`.
 */

import type { CapTableHolder, ShareClassRow } from './equity';

export type VestingTreatment = 'normal' | 'accelerated';

export interface WaterfallInput {
  holders: CapTableHolder[];
  classes: ShareClassRow[];
  exitValue: number;
  debt?: number;
  vesting: VestingTreatment;
  asOf: Date;
  /** Optional per-class participation caps (class ref → multiple of invested, total return
   *  including the preference). The stored share-class terms carry no cap. */
  participationCaps?: Record<string, number>;
  /** Optional per-holder-per-class exercise price for option-like positions
   *  (key `${holderRef}|${classRef}`), else the class `pricePerShare`. */
  strikes?: Record<string, number>;
}

export interface ClassPayout {
  classRef: string;
  /** Liquidation preference actually paid (0 when converted). */
  preference: number;
  /** Amount received through participation / as-converted common share. */
  participation: number;
  converted: boolean;
  payout: number;
}

export interface HolderPayout {
  partyRef: string;
  payout: number;
  /** payout ÷ invested; null when the holder has no invested capital. */
  multiple: number | null;
}

export interface Breakpoint {
  exitValue: number;
  classRef: string;
  event: 'preference_satisfied' | 'converts';
}

export interface WaterfallResult {
  byClass: ClassPayout[];
  byHolder: HolderPayout[];
  breakpoints: Breakpoint[];
  /** Exit value less debt, floored at 0. */
  netExit: number;
}

const EPS = 1e-9;

const isOptionLike = (holder: CapTableHolder, cls: ShareClassRow | undefined): boolean =>
  cls?.kind === 'option-pool' || /option|rsu|warrant/i.test(holder.instrument);

const isCommon = (cls: ShareClassRow): boolean => cls.kind === 'common' || cls.kind === 'option-pool';

interface Position {
  holder: CapTableHolder;
  cls: ShareClassRow;
  /** Shares that participate in the exit (vested/accelerated for options). */
  shares: number;
  optionLike: boolean;
  strike: number;
  invested: number;
}

const classPrice = (cls: ShareClassRow | undefined): number => cls?.pricePerShare ?? 0;

function buildPositions(input: WaterfallInput): Position[] {
  const byRef = new Map(input.classes.map((c) => [c.classRef, c]));
  const out: Position[] = [];
  for (const holder of input.holders) {
    const cls = byRef.get(holder.shareClassRef);
    if (!cls) continue;
    const optionLike = isOptionLike(holder, cls);
    const shares = optionLike
      ? (input.vesting === 'accelerated' ? holder.shares : holder.vested)
      : holder.shares;
    if (!(shares > 0)) continue;
    const strike = input.strikes?.[`${holder.holderRef}|${cls.classRef}`] ?? classPrice(cls);
    out.push({
      holder,
      cls,
      shares,
      optionLike,
      strike: optionLike ? strike : 0,
      invested: optionLike ? 0 : shares * classPrice(cls),
    });
  }
  return out;
}

/** Preferred = has a stated liquidation multiple > 0 and is not common/option. */
const isPreferred = (cls: ShareClassRow): boolean => !isCommon(cls) && (cls.liquidationMultiple ?? 0) > 0;

interface Solved {
  converted: Set<string>;
  capped: Set<string>;
  preferenceByClass: Map<string, number>;
  residualByClass: Map<string, number>;
  /** Per-share price of the residual common pool. */
  residualPerShare: number;
  exercised: Set<string>; // position index keys that exercised
}

/** One full distribution of `net` given a conversion decision set. */
function distribute(
  net: number,
  positions: Position[],
  classes: ShareClassRow[],
  caps: Record<string, number>,
  converted: Set<string>,
  capped: Set<string>,
): Omit<Solved, 'converted' | 'capped'> {
  const preferredClasses = classes.filter(isPreferred).filter((c) => !converted.has(c.classRef));
  const investedByClass = new Map<string, number>();
  for (const p of positions) {
    if (p.optionLike) continue;
    investedByClass.set(p.cls.classRef, (investedByClass.get(p.cls.classRef) ?? 0) + p.invested);
  }

  // Seniority stack — group equal seniority (pari passu).
  const preferenceByClass = new Map<string, number>();
  let remaining = net;
  const tiers = new Map<number, ShareClassRow[]>();
  for (const c of preferredClasses) {
    const list = tiers.get(c.seniority) ?? [];
    list.push(c);
    tiers.set(c.seniority, list);
  }
  for (const seniority of [...tiers.keys()].sort((a, b) => a - b)) {
    const tier = tiers.get(seniority)!;
    const claims = tier.map((c) => (c.liquidationMultiple ?? 0) * (investedByClass.get(c.classRef) ?? 0));
    const totalClaim = claims.reduce((a, b) => a + b, 0);
    const paid = Math.min(remaining, totalClaim);
    tier.forEach((c, i) => {
      preferenceByClass.set(c.classRef, totalClaim > 0 ? (paid * claims[i]!) / totalClaim : 0);
    });
    remaining -= paid;
  }

  // Residual pool is shared by common + converted + participating (uncapped) as-converted.
  // Options exercise when strike < residual price: iterate to a fixed point because
  // exercise proceeds enlarge the pool and the share count.
  const sharing = (p: Position): boolean => {
    if (p.optionLike) return true;
    if (isCommon(p.cls)) return true;
    if (converted.has(p.cls.classRef)) return true;
    if (isPreferred(p.cls) && p.cls.participating && !capped.has(p.cls.classRef)) return true;
    return false;
  };

  const exercised = new Set<number>();
  let residualPerShare = 0;
  const idx = (p: Position) => positions.indexOf(p);
  for (let iter = 0; iter < 50; iter++) {
    let pool = remaining;
    let count = 0;
    for (const p of positions) {
      if (!sharing(p)) continue;
      if (p.optionLike) {
        if (!exercised.has(idx(p))) continue;
        pool += p.shares * p.strike;
      }
      count += p.shares;
    }
    // Capped participants take a fixed top-up outside the pro-rata pool.
    let capTopUp = 0;
    for (const c of capped) {
      const inv = investedByClass.get(c) ?? 0;
      const total = Math.max(0, (caps[c] ?? 0) * inv - (preferenceByClass.get(c) ?? 0));
      capTopUp += Math.min(total, Math.max(0, pool));
    }
    const distributable = Math.max(0, pool - capTopUp);
    const price = count > 0 ? distributable / count : 0;
    const next = new Set<number>();
    positions.forEach((p, i) => {
      if (p.optionLike && sharing(p) && price > p.strike + EPS) next.add(i);
    });
    const same = next.size === exercised.size && [...next].every((i) => exercised.has(i));
    residualPerShare = price;
    if (same) break;
    exercised.clear();
    next.forEach((i) => exercised.add(i));
  }

  const residualByClass = new Map<string, number>();
  positions.forEach((p, i) => {
    if (!sharing(p)) return;
    if (p.optionLike && !exercised.has(i)) return;
    const gross = p.shares * residualPerShare;
    const net = p.optionLike ? gross - p.shares * p.strike : gross;
    residualByClass.set(p.cls.classRef, (residualByClass.get(p.cls.classRef) ?? 0) + net);
  });
  // Capped participation top-up.
  for (const c of capped) {
    const inv = investedByClass.get(c) ?? 0;
    const total = Math.max(0, (caps[c] ?? 0) * inv - (preferenceByClass.get(c) ?? 0));
    residualByClass.set(c, (residualByClass.get(c) ?? 0) + total);
  }

  return {
    preferenceByClass,
    residualByClass,
    residualPerShare,
    exercised: new Set([...exercised].map(String)),
  };
}

function solve(input: WaterfallInput, net: number, positions: Position[]): Solved {
  const caps = input.participationCaps ?? {};
  const preferred = input.classes.filter(isPreferred);
  const converted = new Set<string>();
  const capped = new Set<string>();

  const classTotal = (res: Omit<Solved, 'converted' | 'capped'>, ref: string): number =>
    (res.preferenceByClass.get(ref) ?? 0) + (res.residualByClass.get(ref) ?? 0);

  const invOf = (ref: string): number =>
    positions.filter((p) => p.cls.classRef === ref).reduce((a, p) => a + p.invested, 0);
  const totalOf = (res: Omit<Solved, 'converted' | 'capped'>, ref: string): number => classTotal(res, ref);

  // A class that stays preferred is either capped (participating with a cap whose total
  // exceeds the cap) or not. Evaluate "stay" with the cap applied, then compare to converting.
  const stayTotal = (ref: string, conv: Set<string>): number => {
    const c = input.classes.find((x) => x.classRef === ref)!;
    const cap = caps[ref];
    const cp = new Set<string>();
    if (c.participating && cap != null) {
      const probe = distribute(net, positions, input.classes, caps, conv, cp);
      if (totalOf(probe, ref) > cap * invOf(ref) + EPS) cp.add(ref);
    }
    return totalOf(distribute(net, positions, input.classes, caps, conv, cp), ref);
  };

  for (let round = 0; round < preferred.length * 3 + 3; round++) {
    let changed = false;
    for (const c of preferred) {
      const ref = c.classRef;
      // Uncapped participating never converts (it already gets preference + share).
      if (c.participating && caps[ref] == null) continue;
      const without = new Set(converted);
      without.delete(ref);
      const staying = stayTotal(ref, without);
      const withIt = new Set(converted).add(ref);
      const asConverted = totalOf(distribute(net, positions, input.classes, caps, withIt, new Set<string>()), ref);
      const shouldConvert = asConverted > staying + EPS;
      if (shouldConvert && !converted.has(ref)) { converted.add(ref); changed = true; }
      else if (!shouldConvert && converted.has(ref)) { converted.delete(ref); changed = true; }
    }
    if (!changed) break;
  }
  // Settle caps for classes that stay preferred.
  for (const c of preferred) {
    const ref = c.classRef;
    if (converted.has(ref) || !c.participating || caps[ref] == null) continue;
    const probe = distribute(net, positions, input.classes, caps, converted, capped);
    if (totalOf(probe, ref) > caps[ref]! * invOf(ref) + EPS) capped.add(ref);
  }

  const final = distribute(net, positions, input.classes, caps, converted, capped);
  return { ...final, converted, capped };
}

/** Core distribution without breakpoints (used by breakpoint search to avoid recursion). */
function payoutsAt(input: WaterfallInput, exitValue: number): { byClass: ClassPayout[]; byHolder: HolderPayout[]; netExit: number; converted: Set<string>; preferenceByClass: Map<string, number> } {
  const debt = Math.max(0, input.debt ?? 0);
  const net = Math.max(0, exitValue - debt);
  const positions = buildPositions(input);
  const solved = solve(input, net, positions);

  const classRefs = [...new Set([...input.classes.map((c) => c.classRef)])];
  const byClass: ClassPayout[] = classRefs
    .filter((ref) => positions.some((p) => p.cls.classRef === ref) || solved.preferenceByClass.has(ref))
    .map((ref) => {
      const preference = solved.preferenceByClass.get(ref) ?? 0;
      const participation = solved.residualByClass.get(ref) ?? 0;
      return {
        classRef: ref,
        preference,
        participation,
        converted: solved.converted.has(ref),
        payout: preference + participation,
      };
    });

  // Holder payouts: split each class payout across its positions.
  const classPayout = new Map(byClass.map((c) => [c.classRef, c]));
  const prefShare = new Map<string, number>(); // classRef → total weight for preference (invested)
  const resShare = new Map<string, number>(); // classRef → total weight for residual (exercised shares)
  const exercisedKeys = solved.exercised;
  positions.forEach((p, i) => {
    prefShare.set(p.cls.classRef, (prefShare.get(p.cls.classRef) ?? 0) + p.invested);
    const takes = !p.optionLike || exercisedKeys.has(String(i));
    if (takes) resShare.set(p.cls.classRef, (resShare.get(p.cls.classRef) ?? 0) + p.shares);
  });

  const holderTotals = new Map<string, { payout: number; invested: number }>();
  positions.forEach((p, i) => {
    const cp = classPayout.get(p.cls.classRef);
    if (!cp) return;
    const takes = !p.optionLike || exercisedKeys.has(String(i));
    const prefW = prefShare.get(p.cls.classRef) ?? 0;
    const resW = resShare.get(p.cls.classRef) ?? 0;
    const pref = prefW > 0 ? (cp.preference * p.invested) / prefW : 0;
    const res = takes && resW > 0 ? (cp.participation * p.shares) / resW : 0;
    const cur = holderTotals.get(p.holder.holderRef) ?? { payout: 0, invested: 0 };
    cur.payout += pref + res;
    cur.invested += p.invested + (p.optionLike && takes ? p.shares * p.strike : 0);
    holderTotals.set(p.holder.holderRef, cur);
  });

  const byHolder: HolderPayout[] = [...holderTotals.entries()].map(([partyRef, t]) => ({
    partyRef,
    payout: t.payout,
    multiple: t.invested > 0 ? t.payout / t.invested : null,
  }));

  return { byClass, byHolder, netExit: net, converted: solved.converted, preferenceByClass: solved.preferenceByClass };
}

/** Exit values at which each preferred class's preference is fully covered and at which it
 *  converts. Found by bisection over the monotone payout function. */
function findBreakpoints(input: WaterfallInput): Breakpoint[] {
  const positions = buildPositions(input);
  const preferred = input.classes.filter(isPreferred);
  if (!preferred.length) return [];
  const debt = Math.max(0, input.debt ?? 0);
  const totalShares = positions.reduce((a, p) => a + p.shares, 0);
  const totalClaim = preferred.reduce(
    (a, c) => a + (c.liquidationMultiple ?? 0) * positions.filter((p) => p.cls.classRef === c.classRef).reduce((x, p) => x + p.invested, 0),
    0,
  );
  const hi0 = debt + Math.max(totalClaim * 4, totalShares * Math.max(1, ...input.classes.map(classPrice)) * 20, 1);

  const out: Breakpoint[] = [];
  for (const c of preferred) {
    const inv = positions.filter((p) => p.cls.classRef === c.classRef).reduce((a, p) => a + p.invested, 0);
    const claim = (c.liquidationMultiple ?? 0) * inv;
    if (claim <= 0) continue;

    // preference_satisfied: smallest exit where the class's preference is fully covered by the
    // seniority stack — the senior claims ahead of it plus its own (pari passu tiers share).
    // Closed form, independent of conversion (a converted class has no preference to test).
    const claimOf = (cl: ShareClassRow): number =>
      (cl.liquidationMultiple ?? 0) * positions.filter((p) => p.cls.classRef === cl.classRef).reduce((x, p) => x + p.invested, 0);
    const stackThrough = preferred
      .filter((o) => o.seniority <= c.seniority)
      .reduce((a, o) => a + claimOf(o), 0);
    out.push({ exitValue: Math.round((debt + stackThrough) * 100) / 100, classRef: c.classRef, event: 'preference_satisfied' });

    // converts: smallest exit where the class is converted (may never happen when participating uncapped).
    if (!(c.participating && input.participationCaps?.[c.classRef] == null)) {
      if (payoutsAt(input, hi0 * 8).converted.has(c.classRef)) {
        let lo = 0;
        let hi = hi0 * 8;
        for (let i = 0; i < 90; i++) {
          const mid = (lo + hi) / 2;
          if (payoutsAt(input, mid).converted.has(c.classRef)) hi = mid; else lo = mid;
        }
        out.push({ exitValue: Math.round(hi * 100) / 100, classRef: c.classRef, event: 'converts' });
      }
    }
  }
  return out.sort((a, b) => a.exitValue - b.exitValue);
}

export function computeWaterfall(input: WaterfallInput): WaterfallResult {
  const res = payoutsAt(input, input.exitValue);
  return {
    byClass: res.byClass,
    byHolder: res.byHolder,
    breakpoints: findBreakpoints(input),
    netExit: res.netExit,
  };
}

// ── Sensitivity & goal-seek ──────────────────────────────────────────────────

export interface SensitivityPoint {
  exitValue: number;
  byHolder: HolderPayout[];
  byClass: ClassPayout[];
}

/** The same function over a range of exit values (breakpoints skipped for speed). */
export function sensitivity(base: Omit<WaterfallInput, 'exitValue'>, exitValues: number[]): SensitivityPoint[] {
  return exitValues.map((exitValue) => {
    const r = payoutsAt({ ...base, exitValue }, exitValue);
    return { exitValue, byHolder: r.byHolder, byClass: r.byClass };
  });
}

/** An evenly spaced inclusive range. */
export function exitRange(from: number, to: number, steps: number): number[] {
  const n = Math.max(1, Math.floor(steps));
  if (n === 1) return [from];
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

/**
 * Goal-seek: the smallest exit value at which `partyRef` receives at least `targetPayout`.
 * Bisection — payouts are monotone non-decreasing in exit value. Null when unreachable
 * within `maxExit`.
 */
export function goalSeekExit(
  base: Omit<WaterfallInput, 'exitValue'>,
  partyRef: string,
  targetPayout: number,
  opts: { maxExit?: number; tolerance?: number } = {},
): number | null {
  const payout = (exitValue: number): number =>
    payoutsAt({ ...base, exitValue }, exitValue).byHolder.find((h) => h.partyRef === partyRef)?.payout ?? 0;
  const maxExit = opts.maxExit ?? Math.max(1, (base.debt ?? 0) + targetPayout * 1000);
  const tolerance = opts.tolerance ?? 0.01;
  if (payout(maxExit) < targetPayout) return null;
  let lo = 0;
  let hi = maxExit;
  for (let i = 0; i < 200 && hi - lo > tolerance; i++) {
    const mid = (lo + hi) / 2;
    if (payout(mid) >= targetPayout) hi = mid; else lo = mid;
  }
  return hi;
}
