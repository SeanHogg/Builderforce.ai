// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { MAX_DRAWN_EDGES } from '../scene/edgeBudget';
import { CapNote, EdgesCapped } from './cameras';

describe('the link budget caption', () => {
    it('says how many links are shown of how many when the budget leaves some out', () => {
        const { getByTestId } = render(<EdgesCapped total={113_975} labels={L} />);
        expect(getByTestId('kg-edges-capped').textContent).toBe(
            fillTemplate(L.surface.scene.edgesCapped, { shown: MAX_DRAWN_EDGES.toLocaleString(), total: (113_975).toLocaleString() }),
        );
        expect(getByTestId('kg-edges-capped').textContent).toBe('Showing 15,000 of 113,975 links');
    });

    it('says nothing while every link is drawn', () => {
        const { container } = render(<EdgesCapped total={MAX_DRAWN_EDGES} labels={L} />);
        expect(container.querySelector('[data-testid="kg-edges-capped"]')).toBeNull();
    });

    it('shares its shape with the pipes note', () => {
        const { getByTestId } = render(<CapNote testId="kg-pipes-capped">pipes</CapNote>);
        expect(getByTestId('kg-pipes-capped').textContent).toBe('pipes');
    });
});
