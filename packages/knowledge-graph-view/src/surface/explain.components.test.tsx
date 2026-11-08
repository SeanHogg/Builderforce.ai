// @vitest-environment jsdom
/** What the user sees of the explanations: the cut-graph notice, the sync wording and the one-station path. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { dataCoverage } from './dataCoverage';
import { counted } from './plural';
import { LinesPanel } from './LinesPanel';
import { makeOverlay, PRESETS } from './overlays';
import { truncatedFixture } from './outlineFixture';
import { pathOfLine } from './path';
import { PathStrip } from './PathStrip';
import { ScaleLine } from './ScaleLine';
import { buildLines } from './lines';
import { buildStations } from './stations';
import { parityText, syncPill } from './syncPill';

const E = L.surface.explain;
const stats = { nodes: 743, edges: 516, sources: 3038 };
const scale = (over: Partial<Parameters<typeof ScaleLine>[0]> = {}) => render(
    <span data-testid="scale"><ScaleLine labels={L} stats={stats} truncated compact={false} showAll={false} drawn={743} total={743} onShowAll={vi.fn()} {...over} /></span>,
);

describe('the cut-graph notice', () => {
    it('replaces the vague "most important part" text when the server sent no outline', () => {
        scale({ capped: { shown: 119, total: 3038, cut: true } });
        expect(screen.getByTestId('kg-map-cut').textContent).toBe(fillTemplate(E.cutNote, { shown: '119', files: counted(L, 'file', 3038, { count: (3038).toLocaleString() }) }));
        expect(screen.getByTestId('scale').textContent).not.toContain('search reaches all');
    });

    it('reads as the scale sentence when the map came from a complete outline', () => {
        scale({ stations: 20, files: 3038 });
        expect(screen.queryByTestId('kg-map-cut')).toBeNull();
        expect(screen.getByTestId('scale').textContent).toBe(fillTemplate(L.surface.scaleSummary, { stations: '20 stations', files: '3,038 files', nodes: '743' }));
    });
});

describe('"Not set up" says why', () => {
    const graph = truncatedFixture(false);
    const stations = buildStations(graph);
    const props = {
        lines: buildLines(graph, stations), stations, labels: L, lineId: null, selectedStation: null, onSelectLine: vi.fn(), onSelectStation: vi.fn(),
        overlay: makeOverlay(PRESETS.activity, stations.stations),
    };

    it('gives the reason in the legend row when the coverage facts are known', () => {
        render(<LinesPanel {...props} coverage={dataCoverage(graph)} />);
        const row = screen.getByTestId('kg-surface-legend').querySelector('[data-channel="colour"][data-status="not-set-up"]')!;
        expect(row.textContent).toContain(L.surface.notSetUp);
        expect(row.textContent).toContain(fillTemplate(E.whyNoOutline, { shown: '1', files: '5 files' }));
        expect(row.textContent).toContain(E.legendNotSetUp);
    });

    it('stays "Not set up" alone without them', () => {
        render(<LinesPanel {...props} />);
        const row = screen.getByTestId('kg-surface-legend').querySelector('[data-channel="colour"][data-status="not-set-up"]')!;
        expect(row.textContent).not.toContain(E.whyNoOutline.slice(0, 12));
    });
});

describe('the legend', () => {
    const graph = truncatedFixture(true);
    const stations = buildStations(graph);
    const props = {
        lines: buildLines(graph, stations), stations, labels: L, lineId: null, selectedStation: null, onSelectLine: vi.fn(), onSelectStation: vi.fn(),
        overlay: makeOverlay(PRESETS.quality, stations.stations),
    };

    it('names the colour of each finding kind while the System camera is on, and only then', () => {
        const { rerender } = render(<LinesPanel {...props} kinds={['cycle', 'unused-file']} />);
        expect(screen.getByTestId('kg-kinds-legend').querySelectorAll('[data-kind]').length).toBe(2);
        rerender(<LinesPanel {...props} />);
        expect(screen.queryByTestId('kg-kinds-legend')).toBeNull();
    });

    it('says "Reached" for a coverage channel fed by static reach', () => {
        const reachedStations = { ...stations, stations: stations.stations.map((s) => ({ ...s, cov: 0.5, covProvenance: 'heuristic' as const })) };
        render(<LinesPanel {...props} stations={reachedStations} overlay={makeOverlay(PRESETS.quality, reachedStations.stations)} />);
        const row = screen.getByTestId('kg-surface-legend').querySelector('[data-channel="ring"]')!;
        expect(row.textContent).toContain(L.surface.map.stats.reached);
    });
});

describe('the sync strip', () => {
    const local0 = { local: { files: 0, docs: 0 }, server: { files: 2945, docs: 0 }, sources: [] };

    it('says the folder is not reviewed on this machine instead of "0 here"', () => {
        expect(parityText(L, local0)).toBe(counted(L, 'fileServerOnly', 2945, { server: (2945).toLocaleString() }));
    });

    it('is never "Synced" when the counts differ: a folder held only on the server reads as such (neutral), the same as the parity line', () => {
        const pill = syncPill({ labels: L, review: { status: 'idle' }, stale: false, refreshFailed: false, sync: local0 });
        expect(pill).toMatchObject({ kind: 'serverOnly', state: 'serverOnly', tab: 'server' });
    });
});

describe('a one-station path', () => {
    const graph = truncatedFixture(true);
    const stations = buildStations(graph);
    const one = { stops: [{ id: 'a', name: 'vscode/src' }], hops: [] };

    it('disables stepping and the sequence and says why', () => {
        render(<PathStrip path={one} step={0} labels={L} onStep={vi.fn()} pathTitle="vscode line" onOpenPanel={vi.fn()} />);
        expect(screen.getByTestId('kg-path-one-station').textContent).toBe(E.oneStation);
        expect((screen.getByRole('button', { name: L.surface.path.sequence }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: L.surface.path.runToEnd }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.queryByText('Pick a line or a station to draw its sequence.')).toBeNull();
    });

    it('still steps a real path and offers the sequence', () => {
        const line = buildLines(graph, stations).lines[0]!;
        const path = pathOfLine(line, stations.byId);
        const onStep = vi.fn();
        render(<PathStrip path={path} step={0} labels={L} onStep={onStep} onOpenPanel={vi.fn()} />);
        expect(path.stops.length).toBeGreaterThan(1);
        expect(screen.queryByTestId('kg-path-one-station')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: L.surface.pathNext }));
        expect(onStep).toHaveBeenCalledWith(1);
    });
});
