/**
 * The commit scrubber of the status strip: "Review ●─●─● Now sha". A dot per commit from
 * `source.history`, newest at the right. Picking one marks the stations that commit changed
 * (it feeds the "What changed?" question and the Changed metric through `useSurface`; the root
 * also switches the question, see `onPick`); "Now" clears it. Renders nothing when the source
 * keeps no history or the root has no commits.
 */

import { useEffect, useMemo, useState } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { counted } from './plural';
import { cssVar } from '../scene/themeColors';
import { CONTROL, muted } from '../styles';
import { TYPE } from './ui/type';
import type { Commit, KnowledgeGraphSource } from '../types';
import { QuietButton } from './ui';

const MAX_DOTS = 40;
const SHA_LENGTH = 7;

/** The commits of a root, oldest first, capped to the latest {@link MAX_DOTS}; empty while loading, on failure, or with no history. */
export interface HistoryRead { commits: Commit[]; total: number; /** The read is still on the way (never "no commits"). */ loading: boolean }

export function useHistory(source: KnowledgeGraphSource, rootId: string | null): HistoryRead {
    const [state, setState] = useState<HistoryRead>({ commits: [], total: 0, loading: !!source.history && !!rootId });
    const read = source.history;
    useEffect(() => {
        setState({ commits: [], total: 0, loading: !!read && !!rootId });
        if (!read || !rootId) return;
        let live = true;
        read.call(source, rootId).then(
            (h) => { if (live) setState({ commits: [...h.commits].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-MAX_DOTS), total: h.commits.length, loading: false }); },
            () => { if (live) setState({ commits: [], total: 0, loading: false }); /* no history: no slider */ },
        );
        return () => { live = false; };
    }, [read, source, rootId]);
    return state;
}

export interface TimeSliderProps {
    commits: readonly Commit[];
    /** How many commits the root has in all; more than are drawn ⇒ the cap is said out loud. */
    capped?: number | undefined;
    /** The picked commit's sha; null = now. */
    picked: string | null;
    labels: KnowledgeGraphLabels;
    /** A commit was picked (its sha) or Now was (null). The root also asks "What changed?" on a pick. */
    onPick(sha: string | null): void;
    /** Stations the picked commit changed, for the readout. */
    changedStations: number;
}

export function TimeSlider({ commits, capped, picked, labels, onPick, changedStations }: TimeSliderProps) {
    const t = labels.surface.time;
    const at = useMemo(() => commits.findIndex((c) => c.sha === picked), [commits, picked]);
    if (commits.length === 0) return null;
    const step = (delta: number) => {
        const next = (at < 0 ? commits.length : at) + delta;
        onPick(next >= commits.length || next < 0 ? null : commits[next]!.sha);
    };
    const shown = (picked ?? commits[commits.length - 1]!.sha).slice(0, SHA_LENGTH);
    return (
        <div
            role="group" aria-label={t.aria} data-testid="kg-time" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, ...muted }}
            onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
            }}
        >
            <span style={{ flex: 'none' }}>{t.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', minWidth: 0, scrollbarWidth: 'none' }}>
                {commits.map((c, i) => {
                    const on = c.sha === picked;
                    // The line to the left of a dot is lit up to the picked commit (everything is lit at Now).
                    const lit = at < 0 || i <= at;
                    return (
                        <span key={c.sha} style={{ display: 'inline-flex', alignItems: 'center', flex: 'none' }}>
                            {i > 0 && <span aria-hidden="true" style={{ width: 14, height: 2, background: cssVar(lit ? 'accent' : 'border') }} />}
                            <button
                                type="button" data-commit={c.sha} aria-pressed={on} title={`${c.title} · ${c.at}`}
                                aria-label={fillTemplate(t.commitAria, { title: c.title, at: c.at })} onClick={() => onPick(on ? null : c.sha)}
                                style={{ width: `calc(${CONTROL} - 8px)`, height: CONTROL, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                            >
                                <span aria-hidden="true" style={{ width: 12, height: 12, boxSizing: 'border-box', borderRadius: 999, border: `2px solid ${cssVar(lit ? 'accent' : 'border')}`, background: cssVar(on ? 'accent' : 'panel') }} />
                            </button>
                        </span>
                    );
                })}
            </div>
            {capped !== undefined && capped > commits.length && <span data-testid="kg-time-capped" style={{ flex: 'none' }}>{counted(labels, 'commitsCapped', commits.length)}</span>}
            <QuietButton aria-pressed={picked === null} style={{ color: cssVar(picked === null ? 'text' : 'muted'), fontWeight: picked === null ? 700 : 500 }} onClick={() => onPick(null)}>{t.now}</QuietButton>
            <span style={{ flex: 'none', ...TYPE.monoValue, color: cssVar('text') }}>{shown}</span>
            {picked !== null && <span role="status" style={{ flex: 'none' }}>{counted(labels, 'stationChanged', changedStations)}</span>}
        </div>
    );
}
