/**
 * dynamic/schedule.ts — which dynamic checks a run gets (PRD 41 C6.2, C8.4, C11 item 4, D9):
 *
 *  1. `never` in the project's policy ⇒ skipped (`policy-never`);
 *  2. an UNTRUSTED workspace ⇒ skipped (`untrusted-workspace`), mandated or not: the tier runs project code;
 *  3. not available on this host (no config, no tool, nothing changed it applies to) ⇒ skipped with that reason —
 *     a mandated check that cannot run is still `skipped`, never a silent zero; no budget left ⇒ `budget-exhausted`;
 *  4. MANDATED by the policy for this run (C11 item 4, the delta policy) ⇒ run (`scheduledBy.policy = 'mandated'`);
 *  5. otherwise optional: the {@link DynamicCheckScheduler} decides — {@link optInScheduler} by default
 *     (the person's opt-in), WS20's Thompson sampler later.
 *
 * Also parses the per-project policy from the repo's `.builderforce/delta.json` (`benchmarks`, `dynamic`),
 * passed in as DATA from the BEFORE side (the same security rule as `withOverrides`: a run cannot change
 * which checks judge it). Invalid entries are dropped and reported as codes, never thrown.
 */

import {
    DEFAULT_BENCH_THRESHOLD, DEFAULT_DYNAMIC_POLICY, DYNAMIC_CHECKS, MIN_BENCH_PAIRS,
    type BenchmarkSpec, type DynamicCheckContext, type DynamicCheckId, type DynamicCheckScheduler, type DynamicDecision,
    type DynamicPolicy, type DynamicRequirement, type DynamicSkipReason,
} from './contract.js';

/** The default scheduler: an optional check runs exactly when the person opted in. */
export const optInScheduler: DynamicCheckScheduler = {
    decide: (_check, ctx) => ctx.optIn
        ? { run: true, scheduledBy: { policy: 'opt-in' } }
        : { run: false, reason: 'opt-in-off', scheduledBy: { policy: 'opt-in' } },
};

/** Whether the policy mandates `check` for this run (C11 item 4, the delta policy). */
export function isMandated(policy: DynamicPolicy, check: DynamicCheckId, ctx: Pick<DynamicCheckContext, 'mode' | 'branch'>): boolean {
    const req = policy.require[check];
    if (req === 'always') return true;
    if (ctx.mode !== 'autonomous') return false;
    if (req === 'autonomous') return true;
    return req === 'autonomous-protected' && ctx.branch !== undefined && policy.protectedBranches.includes(ctx.branch);
}

/**
 * One decision per check, in {@link DYNAMIC_CHECKS} order. `unavailable` names the checks this host cannot run
 * and why (decided by the host before any process starts).
 */
export function planDynamicTier(
    ctx: DynamicCheckContext,
    policy: DynamicPolicy,
    unavailable: Partial<Readonly<Record<DynamicCheckId, DynamicSkipReason>>>,
    scheduler: DynamicCheckScheduler = optInScheduler,
): Map<DynamicCheckId, DynamicDecision> {
    const out = new Map<DynamicCheckId, DynamicDecision>();
    // Cumulative budget: each later check is asked with what the checks decided to run so far are expected to leave.
    let committedMs = 0;
    for (const check of DYNAMIC_CHECKS) {
        const missing = unavailable[check];
        if (policy.require[check] === 'never') out.set(check, { run: false, reason: 'policy-never', scheduledBy: { policy: 'project-policy' } });
        // No project code runs in an untrusted workspace — a mandated check included: it reads `not run`, never a pass.
        else if (!ctx.trusted) out.set(check, { run: false, reason: 'untrusted-workspace', scheduledBy: { policy: 'trust' } });
        else if (missing) out.set(check, { run: false, reason: missing, scheduledBy: { policy: 'unavailable' } });
        else if (ctx.remainingBudgetMs <= 0) out.set(check, { run: false, reason: 'budget-exhausted', scheduledBy: { policy: 'budget' } });
        else if (isMandated(policy, check, ctx)) out.set(check, { run: true, scheduledBy: { policy: 'mandated' } });
        else out.set(check, scheduler.decide(check, { ...ctx, remainingBudgetMs: ctx.remainingBudgetMs - committedMs }));
        const decided = out.get(check)!;
        // Every run is charged — a mandated benchmark leaves less for the sampled checks after it.
        if (decided.run) committedMs += decided.expectedMs ?? scheduler.expectedMs?.(check) ?? 0;
    }
    return out;
}

