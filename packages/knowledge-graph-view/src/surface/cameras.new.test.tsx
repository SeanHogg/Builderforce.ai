// @vitest-environment jsdom
/** The System, Heat and Sequence cameras, through the real surface state. */
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { LENSES } from '../lenses';
import { surfaceFixture } from '../testing';
import { HeatGrid } from './HeatGrid';
import type { SceneProps } from './registry';
import { SequenceDiagram } from './SequenceDiagram';
import { SystemTiers } from './SystemTiers';
import { useSurface, type SurfaceModel } from './useSurface';

const graph = surfaceFixture();
const seen: { surface?: SurfaceModel } = {};

function mount(Camera: ComponentType<SceneProps>, mode: SceneProps['mode']) {
    function Harness() {
        const surface = useSurface(graph, null);
        seen.surface = surface;
        return (
            <Camera
                mode={mode} graph={graph} drawn={{ nodes: graph.nodes, edges: graph.edges }} lens={LENSES.structure} labels={L} rootTitle="sys" selected={null}
                focus={[]} reducedMotion surface={surface} onSelect={vi.fn()} onShow={vi.fn()}
            />
        );
    }
    return render(<Harness />);
}

describe('SystemTiers', () => {
    it('draws a row per layer with a card per component, the finding bar by kind and the data row', () => {
        mount(SystemTiers, 'system');
        expect([...document.querySelectorAll('[data-tier]')].map((t) => t.getAttribute('data-tier'))).toEqual(['entry', 'presentation', 'infrastructure', 'data']);
        const repo = screen.getByRole('button', { name: fillTemplate(L.surface.system.componentAria, { name: 'repositories', files: 1, findings: 1 }) });
        expect(repo.querySelector('[data-kind="clone-group"]')).toBeTruthy();
        expect(document.querySelector('[data-terminus="data"]')!.textContent).toContain('repositories');
    });

    it('selects a component on click', () => {
        mount(SystemTiers, 'system');
        fireEvent.click(screen.getByRole('button', { name: /^cron, / }));
        expect(seen.surface!.station!.name).toBe('cron');
    });
});

describe('HeatGrid', () => {
    it('draws a cell per station per layer, wider for larger size levels, with the bar from the ring channel', () => {
        mount(HeatGrid, 'heat');
        expect(document.querySelectorAll('[data-cell]')).toHaveLength(5);
        const w = (name: string) => parseInt((screen.getByRole('button', { name: new RegExp(`^${name}, `) }) as HTMLElement).style.width, 10);
        expect(w('API')).toBeGreaterThanOrEqual(w('cron'));
        expect(screen.getByText(fillTemplate(L.surface.heat.legend, { size: L.surface.metricNames.cx, colour: L.surface.metricNames.anti, bar: L.surface.metricNames.cov }))).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /^repositories, / }));
        expect(seen.surface!.station!.name).toBe('repositories');
    });
});

describe('SequenceDiagram', () => {
    it('draws a lifeline per stop and a message per hop, and the step follows the path strip', () => {
        mount(SequenceDiagram, 'sequence');
        expect(document.querySelectorAll('[data-lifeline]')).toHaveLength(4);
        expect(document.querySelectorAll('[data-message]')).toHaveLength(3);
        expect(document.querySelector('[data-lifeline][aria-current="step"]')!.getAttribute('aria-label')).toBe('main.tsx');
        fireEvent.click(document.querySelectorAll('[data-lifeline]')[2]!);
        expect(seen.surface!.step).toBe(2);
        expect(document.querySelector('[data-lifeline][aria-current="step"]')!.getAttribute('aria-label')).toBe('API');
        expect(document.querySelector('[data-message][data-active]')!.getAttribute('data-message')).toBe('1-2');
    });

    it('copies the Mermaid of what is drawn', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        mount(SequenceDiagram, 'sequence');
        fireEvent.click(screen.getByRole('button', { name: L.copyMermaid }));
        expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^sequenceDiagram\n    participant P1 as main\.tsx/));
    });

    it('says what to pick when there is no path', () => {
        function Empty() {
            const surface = useSurface({ ...graph, nodes: [], edges: [], findings: [] }, null);
            return <SequenceDiagram mode="sequence" graph={graph} drawn={{ nodes: [], edges: [] }} lens={LENSES.structure} labels={L} rootTitle="" selected={null} focus={[]} reducedMotion surface={surface} onSelect={vi.fn()} onShow={vi.fn()} />;
        }
        render(<Empty />);
        expect(screen.getByText(L.surface.sequence.empty)).toBeTruthy();
    });
});
