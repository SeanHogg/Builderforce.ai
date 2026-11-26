/**
 * The first-load gate's choices, pure: which root a run-gated host opens on, and why. The reason is
 * recorded in the load timeline (`KnowledgeGraphSource.decision`), so a Diagnostics copy says WHY a
 * root was chosen, not only which calls ran.
 */

import type { KnowledgeScopeSummary } from './types';

export interface RootChoice { root: string; reason: string }

/**
 * The root to open once the scopes are listed, in preference order:
 * the root the person ran, the root of the graph already painted (the last-seen one: it is what they see), the root
 * already selected, then the newest scope. A candidate that is not in the listed scopes never wins.
 */
export function chooseRoot(sorted: readonly KnowledgeScopeSummary[], candidates: { run: string | null; painted: string | null; current: string | null }): RootChoice {
    const listed = (id: string | null): id is string => !!id && sorted.some((s) => s.rootId === id);
    if (listed(candidates.run)) return { root: candidates.run, reason: 'the root that was run' };
    if (listed(candidates.painted)) return { root: candidates.painted, reason: 'the root of the last-seen graph on screen (it is in the scopes)' };
    if (listed(candidates.current)) return { root: candidates.current, reason: 'the root already selected (it is in the scopes)' };
    const why = candidates.painted ? `the last-seen root ${candidates.painted} is not in the scopes; ` : '';
    return { root: sorted[0]!.rootId, reason: `${why}the newest scope` };
}

/** Why a `lastSeen` that answered nothing did, in the view's words (the host's trace names the cause: absent, oversize, unreadable). */
export const LAST_SEEN_MISS = 'nothing remembered (file absent, over the size cap, or unreadable: see the host log)';

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
