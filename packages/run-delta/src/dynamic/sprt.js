/**
 * dynamic/sprt.ts — D9.2 sequential testing for benchmarks: a sign-test SPRT over the interleaved pairs, so a decided
 * benchmark stops early instead of running every round. The test itself is the ONE statistics home's
 * (`signTestSprt`, `@seanhogg/builderforce-memory/stats`); nothing here re-implements it.
 *
 *  - Each pair is a sign: `1` when after is slower than before by more than δ/2, `0` when faster by more than δ/2;
 *    pairs within ±δ/2 are TIES and dropped. δ is the metric's warn threshold (a fraction of before for `pct`).
 *  - H₀: π = 0.5 against H₁: π = {@link SPRT_P1}, α = {@link SPRT_ALPHA}, β = {@link SPRT_BETA} (Wald boundaries), run
 *    in both directions (slower, and mirrored for faster). Each direction resolves once — reject or accept — and stays.
 *  - WALD'S STOPPING RULE: the series stops when BOTH directions have resolved, and only after an EVEN number of
 *    rounds (the AB/BA order stays balanced). The cap is {@link sprtCap} = max({@link SPRT_CAP_PAIRS}, spec rounds), so a
 *    configured spec is never cut short. Rejecting needs at least {@link SPRT_MIN_REJECT_PAIRS} pairs (implied by the
 *    boundaries, not chosen).
 *  - Reporting ({@link sequentialBenchmarkDelta}): a stopped series that rejected is `sprt-sign` / `reject` and keeps
 *    its bootstrap CI (the verdict still needs the CI beyond ±warn: `withinNoise`); one that accepted in both
 *    directions is `sprt-sign` / `accept` (within noise). A rejection whose direction disagrees with the sign of the
 *    Hodges–Lehmann effect, and every series that reached the cap unresolved, is reported by C6.2 (Wilcoxon).
 *  - The realized error rates of the truncated test are EXACT ({@link sprtOperatingCharacteristics}, dynamic
 *    programming over the stopping lattice — no PRNG) and read for the cap actually used ({@link sprtRealized}).
 *
 * Pure and deterministic: the decision is a function of the samples, so the runner's stop (agent-tools) and the tier's
 * report always agree.
 */
import { signTestSprt } from '@seanhogg/builderforce-memory/stats';
import { benchmarkDelta } from './benchmarkMetric.js';
export const SPRT_P0 = 0.5;
export const SPRT_P1 = 0.85;
export const SPRT_ALPHA = 0.01;
export const SPRT_BETA = 0.05;
/** The cap for a spec with fewer rounds: {@link sprtCap}. */
export const SPRT_CAP_PAIRS = 30;
const LOG_A = Math.log((1 - SPRT_BETA) / SPRT_ALPHA);
const LOG_B = Math.log(SPRT_BETA / (1 - SPRT_ALPHA));
const STEP_UP = Math.log(SPRT_P1 / SPRT_P0);
const STEP_DOWN = Math.log((1 - SPRT_P1) / (1 - SPRT_P0));
/** The fewest pairs that can reject H₀ (every sign the same way): ⌈ln A / ln(π₁/π₀)⌉ — 9 at π₁ = 0.85. */
export const SPRT_MIN_REJECT_PAIRS = Math.ceil(LOG_A / STEP_UP);
/** The rounds a sequential benchmark may run: max(30, the spec's own rounds). */
export const sprtCap = (rounds) => Math.max(SPRT_CAP_PAIRS, rounds);
export const sprtAlphaBounds = (r, wilcoxonAlpha = 0.01) => ({
    rigorous: r.alpha + Math.min(r.unresolvedH0, wilcoxonAlpha),
    independent: r.alpha + r.unresolvedH0 * wilcoxonAlpha,
});
/** 1 = after slower beyond δ/2, 0 = faster beyond δ/2, undefined = tie (dropped). */
function signOf(before, after, threshold) {
    const raw = after - before;
    // A zero before level has no relative scale: any move counts as a full (100%) one.
    const diff = threshold.kind === 'pct' ? (before === 0 ? Math.sign(raw) : raw / Math.abs(before)) : raw;
    if (!Number.isFinite(diff) || Math.abs(diff) <= threshold.warn / 2)
        return undefined;
    return diff > 0 ? 1 : 0;
}
const directionOf = (d) => d === 'reject-null' ? 'reject' : d === 'accept-null' ? 'accept' : 'continue';
/** Both directions over the even-length prefix of the pairs, and whether Wald's rule has stopped the series. */
export function sprtSign(samples, threshold) {
    const n = Math.min(samples.before.length, samples.after.length);
    const pairs = n - (n % 2);
    const signed = [];
    for (let i = 0; i < pairs; i++) {
        const s = signOf(samples.before[i], samples.after[i], threshold);
        // `signTestSprt` reads a pair as "+" when its second value is larger: a slower pair is [0, 1].
        if (s !== undefined)
            signed.push(s === 1 ? [0, 1] : [1, 0]);
    }
    const options = { p0: SPRT_P0, p1: SPRT_P1, alpha: SPRT_ALPHA, beta: SPRT_BETA };
    const slower = directionOf(signTestSprt(signed, { ...options, alternative: 'greater' }).decision);
    const faster = directionOf(signTestSprt(signed, { ...options, alternative: 'less' }).decision);
    const stopped = slower !== 'continue' && faster !== 'continue';
    const decision = !stopped ? 'continue' : slower === 'reject' ? 'regressed' : faster === 'reject' ? 'improved' : 'accept';
    return { decision, slower, faster, pairs, observations: signed.length };
}
/** Whether the pairs so far stop the rounds (Wald's rule, at an even round). */
export function sprtStops(samples, threshold) {
    const n = Math.min(samples.before.length, samples.after.length);
    return n > 0 && n % 2 === 0 && sprtSign(samples, threshold).decision !== 'continue';
}
/** THE sequential test of the dynamic tier: the sign-test SPRT. */
export function sprtSignTest(defaultThreshold) {
    return {
        cap: sprtCap,
        decided: (spec, samples) => sprtStops(samples, spec.threshold ?? defaultThreshold),
    };
}
/**
 * One benchmark's metric under the sequential test. Starts from C6.2's (`benchmarkDelta`: levels, Wilcoxon p and the
 * bootstrap CI); a stopped series replaces the method with `sprt-sign` and its decision, KEEPING the CI. No p-value:
 * it would be invalid after optional stopping.
 */
