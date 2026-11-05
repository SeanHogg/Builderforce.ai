/**
 * The left panel: the lines that run from the entry points, the stations on the selected
 * line, and a live legend of what the overlay channels currently show. A channel whose data
 * is not set up says so here instead of drawing a neutral mark with no explanation.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { button, chip, heading, list, muted } from '../styles';
import type { LinesModel } from './lines';
import { CHANNELS, lineTone, type OverlayModel } from './overlays';
import type { Station, StationModel } from './stations';

export interface LinesPanelProps {
    lines: LinesModel;
    stations: StationModel;
    overlay: OverlayModel;
    labels: KnowledgeGraphLabels;
    /** The line whose stations are listed. */
    lineId: string | null;
    selectedStation: string | null;
    onSelectLine(id: string): void;
    onSelectStation(id: string): void;
}

export function LinesPanel({ lines, stations, overlay, labels, lineId, selectedStation, onSelectLine, onSelectStation }: LinesPanelProps) {
    const s = labels.surface;
    const line = lines.lines.find((l) => l.id === lineId) ?? null;
    const layerName = (st: Station) => s.layers[(st.layer ?? 'other') as keyof typeof s.layers] ?? s.layers.other;
    return (
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
            <section aria-label={s.linesTitle} style={{ display: 'grid', gap: 6 }}>
                <h3 style={heading}>{s.linesTitle}</h3>
                {lines.lines.length === 0 ? <p style={muted}>{s.linesEmpty}</p> : (
                    <ul style={list}>
                        {lines.lines.map((l) => (
                            <li key={l.id}>
                                <button
                                    type="button" aria-pressed={l.id === lineId} data-line={l.id} onClick={() => onSelectLine(l.id)}
                                    style={{ ...chip(l.id === lineId), width: '100%', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start', textAlign: 'start' }}
                                >
                                    <span aria-hidden="true" style={{ width: 18, height: 6, borderRadius: 3, flex: 'none', background: cssVar(lineTone(l.colourIndex)) }} />
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{fillTemplate(s.lineName, { name: l.name })}</span>
                                    <span style={muted}>{fillTemplate(s.lineStops, { count: l.stops.length })}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {lines.omitted > 0 && <p style={{ ...muted, margin: 0 }}>{fillTemplate(s.omittedLines, { count: lines.omitted })}</p>}
            </section>

            <section aria-label={line ? fillTemplate(s.stationsOn, { name: line.name }) : s.stationsPick} style={{ display: 'grid', gap: 6 }}>
                <h3 style={heading}>{line ? fillTemplate(s.stationsOn, { name: line.name }) : s.stationsPick}</h3>
                {line && (
                    <ul style={list}>
                        {line.stops.flatMap((id) => stations.byId.get(id) ?? []).map((st) => (
                            <li key={st.id}>
                                <button
                                    type="button" aria-pressed={st.id === selectedStation} data-station-row={st.id} onClick={() => onSelectStation(st.id)}
                                    style={{ ...button, width: '100%', display: 'grid', gap: 2, justifyItems: 'start', textAlign: 'start', borderRadius: 10, padding: '6px 12px', borderColor: st.id === selectedStation ? cssVar('accent') : cssVar('border') }}
                                >
                                    <span>
                                        {st.name}
                                        {lines.interchanges.has(st.id) && <span style={{ ...muted, marginInlineStart: 6 }}>{fillTemplate(s.interchange, { count: lines.interchanges.get(st.id)!.length })}</span>}
                                    </span>
                                    <span style={{ ...muted, fontWeight: 400 }}>{fillTemplate(s.stationMeta, { files: st.files, layer: layerName(st) })}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section aria-label={s.legendTitle} data-testid="kg-surface-legend" style={{ display: 'grid', gap: 4 }}>
                <h3 style={heading}>{s.legendTitle}</h3>
                <ul style={{ ...list, gap: 4 }}>
                    {CHANNELS.filter(({ id }) => overlay.status[id] !== 'off').map(({ id }) => (
                        <li key={id} data-channel={id} data-status={overlay.status[id]} style={{ fontSize: 12 }}>
                            {fillTemplate(s.legendRow, { channel: s.channels[id], metric: s.metricNames[overlay.bindings[id]] })}
                            {overlay.status[id] === 'not-set-up' && <span style={{ ...muted, marginInlineStart: 6 }}>· {s.notSetUp}</span>}
                        </li>
                    ))}
                    <li style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width={26} height={6} aria-hidden="true"><line x1={0} x2={26} y1={3} y2={3} stroke={cssVar('edge')} strokeWidth={3} strokeDasharray="6 4" /></svg>
                        {s.untestedSegment}
                    </li>
                </ul>
            </section>
        </div>
    );
}
