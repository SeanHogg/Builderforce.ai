// @vitest-environment jsdom
/** The drawers (Resolve and Simulate are in resolveSimulate.drawers.test.tsx), each through the real surface state: what they show, what they send, and how they degrade. */
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import { surfaceFixture } from '../../testing';
import type { PanelProps } from '../registry';
import { useSurface, type SurfaceModel } from '../useSurface';
import { ApiPanel } from './ApiPanel';
import { CoveragePanel } from './CoveragePanel';
import { PatternsPanel } from './PatternsPanel';

const graph = surfaceFixture();
const noCoverage: KnowledgeGraph = { ...graph, nodes: graph.nodes.map(({ badges, ...n }) => (badges ? { ...n, badges: Object.fromEntries(Object.entries(badges).filter(([k]) => k !== 'coverage')) } : n)) };
const seen: { surface?: SurfaceModel } = {};

function mount(Panel: ComponentType<PanelProps>, over: Partial<PanelProps> & { graph?: KnowledgeGraph } = {}) {
    const props = { onShow: vi.fn(), onCompose: vi.fn(), onClose: vi.fn(), onCamera: vi.fn(), ...over };
    function Harness() {
        const surface = useSurface(over.graph ?? graph, null);
        seen.surface = surface;
        return <Panel graph={over.graph ?? graph} labels={L} surface={surface} {...props} />;
    }
    render(<Harness />);
    return props;
}

describe('CoveragePanel', () => {
    it('says "not set up" when no file reports coverage, never a zero', () => {
        mount(CoveragePanel, { graph: noCoverage });
        expect(screen.getByText(L.surface.coverage.notSetUpTitle)).toBeTruthy();
        expect(document.querySelector('[data-testid="kg-coverage"]')).toBeNull();
    });

    it('shows KPIs, the scatter and the riskiest gap; Prompt tests composes; Run with values opens Simulate on its path', () => {
        const props = mount(CoveragePanel);
        expect(screen.getByText(fillTemplate(L.surface.coverage.kpiFilesValue, { count: 2, total: 6 }))).toBeTruthy();
        expect(document.querySelectorAll('[data-point]')).toHaveLength(2);
        expect(document.querySelector('[data-gap]')!.textContent).toContain('db/repo.ts');
        fireEvent.click(screen.getByRole('button', { name: L.surface.coverage.promptTests }));
        expect(props.onCompose).toHaveBeenCalledWith(fillTemplate(L.surface.coverage.promptText, { file: 'db/repo.ts', complexity: 5, coverage: '20%' }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.coverage.runWithValues }));
        expect(seen.surface!.panel).toBe('simulate');
        expect(seen.surface!.path.stops.map((s) => s.name)).toContain('repositories');
    });
});

describe('PatternsPanel', () => {
    it('is not set up with no patterns and no findings', () => {
        mount(PatternsPanel, { graph: { ...graph, findings: [], nodes: graph.nodes.map(({ badges, ...n }) => n) } });
        expect(screen.getByText(L.surface.patterns.notSetUpTitle)).toBeTruthy();
    });

    it('draws the family matrix with an Anti-pattern row; a family lights its stations through the patterns question', () => {
        const props = mount(PatternsPanel, { cameras: ['3d'] });
        expect(document.querySelector('[data-row="anti"]')!.textContent).toContain(L.surface.patterns.antiRow);
        fireEvent.click(document.querySelector('[data-family="repository"]')!);
        expect(seen.surface!.question).toBe('patterns');
        expect(props.onShow).toHaveBeenCalledWith(['src:sys::api/useCase.ts']);
        expect(screen.getByTestId('kg-patterns-lit').textContent).toBe('repository lights 1 station');
    });

    it('lists the anti-patterns as groups with Show in Tower (only with a Tower), which lights them', () => {
        const props = mount(PatternsPanel, { cameras: ['3d'] });
        const row = document.querySelector('[data-anti]')!;
        fireEvent.click(within(row as HTMLElement).getByRole('button', { name: L.surface.patterns.showInTower }));
        expect(props.onShow).toHaveBeenCalled();
        expect(props.onCamera).toHaveBeenCalledWith('3d');
        expect(seen.surface!.highlight).not.toBeNull();
    });

    it('shows in the Map with its towers look on where there is no WebGL', () => {
        const props = mount(PatternsPanel, { cameras: ['transit', 'system'] });
        const row = document.querySelector('[data-anti]') as HTMLElement;
        const button = within(row).getByRole('button', { name: L.surface.patterns.showInTower }) as HTMLButtonElement;
        expect(button.disabled).toBe(false);
        fireEvent.click(button);
        expect(props.onCamera).toHaveBeenCalledWith('transit');
        expect(seen.surface!.towers).toBe(true);
    });

    it('disables Show in Tower with neither the 3D nor the Map camera', () => {
        mount(PatternsPanel, { cameras: ['system'] });
        const row = document.querySelector('[data-anti]') as HTMLElement;
        expect((within(row).getByRole('button', { name: L.surface.patterns.showInTower }) as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('ApiPanel', () => {
    it('says no endpoints when no route badge exists', () => {
        mount(ApiPanel, { graph: { ...graph, nodes: graph.nodes.map(({ badges, ...n }) => n) } });
        expect(screen.getByText(L.surface.api.notSetUpTitle)).toBeTruthy();
    });

    it('lists endpoints as undocumented with a missing-contract note, shows callers, and Try it copies a curl', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        mount(ApiPanel);
        expect(screen.getByTestId('kg-api-contract').textContent).toBe(L.surface.api.contractMissing);
        expect(document.querySelectorAll('[data-documented="false"]')).toHaveLength(2);
        // Both endpoints live in the one file Web app imports: each row says so, once, with the caller listed once.
        expect(screen.getAllByText(fillTemplate(L.surface.api.callers, { names: 'Web app' }))).toHaveLength(2);
        fireEvent.click(document.querySelector('[data-endpoint="POST /users"] button')!);
        fireEvent.click(screen.getByRole('button', { name: L.surface.api.copyCurl }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('curl -X POST "$BASE_URL/users"')));
    });

    it('exports the OpenAPI skeleton and Postman collection as downloads, and composes contract tests', () => {
        const blobs: Blob[] = [];
        const create = vi.fn((b: Blob) => { blobs.push(b); return 'blob:x'; });
        const revoke = vi.fn();
        Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
        const props = mount(ApiPanel, { rootTitle: 'My service' });
        fireEvent.click(screen.getByRole('button', { name: L.surface.api.exportOpenapi }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.api.exportPostman }));
        expect(create).toHaveBeenCalledTimes(2);
        expect(revoke).toHaveBeenCalledTimes(2); // each object URL is released once, right after its download
        expect(revoke).toHaveBeenCalledWith('blob:x');
        fireEvent.click(screen.getByRole('button', { name: L.surface.api.contractTests }));
        expect(props.onCompose).toHaveBeenCalledWith(fillTemplate(L.surface.api.contractTestsText, { routes: 'POST /users, GET /users/:id' }));
    });
});
