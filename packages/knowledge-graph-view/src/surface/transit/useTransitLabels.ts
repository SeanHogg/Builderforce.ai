/**
 * The station labels of the map: each drawn station's note line (the question's answer, else the
 * plain facts) and the side its label takes. Memoized on what they depend on, so a hover or a card
 * opening does not redo the placement of every label.
 */

import { useMemo } from 'react';
import type { KnowledgeGraphLabels } from '../../labels';
import { stationNote } from '../pathNotes';
import type { Station } from '../stations';
import type { Point } from './geometry';
import { placeLabels, type Box, type LabelItem, type PlacedLabel } from './labelPlacement';
import type { StationStyle } from '../overlays';

export interface StationNote { text: string; accent: boolean }

export interface TransitLabelsInput {
    drawn: readonly Station[];
    positions: ReadonlyMap<string, Point>;
    styles: ReadonlyMap<string, StationStyle>;
    lit: ReadonlySet<string> | null;
    noteOf: ((s: Station) => string | null) | undefined;
    selectedStation: string | null;
    labels: KnowledgeGraphLabels;
    width: number;
    height: number;
    obstacles: readonly Box[];
}

export function useTransitLabels(i: TransitLabelsInput): { placed: Map<string, PlacedLabel>; notes: Map<string, StationNote | null> } {
    const { drawn, positions, styles, lit, noteOf, selectedStation, labels, width, height, obstacles } = i;
    return useMemo(() => {
        const notes = new Map<string, StationNote | null>();
        for (const st of drawn) {
            const answer = noteOf?.(st);
            const fact = answer ? null : stationNote(st, labels);
            notes.set(st.id, answer ? { text: answer, accent: true } : fact ? { text: fact, accent: false } : null);
        }
        // The busiest and the selected station choose their side first.
        const items: LabelItem[] = [...drawn]
            .sort((a, b) => Number(b.id === selectedStation) - Number(a.id === selectedStation) || b.use - a.use)
            .flatMap((st): LabelItem[] => {
                const pos = positions.get(st.id);
                if (!pos) return [];
                const note = lit !== null && !lit.has(st.id) ? null : notes.get(st.id)?.text ?? null;
                return [{ id: st.id, x: pos.x, y: pos.y, r: (styles.get(st.id)?.size ?? 8) + 4, name: st.name, note }];
            });
        return { placed: placeLabels(items, { width, height, obstacles }), notes };
    }, [drawn, positions, styles, lit, noteOf, selectedStation, labels, width, height, obstacles]);
}
