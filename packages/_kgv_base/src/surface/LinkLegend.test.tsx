/** The link key: calls first, then each association kind, drawn with the placement's own tone and dash. */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ASSOCIATION_LINK_KINDS } from '../compute/tasks/placement/associations';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { LinkLegend, LINK_LEGEND } from './LinkLegend';

describe('LinkLegend', () => {
    it('has a row for the calls and every association kind, each with a word', () => {
        expect(LINK_LEGEND.map((r) => r.kind)).toEqual(['calls', ...ASSOCIATION_LINK_KINDS]);
        const { container } = render(<LinkLegend labels={L} />);
        const rows = [...container.querySelectorAll('[data-link]')];
        expect(rows).toHaveLength(LINK_LEGEND.length);
        expect(rows.map((r) => r.textContent)).toEqual([L.legend.linkCalls, L.legend.linkExtends, L.legend.linkImplements, L.legend.linkComposes, L.legend.linkReads]);
    });

    it('draws a dashed sample for a dashed kind and a solid one for calls', () => {
        const { container } = render(<LinkLegend labels={L} />);
        expect(container.querySelector('[data-link="calls"] line')?.hasAttribute('stroke-dasharray')).toBe(false);
        expect(container.querySelector('[data-link="implements"] line')?.hasAttribute('stroke-dasharray')).toBe(true);
    });
});
