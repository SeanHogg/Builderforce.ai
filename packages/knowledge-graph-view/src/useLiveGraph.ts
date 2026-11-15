/**
 * useLiveGraph.ts — the view's live subscription to a running root (PRD 41 A7 + A8).
 *
 * While a root is open AND running (not held as a snapshot, not run-gated-and-idle), the
 * host streams its changes two ways through `source.subscribeLive` (`types.ts`):
 *
 *   - `cb(wholeGraph)`: the host's throttled FULL refresh — painted as-is, replacing the
 *     graph on screen.
 *   - `onPatch(patch, decorate?)`: a bounded change batch — applied to the graph already on
 *     screen with `applyGraphPatch` (`graphPatch.ts`), then the host's `decorate` overlay,
 *     so the view updates without a whole rebuild.
 *
 * `epoch` re-subscribes: a finished review (`reviewEpoch` in `useKnowledgeGraph`) may have
 * opened this very root for watching, so a fresh epoch tears the old subscription down and
 * subscribes again. A `null` rootId (held snapshot, or gated and not running) subscribes to
 * nothing.
 *
 * `graphRef` / `focusRef` are the caller's live refs: `graphRef` is the current on-screen
 * graph (so a patch applies to the latest picture, not a stale render), `focusRef` the
 * current focus (so a whole-graph refresh keeps the picture centered where the person is
 * looking — read the ref inside the callback, never from a closure, to avoid a stale value).
 */

import { useEffect, type MutableRefObject } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphSource } from './types';
import { applyGraphPatch } from './graphPatch';

export interface UseLiveGraphArgs {
    /** The root being watched; null ⇒ no subscription (held snapshot, or run-gated and not running). */
    rootId: string | null;
    /** Bumped to re-subscribe (a finished review may have made this root watchable). */
    epoch: number;
    /** The current on-screen graph; a patch applies to its latest value, then paints. */
    graphRef: MutableRefObject<KnowledgeGraph | null>;
    /** The current focus; kept in step with the subscription. Read live, not from a closure. */
    focusRef: MutableRefObject<string[]>;
    /** Paint a graph as the new on-screen picture (sets state and updates `graphRef`). */
    paint: (g: KnowledgeGraph | null) => void;
}

export function useLiveGraph(source: KnowledgeGraphSource, { rootId, epoch, graphRef, focusRef, paint }: UseLiveGraphArgs): void {
    useEffect(() => {
        if (!rootId || !source.subscribeLive) return undefined;
        const root = rootId;
        const unsubscribe = source.subscribeLive(
            root,
            // Whole-graph refresh: paint it as-is; `focusRef` is read live so the refresh keeps
            // the focus the person is looking at, never a value captured when the effect ran.
            (g: KnowledgeGraph) => {
                if (graphRef.current?.scope.rootId !== root) return;
                paint({ ...g, focus: focusRef.current } as unknown as KnowledgeGraph);
            },
            // Bounded change batch: apply to the latest on-screen graph, then the host's decoration.
            (patch, decorate) => {
                const current = graphRef.current;
                if (!current || current.scope.rootId !== root) return;
                paint(applyGraphPatch(current, patch, decorate));
            },
        );
        return unsubscribe;
        // `graphRef` / `focusRef` / `paint` are stable refs/callbacks from the caller; only the
        // root and the re-subscribe epoch (and the source itself) change what we listen to.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source, rootId, epoch]);
}
