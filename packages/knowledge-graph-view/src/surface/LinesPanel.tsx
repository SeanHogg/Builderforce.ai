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

import { useMemo } from 'react';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { camelKind, fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { counted } from './plural';
import { kindTones } from './system/systemModel';
import { cssVar } from '../scene/themeColors';
import { list, muted, swatch } from '../styles';
import { TYPE } from './ui/type';
import { LegendGlyph } from './LegendGlyph';
import { LineGroupList } from './rail/LineGroupList';
import { LineRow } from './rail/LineRow';
import { StopRow } from './rail/StopRow';
import { firstFindings, stopTag } from './rail/stopTag';
import type { Line, LinesModel } from './lines';
import { isMultiSystem } from './systems';
import { cmp } from '../order';
import type { DataCoverage } from './dataCoverage';
import { notSetUpText } from './notSetUpText';
import { CHANNELS, LINE_TONES, lineTone, type OverlayModel } from './overlays';
import type { StationModel } from './stations';

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
    /** What the graph carries (`dataCoverage`): the reason an unset channel gives. Absent ⇒ "Not set up" alone. */
    coverage?: DataCoverage | null | undefined;
    /** Which extra marks the map draws, so the legend explains them: a ✕ dead end, a square document. */
    extras?: { deadEnd: boolean; docs: boolean } | undefined;
    /** The findings the Act rail lists, in its order: a stop's tag names its first one by place in this list. Absent ⇒ no finding tags. */
    findings?: readonly Finding[] | undefined;
    /** The finding kinds of the graph, given only while the System camera is on: the legend names the colour of each bar segment. */
    kinds?: readonly string[] | undefined;
}