export function sequentialBenchmarkDelta(spec, samples) {
    const m = benchmarkDelta(spec, samples);
    const r = sprtSign(samples, spec.threshold);
    if (r.decision === 'continue' || m.significance?.method !== 'wilcoxon-signed-rank')
        return m;
    const ci = m.significance.ci ? { ci: m.significance.ci } : {};
    if (r.decision === 'accept')
        return { ...m, significance: { method: 'sprt-sign', decision: 'accept', ...ci } };
    // L4: the SPRT's direction must agree with the sign of the paired (Hodges–Lehmann) effect; else C6.2 decides.
    const effect = (m.after ?? 0) - (m.before ?? 0);
    if (r.decision === 'regressed' ? effect <= 0 : effect >= 0)
        return m;
    return { ...m, significance: { method: 'sprt-sign', decision: 'reject', ...ci } };
}
/**
 * The EXACT behaviour of the test on tie-free pairs with P(slower) = `pi`, by dynamic programming over the stopping
 * lattice (signs so far × each direction's state): Wald's rule at even rounds, each direction absorbing at its first
 * boundary crossing, truncated at `cap`. Independent of any PRNG.
 */
export function sprtOperatingCharacteristics(pi, cap = SPRT_CAP_PAIRS) {
    const EPS = 1e-12;
    const resolve = (llr, cur) => cur !== 'continue' ? cur : llr >= LOG_A - EPS ? 'reject' : llr <= LOG_B + EPS ? 'accept' : 'continue';
    let states = new Map([
        ['0,0,continue,continue', { slow: 0, fast: 0, slower: 'continue', faster: 'continue', p: 1 }],
    ]);
    const out = { regressed: 0, improved: 0, accepted: 0, unresolved: 0, averagePairs: 0 };
    for (let round = 1; round <= cap; round++) {
        const next = new Map();
        for (const st of states.values()) {
            for (const up of [true, false]) {
                const slow = st.slow + (up ? 1 : 0), fast = st.fast + (up ? 0 : 1), p = st.p * (up ? pi : 1 - pi);
                const slower = resolve(slow * STEP_UP + fast * STEP_DOWN, st.slower);
                const faster = resolve(fast * STEP_UP + slow * STEP_DOWN, st.faster);
                if (round % 2 === 0 && slower !== 'continue' && faster !== 'continue') {
                    out.averagePairs += p * round;
                    if (slower === 'reject')
                        out.regressed += p;
                    else if (faster === 'reject')
                        out.improved += p;
                    else
                        out.accepted += p;
                    continue;
                }
                const key = `${slow},${fast},${slower},${faster}`;
                const held = next.get(key);
                if (held)
                    held.p += p;
                else
                    next.set(key, { slow, fast, slower, faster, p });
            }
        }
        states = next;
    }
    for (const st of states.values()) {
        out.unresolved += st.p;
        out.averagePairs += st.p * cap;
    }
    return out;
}
const realizedByCap = new Map();
/**
 * The exact operating characteristics of the test at the cap ACTUALLY used (`sprtCap(spec rounds)`), by the DP,
 * quantized (rates 1e-4, average pairs 1e-2) and memoised per cap. Ties only remove signed observations within the cap,
 * which lowers α (and power). With {@link sprtAlphaBounds} they give that cap's false-regression bounds — e.g. at 30:
 * α 0.0075, U 0.0482, rigorous 0.0175, under independence ≈ 0.0080.
 */
export function sprtRealized(cap) {
    const held = realizedByCap.get(cap);
    if (held)
        return held;
    const q = (v, step) => Number((Math.round(v / step) * step).toFixed(4));
    const h0 = sprtOperatingCharacteristics(SPRT_P0, cap);
    const h1 = sprtOperatingCharacteristics(SPRT_P1, cap);
    const r = {
        alpha: q(h0.regressed, 1e-4), beta: q(1 - h1.regressed, 1e-4),
        asnH0: q(h0.averagePairs, 1e-2), asnH1: q(h1.averagePairs, 1e-2), unresolvedH0: q(h0.unresolved, 1e-4),
    };
    realizedByCap.set(cap, r);
    return r;
}
//# sourceMappingURL=sprt.js.map