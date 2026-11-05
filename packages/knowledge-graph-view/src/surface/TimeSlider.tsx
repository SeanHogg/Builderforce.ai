/**
 * The time slider in the header: a dot per commit from `source.history`, newest at the right.
 * Picking one marks the stations that commit changed (it feeds the "What changed?" question and
 * the Changed metric through `useSurface`); "Now" clears it. Renders nothing when the source
 * keeps no history or the root has no commits.
 */

import { useEffect, useMemo, useState } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { chip, muted } from '../styles';
import type { KnowledgeGraphSource } from '../types';

export type Commit = { sha: string; title: string; at: string; refs: string[] };

const MAX_DOTS = 40;

/** The commits of a root, oldest first, capped to the latest {@link MAX_DOTS}; empty while loading, on failure, or with no history. */
export function useHistory(source: KnowledgeGraphSource, rootId: string | null): { commits: Commit[]; total: number } {
    const [state, setState] = useState<{ commits: Commit[]; total: number }>({ commits: [], total: 0 });
    const read = source.history;
    useEffect(() => {
        setState({ commits: [], total: 0 });
        if (!read || !rootId) return;
        let live = true;
        read.call(source, rootId).then(
            (h) => { if (live) setState({ commits: [...h.commits].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_DOTS), total: h.commits.length }); },
            () => { /* no history: no slider */ },
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
    return (
        <div
            role="group" aria-label={t.aria} data-testid="kg-time" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}
            onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
            }}
        >
            <span style={{ ...muted, flex: 'none' }}>{t.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, overflowX: 'auto', minWidth: 0 }}>
                {commits.map((c) => (
                    <button
                        key={c.sha} type="button" data-commit={c.sha} aria-pressed={c.sha === picked} title={`${c.title} · ${c.at}`}
                        aria-label={fillTemplate(t.commitAria, { title: c.title, at: c.at })} onClick={() => onPick(c.sha === picked ? null : c.sha)}
                        style={{ flex: 'none', width: 28, height: 40, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                    >
                        <span aria-hidden="true" style={{ width: c.sha === picked ? 14 : 9, height: c.sha === picked ? 14 : 9, borderRadius: 999, background: cssVar(c.sha === picked ? 'accent' : 'edge'), border: `2px solid ${cssVar('bg')}`, boxShadow: `0 0 0 1px ${cssVar(c.sha === picked ? 'accent' : 'border')}` }} />
                    </button>
                ))}
            </div>
            {capped !== undefined && capped > commits.length && <span data-testid="kg-time-capped" style={{ ...muted, flex: 'none' }}>{fillTemplate(labels.surface.historyCapped, { count: commits.length })}</span>}
            <button type="button" aria-pressed={picked === null} style={{ ...chip(picked === null), minHeight: 32 }} onClick={() => onPick(null)}>{t.now}</button>
            {picked !== null && <span role="status" style={{ ...muted, flex: 'none' }}>{fillTemplate(t.changed, { count: changedStations })}</span>}
        </div>
    );
}
