/**
 * The words for an empty channel: "Not set up" alone, or "Not set up · {why}" when the coverage
 * facts (`dataCoverage`) say why. ONE helper for the legend, the overlay menu and the Act metrics.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { gapOf, type DataCoverage, type GapReason } from './dataCoverage';
import type { MetricId } from './overlays';
import { counted } from './plural';

/** The reason sentence for a gap. */
function gapText(labels: KnowledgeGraphLabels, coverage: DataCoverage, reason: GapReason, metric: MetricId): string {
    const e = labels.surface.explain;
    const name = labels.surface.metricNames[metric].toLocaleLowerCase();
    if (reason === 'no-outline') return fillTemplate(e.whyNoOutline, { shown: coverage.files.toLocaleString(), files: counted(labels, 'file', coverage.sources, { count: coverage.sources.toLocaleString() }) });
    return fillTemplate(reason === 'no-badges' ? e.whyNoBadges : e.whyNotCollected, { metric: name });
}

/** "Not set up", plus the reason when `coverage` knows it. */
export function notSetUpText(labels: KnowledgeGraphLabels, coverage: DataCoverage | null | undefined, metric: MetricId): string {
    const reason = coverage ? gapOf(coverage, metric) : null;
    return coverage && reason
        ? fillTemplate(labels.surface.explain.notSetUpWhy, { reason: gapText(labels, coverage, reason, metric) })
        : labels.surface.notSetUp;
}
