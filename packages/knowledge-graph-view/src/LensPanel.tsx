/** The active lens's panel: its hint, legend, the judgement notice, and its matrix / before-after panel. */

import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from './labels';
import { hasJudgement, lensApplies, type LensDef } from './lenses';
import { LensLegend } from './LensLegend';
import { PartitionMatrix } from './PartitionMatrix';
import { ComparePanel } from './ComparePanel';
import { muted } from './styles';
import type { EvidenceSide, FindingEvidence, KnowledgeBaseline, SourceLocation } from './types';

export interface LensPanelProps {
    graph: KnowledgeGraph;
    /** The lens drawn, and the one the person asked for (they differ when a lens does not apply). */
    lens: LensDef;
    requested: LensDef;
    baseline: KnowledgeBaseline | null;
    current: KnowledgeGraph | null;
    labels: KnowledgeGraphLabels;
    evidence?: ((f: Finding, side: EvidenceSide) => FindingEvidence[]) | undefined;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
}

export function LensPanel({ graph, lens, requested, baseline, current, labels, evidence, onOpenSource }: LensPanelProps) {
    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ ...muted, margin: 0 }}>{labels.lensHints[lens.id]}</p>
            <LensLegend lens={lens} labels={labels} applicable={lensApplies(requested, graph) && lensApplies(lens, graph)} />
            {lens.needsJudgement && !hasJudgement(graph) && <p role="note" style={{ ...muted, margin: 0 }}>{labels.lensNeedsJudgement}</p>}
            {lens.panel === 'matrix' && <PartitionMatrix graph={graph} labels={labels} />}
            {lens.panel === 'compare' && current && (
                <ComparePanel before={baseline} after={current} labels={labels} evidence={evidence} onOpenSource={onOpenSource} />
            )}
        </div>
    );
}
