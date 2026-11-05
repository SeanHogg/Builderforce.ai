/**
 * The wiring between the graph's state (selection, focus, lens) and the surface's state
 * (station, question, pinned path): the ONE select path, Show, the lens and question picks, and
 * the two pinpoint hand-offs (matches arrive, Clear releases). Each action touches both states
 * the same way wherever it is triggered from, so the root only passes them down.
 */

import type { KnowledgeGraphState } from '../useKnowledgeGraph';
import type { LensId } from '../types';
import { questionDef, questionForLens, type QuestionId } from './questions';
import { stationOfRef } from './stations';
import type { SurfaceModel } from './useSurface';

export interface SurfaceActions {
    select(ref: string): void;
    /** Focuses the refs AND selects the first through the one select path, so the map's station follows. */
    show(refs: string[]): void;
    pickLens(id: LensId): void;
    pickQuestion(id: QuestionId): void;
    /** A pinpoint answered: focus the refs, open the path strip on them, ask "What is wrong?". */
    pinpointed(refs: string[]): void;
    /** Clear releases everything a pinpoint set. */
    unpin(): void;
}

export function useSurfaceActions(kg: KnowledgeGraphState, surface: SurfaceModel, onSelected: () => void): SurfaceActions {
    const select = (ref: string) => {
        onSelected();
        kg.select(ref);
        const station = stationOfRef(surface.stations, ref);
        if (station) surface.selectStation(station);
    };
    return {
        select,
        show: (refs) => { kg.setFocus(refs); if (refs[0]) select(refs[0]); },
        pickLens: (id) => { kg.setLens(id); const q = questionForLens(id); if (q) surface.setQuestion(q); },
        pickQuestion: (id) => {
            if (kg.focus.length > 0) kg.setFocus([]);
            surface.setQuestion(id);
            const wanted = questionDef(id).lens;
            if (wanted && kg.lenses.some((l) => l.id === wanted)) kg.setLens(wanted);
        },
        pinpointed: (refs) => { kg.setFocus(refs); surface.pinPath(refs); surface.setQuestion('wrong'); },
        unpin: () => { surface.pinPath(null); kg.setFocus([]); },
    };
}
