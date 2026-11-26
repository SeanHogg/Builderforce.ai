/**
 * One dimension of a run delta (PRD 41 §C11.1): its name, the verdict (word + icon + colour),
 * introduced / resolved / changed counts and its reason chips. Props only. A `not_measured` or
 * `not_comparable` row always shows WHY, since a missing measurement is never zero findings.
 */

import type { DeltaFinding, DimensionResult } from '@builderforce/run-delta/contract';
import { cssVar } from '../scene/themeColors';
import { TYPE } from '../surface/ui/type';
import { fillTemplate } from '../template';
import { dimensionLabel, lineageGroup, reasonLabel } from './deltaText';
import type { RunDeltaLabels } from './labels';
import { reasonTag, VerdictMark } from './VerdictMark';

/** Lineage counts of a dimension; `present` findings carry no lineage and are not counted (C9). */
export function lineageCounts(findings: readonly DeltaFinding[]): { introduced: number; resolved: number; changed: number } {
    const counts = { introduced: 0, resolved: 0, changed: 0 };
    for (const f of findings) {
        const group = lineageGroup(f);
        if (group === 'introduced' || group === 'resolved' || group === 'changed') counts[group]++;
    }
    return counts;
}

export interface DimensionRowProps {
    dimension: DimensionResult;
    labels: RunDeltaLabels;
}

export function DimensionRow({ dimension, labels }: DimensionRowProps) {
    const counts = lineageCounts(dimension.findings);
    const countText = ([
        ['introduced', labels.introducedCount],
        ['resolved', labels.resolvedCount],
        ['changed', labels.changedCount],
    ] as const).filter(([k]) => counts[k] > 0).map(([k, t]) => fillTemplate(t, { count: counts[k] }));
    // `heuristic` is the ≈ mark, not a word chip; every other reason is a localized chip.
    const heuristic = dimension.reasons.includes('heuristic');
    const reasons = dimension.reasons.filter((r) => r !== 'heuristic');
    return (
        <li
            data-dimension={dimension.id}
            style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4, minWidth: 0,
                padding: '6px 0', borderTop: `1px solid ${cssVar('border')}`,
            }}
        >
            <span style={{ ...TYPE.subtitle, color: cssVar('text'), flex: '1 1 140px', minWidth: 0, overflowWrap: 'anywhere' }}>
                {dimensionLabel(labels, dimension.id)}
            </span>
            <VerdictMark verdict={dimension.verdict} labels={labels} />
            {heuristic && (
                <span style={reasonTag} title={labels.heuristicHint} aria-label={labels.heuristicHint}>{labels.heuristicMark}</span>
            )}
            {countText.length > 0 && <span style={{ ...TYPE.meta, whiteSpace: 'nowrap' }}>{countText.join(' · ')}</span>}
            {reasons.length > 0 && (
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flexBasis: '100%', minWidth: 0 }}>
                    {reasons.map((r) => <span key={r} data-reason={r} style={reasonTag}>{reasonLabel(labels, r)}</span>)}
                </span>
            )}
        </li>
    );
}
