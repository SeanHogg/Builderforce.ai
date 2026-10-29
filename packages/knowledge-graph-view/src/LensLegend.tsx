/**
 * The active lens's legend (PRD 38 §3.3): each tone the lens draws with, named. Presentational —
 * the rows come from the lens registry, the words from `labels.legend`. When the lens the
 * person asked for does not apply to this folder's packs, it says so instead of drawing
 * a legend for something that is not on screen.
 */

import type { KnowledgeGraphLabels } from './labels';
import type { LensDef } from './lenses';
import { kindLabel } from './names';
import { cssVar } from './scene/themeColors';
import { list, muted, swatch } from './styles';

export interface LensLegendProps {
    lens: LensDef;
    labels: KnowledgeGraphLabels;
    /** False ⇒ the requested lens' packs are not in this graph. */
    applicable: boolean;
}

export function LensLegend({ lens, labels, applicable }: LensLegendProps) {
    return (
        <div style={{ display: 'grid', gap: 6 }}>
            {!applicable && <p role="note" data-testid="kg-lens-not-applicable" style={{ ...muted, margin: 0 }}>{labels.lensNotApplicable}</p>}
            {lens.legend.length > 0 && (
                <section aria-label={labels.legendLabel} data-testid="kg-legend">
                    <ul style={{ ...list, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                        {lens.legend.map((row) => (
                            <li key={`${row.tone}:${row.key}`} data-legend={row.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, minHeight: 20 }}>
                                <span style={swatch(cssVar(row.tone))} aria-hidden="true" />
                                <span>{kindLabel(labels, row.key)}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
