/**
 * THE per-run budget arithmetic — has a run spent its cap, and is it close enough to
 * be told to converge? One rule for every loop that caps a run: the cloud cost loop
 * (`api/.../costLoop/runBudget.ts`, the A2 spend + token caps) and the editor's run
 * store (`builderforce.maxRunBudgetUsd`). Pure; each host reads its own spend and
 * words its own stop.
 *
 * Money is in MILLICENTS, like every other figure in this package.
 */
/** Share of the budget at which the run is told to stop exploring and converge. */
export const RUN_BUDGET_WARN_AT = 0.8;
/** A declared cap. Any finite number is one — a cap of 0 fails closed; a host that means
 *  "off" passes null. */
const capOf = (n) => typeof n === 'number' && Number.isFinite(n) ? n : null;
/** The first cap the run has reached (spend before tokens), or null while it is inside both. */
export function runBudgetBreach(caps, usage) {
    const spendCap = capOf(caps.maxSpendMillicents);
    if (spendCap != null && usage.spendMillicents >= spendCap)
        return { kind: 'spend', used: usage.spendMillicents, cap: spendCap };
    const tokenCap = capOf(caps.maxTokens);
    const tokens = usage.tokens ?? 0;
    if (tokenCap != null && tokens >= tokenCap)
        return { kind: 'tokens', used: tokens, cap: tokenCap };
    return null;
}
/** Fraction (0..1+) of a run's budget used — the larger of the spend and token shares. */
export function runBudgetUsedShare(caps, usage) {
    const spend = caps.maxSpendMillicents ? usage.spendMillicents / caps.maxSpendMillicents : 0;
    const tokens = caps.maxTokens ? (usage.tokens ?? 0) / caps.maxTokens : 0;
    return Math.max(spend, tokens);
}
/** Whether the run has crossed {@link RUN_BUDGET_WARN_AT} of its budget. */
export function runBudgetWarnDue(caps, usage) {
    return runBudgetUsedShare(caps, usage) >= RUN_BUDGET_WARN_AT;
}
//# sourceMappingURL=runBudget.js.map