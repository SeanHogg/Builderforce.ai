/**
 * The view's state: which reviewed root, its graph, the lens, the focus, search, live
 * updates and the review run. Everything reaches the host through the ONE
 * `KnowledgeGraphSource`; nothing here knows where files or memory live.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { LENSES, lensApplies, lensesFor, type LensDef } from './lenses';
import { localSearch } from './graphModel';
import { useReviewRun, type ReviewRun } from './useReviewRun';
import type { KnowledgeBaseline, KnowledgeGraphSource, KnowledgeScopeSummary, KnowledgeSearchHit, LensId } from './types';

export type GraphStatus = 'loading' | 'empty' | 'ready' | 'error';

export interface KnowledgeGraphState {
    status: GraphStatus;
    scopes: KnowledgeScopeSummary[];
    rootId: string | null;
    graph: KnowledgeGraph | null;
    /** The root's stored "before" (Compare), from the host; null when it keeps none. */
    baseline: KnowledgeBaseline | null;
    lens: LensDef;
    /** The lens the person asked for (or the host opened on); differs from `lens` when it does not apply. */
    requested: LensDef;
    lenses: LensDef[];
    selected: string | null;
    focus: string[];
    query: string;
    hits: KnowledgeSearchHit[] | null;
    review: ReviewRun;
    selectRoot(rootId: string): void;
    setLens(id: LensId): void;
    select(ref: string | null): void;
    setFocus(refs: string[]): void;
    search(q: string): Promise<void>;
    reload(): void;
}

const newestFirst = (a: KnowledgeScopeSummary, b: KnowledgeScopeSummary): number =>
    (b.lastReviewedAt ?? '').localeCompare(a.lastReviewedAt ?? '') || a.title.localeCompare(b.title);

export interface KnowledgeGraphOptions {
    initialLens?: LensId;
    initialFocus?: string[];
    /** The host's lens subset (in display order as `LENS_ORDER`); absent ⇒ every lens that applies. */
    lenses?: readonly LensId[];
}

export function useKnowledgeGraph(source: KnowledgeGraphSource, opts: KnowledgeGraphOptions = {}): KnowledgeGraphState {
    const [status, setStatus] = useState<GraphStatus>('loading');
    const [scopes, setScopes] = useState<KnowledgeScopeSummary[]>([]);
    const [rootId, setRootId] = useState<string | null>(null);
    const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
    const [baseline, setBaseline] = useState<KnowledgeBaseline | null>(null);
    const [lensId, setLensId] = useState<LensId>(opts.initialLens ?? 'structure');
    const [selected, setSelected] = useState<string | null>(null);
    const [focus, setFocus] = useState<string[]>(opts.initialFocus ?? []);
    const [query, setQuery] = useState('');
    const [hits, setHits] = useState<KnowledgeSearchHit[] | null>(null);
    const [generation, setGeneration] = useState(0);
    // A source that holds its graph is painted as-is: no load, no loading state.
    const held = source.snapshot;

    // Scopes → pick the most recently reviewed root.
    useEffect(() => {
        if (held) return undefined;
        let live = true;
        setStatus('loading');
        source.scopes()
            .then((found) => {
                if (!live) return;
                const sorted = [...found].sort(newestFirst);
                setScopes(sorted);
                if (sorted.length === 0) { setStatus('empty'); setRootId(null); return; }
                setRootId((current) => (current && sorted.some((s) => s.rootId === current) ? current : sorted[0]!.rootId));
            })
            .catch(() => { if (live) setStatus('error'); });
        return () => { live = false; };
    }, [source, held, generation]);

    // Root → its graph (+ the host's baseline, when it keeps one).
    useEffect(() => {
        if (held || !rootId) return undefined;
        let live = true;
        setStatus('loading');
        Promise.all([
            source.load(rootId, opts.initialFocus?.length ? { focus: opts.initialFocus } : undefined),
            source.baseline ? source.baseline(rootId).catch(() => null) : Promise.resolve(null),
        ])
            .then(([g, before]) => {
                if (!live) return;
                setGraph(g);
                setBaseline(before);
                setStatus(g ? 'ready' : 'empty');
            })
            .catch(() => { if (live) setStatus('error'); });
        return () => { live = false; };
        // initialFocus is read once per root by design.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source, held, rootId, generation]);

    // Live updates for the open root.
    useEffect(() => {
        if (held || !rootId || !source.subscribeLive) return undefined;
        return source.subscribeLive(rootId, (g) => setGraph(g));
        // `generation`: a finished review may have opened (and so made watchable) this very root.
    }, [source, held, rootId, generation]);

    // A finished review is a new "after", and its previous review the host's new "before".
    const onReviewDone = useCallback((doneRoot: string) => {
        setRootId(doneRoot);
        setGeneration((n) => n + 1);
    }, []);
    const review = useReviewRun(source, onReviewDone);

    const shown = held ? held.graph : graph;
    const allowed = opts.lenses;
    const lenses = useMemo(
        () => (shown ? lensesFor(shown).filter((l) => !allowed || allowed.includes(l.id)) : []),
        [shown, allowed],
    );
    const lens = useMemo(() => {
        const wanted = LENSES[lensId];
        if (!shown || (lensApplies(wanted, shown) && (!allowed || allowed.includes(wanted.id)))) return wanted;
        return lenses[0] ?? LENSES.structure;
    }, [shown, lensId, lenses, allowed]);

    const search = useCallback(async (q: string) => {
        setQuery(q);
        if (!q.trim() || !shown) { setHits(null); return; }
        const found = source.search ? await source.search(shown.scope.rootId, q).catch(() => localSearch(shown, q)) : localSearch(shown, q);
        setHits(found);
        if (found.length === 0) return;
        const refs = found.map((h) => h.ref);
        setFocus(refs);
        // The API searches everything; the loaded graph is only the top of a large one. A hit
        // outside it is brought in by reloading with those refs as the focus.
        const loadedRefs = new Set<string>(shown.nodes.map((n) => n.ref));
        if (!held && refs.some((r) => !loadedRefs.has(r))) {
            const reloaded = await source.load(shown.scope.rootId, { focus: refs }).catch(() => null);
            if (reloaded) setGraph(reloaded);
        }
        setSelected(refs[0]!);
    }, [shown, source, held]);

    const selectRoot = useCallback((id: string) => {
        setRootId(id);
        setSelected(null);
        setHits(null);
        setBaseline(null);
    }, []);

    if (held) {
        const heldRoot = held.graph.scope.rootId;
        return {
            status: 'ready',
            scopes: [{ rootId: heldRoot, title: held.title ?? heldRoot, packs: held.graph.scope.packs }],
            rootId: heldRoot, graph: held.graph, baseline: held.baseline ?? null, lens, requested: LENSES[lensId], lenses, selected, focus, query, hits, review,
            selectRoot: () => undefined, setLens: setLensId, select: setSelected, setFocus, search,
            reload: () => setGeneration((n) => n + 1),
        };
    }
    return {
        status, scopes, rootId, graph, baseline, lens, requested: LENSES[lensId], lenses, selected, focus, query, hits, review,
        selectRoot, setLens: setLensId, select: setSelected, setFocus, search,
        reload: () => setGeneration((n) => n + 1),
    };
}
