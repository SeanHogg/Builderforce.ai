/**
 * The controls that float over the scene (mockup B-Surface): the error banner at the top, the
 * *View* group with "↑ Out to …", + , − and Fit, the question pills with the *More questions*
 * menu and the "{family} only ✕" chip, and the scale note in the bottom-left corner. The overlay
 * takes the scene's whole box but lets pointer events through: only its controls take them.
 *
 * `narrow` (a phone) stops floating: the same parts stack in flow ABOVE the scene, the View and
 * question rows become horizontal scrollers, and the scale note follows them.
 *
 * Pure presentation. Every datum comes in by prop; the pieces it composes are `CameraBar`
 * (View + zoom), `QuestionBar` and `ScaleLine`.
 */

import type { CSSProperties } from 'react';
import { ScaleLine } from './ScaleLine';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import type { LensDef } from '../lenses';
import { cssVar } from '../scene/themeColors';
import { CONTROL, muted } from '../styles';
import type { LensId, SyncStatus, ViewMode } from '../types';
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
    // The error banner: files the server does not have. Absent or 0 ⇒ no banner.
    missingFiles?: number | null | undefined;
    /** Opens the Sync drawer (`surface.openPanel('sync')`). */
    onDiagnose?: (() => void) | undefined;
    /** A phone: stack in flow above the scene instead of floating over it. */
    narrow?: boolean | undefined;
}

/** How many files the server lacks, from a sync status: the skipped/rejected list when the host recorded one, else the count gap. */
export function missingFilesOf(status: SyncStatus | null | undefined): number {
    if (!status) return 0;
    if (status.skipped !== undefined && status.skipped.length > 0) return status.skipped.length;
    return status.server ? Math.max(0, status.local.files - status.server.files) : 0;
}

const banner: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 12px', borderRadius: 10, fontSize: 12, pointerEvents: 'auto',
    border: `1px solid ${cssVar('cycle')}`, background: cssVar('warnBg'), color: cssVar('text'),
};

export function SceneOverlay(p: SceneOverlayProps) {
    const { labels, narrow = false } = p;
    const t = labels.surface.overlay;
    const missing = p.missingFiles ?? 0;
    const root: CSSProperties = narrow
        ? { display: 'grid', gap: 6, padding: '4px 0' }
        : { position: 'absolute', inset: 0, zIndex: 2, display: 'flex', flexDirection: 'column', pointerEvents: 'none', padding: '0 0 10px', minHeight: 0 };

    return (
        <div role="group" aria-label={t.controls} data-testid="kg-scene-overlay" style={root}>
            {missing > 0 && (
                <div role="alert" data-testid="kg-sync-banner" style={{ ...banner, margin: narrow ? 0 : '10px 12px 0' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{fillTemplate(t.missingFiles, { count: missing })}</span>
                    {p.onDiagnose && (
                        <button
                            type="button"
                            style={{ height: CONTROL, padding: '0 12px', borderRadius: 8, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 600, border: `1px solid ${cssVar('border')}`, background: cssVar('panel'), color: cssVar('text') }}
                            onClick={p.onDiagnose}
                        >
                            {t.diagnose}
                        </button>
                    )}
                </div>
            )}
            <CameraBar
                labels={labels} cameras={p.cameras} mode={p.mode} onMode={p.onMode} zoom={p.zoom} outTo={p.outTo} onOut={p.onOut} scroll={narrow}
            />
            <div style={{ padding: '0 12px', pointerEvents: 'none', minWidth: 0 }}>
                <div style={{ pointerEvents: 'auto', width: narrow ? '100%' : 'fit-content', maxWidth: '100%' }}>
                    <QuestionBar
                        labels={labels} stations={p.stations} question={p.question} onQuestion={p.onQuestion} lenses={p.lenses} lens={p.lens} onLens={p.onLens}
                        family={p.family} onClearFamily={p.onClearFamily} scroll={narrow}
                    />
                </div>
            </div>
            <div style={{ flex: 1, minHeight: 0 }} />
            <div style={{ padding: '0 12px', ...(narrow ? null : { pointerEvents: 'none' }) }}>
                <Card style={{ display: 'inline-block', maxWidth: narrow ? '100%' : 360, padding: '6px 10px', ...muted, pointerEvents: 'auto', background: cssVar('panel') }}>
                    <span data-testid="kg-scale-note">
                        <ScaleLine
                            labels={labels} stats={p.stats} truncated={p.truncated} compact={p.compact} showAll={p.showAll} drawn={p.drawn} total={p.total} onShowAll={p.onShowAll}
                        />
                    </span>
                </Card>
            </div>
        </div>
    );
}
