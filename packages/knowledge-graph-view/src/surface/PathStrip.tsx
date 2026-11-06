/**
 * The path strip (150px under the scene on desktop, a vertical list on a phone): the title of
 * the line and where it enters, Reset / Step / Run to end, *Simulate with values* (opens the
 * Simulate drawer), a Sequence toggle that swaps the stop chips for the sequence diagram, and
 * *Copy as Mermaid*. Each stop is a mono chip with a note from its metrics ("no tests · god");
 * between two stops the hop says its edge kind and count (and what travels over it, when the
 * edge carries it), in the violation colour where it skips or climbs a layer.
 */

import { useState, type ReactNode } from 'react';
import { CopiedNote, CopyFallback, useCopyText } from '../copyText';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { edgeKindLabel } from '../names';
import { cssVar } from '../scene/themeColors';
import { CONTROL, MONO, muted } from '../styles';
import { Pill, pillStyle, QuietButton } from './ui';
import type { PathModel } from './path';
import { stationNote } from './pathNotes';
import { SequenceView } from './SequenceDiagram';
import { pathMermaid } from './sequenceText';
import type { Station } from './stations';

/** The strip's fixed height on desktop. */
export const PATH_STRIP_HEIGHT = 150;

export interface PathStripProps {
    path: PathModel;
    step: number;
    labels: KnowledgeGraphLabels;
    onStep(n: number): void;
    /** The line's name; absent ⇒ the title is just "Path". */
    lineName?: string | null | undefined;
    /** Where the line enters (its first route, else the entry station): `entryLabel(graph, station)`. */
    entry?: string | null | undefined;
    /** The stations by id, for each stop's note. Absent ⇒ no notes. */
    stations?: ReadonlyMap<string, Station> | undefined;
    /** Opens a drawer by PANELS id; *Simulate with values* is offered only with it. */
    onOpenPanel?: ((id: string) => void) | undefined;
    /** A phone: the stops are a vertical list instead of a row. */
    narrow?: boolean | undefined;
}

const chipStyle = (on: boolean) => ({ ...pillStyle(on), fontFamily: MONO, fontSize: 11.5 });

const actionStyle = { ...pillStyle(false), height: `calc(${CONTROL} - 4px)`, padding: '0 10px', fontWeight: 600 } as const;

/** A one-shot strip control (Reset, Step, Run to end): a pill that is not a toggle. */
function Action({ disabled, children, ...rest }: { disabled?: boolean; children: ReactNode; onClick(): void; 'aria-label'?: string; title?: string }) {
    return <button type="button" disabled={disabled} {...rest} style={{ ...actionStyle, ...(disabled ? { opacity: 0.5, cursor: 'default' } : null) }}>{children}</button>;
}

export function PathStrip({ path, step, labels, onStep, lineName, entry, stations, onOpenPanel, narrow = false }: PathStripProps) {
    const s = labels.surface;
    const [sequence, setSequence] = useState(false);
    const copier = useCopyText();
    const last = path.stops.length - 1;
    const at = Math.min(Math.max(step, 0), Math.max(last, 0));
    const title = lineName ? fillTemplate(s.path.title, { line: fillTemplate(s.lineName, { name: lineName }), entry: entry ?? path.stops[0]?.name ?? '' }) : s.pathTitle;
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
                        <strong style={{ fontSize: 12, fontFamily: MONO, marginInlineEnd: 4, overflowWrap: 'anywhere' }}>{title}</strong>
                        <Action onClick={() => onStep(0)}>{s.path.reset}</Action>
                        <Action disabled={at <= 0} aria-label={s.pathBack} title={s.pathBack} onClick={() => onStep(at - 1)}><span aria-hidden="true">◀ </span>{s.path.step}</Action>
                        <Action disabled={at >= last} aria-label={s.pathNext} title={s.pathNext} onClick={() => onStep(at + 1)}>{s.path.step}<span aria-hidden="true"> ▶</span></Action>
                        <Action disabled={at >= last} onClick={() => onStep(last)}>{s.path.runToEnd}</Action>
                        {onOpenPanel && <Action onClick={() => onOpenPanel('simulate')}>{s.path.simulate}</Action>}
                        <Pill style={ctl} on={sequence} onClick={() => setSequence((v) => !v)}>{s.path.sequence}</Pill>
                        <QuietButton onClick={() => void copier.copy(mermaid)}>{labels.copyMermaid}</QuietButton>
                        <CopiedNote status={copier.status} labels={labels} />
                        <span aria-live="polite" style={{ ...muted, fontFamily: MONO }}>{fillTemplate(s.pathStep, { n: at + 1, total: path.stops.length })}</span>
                    </div>
                    <CopyFallback status={copier.status} text={mermaid} label={labels.copyMermaid} labels={labels} />
                    {sequence ? <SequenceView path={path} step={at} onStep={onStep} labels={labels} copy={false} /> : (
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
                                            <span style={{ ...muted, fontFamily: MONO, fontSize: 11, color: cssVar(bad ? 'violation' : 'muted') }} data-hop={hop.verdict ?? 'ok'}>
                                                {narrow ? '↓ ' : ''}{fillTemplate(s.pathHop, { kind: edgeKindLabel(labels, hop.kind), count: hop.count })}
                                                {hop.detail ? ` · ${hop.detail}` : ''}
                                                {hop.verdict === 'skips' ? ` · ${labels.traceSkips}` : hop.verdict === 'upward' ? ` · ${labels.traceUpward}` : ''}
                                            </span>
                                        )}
                                        <span style={{ display: 'grid', gap: 2, justifyItems: narrow ? 'start' : 'center' }}>
                                            <button type="button" aria-current={i === at ? 'step' : undefined} style={chipStyle(i === at)} onClick={() => onStep(i)}>{stop.name}</button>
                                            {note && <span data-stop-note={stop.id} style={{ ...muted, fontFamily: MONO, fontSize: 10.5 }}>{note}</span>}
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
