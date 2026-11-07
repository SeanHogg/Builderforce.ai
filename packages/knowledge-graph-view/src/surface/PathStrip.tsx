/**
 * The path strip (150px under the scene on desktop, a vertical list on a phone): the title of
 * the line and where it enters, Reset / Step / Run to end, *Simulate with values* (opens the
 * Simulate drawer), a Sequence toggle that swaps the stop chips for the sequence diagram, and
 * *Copy as Mermaid*. Each stop is a mono chip with a note from its metrics ("no tests · god");
 * between two stops the hop says its edge kind and count (and what travels over it, when the
 * edge carries it), in the violation colour where it skips or climbs a layer.
 */

import { useState } from 'react';
import { CopiedNote, CopyFallback, useCopyText } from '../copyText';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { CONTROL, muted } from '../styles';
import { Pill, pillStyle, QuietButton } from './ui';
import { TYPE } from './ui/type';
import { Action, StepControls } from './StepControls';
import type { PathModel } from './path';
import { stationNote } from './pathNotes';
import { SequenceView } from './SequenceDiagram';
import { hopText, pathMermaid } from './sequenceText';
import type { Station } from './stations';

/** The strip's fixed height on desktop. */
export const PATH_STRIP_HEIGHT = 150;

export interface PathStripProps {
    path: PathModel;
    step: number;
    labels: KnowledgeGraphLabels;
    onStep(n: number): void;
    /** The strip's title ("Web line · GET /users"), made by the root; absent ⇒ "Path". */
    pathTitle?: string | null | undefined;
    /** Switches the scene to the full-size Sequence camera; the Enlarge control shows only while the Sequence toggle is on. */
    onEnlarge?: (() => void) | undefined;
    /** The stations by id, for each stop's note. Absent ⇒ no notes. */
    stations?: ReadonlyMap<string, Station> | undefined;
    /** Opens a drawer by PANELS id; *Simulate with values* is offered only with it. */
    onOpenPanel?: ((id: string) => void) | undefined;
    /** The route label per hop ("PUT 1.4 MB"), indexed like `path.hops`; from `hopRouteLabels`. A null or absent entry draws nothing. */
    routeLabels?: readonly (string | null)[] | undefined;
    /** A phone: the stops are a vertical list instead of a row. */
    narrow?: boolean | undefined;
}

const chipStyle = (on: boolean) => ({ ...pillStyle(on), ...TYPE.mono, fontWeight: on ? TYPE.pillOn.fontWeight : TYPE.monoName.fontWeight });

export function PathStrip({ path, step, labels, onStep, pathTitle, onEnlarge, stations, onOpenPanel, routeLabels, narrow = false }: PathStripProps) {
    const s = labels.surface;
    const [sequence, setSequence] = useState(false);
    const copier = useCopyText();
    const last = path.stops.length - 1;
    // One station has nothing to step through and no sequence to draw.
    const single = path.stops.length === 1;
    const at = Math.min(Math.max(step, 0), Math.max(last, 0));
    const title = pathTitle || s.pathTitle;
    const mermaid = pathMermaid(path, labels);
    const ctl = { height: `calc(${CONTROL} - 4px)`, padding: '0 10px', fontWeight: 600 } as const;

    return (
        <section
            aria-label={s.pathTitle} data-testid="kg-path"
            style={{
                display: 'grid', gap: 6, padding: '8px 12px', borderTop: `1px solid ${cssVar('border')}`, background: cssVar('bg'),
                alignContent: 'start', minWidth: 0, ...(narrow ? null : { height: PATH_STRIP_HEIGHT, flex: 'none', overflow: 'auto' }),
            }}
        >
            {path.stops.length === 0 ? <p style={{ ...muted, margin: 0 }}>{s.pathEmpty}</p> : (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <strong style={{ ...TYPE.subtitle, marginInlineEnd: 4, overflowWrap: 'anywhere' }}>{title}</strong>
                        <StepControls at={at} last={last} labels={labels} onStep={onStep} />
                        {onOpenPanel && <Action onClick={() => onOpenPanel('simulate')}>{s.path.simulate}</Action>}
                        <Pill style={ctl} on={sequence && !single} disabled={single} onClick={() => setSequence((v) => !v)}>{s.path.sequence}</Pill>
                        {sequence && !single && onEnlarge && <Action onClick={onEnlarge}>{s.path.enlarge}</Action>}
                        <QuietButton onClick={() => void copier.copy(mermaid)}>{labels.copyMermaid}</QuietButton>
                        <CopiedNote status={copier.status} labels={labels} />
                        <span aria-live="polite" style={{ ...muted, ...TYPE.monoValue }}>{fillTemplate(s.pathStep, { n: at + 1, total: path.stops.length })}</span>
                    </div>
                    {single && <p data-testid="kg-path-one-station" style={{ ...muted, margin: 0 }}>{s.explain.oneStation}</p>}
                    <CopyFallback status={copier.status} text={mermaid} label={labels.copyMermaid} labels={labels} />
                    {sequence && !single ? <SequenceView path={path} step={at} onStep={onStep} labels={labels} copy={false} /> : (
                        <ol
                            aria-label={s.path.stops}
                            style={{
                                listStyle: 'none', margin: 0, padding: '0 0 2px', display: 'flex', gap: narrow ? 4 : 6, minWidth: 0,
                                ...(narrow ? { flexDirection: 'column', alignItems: 'stretch' } : { alignItems: 'flex-start', overflowX: 'auto' }),
                            }}
                        >
                            {path.stops.map((stop, i) => {
                                const hop = i > 0 ? path.hops[i - 1] : undefined;
                                const bad = hop?.verdict === 'skips' || hop?.verdict === 'upward';
                                const note = stationNote(stations?.get(stop.id), labels);
                                return (
                                    <li key={stop.id} style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'flex-start' : 'center', gap: 6, flex: 'none' }}>
                                        {hop && (
                                            <span style={{ ...TYPE.monoMeta, color: cssVar(bad ? 'violation' : 'muted') }} data-hop={hop.verdict ?? 'ok'} data-cycle={hop.cycle || undefined}>
                                                {narrow ? '↓ ' : ''}{hop.cycle && <span aria-hidden="true" data-cycle-mark>⟲ </span>}{hopText(labels, hop)}
                                                {hop.detail ? ` · ${hop.detail}` : ''}
                                                {routeLabels?.[i - 1] ? <span data-route={routeLabels[i - 1]}>{` · ${routeLabels[i - 1]}`}</span> : null}
                                                {hop.verdict === 'skips' ? ` · ${labels.traceSkips}` : hop.verdict === 'upward' ? ` · ${labels.traceUpward}` : ''}
                                            </span>
                                        )}
                                        <span style={{ display: 'grid', gap: 2, justifyItems: narrow ? 'start' : 'center' }}>
                                            <button type="button" aria-current={i === at ? 'step' : undefined} style={chipStyle(i === at)} title={stations?.get(stop.id)?.path} onClick={() => onStep(i)}>{stop.name}</button>
                                            {note && <span data-stop-note={stop.id} style={TYPE.monoMeta}>{note}</span>}
                                        </span>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </>
            )}
        </section>
    );
}
