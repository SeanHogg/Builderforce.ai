/**
 * knowledge/reviewCost.ts — the ONE price model of a review's confirm chip (PRD 38 §3.1
 * "≈ model calls and cost"), shared by every host:
 *
 *   {@link ReviewCallPrice}   what a host knows of ONE judged section — the server's
 *                             `GET …/knowledge/judge/estimate` (a `JudgeEstimate` satisfies it),
 *                             or "local" for an on-device engine;
 *   {@link reviewCostOf}      calls × price, with the validation (finite, >= 0) in ONE place;
 *   {@link reviewCostSuffix}  that cost as the chat row's text, for a host with no view of its
 *                             own (the editor, on-prem). A browser host maps the same
 *                             {@link ReviewCost} onto its chip (`knowledge-browser` `estimateReview`).
 *
 * LANGUAGE. A PreFetch row's `text` is English by design (only chips carry a `labelKey`; every
 * row here — `planDetailLine`, the report — is English), so the suffix is English and its
 * currency is en-US, from the one constant below. The web/Rovr chip is localized separately
 * (`reviewPlanCostLocal` in the catalogs). Pure.
 */

/** What a host knows of one judged section's price. */
export interface ReviewCallPrice {
    /** ≈ USD of one judged section; null when unknown. */
    perCallUsd: number | null;
    /** Judged on the person's own local model: no cost. */
    local: boolean;
}

export type ReviewCallPricePort = () => Promise<ReviewCallPrice | undefined>;

/** A review's cost: on a local model, an amount, or not known. */
export type ReviewCost = { kind: 'local' } | { kind: 'usd'; usd: number } | { kind: 'unknown' };

/** The chat row's words for a local engine (English by design — see the header). */
export const LOCAL_COST_TEXT = 'runs on your local model — no cost';

/** `modelCalls` × the per-call price. A missing, non-finite or negative price is unknown, never NaN or 0. */
export function reviewCostOf(modelCalls: number, price: ReviewCallPrice | undefined): ReviewCost {
    if (!price) return { kind: 'unknown' };
    if (price.local) return { kind: 'local' };
    const perCall = price.perCallUsd;
    return perCall !== null && Number.isFinite(perCall) && perCall >= 0 ? { kind: 'usd', usd: modelCalls * perCall } : { kind: 'unknown' };
}

const usd = (value: number): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 2 : 0 }).format(value);

/** " · ≈ $0.12", " · runs on your local model — no cost", or "" when the price is unknown or the port fails. */
export async function reviewCostSuffix(modelCalls: number, port: ReviewCallPricePort | undefined): Promise<string> {
    let price: ReviewCallPrice | undefined;
    try {
        price = port ? await port() : undefined;
    } catch {
        return '';
    }
    const cost = reviewCostOf(modelCalls, price);
    if (cost.kind === 'local') return ` · ${LOCAL_COST_TEXT}`;
    return cost.kind === 'usd' ? ` · ≈ ${usd(cost.usd)}` : '';
}
