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
import type { MarkType } from './shapes';
import { list, muted, swatch } from './styles';
import { ShapeGlyph } from './surface/LegendGlyph';
import { ShapeLegend } from './surface/ShapeLegend';

export interface LensLegendProps {
    lens: LensDef;
    labels: KnowledgeGraphLabels;
    /** False ⇒ the requested lens' packs are not in this graph. */
    applicable: boolean;
    /** The mark types the graph draws (`typesPresent`): the shape key under the tones. Absent ⇒ no shape key. */
    types?: readonly MarkType[] | undefined;
}

export function LensLegend({ lens, labels, applicable, types }: LensLegendProps) {
    return (
        <div style={{ display: 'grid', gap: 6 }}>
            {!applicable && <p role="note" data-testid="kg-lens-not-applicable" style={{ ...muted, margin: 0 }}>{labels.lensNotApplicable}</p>}
            {lens.legend.length > 0 && (
                <section aria-label={labels.legendLabel} data-testid="kg-legend">
                    <ul style={{ ...list, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                        {lens.legend.map((row) => (
                            <li key={`${row.tone}:${row.key}`} data-legend={row.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, minHeight: 20 }}>
                                {row.shape ? (
                                    <ShapeGlyph shape={row.shape} tone={row.tone} size={12} />
                                ) : (
                                    <span style={{ ...swatch(cssVar(row.tone)), borderRadius: 999 }} aria-hidden="true" />
                                )}
                                <span>{kindLabel(labels, row.key)}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {types && <ShapeLegend types={types} labels={labels} />}
        </div>
    );
}
