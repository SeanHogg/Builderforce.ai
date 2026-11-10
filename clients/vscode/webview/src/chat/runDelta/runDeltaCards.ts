/**
 * The run delta cards of ONE chat (PRD 41 §C11.1, §C14), as pure data: which `run-delta/card`
 * payloads the chat holds and which transcript message each card follows.
 *
 * A run's card goes through `pending` ("Measuring…") to its computed cards, one per repository
 * (or to `failed` when none came): {@link mergeCards} keeps exactly one of those states per run.
 * A card belongs at the END of the run that produced it: the host names that reply (`at`, the
 * run's last assistant message), and the card follows it. A card without `at` (a record stored
 * before the field existed), or whose reply is gone, follows the chat's last reply.
 */

import type { RunDeltaCardPayload as ContractCard, RunDeltaProgressCard } from '@builderforce/run-delta/contract';
import type { Prediction } from '@builderforce/run-delta/predict';

/** A card as the host posts it: the contract's payload plus `predicted`, the predictions it shows (PRD 41 §D11; advisory). */
export type RunDeltaCardPayload = ContractCard & { predicted?: Prediction[] };
/** The host's refusal codes, from the contract (never spelled here). */
export { RUN_DELTA_OPEN_REFUSED, RUN_DELTA_RELEASE_REFUSED, releaseRefusalOf, type RunDeltaReleaseRefusal } from '@builderforce/run-delta/contract';
export type ComputedCard = Exclude<RunDeltaCardPayload, RunDeltaProgressCard>;

export const RUN_DELTA_CARD = 'run-delta/card';
export const RUN_DELTA_GET = 'run-delta/get';
/** Request `{ runId, path, line? }` (path repo-relative): the host opens a path the stored delta names, under its repository root. */
export const RUN_DELTA_OPEN_FILE = 'run-delta/open';
/** Request `{ runId }`: release a run held at its finalize gate (§12.5). Refused with one of `RUN_DELTA_RELEASE_REFUSED`. */
export const RUN_DELTA_RELEASE = 'run-delta/release';

export const isProgress = (c: RunDeltaCardPayload): c is RunDeltaProgressCard => c.status === 'pending' || c.status === 'failed';

/** One card's identity: a run can cover more than one repository; its progress card is one per run. */
export const cardKey = (c: RunDeltaCardPayload): string => `${c.runId}\u0000${isProgress(c) ? '' : c.repo}`;

/**
 * Add or replace cards, keeping arrival order. A computed card replaces its run's progress card; a
 * progress card for a run that already has a computed card is stale and dropped; a re-posted card
 * (a released one) replaces its earlier self.
 */
export function mergeCards(current: readonly RunDeltaCardPayload[], incoming: readonly RunDeltaCardPayload[]): RunDeltaCardPayload[] {
    const byKey = new Map(current.map((c) => [cardKey(c), c] as const));
    for (const c of incoming) {
        if (isProgress(c)) {
            if ([...byKey.values()].some((k) => k.runId === c.runId && !isProgress(k))) continue;
        } else {
            byKey.delete(`${c.runId}\u0000`);
        }
        byKey.set(cardKey(c), c);
    }
    return [...byKey.values()];
}

const isBase = (c: Record<string, unknown>): boolean =>
    typeof c.runId === 'string' && typeof c.chatId === 'number' && (c.at === undefined || typeof c.at === 'number');

/** A `run-delta/get` answer → payloads; anything else (an older host, an error shape) → none. `root` may be absent (an older host). */
export function cardsFromAnswer(answer: unknown): RunDeltaCardPayload[] {
    if (!Array.isArray(answer)) return [];
    return answer.filter((c): c is RunDeltaCardPayload => {
        if (!c || typeof c !== 'object' || !isBase(c)) return false;
        if (c.status === 'pending' || c.status === 'failed') return true;
        return (c.status === undefined || c.status === 'computed') && typeof c.repo === 'string'
            && (c.root === undefined || typeof c.root === 'string')
            && !!c.delta && typeof c.delta === 'object' && Array.isArray(c.delta.dimensions);
    });
}

/**
 * A card path the webview may ask the host to open: repo-relative only. An absolute path (POSIX, Windows drive or UNC), a
 * `..` segment or an empty path is refused here; the host resolves the rest under the delta's repository root and confines it.
 */
export function safeRepoPath(path: string): string | undefined {
    const p = path.replace(/\\/g, '/');
    if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').some((seg) => seg === '..')) return undefined;
    return p;
}

/**
 * Cards grouped by the message they follow: the reply the host named (`at`) when it is still in
 * the transcript, else the last reply. `replies` are the chat's assistant message ids in transcript order.
 */
export function placeCards(cards: readonly RunDeltaCardPayload[], replies: readonly number[]): Map<number, RunDeltaCardPayload[]> {
    const placed = new Map<number, RunDeltaCardPayload[]>();
    const last = replies[replies.length - 1];
    if (last === undefined) return placed;
    const present = new Set(replies);
    for (const card of cards) {
        const at = card.at !== undefined && present.has(card.at) ? card.at : last;
        placed.set(at, [...(placed.get(at) ?? []), card]);
    }
    return placed;
}