export function LinesPanel({ lines, stations, overlay, labels, lineId, selectedStation, onSelectLine, onSelectStation, rail = false, coverage, extras, findings, kinds }: LinesPanelProps) {
    const s = labels.surface;
    const kindTone = useMemo(() => kindTones(kinds ?? []), [kinds]);
    // A coverage number that is a static reach says "Reached", never "Coverage" (it is a heuristic, not a measurement).
    const reached = stations.stations.some((st) => st.covProvenance === 'heuristic');
    const metricName = (m: keyof typeof s.metricNames) => (m === 'cov' && reached ? s.map.stats.reached : s.metricNames[m]);
    // Owner swatches in the colour order the map uses (sorted names, line palette).
    const ownerNames = [...new Set(stations.stations.map((st) => st.owner).filter((o): o is string => !!o))].sort(cmp).slice(0, LINE_TONES.length);
    const line = lines.lines.find((l) => l.id === lineId) ?? null;
    // Each stop's first finding, numbered as the Act rail lists them (`findings` is that list).
    const firstOf = useMemo(() => firstFindings(stations.stations, findings ?? []), [stations, findings]);
    // A root of several systems groups its lines by system (PRD 41 A9); one system reads as the flat list it always was.
    const grouped = isMultiSystem(lines.systems);
    const renderLine = (l: Line) => <LineRow line={l} selected={l.id === lineId} byId={stations.byId} labels={labels} onSelect={onSelectLine} />;
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
                <h3 style={TYPE.sectionHeading}>{s.rail.heading}</h3>
                {lines.lines.length === 0 ? <p style={muted}>{s.linesEmpty}</p> : grouped ? (
                    <LineGroupList lines={lines.lines} systems={lines.systems ?? []} labels={labels} renderLine={renderLine} />
                ) : (
                    <ul style={{ ...list, gap: 2 }}>
                        {lines.lines.map((l) => <li key={l.id}>{renderLine(l)}</li>)}
                    </ul>
                )}
                {lines.omitted > 0 && <p style={{ ...muted, margin: 0 }}>{counted(labels, 'entryPointsOmitted', lines.omitted)}</p>}
            </section>

            <section aria-label={line ? fillTemplate(s.stationsOn, { name: line.name }) : s.stationsPick} style={{ display: 'grid', gap: 6 }}>
                <h3 style={TYPE.sectionHeading}>{line ? fillTemplate(s.stationsOn, { name: line.name }) : s.stationsPick}</h3>
                {line && (
                    <ul style={{ ...list, gap: 2 }}>
                        {line.stops.flatMap((id) => stations.byId.get(id) ?? []).map((st) => (
                            <li key={st.id}>
                                <StopRow
                                    station={st} selected={st.id === selectedStation} overlay={overlay} lineColourIndex={line.colourIndex}
                                    interchange={lines.interchanges.get(st.id)?.length ?? 0} tag={stopTag(st, firstOf.get(st.id), labels)} labels={labels} onSelect={onSelectStation}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section aria-label={s.legendTitle} data-testid="kg-surface-legend" style={{ display: 'grid', gap: 6, marginTop: 'auto', paddingTop: 8, borderTop: `1px solid ${cssVar('border')}` }}>
                <h3 style={{ ...TYPE.subtitle, color: cssVar('text') }}>{s.rail.legendHeading}</h3>
                <ul style={{ ...list, gap: 6 }}>
                    {legend.map(({ id }) => (
                        <li key={id} data-channel={id} data-status={overlay.status[id]} style={{ ...TYPE.meta, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <LegendGlyph channel={id} metric={overlay.bindings[id]} status={overlay.status[id]} />
                            <span>{fillTemplate(s.legendRow, { channel: s.channels[id], metric: metricName(overlay.bindings[id]) })}</span>
                            {overlay.status[id] === 'not-set-up' && <span style={muted}>· {notSetUpText(labels, coverage, overlay.bindings[id])}, {s.explain.legendNotSetUp}</span>}
                            {id === 'colour' && owners && <span style={muted}>· {s.rail.ownerSwatches}</span>}
                        </li>
                    ))}
                    {owners && ownerNames.length > 0 && (
                        <li data-testid="kg-owner-swatches" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', ...TYPE.meta }}>
                            {ownerNames.map((name, i) => (
                                <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                    <span aria-hidden="true" style={swatch(cssVar(lineTone(i)))} />{name}
                                </span>
                            ))}
                        </li>
                    )}
                    {kindTone.size > 0 && (
                        <li data-testid="kg-kinds-legend" aria-label={s.kindsLegend} style={{ display: 'grid', gap: 4, ...TYPE.meta }}>
                            <span style={muted}>{s.kindsLegend}</span>
                            <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
                                {[...kindTone].map(([kind, tone]) => (
                                    <span key={kind} data-kind={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                        <span aria-hidden="true" style={swatch(cssVar(tone))} />{labels.findingKinds[camelKind(kind)] ?? kind}
                                    </span>
                                ))}
                            </span>
                        </li>
                    )}
                    {pins && (
                        <li data-channel="pins" data-status="ready" style={{ ...TYPE.meta, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <LegendGlyph channel="pins" metric="anti" status="ready" />
                            <span>{s.channels.pins}</span>
                        </li>
                    )}
                    <li style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width={40} height={16} aria-hidden="true" style={{ flex: 'none' }}><line x1={0} x2={40} y1={8} y2={8} stroke={cssVar('violation')} strokeWidth={3} strokeDasharray="7 5" /></svg>
                        {s.untestedSegment}
                    </li>
                    {extras?.deadEnd && (
                        <li data-legend="dead-end" style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <svg width={40} height={16} aria-hidden="true" style={{ flex: 'none' }}><path d="M14 3 L26 13 M26 3 L14 13" stroke={cssVar('violation')} strokeWidth={2.5} strokeLinecap="round" fill="none" /></svg>
                            {s.map.deadEnd}
                        </li>
                    )}
                    {extras?.docs && (
                        <li data-legend="docs" style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <svg width={40} height={16} aria-hidden="true" style={{ flex: 'none' }}><rect x={14} y={2} width={12} height={12} rx={2} fill="none" stroke={cssVar('edge')} strokeWidth={2} /></svg>
                            {s.map.doc}
                        </li>
                    )}
                    {legend.length === 0 && !pins && <li style={muted}>{s.rail.legendEmpty}</li>}
                </ul>
            </section>
        </div>
    );
}
