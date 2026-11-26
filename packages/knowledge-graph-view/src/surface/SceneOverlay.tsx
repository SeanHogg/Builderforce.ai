/**
 * The toolbar over the scene (design prototype `#tools` + `#cmp`): ONE wrapping row on the panel background — the View segment (`CameraBar`), the
 * 3D | Flat pair, a spacer, then the questions segment with its More menu (`QuestionBar`) — and, under it, the compare bar (`time`, the commit scrubber)
 * only while "What changed?" is asked or a commit is picked. The scale note sits in the bottom-left corner. The overlay takes the scene's whole box but
 * lets pointer events through: only its controls take them. The scene starts below the MEASURED toolbar (`--kg-scene-top`).
 *
 * `narrow` (a phone) stops floating: the same parts stack in flow ABOVE the scene.
 *
 * Pure presentation. Every datum comes in by prop; the pieces it composes are `CameraBar`, `QuestionBar` and `ScaleLine`.
 */

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { ScaleLine, type MapCap } from './ScaleLine';
import type { KnowledgeGraphLabels } from '../labels';
import type { LensDef } from '../lenses';
import { cssVar } from '../scene/themeColors';
import { muted } from '../styles';
import type { LensId, ViewMode } from '../types';
import { CameraBar } from './CameraBar';
import { QuestionBar } from './QuestionBar';
import type { QuestionId } from './questions';
import type { CameraDef } from './registry';
import type { Station } from './stations';
import { Card } from './ui';

export interface SceneOverlayProps {
    labels: KnowledgeGraphLabels;
    // The View group and its right-hand buttons.
    cameras: readonly CameraDef[];
    mode: ViewMode;
    onMode(mode: ViewMode): void;
    // The question row.
    stations: readonly Station[];
    question: QuestionId;
    onQuestion(id: QuestionId): void;
    /** The lenses available now: those without a question appear in the More menu. */
    lenses?: readonly LensDef[] | undefined;
    lens?: LensId | undefined;
    onLens?: ((id: LensId) => void) | undefined;
    /** `surface.family` / `surface.setFamily(null)`. */
    family?: string | null | undefined;
    onClearFamily?: (() => void) | undefined;
    // The scale note.
    stats: { nodes: number; edges: number; sources: number };
    truncated: boolean;
    compact: boolean;
    showAll: boolean;
    drawn: number;
    total: number;
    onShowAll(): void;
    /** The map shows only part of the files (`surface.stations.capped`, or the cut graph's own count). */
    capped?: MapCap | undefined;
    /** A phone: stack in flow above the scene instead of floating over it. */
    narrow?: boolean | undefined;
    /** The compare bar (the commit scrubber) under the toolbar; absent ⇒ not shown. */
    time?: ReactNode;
    /** The ONE 3D / Flat switch (PRD 43 C4), shown beside the View group when `onFlat` is given. */
    flat?: boolean | undefined;
    onFlat?: ((flat: boolean) => void) | undefined;
}

/** The CSS variable the scene's top edge reads: the measured height of the controls block, set on the overlay's parent (the scene's box). */
export const SCENE_TOP_VAR = '--kg-scene-top';

/**
 * Publishes the controls block's height as `--kg-scene-top` on the overlay's parent, so the scene starts BELOW the
 * floating controls in every camera. A ResizeObserver keeps it right as the bars change (a chip is
 * added); where there is none, or the box has no height yet, the variable is left unset and the scene falls back to
 * its default. `on` false (a phone stacks the controls in flow) publishes nothing.
 */
function useSceneTop(root: RefObject<HTMLElement | null>, controls: RefObject<HTMLElement | null>, on: boolean) {
    useLayoutEffect(() => {
        const host = root.current?.parentElement, block = controls.current;
        if (!on || !host || !block) return undefined;
        const publish = () => {
            const h = Math.ceil(block.getBoundingClientRect().height);
            if (h > 0) host.style.setProperty(SCENE_TOP_VAR, `${h}px`); else host.style.removeProperty(SCENE_TOP_VAR);
        };
        publish();
        const watch = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(publish);
        watch?.observe(block);
        return () => { watch?.disconnect(); host.style.removeProperty(SCENE_TOP_VAR); };
    }, [root, controls, on]);
}

export function SceneOverlay(p: SceneOverlayProps) {
    const { labels, narrow = false } = p;
    const t = labels.surface.overlay;
    const rootRef = useRef<HTMLDivElement>(null);
    const controls = useRef<HTMLDivElement>(null);
    useSceneTop(rootRef, controls, !narrow);
    const root: CSSProperties = narrow
        ? { position: 'relative', display: 'grid', gap: 0 }
        : { position: 'absolute', inset: 0, zIndex: 2, display: 'flex', flexDirection: 'column', pointerEvents: 'none', padding: '0 0 10px', minHeight: 0 };

    return (
        <div ref={rootRef} role="group" aria-label={t.controls} data-testid="kg-scene-overlay" style={root}>
            {/* The controls block: what the scene must sit below. Its height is measured, never assumed. */}
            <div ref={controls} data-testid="kg-scene-controls" style={{ display: 'grid', gap: 0, minWidth: 0 }}>
            <div
                data-testid="kg-camera-row"
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '6px 10px', minWidth: 0, pointerEvents: 'auto', borderBottom: `1px solid ${cssVar('border')}`, background: cssVar('panel') }}
            >
                <CameraBar labels={labels} cameras={p.cameras} mode={p.mode} onMode={p.onMode} flat={p.flat} onFlat={p.onFlat} />
                <span aria-hidden="true" style={{ flex: 1 }} />
                <QuestionBar
                    labels={labels} stations={p.stations} question={p.question} onQuestion={p.onQuestion} lenses={p.lenses} lens={p.lens} onLens={p.onLens}
                    family={p.family} onClearFamily={p.onClearFamily}
                />
            </div>
            {p.time && <div style={{ pointerEvents: 'auto', minWidth: 0 }}>{p.time}</div>}
            </div>
            <div style={{ flex: 1, minHeight: 0 }} />
            <div style={{ padding: '0 12px', ...(narrow ? null : { pointerEvents: 'none' }) }}>
                <Card style={{ display: 'inline-block', maxWidth: narrow ? '100%' : 360, padding: '6px 10px', ...muted, pointerEvents: 'auto', background: cssVar('panel') }}>
                    <span data-testid="kg-scale-note">
                        <ScaleLine
                            labels={labels} stats={p.stats} truncated={p.truncated} compact={p.compact} showAll={p.showAll} drawn={p.drawn} total={p.total} onShowAll={p.onShowAll} capped={p.capped}
                            stations={p.stations.length} files={p.stats.sources}
                        />
                    </span>
                </Card>
            </div>
        </div>
    );
}
