/**
 * The pinpoint input of the ask bar (PRD 38, Option B+): paste a screenshot, drop one on the
 * bar, or pick a file. The host reads the image and returns the code behind it; the view
 * focuses the matched refs, opens the path strip on them and asks "What is wrong on this
 * path?". Every match shows where it came from (vision, exact string, catalog key, import).
 * *Diagnose with the agent* puts the description, the matched path and its findings in the ONE
 * composer. Renders its children alone when the source cannot pinpoint.
 */

import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { findingRequest } from '../findingText';
import { labelFor, nodeIndex } from '../graphModel';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import { card, muted, primaryButton, quietButton } from '../styles';
import { TYPE } from './ui/type';
import type { KnowledgeGraphSource, PinpointResult } from '../types';
import { getComputeClient } from '../compute/sharedClient';
import { scopeFindings } from './scope';
import { stationOfRef, type StationModel } from './stations';
import { MAX_IMAGE_BYTES, usePinpoint } from './usePinpoint';

const TONE: Record<PinpointResult['matches'][number]['provenance'] | 'vision', ThemeTone> = { vision: 'accent', exact: 'agrees', catalog: 'agrees', import: 'cycle' };

export interface PinpointInputProps {
    source: KnowledgeGraphSource;
    rootId: string | null;
    graph: KnowledgeGraph;
    stations: StationModel;
    labels: KnowledgeGraphLabels;
    /** The matched refs, once the host answered: the root focuses them, pins the path and asks "wrong". */
    onMatches(refs: string[]): void;
    /** Clear was pressed: release the focus and the pinned path the matches set. */
    onClear?: (() => void) | undefined;
    onSelect(ref: string): void;
    onCompose?: ((text: string) => void) | undefined;
    /**
     * The ask bar's own controls, which this wraps so a paste or a drop anywhere on the bar is caught.
     * A function receives the screenshot button to place INSIDE the bar (null when the source cannot
     * pinpoint); plain children get the button as a sibling.
     */
    children: ReactNode | ((picker: ReactNode) => ReactNode);
}

