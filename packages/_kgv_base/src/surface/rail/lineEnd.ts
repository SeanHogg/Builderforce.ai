/**
 * Where a line ends, as data and words. React-free on purpose: the rail's `LineRow.tsx` pulls in react and the theme
 * colours, so logic a plain `.test.ts` asserts (the API suite runs those and installs no react) lives here.
 */

import type { KnowledgeGraphLabels } from '../../labels';
import type { Line } from '../lines';
import type { StationModel } from '../stations';

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
