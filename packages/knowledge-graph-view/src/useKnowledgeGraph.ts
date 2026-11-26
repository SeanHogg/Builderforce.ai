/**
 * The view's state: which reviewed root, its graph, the lens, the focus, search, live
 * updates and the review run. Everything reaches the host through the ONE
 * `KnowledgeGraphSource`; nothing here knows where files or memory live.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { LENSES, lensApplies, lensFindings, lensesFor, type LensDef } from './lenses';
import { localSearch } from './graphModel';
import { useReviewRun, type ReviewRun } from './useReviewRun';
import { useLiveGraph } from './useLiveGraph';
import { useGrowthReread } from './useGrowthReread';
import { chooseRoot, errorText, LAST_SEEN_MISS } from './firstLoadGate';
import { isNotReviewedHere, type KnowledgeBaseline, type KnowledgeGraphSource, type KnowledgeScopeSummary, type KnowledgeSearchHit, type LensId, type NotReviewedHere } from './types';

/**
 * `not-here`: the host holds no review of the root on THIS machine (PRD 41 A7) — Review, or the server's copy.
 * `idle`: a run-gated host (`source.runGated`) has a reviewed root but nothing drawn, and builds nothing until Run.
 */
export type GraphStatus = 'loading' | 'empty' | 'load-failed' | 'ready' | 'error' | 'not-here' | 'idle';

export interface KnowledgeGraphState {
    status: GraphStatus;
    /** Set while `status` is `not-here`: whether the host can also seed from the server's copy. */
    notHere: NotReviewedHere['notReviewedHere'] | null;
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
    /** The graph on screen is the last one seen (or a reload is in flight): a fresh read has not landed yet. */
    stale: boolean;
    /** The fresh read failed while a graph was drawn; that graph stays and the view offers Retry. */
    refreshFailed: boolean;
    /** The open root is loaded and tracked live. Always true on a host that is not run-gated. */
    running: boolean;
    /** Run: load the open root once and track its changes from then on (a run-gated host builds nothing before it). */
    run(): void;
    selectRoot(rootId: string): void;
    setLens(id: LensId): void;
    select(ref: string | null): void;
    setFocus(refs: string[]): void;
    /** Focus the refs and, when some are not in the loaded graph, load around them (search and Show both use this). */
    focusRefs(refs: string[]): void;
    search(q: string): Promise<void>;
    reload(): void;
}

const newestFirst = (a: KnowledgeScopeSummary, b: KnowledgeScopeSummary): number =>
    (b.lastReviewedAt ?? '').localeCompare(a.lastReviewedAt ?? '') || a.title.localeCompare(b.title);

/** The lenses a graph with findings should open on, in preference order (first that applies AND has findings). */
const FINDINGS_FIRST: readonly LensId[] = ['unused', 'partitions', 'duplication', 'knowledge', 'structure'];

export { GROW_INTERVAL_MS } from './useGrowthReread';

export interface KnowledgeGraphOptions {
    initialLens?: LensId;
    initialFocus?: string[];
    /** The host's lens subset (in display order as `LENS_ORDER`); absent ⇒ every lens that applies. */
    lenses?: readonly LensId[];
}