function Badge({ tone, text }: { tone: ThemeTone; text: string }) {
    return <span style={{ ...TYPE.tag, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap', border: `1px solid ${cssVar(tone)}`, color: cssVar(tone) }}>{text}</span>;
}

/** A drag carries files (not text or a link), so only then does the bar show its drop state. */
const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export function PinpointInput({ source, rootId, graph, stations, labels, onMatches, onClear, onSelect, onCompose, children }: PinpointInputProps) {
    const t = labels.surface.pinpoint;
    const files = useRef<HTMLInputElement>(null);
    const [over, setOver] = useState(false);
    const { state, run, clear } = usePinpoint(source, rootId, (refs) => onMatches(refs));
    const index = useMemo(() => nodeIndex(graph), [graph]);
    if (!source.pinpoint) return <>{typeof children === 'function' ? children(null) : children}</>;

    const image = (list: FileList | null | undefined): File | undefined => (list ? [...list].find((f) => f.type.startsWith('image/')) : undefined);
    const onPaste = (e: ClipboardEvent) => {
        const file = image(e.clipboardData?.files);
        if (file) { e.preventDefault(); run(file); }
    };
    const onDrop = (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        const dropped = e.dataTransfer?.files;
        const file = image(dropped) ?? dropped?.[0];
        if (file) run(file);
    };
    const diagnose = async (result: PinpointResult) => {
        const refs = result.matches.map((m) => m.ref);
        // The path scans every outline link per hop: the compute worker builds it.
        let path = '';
        try { path = (await getComputeClient().once('path', { graph, refs, stations })).stops.map((s) => s.name).join(' → '); } catch { /* diagnose without a path */ }
        const onPath = new Set(refs.flatMap((r) => stationOfRef(stations, r) ?? []));
        const findings = scopeFindings(graph.findings, stations, onPath).map((f) => findingRequest(f, labels, index)).join(' ');
        onCompose?.(fillTemplate(t.diagnoseText, { description: result.description, path: path || t.noFindings, findings: findings || t.noFindings }));
    };

    // The picker: a quiet icon button that sits inside the ask bar's right edge.
    const picker = (
        <>
            <input
                ref={files} type="file" accept="image/*" tabIndex={-1} aria-hidden="true" data-testid="kg-pinpoint-file" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }}
            />
            <button
                type="button" data-testid="kg-pinpoint-button" title={t.hint} aria-label={t.button} onClick={() => files.current?.click()}
                style={{ flex: 'none', width: 28, height: 28, padding: 0, border: 0, borderRadius: 7, background: 'transparent', color: cssVar('muted'), cursor: 'pointer', display: 'grid', placeItems: 'center' }}
            >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }}>
                    <path d="M2 5.5h2.2L5.4 3.5h5.2l1.2 2H14v7H2z" /><circle cx="8" cy="8.6" r="2.2" />
                </svg>
            </button>
        </>
    );
    return (
        <div
            data-testid="kg-pinpoint" onPaste={onPaste} onDrop={onDrop}
            onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); setOver(true); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
            // The result card floats under the bar, so a pinpoint never grows the 56px header row.
            style={{ position: 'relative', flex: '1 1 180px', minWidth: 0, display: 'flex', borderRadius: 10, outline: over ? `2px dashed ${cssVar('accent')}` : 'none', outlineOffset: 2 }}
        >
            {typeof children === 'function' ? children(picker) : <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, flex: 1 }}>{children}{picker}</div>}
            {over && <p style={{ ...muted, margin: 0, position: 'absolute', top: '100%', left: 0, zIndex: 5 }}>{t.dropHere}</p>}
            {state.status !== 'idle' && (
                <section
                    aria-label={t.label} aria-live="polite" data-status={state.status}
                    style={{ ...card, display: 'grid', gap: 8, position: 'absolute', top: '100%', insetInline: 0, marginTop: 6, zIndex: 5, maxHeight: '60vh', overflow: 'auto', background: cssVar('bg'), boxShadow: '0 8px 28px color-mix(in srgb, currentColor 18%, transparent)' }}
                >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        {'thumb' in state && state.thumb && <img src={state.thumb} alt={t.thumbAlt} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: `1px solid ${cssVar('border')}` }} />}
                        <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
                            {state.status === 'reading' && <p style={{ ...muted, margin: 0 }}>{t.reading}</p>}
                            {state.status === 'failed' && <p role="alert" style={{ margin: 0 }}>{t.failed}</p>}
                            {state.status === 'invalid' && <p role="alert" style={{ margin: 0 }}>{state.reason === 'size' ? fillTemplate(labels.surface.imageTooLarge, { size: MAX_IMAGE_BYTES / (1024 * 1024) }) : t.notImage}</p>}
                            {state.status === 'done' && (
                                <>
                                    <h3 style={TYPE.sectionHeading}>{t.descriptionTitle}</h3>
                                    <p style={{ margin: 0, ...TYPE.bodyLarge }}>{state.result.description}</p>
                                </>
                            )}
                        </div>
                        <button type="button" style={{ ...quietButton, minHeight: 32 }} aria-label={t.clearAria} onClick={() => { clear(); onClear?.(); }}>{t.clear}</button>
                    </div>
                    {state.status === 'done' && (
                        <>
                            {state.result.anchors.length > 0 && (
                                <div style={{ display: 'grid', gap: 4 }}>
                                    <h3 style={TYPE.sectionHeading}>{t.anchorsTitle}</h3>
                                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {state.result.anchors.map((a) => (
                                            <li key={a.text} style={{ display: 'flex', gap: 4, alignItems: 'center', ...TYPE.body }}>
                                                <q>{a.text}</q><Badge tone={TONE.vision} text={labels.surface.pinpointProvenance.vision} />
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {state.result.matches.length === 0 ? <p style={{ ...muted, margin: 0 }}>{t.noMatch}</p> : (
                                <div style={{ display: 'grid', gap: 4 }}>
                                    <h3 style={TYPE.sectionHeading}>{t.matchesTitle}</h3>
                                    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
                                        {state.result.matches.map((m) => (
                                            <li key={m.ref} data-match={m.ref} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                                <button type="button" style={{ ...quietButton, minHeight: 32, padding: '0 8px' }} onClick={() => onSelect(m.ref)}>{labelFor(index, m.ref)}</button>
                                                <Badge tone={TONE[m.provenance]} text={labels.surface.pinpointProvenance[m.provenance]} />
                                                <span style={muted}>{m.why}</span>
                                            </li>
                                        ))}
                                    </ol>
                                    <div><button type="button" style={primaryButton} disabled={!onCompose} onClick={() => diagnose(state.result)}>{t.diagnose}</button></div>
                                </div>
                            )}
                        </>
                    )}
                </section>
            )}
        </div>
    );
}
