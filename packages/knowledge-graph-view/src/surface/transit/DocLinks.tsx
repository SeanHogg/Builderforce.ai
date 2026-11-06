/**
 * The dashed "describes" links from a document station to the code it is about (routed round the
 * stations like a line), and the satellite sub-stations an unfolded station opens into. The
 * satellites are real, focusable stations: selecting one selects the station it belongs to. The
 * Claims question brings the links to full strength and names them.
 */

import { fillTemplate } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { MONO } from '../../styles';
import type { HopRoute } from './corridors';
import type { Point } from './geometry';
import { satelliteName, type Satellite, type SatellitePlace } from './unfold';

export function DescribeLinks({ routes, emphasised, label }: { routes: readonly HopRoute[]; emphasised: boolean; label: string }) {
    return (
        <g aria-hidden="true" data-describes>
            {routes.map((r) => (
                <path key={r.lineId} d={r.d} data-describes-link fill="none" stroke={cssVar('nodeSection')} strokeWidth={1.5} strokeDasharray="2 5" strokeLinecap="round" opacity={emphasised ? 1 : 0.4} />
            ))}
            {emphasised && routes[0] && (
                <text x={routes[0].mid.x + 6} y={routes[0].mid.y - 5} fontSize={10} fontWeight={500} fill={cssVar('nodeSection')} paintOrder="stroke" stroke={cssVar('bg')} strokeWidth={3}>{label}</text>
            )}
        </g>
    );
}

export interface SatellitesProps {
    center: Point;
    items: readonly Satellite[];
    places: readonly SatellitePlace[];
    color: string;
    /** The station they belong to. */
    parentName: string;
    /** `surface.map.satelliteAria`: `{name}`, `{parent}`. */
    ariaTemplate: string;
    onSelect(): void;
}

export function Satellites({ center, items, places, color, parentName, ariaTemplate, onSelect }: SatellitesProps) {
    return (
        <g data-satellites>
            {items.map((s, i) => {
                const p = places[i];
                if (!p) return null;
                return (
                    <g
                        key={s.id} role="button" tabIndex={0} data-satellite={s.id} style={{ cursor: 'pointer' }}
                        aria-label={fillTemplate(ariaTemplate, { name: s.name, parent: parentName })}
                        onClick={onSelect} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
                    >
                        <line x1={center.x} y1={center.y} x2={p.x} y2={p.y} stroke={color} strokeWidth={1.5} opacity={0.6} />
                        <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
                        <circle cx={p.x} cy={p.y} r={5} fill={color} stroke={cssVar('bg')} strokeWidth={1.5} />
                        <text x={p.x + (p.anchor === 'start' ? 8 : -8)} y={p.y + 4} textAnchor={p.anchor} fontFamily={MONO} fontSize={10} fill={cssVar('text')} paintOrder="stroke" stroke={cssVar('bg')} strokeWidth={3}>{satelliteName(s)}</text>
                    </g>
                );
            })}
        </g>
    );
}
