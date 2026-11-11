/**
 * The controls that float over the scene (mockup B-Surface): the
 * *View* group with "↑ Out to …", + , − and Fit, the question pills with the *More questions*
 * menu and the "{family} only ✕" chip, and the scale note in the bottom-left corner. The overlay
 * takes the scene's whole box but lets pointer events through: only its controls take them.
 *
 * `narrow` (a phone) stops floating: the same parts stack in flow ABOVE the scene, the View and
 * question rows become horizontal scrollers, and the scale note follows them.
 *
 * Three slots come from the root: `tools` (Panels + Risk overlays, right after the View group), `panelToggles`
 * (the show/hide glyphs before the zoom buttons) and `time` (the commit scrubber, at the end of the question row).
 *
 * Pure presentation. Every datum comes in by prop; the pieces it composes are `CameraBar`
 * (View + zoom), `QuestionBar` and `ScaleLine`.
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
import type { ZoomApi } from './zoom';

export interface SceneOverlayProps {
    labels: KnowledgeGraphLabels;
    // The View group and its right-hand buttons.
    cameras: readonly CameraDef[];
    mode: ViewMode;
    onMode(mode: ViewMode): void;
    /** The active camera's api from `useZoomHost().api`; null disables +, − and Fit. */
    zoom: ZoomApi | null;
    /** The level above the open station or drill ("the line"); null ⇒ no "↑ Out to" button. */
    outTo?: string | null | undefined;
    onOut?: (() => void) | undefined;
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
    /** The canvas tools (Panels, Risk overlays): `CameraBar` puts them right after the View group. */
    tools?: ReactNode;
    /** The panel show/hide toggles, in the camera bar's right cluster. */
    panelToggles?: ReactNode;
    /** The Legend button, beside the panel toggles. */
    legend?: ReactNode;
    /** The commit scrubber, at the trailing end of the question row. */
    time?: ReactNode;
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
        ? { position: 'relative', display: 'grid', gap: 6, padding: '4px 0' }
        : { position: 'absolute', inset: 0, zIndex: 2, display: 'flex', flexDirection: 'column', pointerEvents: 'none', padding: '0 0 10px', minHeight: 0 };

    return (
        <div ref={rootRef} role="group" aria-label={t.controls} data-testid="kg-scene-overlay" style={root}>
            {/* The controls block: what the scene must sit below. Its height is measured, never assumed. */}
            <div ref={controls} data-testid="kg-scene-controls" style={{ display: 'grid', gap: narrow ? 6 : 0, minWidth: 0 }}>
            <CameraBar
                labels={labels} cameras={p.cameras} mode={p.mode} onMode={p.onMode} zoom={p.zoom} outTo={p.outTo} onOut={p.onOut}
                tools={p.tools} stacked={narrow} panelToggles={p.panelToggles} legend={p.legend}
            />
            <div style={{ padding: '0 12px 8px', pointerEvents: 'none', minWidth: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: narrow ? 'nowrap' : 'wrap' }}>
                <div style={{ pointerEvents: 'auto', width: narrow ? '100%' : 'fit-content', maxWidth: '100%' }}>
                    <QuestionBar
                        labels={labels} stations={p.stations} question={p.question} onQuestion={p.onQuestion} lenses={p.lenses} lens={p.lens} onLens={p.onLens}
                        family={p.family} onClearFamily={p.onClearFamily}
                    />
                </div>
                {p.time && <div style={{ pointerEvents: 'auto', flex: 'none', maxWidth: '100%', overflowX: narrow ? 'auto' : 'visible' }}>{p.time}</div>}
            </div>
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
