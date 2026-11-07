/**
 * A line row of the left rail: a two-line button. The name on the first line; "{stations} · {files} ·
 * {where it ends}" under it; a dead-end count at the right, in the violation colour when there is one.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import type { Line } from '../lines';
import { lineTone } from '../overlays';
import { counted } from '../plural';
import type { StationModel } from '../stations';
import { TYPE } from '../ui/type';
import { clip, railRow } from './railRow';

/** A line ends in a dead end when its last station is nothing a store or service, and nobody has reported it yet. */
export const deadEndsOf = (line: Line, byId: StationModel['byId']): number =>
    line.terminus.kind === 'end' && (byId.get(line.terminus.stationId)?.findingIds.length ?? 0) === 0 ? 1 : 0;

const REASON_KEY = {
    'no-references': 'noReferences', 'only-upward': 'onlyUpward', 'only-visited': 'onlyVisited', 'only-higher-layer': 'onlyHigherLayer', 'max-stops': 'maxStops',
} as const;

/** Where a line ends, in words: why it stopped, unless it ends at a real store or service (or the line records no reason). */
export function endText(line: Line, labels: KnowledgeGraphLabels): string {
    const reason = line.stopReason;
    return reason && reason !== 'terminus' ? labels.surface.stopReasons[REASON_KEY[reason]] : labels.surface.terminus[line.terminus.kind];
}

export interface LineRowProps {
    line: Line;
    selected: boolean;
    byId: StationModel['byId'];
    labels: KnowledgeGraphLabels;
    onSelect(id: string): void;
}

export function LineRow({ line, selected, byId, labels, onSelect }: LineRowProps) {
    const s = labels.surface;
    const files = new Set(line.stops.flatMap((id) => byId.get(id)?.refs ?? [])).size;
    const dead = deadEndsOf(line, byId);
    return (
        <button type="button" aria-pressed={selected} data-line={line.id} onClick={() => onSelect(line.id)} style={{ ...railRow(selected), padding: '4px 8px' }}>
            <span aria-hidden="true" style={{ width: 10, height: 26, borderRadius: 5, flex: 'none', background: cssVar(lineTone(line.colourIndex)) }} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <b style={{ ...clip, ...TYPE.subtitle, fontWeight: selected ? 700 : 600 }}>{fillTemplate(s.lineName, { name: line.name })}</b>
                <span data-line-detail data-stop-reason={line.stopReason} style={{ ...clip, ...TYPE.meta }}>
                    {fillTemplate(s.rail.lineDetail, { stations: counted(labels, 'station', line.stops.length), files: counted(labels, 'file', files), end: endText(line, labels) })}
                </span>
            </span>
            <span data-dead-ends={dead} style={{ ...TYPE.status, whiteSpace: 'nowrap', color: cssVar(dead > 0 ? 'violation' : 'muted') }}>{counted(labels, 'deadEnd', dead)}</span>
        </button>
    );
}
