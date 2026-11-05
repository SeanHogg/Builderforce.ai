/**
 * The transit map (PRD 38, Option B+): layer bands top to bottom, one coloured line per
 * entry point, stations on the bands. A station's colour, size, ring, pulse and outline come
 * from the overlay bindings; a line's width too. A segment no test reaches is dashed (only
 * where coverage was collected), a finding is a numbered pin, a station on several lines is
 * an interchange, and a line ends in a data store, an external service, or an "ends here"
 * marker. Colours are tokens, so both themes read; the flow and the pulse animate only when
 * motion is allowed. Every station is a 40px target and a real button.
 */

import { useMemo, useRef } from 'react';
import { useContainerWidth } from '../environment';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { cssVar, type ThemeTone } from '../scene/themeColors';
import type { LinesModel } from './lines';
import { lineTone, segmentUntested, type OverlayModel } from './overlays';
import type { Station, StationModel } from './stations';
import { layoutTransit, OTHER_LAYER, type Point } from './transitLayout';
import type { Pin } from './useSurface';

const halo = { paintOrder: 'stroke', stroke: cssVar('bg'), strokeWidth: 3 } as const;

export interface TransitMapProps {
    stations: StationModel;
    lines: LinesModel;
    overlay: OverlayModel;
    labels: KnowledgeGraphLabels;
    /** Stations that answer the question; null = all. */
    lit: ReadonlySet<string> | null;
    /** The line drawn emphasised (its flow animates). */
    lineId: string | null;
    selectedStation: string | null;
    pins: readonly Pin[];
    /** A lit station's second line of text. */
    noteOf?: ((s: Station) => string | null) | undefined;
    reducedMotion: boolean;
    onSelectStation(id: string): void;
    onSelectLine(id: string): void;
    label: string;
}

function TerminusIcon({ kind, at, color }: { kind: 'data' | 'external' | 'end'; at: Point; color: string }) {
    const { x, y } = at;
    if (kind === 'data') {
        return <path d={`M ${x - 11} ${y - 8} a 11 4 0 0 0 22 0 v 16 a 11 4 0 0 1 -22 0 z M ${x - 11} ${y - 8} a 11 4 0 0 1 22 0 a 11 4 0 0 1 -22 0`} fill={color} stroke={cssVar('bg')} strokeWidth={1.5} />;
    }
    if (kind === 'external') {
        return <path d={`M ${x - 10} ${y} a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0 M ${x - 10} ${y} h 20 M ${x} ${y - 10} c 5 5 5 15 0 20 c -5 -5 -5 -15 0 -20`} fill="none" stroke={color} strokeWidth={1.8} />;
    }
    return <path d={`M ${x - 8} ${y - 8} L ${x + 8} ${y + 8} M ${x + 8} ${y - 8} L ${x - 8} ${y + 8}`} stroke={cssVar('violation')} strokeWidth={3.5} strokeLinecap="round" fill="none" />;
}

