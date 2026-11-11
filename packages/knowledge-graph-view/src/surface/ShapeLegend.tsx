/**
 * The shape key: ONE legend for every camera (PRD 43 B1a rule 2) — each mark type present on screen,
 * its silhouette and its name. The types come from the `shapes.ts` registry, the words from
 * `labels.legend` (`typeClass`, `typeFunction`, …). Wraps, so it fits a 360px rail. Tokens only.
 *
 * `describe` turns it into the full key (the Legend button's popover): one row per type with its
 * one-line meaning (`labels.legend.type{X}Meaning`), and the types in `present` tagged "on screen".
 */

import type { KnowledgeGraphLabels } from '../labels';
import { kindLabel } from '../names';
import { typeLegendKey, typeShape, type MarkType } from '../shapes';
import { list, muted } from '../styles';
import { ShapeGlyph } from './LegendGlyph';
import { TYPE } from './ui/type';

export interface ShapeLegendProps {
    types: readonly MarkType[];
    labels: Pick<KnowledgeGraphLabels, 'legend'>;
    /** Each row also says what the type means (a column, not a wrapping row). */
    describe?: boolean;
    /** The types drawn now: tagged "on screen" when `describe` is on. */
    present?: readonly MarkType[];
}

export function ShapeLegend({ types, labels, describe = false, present }: ShapeLegendProps) {
    if (types.length === 0) return null;
    const title = kindLabel(labels, 'shapesTitle');
    const shown = new Set(present ?? []);
    return (
        <section aria-label={title} data-testid="kg-shape-legend" style={{ display: 'grid', gap: 4 }}>
            <span style={{ ...TYPE.meta }}>{title}</span>
            {describe ? (
                <ul style={{ ...list, display: 'grid', gap: 6 }}>
                    {types.map((t) => (
                        <li key={t} data-type={t} data-present={shown.has(t) ? 'true' : undefined} style={{ display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr)', alignItems: 'start', gap: 8, ...TYPE.meta }}>
                            <span style={{ paddingTop: 2 }}><ShapeGlyph shape={typeShape(t)} /></span>
                            <span style={{ display: 'grid', gap: 1, minWidth: 0 }}>
                                <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0 8px', alignItems: 'baseline' }}>
                                    <span data-type-name>{kindLabel(labels, typeLegendKey(t))}</span>
                                    {shown.has(t) && <span data-on-screen style={{ ...TYPE.tag }}>{kindLabel(labels, 'onScreen')}</span>}
                                </span>
                                <span style={{ ...muted, overflowWrap: 'anywhere' }}>{kindLabel(labels, `${typeLegendKey(t)}Meaning`)}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            ) : (
                <ul style={{ ...list, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                    {types.map((t) => (
                        <li key={t} data-type={t} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 20, ...TYPE.meta }}>
                            <ShapeGlyph shape={typeShape(t)} />
                            <span>{kindLabel(labels, typeLegendKey(t))}</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
