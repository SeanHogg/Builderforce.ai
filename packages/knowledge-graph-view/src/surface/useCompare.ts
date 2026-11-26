/**
 * The compare's ONE state (PRD 43 Part C5): `{ source, side, findingId?, commit? } | null` and its actions. Everything that
 * compares drives it and reads it: the Before / After toggles (the fix flow, the Reviews panel's Server tab), the time
 * slider's picked commit, the restructure entries and the Patterns card, and the compare bar that shows it.
 *
 * Two-graph sources (baseline, snapshot, restructure) also yield the ONE union graph the stage draws for the whole
 * comparison (`view.graph`); the host view hands that graph down instead of today's, so the MarkSet is built once. A commit
 * is a changed set over today's graph (`view.graph` null). `play` steps a restructure or a baseline Before to After and a
 * commit comparison oldest to newest; a baseline the host says is not comparable offers no Before.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { Proposal } from '../compute/compare';
import type { Revision } from '../revision';
import type { Commit, KnowledgeBaseline, KnowledgeGraphSource } from '../types';
import { compareModel, compareRevs, compareView, type CompareSide, type CompareSource, type CompareState, type CompareView } from './compareModel';

/** How long a side is held while a play runs, and the pause before a restructure starts playing. */
export const PLAY_STEP_MS = 1300;
export const PLAY_START_MS = 700;

export interface CompareInput {
    /** Today's graph (the host's `kg.graph`), never the union. */
    current: KnowledgeGraph | null;
    baseline: KnowledgeBaseline | null;
    /** The host's source: a held `snapshot` names the comparison `snapshot` (and its `rev` is After's), else it is `baseline`. */
    source: Pick<KnowledgeGraphSource, 'snapshot'>;
    /** The root's commits, oldest first: what a commit play steps through. */
    commits: readonly Commit[];
    /** A new root closes the comparison. */
    rootId: string | null;
}

export interface CompareApi {
    state: CompareState | null;
    view: CompareView | null;
    /** A baseline the host calls not comparable: no Before for the baseline / snapshot sources. */
    comparable: boolean;
    reasons: readonly string[];
    playing: boolean;
    /** The earlier REVIEW is what is drawn (a baseline / snapshot comparison on Before): evidence and the surface's delta read the baseline. */
    showingBefore: boolean;
    /** The commit a commit comparison is on, else null (the time slider's pick). */
    picked: Commit | null;
    /** Opens a comparison; a restructure brings its proposal and starts on Before, then plays. */
    open(next: CompareState, proposal?: Proposal): void;
    close(): void;
    setSide(side: CompareSide): void;
    play(): void;
    /** The time slider's pick: a sha opens a commit comparison, null closes one. */
    pickCommit(sha: string | null): void;
    /** The Before / After toggle of the fix flow and the Server tab, over this state. */
    revision: { value: Revision; hasBefore: boolean; onChange(r: Revision): void };
}

const isBaselineSource = (s: CompareSource | undefined): boolean => s === 'baseline' || s === 'snapshot';

export function useCompare(input: CompareInput): CompareApi {
    const { current, baseline, source, commits, rootId } = input;
    const baselineSource = source.snapshot ? 'snapshot' : 'baseline', snapshotRev = source.snapshot?.rev;
    const [state, setState] = useState<CompareState | null>(null);
    const [proposal, setProposal] = useState<Proposal | null>(null);
    const [playing, setPlaying] = useState(false);
    const live = useRef<CompareState | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const commitsRef = useRef(commits);
    commitsRef.current = commits;
    const comparable = baseline?.comparable !== false;
    const comparableRef = useRef(comparable);
    comparableRef.current = comparable;

    const stop = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; setPlaying(false); }, []);
    const commit = useCallback((next: CompareState | null) => { live.current = next; setState(next); }, []);
    const after = useCallback((ms: number, run: () => void) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(run, ms); }, []);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const close = useCallback(() => { stop(); commit(null); setProposal(null); }, [stop, commit]);
    // A new root is not what was being compared.
    useEffect(() => { close(); }, [rootId, close]);

    const setSide = useCallback((side: CompareSide) => {
        const s = live.current;
        if (!s || s.side === side) return;
        if (side === 'before' && isBaselineSource(s.source) && !comparableRef.current) return;
        stop();
        commit({ ...s, side });
    }, [stop, commit]);

    const play = useCallback(() => {
        const s = live.current;
        if (!s) return;
        if (timer.current) clearTimeout(timer.current);
        if (s.source === 'commit') {
            // The history replays: every commit oldest to newest, each shown After (the changed set over today's graph).
            const list = commitsRef.current;
            let i = 0;
            const step = (): void => {
                const at = list[i];
                if (!at || live.current?.source !== 'commit') { stop(); return; }
                commit({ source: 'commit', side: 'after', commit: at });
                i += 1;
                if (i < list.length) after(PLAY_STEP_MS, step); else stop();
            };
            setPlaying(list.length > 0);
            step();
            return;
        }
        if (s.side === 'after') {
            if (isBaselineSource(s.source) && !comparableRef.current) return;
            setPlaying(true);
            commit({ ...s, side: 'before' });
            after(PLAY_STEP_MS, () => { const n = live.current; if (n) commit({ ...n, side: 'after' }); stop(); });
        } else { commit({ ...s, side: 'after' }); stop(); }
    }, [stop, commit, after]);

    const open = useCallback((next: CompareState, p?: Proposal) => {
        stop();
        setProposal(p ?? null);
        commit(next);
        if (next.source === 'restructure') { setPlaying(true); after(PLAY_START_MS, play); }
    }, [stop, commit, after, play]);

    const pickCommit = useCallback((sha: string | null) => {
        const picked = sha ? commitsRef.current.find((c) => c.sha === sha) : undefined;
        if (picked) { stop(); setProposal(null); commit({ source: 'commit', side: 'after', commit: picked }); }
        else if (live.current?.source === 'commit') close();
    }, [stop, commit, close]);

    const model = useMemo(
        () => (state && state.source !== 'commit' ? compareModel(state.source, current, baseline?.graph ?? null, proposal) : null),
        [state?.source, current, baseline, proposal], // eslint-disable-line react-hooks/exhaustive-deps
    );
    const baselineRev = baseline?.rev ?? null;
    const view = useMemo(
        () => (state ? compareView(state, model, compareRevs(state, baselineRev, snapshotRev ?? null)) : null),
        [state, model, baselineRev, snapshotRev],
    );

    const hasBefore = !!baseline && comparable;
    const revision = useMemo(() => ({
        value: (isBaselineSource(state?.source) ? state!.side : 'after') as Revision,
        hasBefore,
        onChange: (r: Revision) => {
            if (isBaselineSource(live.current?.source)) setSide(r);
            else if (r === 'before' && hasBefore) { stop(); setProposal(null); commit({ source: baselineSource, side: 'before' }); }
        },
    }), [state, hasBefore, baselineSource, setSide, stop, commit]);

    const showingBefore = isBaselineSource(state?.source) && state?.side === 'before';
    return { state, view, comparable, reasons: baseline?.reasons ?? [], playing, showingBefore, picked: state?.source === 'commit' ? state.commit ?? null : null, open, close, setSide, play, pickCommit, revision };
}
