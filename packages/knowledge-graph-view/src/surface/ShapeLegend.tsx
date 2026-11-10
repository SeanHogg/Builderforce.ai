/**
 * The shape key: ONE legend for every camera (PRD 43 B1a rule 2) — each mark type present on screen,
 * its silhouette and its name. The types come from the `shapes.ts` registry, the words from
 * `labels.legend` (`typeClass`, `typeFunction`, …). Wraps, so it fits a 360px rail. Tokens only.
 */

import type { KnowledgeGraphLabels } from '../labels';
import { kindLabel } from '../names';
import { typeLegendKey, typeShape, type MarkType } from '../shapes';
import { list } from '../styles';
import { ShapeGlyph } from './LegendGlyph';
import { TYPE } from './ui/type';

export function ShapeLegend({ types, labels }: { types: readonly MarkType[]; labels: Pick<KnowledgeGraphLabels, 'legend'> }) {
    if (types.length === 0) return null;
    const title = kindLabel(labels, 'shapesTitle');
    return (
        <section aria-label={title} data-testid="kg-shape-legend" style={{ display: 'grid', gap: 4 }}>
            <span style={{ ...TYPE.meta }}>{title}</span>
            <ul style={{ ...list, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                {types.map((t) => (
                    <li key={t} data-type={t} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 20, ...TYPE.meta }}>
                        <ShapeGlyph shape={typeShape(t)} />
                        <span>{kindLabel(labels, typeLegendKey(t))}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
