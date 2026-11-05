// @vitest-environment jsdom
/** The six drawers, each through the real surface state: what they show, what they send, and how they degrade. */
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import { surfaceFixture } from '../../testing';
import type { KnowledgeGraphSource } from '../../types';
import type { PanelProps } from '../registry';
import { useSurface, type SurfaceModel } from '../useSurface';
import { ApiPanel } from './ApiPanel';
import { CoveragePanel } from './CoveragePanel';
import { PatternsPanel } from './PatternsPanel';
import { ResolvePanel } from './ResolvePanel';
import { SimulatePanel } from './SimulatePanel';
import { SyncPanel } from './SyncPanel';

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

describe('SyncPanel', () => {
    const counts = { files: 10, edges: 20, docs: 2 };
    const source = (over: Partial<KnowledgeGraphSource> = {}): KnowledgeGraphSource => ({
        scopes: async () => [], load: async () => null,
        syncStatus: async () => ({
            local: counts, server: { ...counts, files: 8 }, skipped: [{ path: 'big.bin', bytes: 3 * 1024 * 1024, reason: 'too large' }],
            sources: [{ id: 'code', state: 'collected' }, { id: 'coverage', state: 'absent', note: 'no lcov' }],
        }),
        ...over,
    });

    it('draws nothing when the source cannot report its status', () => {
        mount(SyncPanel, { source: { scopes: async () => [], load: async () => null }, rootId: 'sys' });
        expect(screen.queryByTestId('kg-sync')).toBeNull();
    });

    it('shows the pipeline, local against server, the skipped files with reasons, and the sources with their state', async () => {
        mount(SyncPanel, { source: source(), rootId: 'sys', diagnosticsText: () => 'DIAG' });
        await screen.findByTestId('kg-sync');
        expect(document.querySelector('[data-step="match"]')!.getAttribute('data-state')).toBe('attention');
        expect(document.querySelectorAll('[data-step]')).toHaveLength(6);
        expect(screen.getByTestId('kg-sync-skipped').textContent).toContain('big.bin · 3.0 MB · too large');
        expect(document.querySelector('[data-source="coverage"]')!.textContent).toContain(L.surface.sourceStates.absent);
        expect(screen.getByText('no lcov')).toBeTruthy();
        expect(screen.getByText(L.surface.syncExcluded.vendored)).toBeTruthy();
        expect(screen.getByRole('meter', { name: fillTemplate(L.surface.sync.barAria, { label: 'Files', local: 10, server: 8 }) })).toBeTruthy();
    });

    it('says when nothing is uploaded yet, and when the read fails', async () => {
        const server = { local: counts, skipped: [], sources: [] };
        mount(SyncPanel, { source: source({ syncStatus: async () => server }), rootId: 'sys' });
        await screen.findByText(L.surface.sync.notUploaded);
        expect(screen.getByText(L.surface.sync.skippedNone)).toBeTruthy();
    });

    it('says "not measured" for edges a linked folder never counted, and draws no bar for them', async () => {
        mount(SyncPanel, { source: source({ syncStatus: async () => ({ local: { files: 4, docs: 1 }, skipped: [], sources: [] }) }), rootId: 'sys' });
        await screen.findByTestId('kg-sync');
        const edges = document.querySelector('[data-count="edges"]')!;
        expect(edges.getAttribute('data-measured')).toBe('false');
        expect(edges.textContent).toContain(L.surface.sync.edgesNotMeasured);
        expect(edges.querySelector('[role="meter"]')).toBeNull();
    });

    it('says "unknown" when no review recorded the skipped files, never "nothing skipped"', async () => {
        mount(SyncPanel, { source: source({ syncStatus: async () => ({ local: counts, sources: [] }) }), rootId: 'sys' });
        expect((await screen.findByTestId('kg-sync-skipped-unknown')).textContent).toBe(L.surface.sync.skippedUnknown);
        expect(screen.queryByText(L.surface.sync.skippedNone)).toBeNull();
    });

    it('lists a skipped file with its reason in words, and no size when none was measured', async () => {
        const skipped = [{ path: 'huge.sql', reason: 'too-large' }, { path: 'a.bin', bytes: 2048, reason: 'unreadable' }];
        mount(SyncPanel, { source: source({ syncStatus: async () => ({ local: counts, skipped, sources: [] }) }), rootId: 'sys' });
        const list = await screen.findByTestId('kg-sync-skipped');
        expect(list.textContent).toContain(`huge.sql · ${L.surface.skipReasons.tooLarge}`);
        expect(list.textContent).not.toContain('0 B');
        expect(list.textContent).toContain(`a.bin · 2.0 KB · ${L.surface.skipReasons.unreadable}`);
    });

    it('notes a truncated graph', async () => {
        mount(SyncPanel, { source: source({ syncStatus: async () => ({ local: { ...counts, truncated: true }, skipped: [], sources: [] }) }), rootId: 'sys' });
        expect((await screen.findByTestId('kg-sync-truncated')).textContent).toBe(L.surface.sync.truncatedNote);
    });

    it('reports a failed read', async () => {
        mount(SyncPanel, { source: source({ syncStatus: async () => { throw new Error('x'); } }), rootId: 'sys' });
        expect((await screen.findByRole('alert')).textContent).toBe(L.surface.sync.failed);
    });

    it('copies the diagnostics text it was given', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        mount(SyncPanel, { source: source(), rootId: 'sys', diagnosticsText: () => 'DIAG' });
        fireEvent.click(await screen.findByRole('button', { name: L.copyDiagnostics }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('DIAG'));
    });
});

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
        expect(screen.getByTestId('kg-patterns-lit').textContent).toBe(fillTemplate(L.surface.patterns.lights, { family: 'repository', count: 1 }));
    });

    it('lists the anti-patterns with Resolve (opens the drawer) and Show in Tower (only with a Tower)', () => {
        const props = mount(PatternsPanel, { cameras: ['3d'] });
        const row = document.querySelector('[data-anti]')!;
        fireEvent.click(row.querySelectorAll('button')[1]!);
        expect(props.onShow).toHaveBeenCalled();
        expect(props.onCamera).toHaveBeenCalledWith('3d');
        fireEvent.click(row.querySelectorAll('button')[0]!);
        expect(seen.surface!.panel).toBe('resolve');
        expect(seen.surface!.resolving).not.toBeNull();
    });

    it('disables Show in Tower where there is no WebGL', () => {
        mount(PatternsPanel, { cameras: ['transit'] });
        expect((document.querySelector('[data-anti] button:nth-of-type(2)') as HTMLButtonElement).disabled).toBe(true);
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

describe('ResolvePanel', () => {
    const unused: Finding = { id: 'u', kind: 'unused-file', pack: 'code', nodes: ['src:sys::cron/job.ts'] as never, severity: 'info', params: { count: 1, files: 1 }, requestKey: 'knowledgeGraph.fix.unusedFile' };

    function open(f: Finding | null, props: Partial<PanelProps>) {
        function Harness() {
            const surface = useSurface(graph, null);
            seen.surface = surface;
            return (
                <>
                    <button type="button" onClick={() => surface.resolve(f)}>open</button>
                    <ResolvePanel graph={graph} labels={L} surface={surface} onShow={vi.fn()} onClose={vi.fn()} {...props} />
                </>
            );
        }
        render(<Harness />);
        fireEvent.click(screen.getByText('open'));
    }

    it('asks which finding when none was chosen', () => {
        mount(ResolvePanel);
        expect(screen.getByText(L.surface.resolve.empty)).toBeTruthy();
    });

    it('applies a codemod where the source offers one, and shows the branch', async () => {
        const applyFix = vi.fn().mockResolvedValue({ branch: 'fix/unused', changed: ['cron/job.ts'] });
        const onChanged = vi.fn();
        open(unused, { source: { scopes: async () => [], load: async () => null, applyFix }, onChanged });
        fireEvent.click(screen.getByRole('button', { name: L.surface.resolve.applyFix }));
        const done = await screen.findByTestId('kg-resolve-done');
        expect(applyFix).toHaveBeenCalledWith(unused);
        expect(onChanged).toHaveBeenCalledTimes(1); // the graph reloads, so the fixed finding disappears
        expect(done.textContent).toContain(fillTemplate(L.surface.resolve.applied, { branch: 'fix/unused' }));
        expect(screen.getByText(L.surface.resolve.undoNote)).toBeTruthy();
    });

    it('prompts the agent for a kind with no codemod, or a source without applyFix', () => {
        const onCompose = vi.fn();
        open(graph.findings[0]!, { onCompose, source: { scopes: async () => [], load: async () => null, applyFix: vi.fn() } });
        expect(screen.queryByRole('button', { name: L.surface.resolve.applyFix })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: L.surface.resolve.prompt }));
        expect(onCompose).toHaveBeenCalledTimes(1);
    });

    it('reports a codemod that failed', async () => {
        open(unused, { source: { scopes: async () => [], load: async () => null, applyFix: vi.fn().mockRejectedValue(new Error('x')) } });
        fireEvent.click(screen.getByRole('button', { name: L.surface.resolve.applyFix }));
        expect((await screen.findByRole('alert')).textContent).toBe(L.surface.resolve.failed);
    });
});

describe('SimulatePanel', () => {
    it('draws the path, and sends a request with the path and the typed values (never a result)', () => {
        const props = mount(SimulatePanel);
        const stops = seen.surface!.path.stops.map((s) => s.name);
        expect(stops.length).toBeGreaterThan(1);
        fireEvent.change(screen.getByLabelText(L.surface.simulate.valuesLabel), { target: { value: 'amount=100' } });
        fireEvent.click(screen.getByRole('button', { name: L.surface.simulate.run }));
        expect(props.onCompose).toHaveBeenCalledWith(fillTemplate(L.surface.simulate.requestText, { path: stops.join(' → '), values: 'amount=100' }));
        expect(screen.getByRole('status').textContent).toBe(L.surface.simulate.sent);
    });

    it('cannot run without a composer, and says so', () => {
        mount(SimulatePanel, { onCompose: undefined });
        expect((screen.getByRole('button', { name: L.surface.simulate.run }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText(L.surface.simulate.noComposer)).toBeTruthy();
    });
});
