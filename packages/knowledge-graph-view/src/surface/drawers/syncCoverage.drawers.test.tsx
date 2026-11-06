import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { surfaceFixture } from '../../testing';
import type { KnowledgeGraphSource, SyncStatus } from '../../types';
import type { PanelProps } from '../registry';
import { useSurface } from '../useSurface';
import { CoveragePanel } from './CoveragePanel';
import { SyncPanel } from './SyncPanel';

const graph = surfaceFixture();

const status: SyncStatus = {
    local: { files: 10, edges: 20, docs: 2 }, server: { files: 8, edges: 20, docs: 2 },
    skipped: [{ path: 'big.json', bytes: 2_000_000, reason: 'too-large' }, { path: 'vendor/x', reason: 'nested-checkout' }, { path: 'a.local', reason: 'local-state' }],
    sources: [{ id: 'coverage', state: 'absent' }, { id: 'traces', state: 'absent' }, { id: 'openapi', state: 'estimated' }, { id: 'code', state: 'collected' }],
};
const history = {
    total: 2,
    loading: false,
    commits: [
        { sha: 'aaaaaaaa1', title: 'old fix', at: '2026-01-01T00:00:00Z', refs: ['x'] },
        { sha: 'bbbbbbbb2', title: 'new work', at: '2026-01-05T00:00:00Z', refs: ['x', 'y'], author: 'Sean' },
    ],
};
const src = (over: Partial<KnowledgeGraphSource> = {}): KnowledgeGraphSource => ({ scopes: async () => [], load: async () => null, syncStatus: async () => status, ...over });

function mount(Panel: ComponentType<PanelProps>, over: Partial<PanelProps> & { graph?: KnowledgeGraph } = {}) {
    const props = { onShow: vi.fn(), onCompose: vi.fn(), onClose: vi.fn(), ...over };
    function Harness() {
        const surface = useSurface(over.graph ?? graph, null);
        return <Panel graph={over.graph ?? graph} labels={L} surface={surface} {...props} />;
    }
    render(<Harness />);
    return props;
}

describe('SyncPanel (delta, sources, excluded, diagnostics)', () => {
    const base = { source: src({ history: async () => history }), rootId: 'sys', sync: status, history, lastReviewedAt: '2026-01-03T00:00:00Z', diagnosticsText: () => 'DIAG TEXT' };

    it('feeds the commits since the last review, newest first, pending before applied', () => {
        mount(SyncPanel, base);
        const rows = [...screen.getByTestId('kg-sync-delta').querySelectorAll('li')];
        expect(rows.map((r) => r.getAttribute('data-sha'))).toEqual(['bbbbbbbb2', 'aaaaaaaa1']);
        expect(rows[0]!.getAttribute('data-state')).toBe('pending');
        expect(rows[1]!.getAttribute('data-state')).toBe('applied');
        expect(rows[0]!.textContent).toContain('Sean');
    });

    it('says the delta feed is not available when the source keeps no history', () => {
        mount(SyncPanel, { ...base, source: src(), history: undefined });
        expect(screen.getByTestId('kg-sync-delta-unavailable').textContent).toBe(L.surface.unavailable.notHere);
    });

    it('says the commits are loading, never "no commits", while history is on the way', () => {
        mount(SyncPanel, { ...base, history: { commits: [], total: 0, loading: true } });
        expect(screen.getByTestId('kg-sync-delta-loading').textContent).toBe(L.surface.sync.deltaLoading);
        expect(screen.queryByText(L.surface.sync.deltaEmpty)).toBeNull();
    });

    it('puts a detail line under each pipeline step and a note on each parity bar', () => {
        mount(SyncPanel, base);
        expect(document.querySelector('[data-step="walk"]')!.textContent).toContain(L.surface.syncStepDetails.walk);
        expect(document.querySelectorAll('[data-step]')).toHaveLength(6);
        expect(screen.getByTestId('kg-parity-note-files').textContent).toContain('2 not on the server yet.');
        expect(screen.getByTestId('kg-parity-note-files').textContent).toContain('1 were too large to store.');
        expect(screen.getByTestId('kg-parity-note-docs').textContent).toBe(L.surface.sync.parityAll);
    });

    it('lists the real excluded folders and keeps them out of the skipped files', () => {
        mount(SyncPanel, base);
        const excluded = screen.getByTestId('kg-sync-excluded').textContent!;
        expect(excluded).toContain('vendor/x');
        expect(excluded).toContain('a.local');
        const skipped = screen.getByTestId('kg-sync-skipped').textContent!;
        expect(skipped).toContain('big.json');
        expect(skipped).not.toContain('vendor/x');
    });

    it('offers each source its action: compose, open the API drawer, or nothing', () => {
        const props = mount(SyncPanel, base);
        fireEvent.click(document.querySelector('[data-source="coverage"] button')!);
        expect(props.onCompose).toHaveBeenCalledWith(L.surface.sync.setUpV8Request);
        fireEvent.click(document.querySelector('[data-source="traces"] button')!);
        expect(props.onCompose).toHaveBeenCalledWith(L.surface.sync.turnOnRequest);
        expect(document.querySelector('[data-source="openapi"] [data-action="actionGenerate"]')).toBeTruthy();
        expect(document.querySelector('[data-source="code"] button')).toBeNull();
    });

    it('shows "Not available here" instead of a dead button when there is no composer', () => {
        mount(SyncPanel, { ...base, onCompose: undefined });
        expect(document.querySelector('[data-source="coverage"] button')).toBeNull();
        expect(document.querySelector('[data-source="coverage"] [data-testid="kg-source-unavailable"]')).toBeTruthy();
    });

    it('draws the diagnostics in a pre and resends skipped files through the review flow', () => {
        const onResendSkipped = vi.fn();
        mount(SyncPanel, { ...base, onResendSkipped });
        expect(screen.getByTestId('kg-sync-diagnostics').tagName).toBe('PRE');
        expect(screen.getByTestId('kg-sync-diagnostics').textContent).toBe('DIAG TEXT');
        fireEvent.click(screen.getByTestId('kg-sync-resend'));
        expect(onResendSkipped).toHaveBeenCalledTimes(1);
    });

    it('marks resend unavailable when the host cannot review', () => {
        mount(SyncPanel, base);
        expect(screen.queryByTestId('kg-sync-resend')).toBeNull();
        expect(screen.getByTestId('kg-sync-resend-unavailable')).toBeTruthy();
    });
});

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