export function useKnowledgeGraph(source: KnowledgeGraphSource, opts: KnowledgeGraphOptions = {}): KnowledgeGraphState {
    const [status, setStatus] = useState<GraphStatus>('loading');
    const [notHere, setNotHere] = useState<NotReviewedHere['notReviewedHere'] | null>(null);
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
    const [stale, setStale] = useState(false);
    const [refreshFailed, setRefreshFailed] = useState(false);
    // A finished review is the only thing that makes an open root newly watchable, so it alone re-subscribes Live.
    const [reviewEpoch, setReviewEpoch] = useState(0);
    // The refs the open root's graph is loaded around: the host's initial focus, then a search's hits that
    // lie outside the loaded top of a large graph. ONE state, read by the ONE load below.
    const initialLoadFocus = useRef(opts.initialFocus?.length ? opts.initialFocus : undefined);
    const [loadFocus, setLoadFocus] = useState<string[] | undefined>(initialLoadFocus.current);
    /** The newest search; an older one that resolves late is dropped. */
    const searchSeq = useRef(0);
    /** The baseline last fetched, for the SOURCE it came from: a recreated source (another project) never shares it. */
    const baselineMemo = useRef<{ source: KnowledgeGraphSource; key: string; value: KnowledgeBaseline | null } | null>(null);
    // A source that holds its graph is painted as-is: no load, no loading state.
    const held = source.snapshot;
    // A run-gated host builds nothing until Run: `runRoot` is the root the person ran (a review they started counts).
    const gated = !!source.runGated && !held;
    const [runRoot, setRunRoot] = useState<string | null>(null);
    const running = !gated || (rootId !== null && runRoot === rootId);
    const gatedRef = useRef(gated);
    gatedRef.current = gated;

    /** Latest values, readable from async continuations before state settles. */
    const rootIdRef = useRef<string | null>(null);
    rootIdRef.current = rootId;
    const runRootRef = useRef<string | null>(null);
    runRootRef.current = runRoot;
    const focusRef = useRef(focus);
    focusRef.current = focus;
    const loadFocusRef = useRef(loadFocus);
    loadFocusRef.current = loadFocus;
    /** The graph on screen, readable from async continuations before state settles (set where `setGraph` is). */
    const graphRef = useRef<KnowledgeGraph | null>(null);
    const paint = useCallback((g: KnowledgeGraph | null) => { graphRef.current = g; setGraph(g); }, []);
    /** Bumped by anything that supersedes a review-growth re-read (a load, a finished review, a source swap). */
    const growSeq = useRef(0);
    // The root whose review is growing it now (`useGrowthReread`); a finished review clears it.
    const growing = useRef<string | null>(null);
    /** The `${rootId}:${generation}:${focus}` already loading/loaded for THIS source — a state-driven rerun never re-reads it. */
    const loadedKey = useRef<{ source: KnowledgeGraphSource; key: string } | null>(null);
    /** The root load in flight: a review-growth re-read waits for it (the host's newer load of a root cancels the older). */
    const pendingLoad = useRef<{ source: KnowledgeGraphSource; key: string } | null>(null);
    // Another SOURCE (another project) never shows the old one's graph: clear everything BEFORE the
    // new source's effects run, so its own lastSeen can paint. (State set during render re-renders at once.)
    const prevSource = useRef(source);
    if (prevSource.current !== source) {
        prevSource.current = source;
        graphRef.current = null; rootIdRef.current = null; runRootRef.current = null; loadedKey.current = null; baselineMemo.current = null; growSeq.current += 1;
        setGraph(null); setRootId(null); setRunRoot(null); setBaseline(null); setScopes([]); setStale(false); setRefreshFailed(false); setStatus('loading');
        setSelected(null); setHits(null); setLoadFocus(initialLoadFocus.current);
    }

    // ONE root's graph, and the host's baseline when it keeps one, read in parallel. The
    // baseline belongs to the root and generation, so a refocus does not fetch it again.
    const loadGraphForRoot = useCallback((root: string, focus: string[] | undefined, gen: number) => {
        // A run-gated host that is not running this root reads its STORED review (read-only, no live updates): a miss there is the Run card.
        // Its key differs from a Run's, so Run still loads what a stored read did not find (or refreshes what it did).
        const storedRead = gatedRef.current && runRootRef.current !== root;
        const key = `${root}:${gen}:${(focus ?? []).join(' ')}${storedRead ? ':stored' : ''}`;
        if (loadedKey.current?.source === source && loadedKey.current.key === key) return;
        const entry = { source, key };
        loadedKey.current = entry;
        growSeq.current += 1;
        const memoKey = `${root}:${gen}`;
        const memo = baselineMemo.current;
        // The same root and generation is a REFOCUS (a search's hits): the graph on screen stays
        // up while it loads, and stays if the reload fails.
        const refocus = memo !== null && memo.source === source && memo.key === memoKey;
        // A reload of the root on screen keeps its picture (stale until the new one lands); another
        // root clears to empty-with-status.
        const keep = graphRef.current?.scope.rootId === root;
        setRefreshFailed(false);
        if (keep) setStale(true);
        else { paint(null); setBaseline(null); setStale(false); setStatus('loading'); }
        const before = refocus
            ? Promise.resolve(memo.value)
            : (source.baseline
                ? source.baseline(root).catch((error: unknown) => { source.decision?.({ kind: 'error', reason: `baseline failed: ${errorText(error)}`, rootId: root }); return null; })
                : Promise.resolve(null));
        if (storedRead) source.decision?.({ kind: 'gate', reason: 'reading the stored review read-only (no Run: no live updates, no rebuild)', rootId: root });
        Promise.all([source.load(root, focus ? { focus } : undefined), before])
            .then(([g, base]) => {
                if (loadedKey.current !== entry) return;
                baselineMemo.current = { source, key: memoKey, value: base };
                if (storedRead) source.decision?.({ kind: 'gate', reason: !g ? 'the load returned nothing: no stored graph, so the Run card' : isNotReviewedHere(g) ? 'not reviewed on this machine' : 'stored graph read: painted without Run', rootId: root });
                // No review of this root on this machine: said plainly, never drawn from anything else.
                if (isNotReviewedHere(g)) {
                    paint(null); setBaseline(null); setStale(false); setRefreshFailed(false);
                    setNotHere(g.notReviewedHere); setStatus('not-here');
                    return;
                }
                setNotHere(null);
                if (!g && graphRef.current) { loadedKey.current = null; setRefreshFailed(true); return; }
                paint(g);
                setBaseline(base);
                setStale(false);
                // A scope EXISTS (rootId was picked) but its graph is gone or unreadable: this is
                // NOT "never reviewed" — say the load failed so the view can offer Retry.
                setStatus(g ? 'ready' : storedRead ? 'idle' : 'load-failed');
            })
            .catch((error: unknown) => {
                if (loadedKey.current !== entry) return;
                source.decision?.({ kind: 'error', reason: `load failed: ${errorText(error)}`, rootId: root });
                loadedKey.current = null; // a Retry (same key) is not deduped away
                // A drawn graph is never replaced by the failure screen: it stays, flagged.
                if (graphRef.current) setRefreshFailed(true); else setStatus('load-failed');
            })
            .finally(() => { if (pendingLoad.current === entry) pendingLoad.current = null; });
        pendingLoad.current = entry;
    }, [source, paint]);

    // Scopes AND the newest root's graph load IN PARALLEL — the reading is not serial (§4.6).
    // The graph starts loading off the SAME scopes read, not in a later state-driven pass.
    useEffect(() => {
        if (held) return undefined;
        let live = true;
        let freshScopes = false;
        let scopesFailed = false;
        if (graphRef.current) { setStale(true); setRefreshFailed(false); } else setStatus('loading');
        // What this host showed last time paints on the first frame; any fresh answer wins over it.
        // `seenSettled`: the lastSeen read is over (answered, missed or failed). A gated host waits on it before choosing a root, so a
        // lastSeen for another root than the newest scope is never raced out by the scopes answer.
        let seenSettled: Promise<unknown> = Promise.resolve();
        if (!graphRef.current && source.lastSeen) {
            seenSettled = source.lastSeen().then((seen) => {
                if (!live) return;
                if (!seen) { source.decision?.({ kind: 'lastSeen', reason: LAST_SEEN_MISS }); return; }
                if (graphRef.current) { source.decision?.({ kind: 'lastSeen', reason: 'ignored: a graph is already drawn', rootId: seen.rootId }); return; }
                // Gated and not running: nothing else draws until Run, so the last graph still paints after the fresh scopes
                // (for the root they opened on), and it is not "updating".
                const idle = gated && runRootRef.current !== seen.rootId && (!freshScopes || rootIdRef.current === seen.rootId);
                if (freshScopes && !idle) { source.decision?.({ kind: 'lastSeen', reason: 'ignored: the fresh scopes answered first', rootId: seen.rootId }); return; }
                source.decision?.({ kind: 'lastSeen', reason: `painted the graph of ${seen.rootId} (${seen.graph.nodes.length} nodes)${idle ? ': not running, so it stays until Run' : ': stale until the fresh read lands'}`, rootId: seen.rootId });
                if (!freshScopes) setScopes([...seen.scopes].sort(newestFirst));
                setRootId(seen.rootId);
                paint(seen.graph);
                setStale(!idle);
                setRefreshFailed(scopesFailed);
                setStatus('ready');
            }).catch((error: unknown) => {
                if (live) source.decision?.({ kind: 'lastSeen', reason: `error (degrades to no last graph): ${errorText(error)}` });
            });
        }
        (gated ? source.scopes().then(async (found) => { await seenSettled; return found; }) : source.scopes())
            .then((found) => {
                if (!live) return;
                freshScopes = true;
                const sorted = [...found].sort(newestFirst);
                setScopes(sorted);
                if (sorted.length === 0) { source.decision?.({ kind: 'gate', reason: 'no scopes: nothing reviewed (empty)' }); paint(null); setStale(false); setStatus('empty'); setRootId(null); return; }
                const choice = chooseRoot(sorted, { painted: graphRef.current?.scope.rootId ?? null, current: rootIdRef.current });
                const root = choice.root;
                source.decision?.({ kind: 'root', reason: choice.reason, rootId: root });
                // Gated: nothing is tracked until Run. A last graph drawn for this root stays (not "updating"); otherwise the root's STORED
                // review is read read-only (no live updates, no rebuild) and painted: the Run card is only for a root with no stored graph.
                if (gated && runRootRef.current !== root) {
                    setRootId(root); setStale(false);
                    if (graphRef.current?.scope.rootId === root) { source.decision?.({ kind: 'gate', reason: 'the last-seen graph of this root is on screen: kept; Run starts updates', rootId: root }); return; }
                    if (graphRef.current) { paint(null); setBaseline(null); }
                    loadGraphForRoot(root, loadFocusRef.current, generation);
                    return;
                }
                loadGraphForRoot(root, loadFocusRef.current, generation);
                setRootId(root);
            })
            .catch((error: unknown) => {
                if (!live) return;
                source.decision?.({ kind: 'error', reason: `scopes failed: ${errorText(error)}` });
                scopesFailed = true;
                if (graphRef.current) { setStale(true); setRefreshFailed(true); } else setStatus('error');
            });
        return () => { live = false; };
    }, [source, held, gated, generation, loadGraphForRoot, paint]);

    // A root picked in the picker, opened by a finished review, or refocused by a search
    // loads in its own pass; the dedupe key keeps this from re-reading what the scopes pass
    // already started. Gated and not running: another root's picture is cleared and the root's STORED review is read (read-only; no live updates).
    useEffect(() => {
        if (held || !rootId) return;
        if (!running) {
            if (graphRef.current && graphRef.current.scope.rootId !== rootId) { paint(null); setBaseline(null); }
            if (!graphRef.current) loadGraphForRoot(rootId, loadFocus, generation);
            return;
        }
        loadGraphForRoot(rootId, loadFocus, generation);
    }, [held, rootId, running, loadFocus, generation, loadGraphForRoot, paint]);

    // Live updates for the open root, once it runs: whole graphs, and change batches applied to the graph on screen.
    // `reviewEpoch`: a finished review may have opened (and so made watchable) this very root.
    useLiveGraph(source, { rootId: held || !running ? null : rootId, epoch: reviewEpoch, graphRef, focusRef, paint });

    // A finished review is a new "after", and its previous review the host's new "before".
    const onReviewDone = useCallback((doneRoot: string) => {
        searchSeq.current += 1;
        growSeq.current += 1;
        growing.current = null;
        setRootId(doneRoot);
        // A review the person started is a Run: its root is loaded and tracked from here.
        setRunRoot(doneRoot);
        setLoadFocus(initialLoadFocus.current);
        setGeneration((n) => n + 1);
        setReviewEpoch((n) => n + 1);
    }, []);
    const review = useReviewRun(source, onReviewDone);

    useGrowthReread({ held, source, review, paint, growing, growSeq, pendingLoad, rootIdRef, loadFocusRef, setStale, setRefreshFailed, setReady: () => setStatus('ready') });

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

    // Open a READY graph on a lens that SHOWS its findings instead of always 'structure' — once per load.
    // The user (or host) may still pick any lens afterwards; this never fights a manual pick. A host that
    // OPENED the view on a lens asked for it: that lens stays requested (so a lens that does not apply
    // to the folder says so, rather than silently swapping to another one).
    const autoSwitched = useRef<{ key: string; from: LensId } | null>(null);
    const hostChoseLens = opts.initialLens !== undefined;
    useEffect(() => {
        if (!shown || hostChoseLens) return;
        const key = `${shown.scope.rootId}:${generation}`;
        if (autoSwitched.current?.key === key) return;
        autoSwitched.current = { key, from: lensId };
        const current = LENSES[lensId];
        const currentOk = lensApplies(current, shown) && (!allowed || allowed.includes(current.id));
        if (currentOk && lensFindings(current, shown).length > 0) return;
        const wanted = FINDINGS_FIRST.find(
            (id) => lensApplies(LENSES[id], shown) && (!allowed || allowed.includes(id)) && lensFindings(LENSES[id], shown).length > 0,
        );
        if (wanted) setLensId(wanted);
    }, [shown, generation, lensId, allowed, hostChoseLens]);

    // ONE way to focus refs (search, Show): the loaded graph is only the top of a large one, so a ref
    // outside it is brought in by loading around those refs.
    const focusRefs = useCallback((refs: string[]) => {
        setFocus(refs);
        if (held || !shown) return;
        const loadedRefs = new Set<string>(shown.nodes.map((n) => n.ref));
        if (refs.some((r) => !loadedRefs.has(r))) setLoadFocus(refs);
    }, [shown, held]);

    const search = useCallback(async (q: string) => {
        const seq = ++searchSeq.current;
        setQuery(q);
        if (!q.trim() || !shown) { setHits(null); return; }
        const found = source.search ? await source.search(shown.scope.rootId, q).catch(() => localSearch(shown, q)) : localSearch(shown, q);
        if (seq !== searchSeq.current) return;
        setHits(found);
        if (found.length === 0) return;
        const refs = found.map((h) => h.ref);
        focusRefs(refs);
        setSelected(refs[0]!);
    }, [shown, source, focusRefs]);

    const selectRoot = useCallback((id: string) => {
        searchSeq.current += 1;
        setRootId(id);
        setLoadFocus(initialLoadFocus.current);
        setSelected(null);
        setHits(null);
        setBaseline(null);
    }, []);

    // Run: the open root loads once and is tracked live from then on (the effects above follow `running`). No root listed
    // yet: nothing was ever reviewed, so Run is the review's own plan → confirm → run.
    const startReview = review.start;
    const run = useCallback(() => {
        const root = rootIdRef.current;
        source.decision?.({ kind: 'run', reason: root ? 'Run pressed: load once, then track changes live' : 'Run pressed with no reviewed root: starts the review plan', rootId: root ?? undefined });
        if (root) setRunRoot(root); else startReview({ pick: true });
    }, [startReview, source]);
    // Retry, or a change the person made (a fact, a fix): on a gated host that is a Run of the open root too.
    const reload = useCallback(() => {
        if (gated && rootIdRef.current) setRunRoot(rootIdRef.current);
        setGeneration((n) => n + 1);
    }, [gated]);

    if (held) {
        const heldRoot = held.graph.scope.rootId;
        return {
            status: 'ready', notHere: null,
            scopes: [{ rootId: heldRoot, title: held.title ?? heldRoot, packs: held.graph.scope.packs }],
            rootId: heldRoot, graph: held.graph, baseline: held.baseline ?? null, lens, requested: LENSES[lensId], lenses, selected, focus, query, hits, review,
            stale: false, refreshFailed: false, running: true, run: () => undefined,
            selectRoot: () => undefined, setLens: setLensId, select: setSelected, setFocus, focusRefs, search,
            reload,
        };
    }
    return {
        status, notHere, scopes, rootId, graph, baseline, lens, requested: LENSES[lensId], lenses, selected, focus, query, hits, review,
        stale, refreshFailed, running, run,
        selectRoot, setLens: setLensId, select: setSelected, setFocus, focusRefs, search,
        reload,
    };
}
