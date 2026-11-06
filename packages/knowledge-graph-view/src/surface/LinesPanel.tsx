/**
 * The left rail (250px, panel background, a border on the scene side): "Lines from the entry
 * points" with each line's route colour, name and stop count; the stops of the selected line in
 * mono with a layer-coloured dot; and, anchored to the bottom, the legend "Reading the picture
 * now" with a GLYPH per bound overlay channel. A channel whose data is not set up says so there
 * instead of drawing a neutral mark with no explanation.
 *
 * `rail` is the rail chrome (width, background, border). A root that wraps the panel in its own
 * box or a sheet (a phone) leaves it off.
 */

import type { CSSProperties } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { heading, layerColor, list, MONO, muted, swatch, type LayerId } from '../styles';
import { LegendGlyph } from './LegendGlyph';
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
    /** Draw the rail chrome: 250px wide, panel background, right border, fills the height. */
    rail?: boolean | undefined;
}

const LAYERS: ReadonlySet<string> = new Set(['entry', 'presentation', 'application', 'domain', 'infrastructure', 'data']);
const layerOf = (st: Station): LayerId => (st.layer && LAYERS.has(st.layer) ? (st.layer as LayerId) : 'other');

const row = (on: boolean): CSSProperties => ({
    width: '100%', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'start', cursor: 'pointer', font: 'inherit', fontSize: 12,
    minHeight: `calc(var(--kg-control, 40px) - 2px)`, padding: '0 8px', borderRadius: 8, color: cssVar('text'),
    border: `1px solid ${on ? cssVar('accent') : 'transparent'}`, background: on ? cssVar('accentSoft') : 'transparent',
});

export function LinesPanel({ lines, stations, overlay, labels, lineId, selectedStation, onSelectLine, onSelectStation, rail = false }: LinesPanelProps) {
    const s = labels.surface;
    const line = lines.lines.find((l) => l.id === lineId) ?? null;
    const layerName = (st: Station) => s.layers[(st.layer ?? 'other') as keyof typeof s.layers] ?? s.layers.other;
    const legend = CHANNELS.filter(({ id }) => overlay.status[id] !== 'off');
    const pins = overlay.bindings.pins === 'on';
    const owners = overlay.status.colour === 'ready' && overlay.bindings.colour === 'owner';

    return (
        <div
            data-testid="kg-lines-rail"
            style={{
                display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0, boxSizing: 'border-box',
                ...(rail ? { width: 250, flex: 'none', overflow: 'auto', padding: 12, background: cssVar('panel'), borderInlineEnd: `1px solid ${cssVar('border')}` } : null),
            }}
        >
            <section aria-label={s.linesTitle} style={{ display: 'grid', gap: 6 }}>
                <h3 style={{ ...heading, fontSize: 13 }}>{s.rail.heading}</h3>
                {lines.lines.length === 0 ? <p style={muted}>{s.linesEmpty}</p> : (
                    <ul style={{ ...list, gap: 2 }}>
                        {lines.lines.map((l) => (
                            <li key={l.id}>
                                <button type="button" aria-pressed={l.id === lineId} data-line={l.id} onClick={() => onSelectLine(l.id)} style={row(l.id === lineId)}>
                                    <span aria-hidden="true" style={{ width: 18, height: 6, borderRadius: 3, flex: 'none', background: cssVar(lineTone(l.colourIndex)) }} />
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: l.id === lineId ? 700 : 500 }}>
                                        {fillTemplate(s.lineName, { name: l.name })}
                                    </span>
                                    <span style={{ ...muted, fontFamily: MONO }}>{fillTemplate(s.lineStops, { count: l.stops.length })}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {lines.omitted > 0 && <p style={{ ...muted, margin: 0 }}>{fillTemplate(s.omittedLines, { count: lines.omitted })}</p>}
            </section>

            <section aria-label={line ? fillTemplate(s.stationsOn, { name: line.name }) : s.stationsPick} style={{ display: 'grid', gap: 6 }}>
                <h3 style={{ ...heading, fontSize: 12, color: cssVar('muted') }}>{line ? fillTemplate(s.stationsOn, { name: line.name }) : s.stationsPick}</h3>
                {line && (
                    <ul style={{ ...list, gap: 2 }}>
                        {line.stops.flatMap((id) => stations.byId.get(id) ?? []).map((st) => (
                            <li key={st.id}>
                                <button
                                    type="button" aria-pressed={st.id === selectedStation} data-station-row={st.id} title={fillTemplate(s.stationMeta, { files: st.files, layer: layerName(st) })}
                                    onClick={() => onSelectStation(st.id)} style={row(st.id === selectedStation)}
                                >
                                    <span aria-hidden="true" style={swatch(layerColor(layerOf(st)))} />
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: MONO, fontSize: 11.5 }}>
                                        {st.name}
                                        {lines.interchanges.has(st.id) && <span style={{ ...muted, marginInlineStart: 6 }}>{fillTemplate(s.interchange, { count: lines.interchanges.get(st.id)!.length })}</span>}
                                    </span>
                                    <span style={{ ...muted, fontFamily: MONO }}>{st.files}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section aria-label={s.legendTitle} data-testid="kg-surface-legend" style={{ display: 'grid', gap: 6, marginTop: 'auto', paddingTop: 8, borderTop: `1px solid ${cssVar('border')}` }}>
                <h3 style={{ ...heading, fontSize: 12 }}>{s.rail.legendHeading}</h3>
                <ul style={{ ...list, gap: 6 }}>
                    {legend.map(({ id }) => (
                        <li key={id} data-channel={id} data-status={overlay.status[id]} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <LegendGlyph channel={id} metric={overlay.bindings[id]} status={overlay.status[id]} />
                            <span>{fillTemplate(s.legendRow, { channel: s.channels[id], metric: s.metricNames[overlay.bindings[id]] })}</span>
                            {overlay.status[id] === 'not-set-up' && <span style={muted}>· {s.notSetUp}</span>}
                            {id === 'colour' && owners && <span style={muted}>· {s.rail.ownerSwatches}</span>}
                        </li>
                    ))}
                    {pins && (
                        <li data-channel="pins" data-status="ready" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <LegendGlyph channel="pins" metric="anti" status="ready" />
                            <span>{s.channels.pins}</span>
                        </li>
                    )}
                    <li style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width={40} height={16} aria-hidden="true" style={{ flex: 'none' }}><line x1={0} x2={40} y1={8} y2={8} stroke={cssVar('edge')} strokeWidth={3} strokeDasharray="7 5" /></svg>
                        {s.untestedSegment}
                    </li>
                    {legend.length === 0 && !pins && <li style={muted}>{s.rail.legendEmpty}</li>}
                </ul>
            </section>
        </div>
    );
}
