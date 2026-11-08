import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { surfaceFixture } from '../../testing';
import type { PanelProps } from '../registry';
import { useSurface } from '../useSurface';
import { CoveragePanel } from './CoveragePanel';

const graph = surfaceFixture();


function mount(Panel: ComponentType<PanelProps>, over: Partial<PanelProps> & { graph?: KnowledgeGraph } = {}) {
    const props = { onShow: vi.fn(), onCompose: vi.fn(), onClose: vi.fn(), ...over };
    function Harness() {
        const surface = useSurface(over.graph ?? graph, null);
        return <Panel graph={over.graph ?? graph} labels={L} surface={surface} {...props} />;
    }
    render(<Harness />);
    return props;
}

describe('CoveragePanel (provenance, test shape, configuration)', () => {
    it('shades the complex-and-untested quadrant of the scatter', () => {
        mount(CoveragePanel);
        expect(screen.getByTestId('kg-risk-quadrant')).toBeTruthy();
        expect(document.querySelector('svg')!.textContent).toContain(L.surface.coverage.quadrant);
    });

    it('badges each KPI with where its number comes from', () => {
        mount(CoveragePanel);
        const badges = [...document.querySelectorAll('[data-provenance]')].map((b) => b.getAttribute('data-provenance'));
        expect(badges).toEqual(['runtime', 'runtime', 'deterministic', 'heuristic']);
    });

    it('says the test shape is not measured when the graph holds no test file', () => {
        mount(CoveragePanel);
        expect(screen.getByTestId('kg-test-shape-none')).toBeTruthy();
    });

    it('draws the split from test paths', () => {
        const extra = ['a.test.ts', 'b.test.ts', 'e2e/c.spec.ts'].map((path) => ({ ...graph.nodes.find((n) => n.label === 'db/repo.ts')!, ref: `src:sys::${path}` as const, label: path }));
        mount(CoveragePanel, { graph: { ...graph, nodes: [...graph.nodes, ...extra] } });
        expect(document.querySelector('[data-shape="unit"]')!.textContent).toContain('2');
        expect(document.querySelector('[data-shape="e2e"]')).toBeTruthy();
    });

    it('names where coverage is configured and sends Apply to the composer, never writing a file', () => {
        const props = mount(CoveragePanel);
        expect(screen.getByTestId('kg-coverage-config').textContent).toContain('api, db');
        fireEvent.click(screen.getByTestId('kg-apply-v8'));
        expect(props.onCompose).toHaveBeenCalledTimes(1);
        expect(vi.mocked(props.onCompose!).mock.calls[0]![0]).toContain('cron, web');
    });

    it('still offers Apply when coverage is not set up anywhere', () => {
        const none: KnowledgeGraph = { ...graph, nodes: graph.nodes.map(({ badges, ...n }) => (badges ? { ...n, badges: Object.fromEntries(Object.entries(badges).filter(([k]) => k !== 'coverage')) } : n)) };
        mount(CoveragePanel, { graph: none });
        expect(screen.getByTestId('kg-apply-v8')).toBeTruthy();
        expect(screen.getByTestId('kg-coverage-config').textContent).toBe(L.surface.coverage.configNowhere);
    });
});