// ─── Per-project policy ──────────────────────────────────────────────────────

const REQUIREMENTS: ReadonlySet<string> = new Set<DynamicRequirement>(['optional', 'autonomous', 'autonomous-protected', 'always', 'never']);
const ID = /^[A-Za-z0-9][\w.-]{0,63}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export interface DynamicPolicyResult {
    policy: DynamicPolicy;
    /** Sorted codes of what was ignored (`invalid:benchmarks.<i>`, `invalid:dynamic.<key>`, `unknown-key:dynamic.<key>`). */
    dropped: string[];
}

function benchmarkOf(raw: unknown): BenchmarkSpec | undefined {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !ID.test(raw.id)) return undefined;
    if (typeof raw.command !== 'string' || !raw.command.trim() || raw.command.length > 1_000 || /[\r\n]/.test(raw.command)) return undefined;
    const unit = raw.unit === undefined ? 'ms' : raw.unit;
    if (unit !== 'ms' && unit !== 'instructions') return undefined;
    let threshold = DEFAULT_BENCH_THRESHOLD;
    if (raw.threshold !== undefined) {
        const t = raw.threshold;
        if (!isRecord(t) || !finite(t.warn, 0, 10) || !finite(t.error, 0, 10) || t.error < t.warn) return undefined;
        threshold = { warn: t.warn, error: t.error, kind: 'pct' };
    }
    const rounds = raw.rounds === undefined ? MIN_BENCH_PAIRS : raw.rounds;
    const warmup = raw.warmup === undefined ? 1 : raw.warmup;
    if (!Number.isInteger(rounds) || !finite(rounds, MIN_BENCH_PAIRS, 60)) return undefined;
    if (!Number.isInteger(warmup) || !finite(warmup, 0, 10)) return undefined;
    return { id: raw.id, command: raw.command.trim(), unit, threshold, rounds, warmup };
}

/** The dynamic policy from a parsed `.builderforce/delta.json` (BEFORE side). Absent / invalid ⇒ the defaults. */
export function dynamicPolicyOf(raw: unknown): DynamicPolicyResult {
    const dropped: string[] = [];
    if (!isRecord(raw)) return { policy: DEFAULT_DYNAMIC_POLICY, dropped };
    const require = { ...DEFAULT_DYNAMIC_POLICY.require };
    let { protectedBranches, budgetMs } = DEFAULT_DYNAMIC_POLICY;
    const benchmarks: BenchmarkSpec[] = [];

    if (raw.benchmarks !== undefined) {
        if (!Array.isArray(raw.benchmarks)) dropped.push('invalid:benchmarks');
        else raw.benchmarks.forEach((b, i) => {
            const spec = benchmarkOf(b);
            if (!spec || benchmarks.some((x) => x.id === spec.id)) dropped.push(`invalid:benchmarks.${i}`);
            else benchmarks.push(spec);
        });
    }
    const dyn = raw.dynamic;
    if (dyn !== undefined && !isRecord(dyn)) dropped.push('invalid:dynamic');
    else if (dyn) {
        for (const key of Object.keys(dyn).sort()) {
            const v = dyn[key];
            if (key === 'require') {
                if (!isRecord(v)) { dropped.push('invalid:dynamic.require'); continue; }
                for (const [check, req] of Object.entries(v)) {
                    if ((DYNAMIC_CHECKS as readonly string[]).includes(check) && typeof req === 'string' && REQUIREMENTS.has(req)) {
                        require[check as DynamicCheckId] = req as DynamicRequirement;
                    } else dropped.push(`invalid:dynamic.require.${check}`);
                }
            } else if (key === 'protectedBranches') {
                if (Array.isArray(v) && v.every((b) => typeof b === 'string' && b.length > 0)) protectedBranches = [...new Set(v as string[])].sort();
                else dropped.push('invalid:dynamic.protectedBranches');
            } else if (key === 'budgetMs') {
                if (finite(v, 1_000, 4 * 3_600_000)) budgetMs = Math.round(v);
                else dropped.push('invalid:dynamic.budgetMs');
            } else dropped.push(`unknown-key:dynamic.${key}`);
        }
    }
    return { policy: { require, protectedBranches, benchmarks, budgetMs }, dropped: [...new Set(dropped)].sort() };
}
