// @vitest-environment jsdom
/** The shape key: one row per mark type present, its silhouette and its localized name. */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { LensLegend } from '../LensLegend';
import { LENSES } from '../lenses';
import { TYPE_SHAPE } from '../shapes';
import { ShapeLegend } from './ShapeLegend';

describe('ShapeLegend', () => {
    it('lists the types present, each with its own silhouette and name', () => {
        const { container, getByRole } = render(<ShapeLegend types={['class', 'test', 'external']} labels={L} />);
        expect(getByRole('region', { name: L.legend.shapesTitle })).toBeTruthy();
        const rows = [...container.querySelectorAll('[data-type]')];
        expect(rows.map((r) => r.getAttribute('data-type'))).toEqual(['class', 'test', 'external']);
        expect(rows.map((r) => r.querySelector('[data-shape]')!.getAttribute('data-shape'))).toEqual([TYPE_SHAPE.class, TYPE_SHAPE.test, TYPE_SHAPE.external]);
        expect(rows[0]!.textContent).toBe(L.legend.typeClass);
    });

    it('names a deployable unit with its capsule', () => {
        const { container } = render(<ShapeLegend types={['unit', 'system']} labels={L} />);
        const row = container.querySelector('[data-type="unit"]')!;
        expect(row.querySelector('[data-shape]')!.getAttribute('data-shape')).toBe('capsule');
        expect(row.textContent).toBe(L.legend.typeUnit);
    });

    it('draws nothing with no types, and rides under the lens legend when given types', () => {
        expect(render(<ShapeLegend types={[]} labels={L} />).container.innerHTML).toBe('');
        const { getByTestId } = render(<LensLegend lens={LENSES.structure} labels={L} applicable types={['source', 'doc']} />);
        expect(getByTestId('kg-shape-legend').querySelectorAll('[data-type]')).toHaveLength(2);
    });
});
