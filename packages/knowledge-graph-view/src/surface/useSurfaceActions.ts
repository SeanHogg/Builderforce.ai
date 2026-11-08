/**
 * The wiring between the graph's state (selection, focus, lens) and the surface's state
 * (station, question, pinned path): the ONE select path, Show, the lens and question picks, and
 * the two pinpoint hand-offs (matches arrive, Clear releases). Each action touches both states
 * the same way wherever it is triggered from, so the root only passes them down.
 */

import type { KnowledgeGraphState } from '../useKnowledgeGraph';
import type { LensId, ViewMode } from '../types';
import { towerCameraOf, type TowerHighlight } from './towerHighlight';
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
    /** Lights an anti-pattern's files in the Tower (3D, else the SVG Tower) and shows the refs; undefined when neither camera exists. */
    showInTower: ((highlight: TowerHighlight, refs: string[]) => void) | undefined;
}

/** The cameras on offer and how to switch to one: what Show in Tower needs. */
export interface TowerCameras { ids: readonly string[]; set(mode: ViewMode): void }

export function useSurfaceActions(kg: KnowledgeGraphState, surface: SurfaceModel, onSelected: () => void, cameras?: TowerCameras): SurfaceActions {
    const camera = towerCameraOf(cameras?.ids);
    const select = (ref: string) => {
        onSelected();
        kg.select(ref);
        const station = stationOfRef(surface.stations, ref);
        if (station) surface.selectStation(station);
    };
    return {
        select,
        show: (refs) => { kg.focusRefs(refs); if (refs[0]) select(refs[0]); },
        pickLens: (id) => { kg.setLens(id); const q = questionForLens(id); if (q) surface.setQuestion(q); },
        pickQuestion: (id) => {
            if (kg.focus.length > 0) kg.setFocus([]);
            surface.setQuestion(id);
            // A question with no lens of its own (Wrong, Untested, Patterns) still leaves a lens-only pick (Compare): the question is the active pick now.
            const wanted = questionDef(id).lens ?? (questionForLens(kg.lens.id) === undefined ? 'structure' as const : undefined);
            if (wanted && kg.lenses.some((l) => l.id === wanted)) kg.setLens(wanted);
        },
        pinpointed: (refs) => { kg.setFocus(refs); surface.pinPath(refs); surface.setQuestion('wrong'); },
        unpin: () => { surface.pinPath(null); kg.setFocus([]); },
        showInTower: camera && cameras
            ? (highlight, refs) => { surface.setHighlight(highlight); kg.focusRefs(refs); if (refs[0]) select(refs[0]); cameras.set(camera); }
            : undefined,
    };
}