export function TransitMap(p: TransitMapProps) {
    const { stations, lines, overlay, labels, lit, selectedStation, pins, noteOf, reducedMotion } = p;
    const s = labels.surface;
    const hostRef = useRef<HTMLDivElement>(null);
    const width = useContainerWidth(hostRef);
    const layout = useMemo(() => layoutTransit(stations.stations, lines.lines, width), [stations.stations, lines.lines, width]);
    const lineById = useMemo(() => new Map(lines.lines.map((l) => [l.id, l] as const)), [lines.lines]);
    const dim = (...ids: string[]) => lit !== null && !ids.every((id) => lit.has(id));
    const layerName = (layer: string) => s.layers[layer as keyof typeof s.layers] ?? s.layers.other;
    const widthOf = (lineId: string) => overlay.lineWidth((lineById.get(lineId)?.stops ?? []).flatMap((id) => stations.byId.get(id) ?? []));
    const pinOf = new Map(pins.map((pin) => [pin.stationId, pin.count] as const));
    const undrawn = stations.stations.length - layout.drawn.length;

    return (
        <div ref={hostRef} data-testid="kg-transit" style={{ position: 'relative', width: '100%', overflow: 'auto' }}>
            <svg
                role="group" aria-label={p.label} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}
                style={{ display: 'block', maxWidth: '100%', color: cssVar('text') }}
            >
                <desc>{fillTemplate(s.mapDescription, { lines: lines.lines.length, stations: layout.drawn.length })}</desc>
                {layout.bands.map((band, i) => (
                    <g key={band.layer} aria-hidden="true">
                        <rect x={0} y={band.y} width={layout.width} height={band.h} fill={i % 2 ? cssVar('plane') : 'transparent'} />
                        <text x={10} y={band.y + 16} fontSize={10} fontWeight={700} letterSpacing="0.08em" fill={cssVar('muted')}>
                            {layerName(band.layer).toUpperCase()}
                        </text>
                    </g>
                ))}

                {layout.routes.map((r) => {
                    const line = lineById.get(r.lineId)!;
                    const w = widthOf(r.lineId);
                    const from = stations.byId.get(r.from), to = stations.byId.get(r.to);
                    const untested = from && to ? segmentUntested(from, to) === true : false;
                    const off = dim(r.from, r.to);
                    const color = cssVar(lineTone(line.colourIndex));
                    return (
                        <g key={`${r.lineId}:${r.index}`} opacity={off ? 0.22 : 1} data-line={r.lineId} data-untested={untested || undefined}>
                            <path d={r.d} fill="none" stroke={cssVar('bg')} strokeWidth={w + 4} strokeLinecap="round" strokeLinejoin="round" />
                            <path
                                d={r.d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"
                                strokeDasharray={untested ? '9 7' : undefined} style={{ cursor: 'pointer' }} onClick={() => p.onSelectLine(r.lineId)}
                            />
                            {!reducedMotion && !off && !untested && r.lineId === p.lineId && (
                                <path d={r.d} fill="none" stroke={cssVar('bg')} strokeWidth={2} strokeLinecap="round" strokeDasharray="2 14" opacity={0.75} pointerEvents="none">
                                    <animate attributeName="stroke-dashoffset" from="16" to="0" dur="1.2s" repeatCount="indefinite" />
                                </path>
                            )}
                        </g>
                    );
                })}

                {lines.lines.map((line) => {
                    const at = layout.positions.get(line.terminus.stationId);
                    const station = stations.byId.get(line.terminus.stationId);
                    if (!at || !station) return null;
                    const icon = { x: at.x + overlay.style(station).size + 30, y: at.y };
                    return (
                        <g key={`t:${line.id}`} data-terminus={line.terminus.kind} opacity={dim(station.id) ? 0.4 : 1}>
                            <title>{s.terminus[line.terminus.kind]}</title>
                            <TerminusIcon kind={line.terminus.kind} at={icon} color={cssVar(lineTone(line.colourIndex))} />
                            <text x={icon.x} y={icon.y + 24} textAnchor="middle" fontSize={10} fill={cssVar('muted')} {...halo}>{s.terminus[line.terminus.kind]}</text>
                        </g>
                    );
                })}

                {layout.drawn.map((id) => {
                    const station = stations.byId.get(id);
                    const at = layout.positions.get(id);
                    if (!station || !at) return null;
                    const st = overlay.style(station);
                    const r = st.size, ring = r + 4;
                    const off = dim(id);
                    const inter = lines.interchanges.get(id);
                    const selected = id === selectedStation;
                    const note = noteOf?.(station);
                    const tone = (t: ThemeTone) => cssVar(t);
                    const activate = () => p.onSelectStation(id);
                    return (
                        <g
                            key={id} role="button" tabIndex={0} data-station={id} aria-pressed={selected}
                            aria-label={fillTemplate(s.stationAria, { name: station.name, layer: layerName(station.layer ?? OTHER_LAYER), files: station.files })}
                            style={{ cursor: 'pointer' }} opacity={off ? 0.4 : 1}
                            onClick={activate} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
                        >
                            {inter && <title>{fillTemplate(s.interchange, { count: inter.length })}</title>}
                            <circle cx={at.x} cy={at.y} r={Math.max(20, ring + 6)} fill="transparent" />
                            {inter && <circle cx={at.x} cy={at.y} r={ring + 3} fill={tone('text')} />}
                            <circle cx={at.x} cy={at.y} r={ring} fill={cssVar('bg')} />
                            <circle cx={at.x} cy={at.y} r={r} fill={tone(st.tone)} stroke={cssVar('bg')} strokeWidth={2} />
                            {st.ring && (
                                <circle
                                    cx={at.x} cy={at.y} r={ring} fill="none" stroke={tone(st.ring.tone)} strokeWidth={3}
                                    strokeDasharray={st.ring.frac > 0 ? `${st.ring.frac * 2 * Math.PI * ring} ${2 * Math.PI * ring}` : '3 3'}
                                    transform={`rotate(-90 ${at.x} ${at.y})`}
                                />
                            )}
                            {st.pulse && (
                                <circle cx={at.x} cy={at.y} r={ring} fill="none" stroke={tone('changed')} strokeWidth={2.5} pointerEvents="none">
                                    {!reducedMotion && <animate attributeName="r" values={`${ring};${ring + 9};${ring}`} dur="2s" repeatCount="indefinite" />}
                                    {!reducedMotion && <animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite" />}
                                </circle>
                            )}
                            {st.outline && <circle cx={at.x} cy={at.y} r={ring + 5} fill="none" stroke={tone('violation')} strokeWidth={1.5} strokeDasharray="2 3" />}
                            {selected && <circle cx={at.x} cy={at.y} r={ring + 8} fill="none" stroke={tone('accent')} strokeWidth={2.5} />}
                            <text x={at.x} y={at.y + ring + 14} textAnchor="middle" fontSize={11} fontWeight={off ? 500 : 600} fill={off ? cssVar('muted') : cssVar('text')} {...halo}>
                                {station.name.length > 16 ? `${station.name.slice(0, 15)}…` : station.name}
                            </text>
                            {note && !off && <text x={at.x} y={at.y + ring + 27} textAnchor="middle" fontSize={10} fill={cssVar('accent')} {...halo}>{note}</text>}
                        </g>
                    );
                })}

                {layout.drawn.filter((id) => pinOf.has(id)).map((id) => {
                    const station = stations.byId.get(id)!;
                    const at = layout.positions.get(id)!;
                    const r = overlay.style(station).size;
                    const cx = at.x + r + 8, cy = at.y - r - 8;
                    return (
                        <g
                            key={`pin:${id}`} role="button" tabIndex={0} data-pin={id} style={{ cursor: 'pointer' }}
                            aria-label={fillTemplate(s.pinAria, { count: pinOf.get(id)!, name: station.name })}
                            onClick={() => p.onSelectStation(id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onSelectStation(id); } }}
                        >
                            <circle cx={cx} cy={cy} r={11} fill={cssVar(`sev${station.anti}` as ThemeTone)} stroke={cssVar('bg')} strokeWidth={1.5} />
                            <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={cssVar('bg')}>{pinOf.get(id)}</text>
                        </g>
                    );
                })}
            </svg>
            {undrawn > 0 && <p style={{ margin: 0, padding: '4px 12px', fontSize: 12, color: cssVar('muted') }}>{fillTemplate(s.moreStations, { count: undrawn })}</p>}
        </div>
    );
}

