/**
 * The run delta cards of ONE chat (PRD 41 §C11.1, §C14), as pure data: which `run-delta/card`
 * payloads the chat holds and which transcript message each card follows.
 *
 * A card belongs at the END of the run that produced it. Messages carry no run id, so a card is
 * anchored to the chat's last reply when it arrives (the run has just settled), and that anchor is
 * remembered on this device per run, so a reopened chat (whose cards come back from
 * `run-delta/get { chatId }`) puts each card where it first appeared. A card with no remembered
 * anchor — a run finished while this panel was closed — follows the chat's last reply.
 */

import type { RunHostMessage } from '../../../../src/brainRunHostProtocol';
import { readStored, writeStored } from '../../storage';

/** The host's `run-delta/card` payload (also each row `run-delta/get` answers). */
export type RunDeltaCardPayload = Omit<Extract<RunHostMessage, { type: 'run-delta/card' }>, 'type'>;

export const RUN_DELTA_CARD = 'run-delta/card';
export const RUN_DELTA_GET = 'run-delta/get';
/** Request `{ runId, path, line? }` (path repo-relative): the host opens a path the stored delta names, under its repository root. */
export const RUN_DELTA_OPEN_FILE = 'run-delta/open';

/** One card's identity: a run can cover more than one repository. */
export const cardKey = (c: Pick<RunDeltaCardPayload, 'runId' | 'repo'>): string => `${c.runId}\u0000${c.repo}`;

/** Add or replace cards (a re-posted delta replaces its card), keeping arrival order. */
export function mergeCards(current: readonly RunDeltaCardPayload[], incoming: readonly RunDeltaCardPayload[]): RunDeltaCardPayload[] {
    const byKey = new Map(current.map((c) => [cardKey(c), c] as const));
    for (const c of incoming) byKey.set(cardKey(c), c);
    return [...byKey.values()];
}

/** A `run-delta/get` answer → payloads; anything else (an older host, an error shape) → none. `root` may be absent (an older host). */
export function cardsFromAnswer(answer: unknown): RunDeltaCardPayload[] {
    if (!Array.isArray(answer)) return [];
    return answer.filter((c): c is RunDeltaCardPayload =>
        !!c && typeof c === 'object' && typeof c.runId === 'string' && typeof c.repo === 'string' && typeof c.chatId === 'number'
        && (c.root === undefined || typeof c.root === 'string')
        && !!c.delta && typeof c.delta === 'object' && Array.isArray(c.delta.dimensions));
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

const ANCHOR_KEY = 'bf.runDelta.anchors';
/** Remembered anchors are capped so the store cannot grow without bound. */
const MAX_ANCHORS = 200;

type Anchors = Record<string, number>;

function readAnchors(): Anchors {
    try {
        const parsed: unknown = JSON.parse(readStored(ANCHOR_KEY) ?? '{}');
        return parsed && typeof parsed === 'object' ? (parsed as Anchors) : {};
    } catch {
        return {};
    }
}

/** The message a run's card follows, as remembered on this device (undefined when never seen here). */
export const anchorOf = (runId: string): number | undefined => {
    const id = readAnchors()[runId];
    return typeof id === 'number' ? id : undefined;
};

/** Remember the message a run's card first followed. The first anchor wins: a later reply never moves an old card. */
export function rememberAnchor(runId: string, messageId: number): void {
    const anchors = readAnchors();
    if (anchors[runId] !== undefined) return;
    const entries = Object.entries({ ...anchors, [runId]: messageId });
    writeStored(ANCHOR_KEY, JSON.stringify(Object.fromEntries(entries.slice(-MAX_ANCHORS))));
}

/**
 * Cards grouped by the message they follow: a remembered anchor still in the transcript, else the
 * last reply. `replies` are the chat's assistant message ids in transcript order.
 */
export function placeCards(
    cards: readonly RunDeltaCardPayload[],
    replies: readonly number[],
    anchor: (runId: string) => number | undefined = anchorOf,
): Map<number, RunDeltaCardPayload[]> {
    const placed = new Map<number, RunDeltaCardPayload[]>();
    const last = replies[replies.length - 1];
    if (last === undefined) return placed;
    const present = new Set(replies);
    for (const card of cards) {
        const remembered = anchor(card.runId);
        const at = remembered !== undefined && present.has(remembered) ? remembered : last;
        placed.set(at, [...(placed.get(at) ?? []), card]);
    }
    return placed;
}
