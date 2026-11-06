// @vitest-environment jsdom
/** The scene overlay, the zoom contract, the Act rail, the path strip and the left rail, one by one. */
import { useState, type ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { LENSES, lensesFor } from '../lenses';
import { surfaceFixture } from '../testing';
import { ActPanel } from './ActPanel';
import { actionCards, acceptanceChecks, findingSource } from './actModel';
import { CAMERAS } from './cameras';
import { LinesPanel } from './LinesPanel';
import { buildLines } from './lines';
import { makeOverlay, PRESETS } from './overlays';
import { pathOfLine } from './path';
import { entryLabel, stationNote } from './pathNotes';
import { PathStrip } from './PathStrip';
import { QuestionBar } from './QuestionBar';
import { MORE_QUESTIONS, questionForLens } from './questions';
import type { SceneProps } from './registry';
import { missingFilesOf, SceneOverlay, type SceneOverlayProps } from './SceneOverlay';
import { buildStations } from './stations';
import { TransitMap } from './TransitMap';
import { useSurface } from './useSurface';
import { useZoomHost, ZoomProvider, type ZoomApi } from './zoom';

const graph = surfaceFixture();
const model = buildStations(graph);
const lines = buildLines(graph, model);
const overlay = makeOverlay(PRESETS.risk, model.stations);
const lenses = lensesFor(graph);
const unusedFinding: Finding = { id: 'f-unused', kind: 'unused-export', pack: 'code', nodes: ['src:sys::api/routes.ts' as Finding['nodes'][number]], severity: 'warn', params: {} };

/** A probe registry: what the active camera registered. */
function probe() {
    const seen: { api: ZoomApi | null } = { api: null };
    const host = { register: (a: ZoomApi) => { seen.api = a; }, unregister: (a: ZoomApi) => { if (seen.api === a) seen.api = null; } };
    return { seen, host };
}

describe('the zoom contract', () => {
    it('the transit map registers an api whose zoom moves its viewBox and whose Fit restores it', () => {
        const { seen, host } = probe();
        const { container } = render(
            <ZoomProvider host={host}>
                <TransitMap
                    stations={model} lines={lines} overlay={overlay} labels={L} lit={null} lineId={lines.lines[0]!.id} selectedStation={null} pins={[]}
                    reducedMotion onSelectStation={vi.fn()} onSelectLine={vi.fn()} label="map"
                />
            </ZoomProvider>,
        );
        const width = () => Number(container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
        const fitted = width();
        expect(seen.api).not.toBeNull();
        act(() => seen.api!.zoomIn());
        const closer = width();
        expect(closer).toBeLessThan(fitted);
        act(() => seen.api!.zoomOut());
        expect(width()).toBeGreaterThan(closer);
        act(() => seen.api!.zoomIn());
        act(() => seen.api!.fit());
        expect(width()).toBe(fitted);
    });

    it('the HTML cameras (System here) register a CSS-scale zoom, and a camera that leaves releases it', () => {
        const { seen, host } = probe();
        const System = CAMERAS.find((c) => c.id === 'system')!.component as ComponentType<SceneProps>;
        function Harness() {
            const surface = useSurface(graph, null);
            return (
                <System
                    mode="system" graph={graph} drawn={{ nodes: graph.nodes, edges: graph.edges }} lens={LENSES.structure} labels={L} rootTitle="sys" selected={null}
                    focus={[]} reducedMotion surface={surface} onSelect={vi.fn()} onShow={vi.fn()}
                />
            );
        }
        const { container, unmount } = render(<ZoomProvider host={host}><Harness /></ZoomProvider>);
        const scale = () => Number(container.querySelector('[data-scale]')!.getAttribute('data-scale'));
        expect(scale()).toBe(1);
        act(() => seen.api!.zoomIn());
        expect(scale()).toBeGreaterThan(1);
        act(() => seen.api!.fit());
        expect(scale()).toBe(1);
        unmount();
        expect(seen.api).toBeNull();
    });
});

function overlayProps(over: Partial<SceneOverlayProps> = {}): SceneOverlayProps {
    return {
        labels: L, cameras: CAMERAS, mode: 'transit', onMode: vi.fn(), zoom: null, stations: model.stations, question: 'where', onQuestion: vi.fn(),
        lenses, lens: 'structure', onLens: vi.fn(), stats: { nodes: 452, edges: 67, sources: 3 }, truncated: true, compact: false, showAll: false,
        drawn: 100, total: 452, onShowAll: vi.fn(), ...over,
    };
}

describe('SceneOverlay', () => {
    it('is a View group of the cameras WITHOUT Sequence, and picking one calls onMode', () => {
        const p = overlayProps();
        render(<SceneOverlay {...p} />);
        const view = within(screen.getByRole('radiogroup', { name: L.viewModesLabel }));
        expect(view.getAllByRole('radio').map((r) => r.textContent)).toEqual([L.viewTransit, L.viewSystem, L.viewGraph, L.viewMap, L.view3d, L.viewHeat, L.viewList]);
        fireEvent.click(view.getByRole('radio', { name: L.viewHeat }));
        expect(p.onMode).toHaveBeenCalledWith('heat');
    });

    it('drives the active camera\'s zoom with +, − and Fit, and disables them when none is registered', () => {
        const zoom: ZoomApi = { zoomIn: vi.fn(), zoomOut: vi.fn(), fit: vi.fn() };
        const { rerender } = render(<SceneOverlay {...overlayProps({ zoom })} />);
        fireEvent.click(screen.getByRole('button', { name: L.zoomIn }));
        fireEvent.click(screen.getByRole('button', { name: L.zoomOut }));
        fireEvent.click(screen.getByRole('button', { name: L.zoomReset }));
        expect([zoom.zoomIn, zoom.zoomOut, zoom.fit].map((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1, 1]);
        rerender(<SceneOverlay {...overlayProps({ zoom: null })} />);
        for (const name of [L.zoomIn, L.zoomOut, L.zoomReset]) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('works against a real registry: a registered camera enables the buttons', () => {
        function Host() {
            const host = useZoomHost();
            const [calls, setCalls] = useState(0);
            const Camera = () => { host.register({ zoomIn: () => setCalls((n) => n + 1), zoomOut: () => undefined, fit: () => undefined }); return null; };
            return (<><ZoomProvider host={host}><button type="button" onClick={() => Camera()}>reg</button></ZoomProvider><SceneOverlay {...overlayProps({ zoom: host.api })} /><span data-testid="calls">{calls}</span></>);
        }
        render(<Host />);
        expect((screen.getByRole('button', { name: L.zoomIn }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByText('reg'));
        fireEvent.click(screen.getByRole('button', { name: L.zoomIn }));
        expect(screen.getByTestId('calls').textContent).toBe('1');
    });

    it('shows "Out to" only while there is a level above, and calls onOut', () => {
        const onOut = vi.fn();
        const { rerender } = render(<SceneOverlay {...overlayProps()} />);
        expect(screen.queryByText(/Out to/)).toBeNull();
        rerender(<SceneOverlay {...overlayProps({ outTo: 'Web line', onOut })} />);
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(L.surface.overlay.outTo, { name: 'Web line' }) }));
        expect(onOut).toHaveBeenCalled();
    });

    it('draws the scale note, with Show all on a compact screen', () => {
        const onShowAll = vi.fn();
        render(<SceneOverlay {...overlayProps({ compact: true, onShowAll })} />);
        const note = within(screen.getByTestId('kg-scale-note'));
        expect(note.getByText(new RegExp(fillTemplate(L.statsLine, { nodes: 452, edges: 67, sources: 3 })))).toBeTruthy();
        fireEvent.click(note.getByRole('button', { name: L.showAll }));
        expect(onShowAll).toHaveBeenCalled();
    });

    it('draws the sync error banner with Diagnose only when files are missing', () => {
        const onDiagnose = vi.fn();
        const { rerender } = render(<SceneOverlay {...overlayProps({ missingFiles: 0 })} />);
        expect(screen.queryByTestId('kg-sync-banner')).toBeNull();
        rerender(<SceneOverlay {...overlayProps({ missingFiles: 23, onDiagnose })} />);
        expect(within(screen.getByTestId('kg-sync-banner')).getByText(fillTemplate(L.surface.overlay.missingFiles, { count: 23 }))).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: L.surface.overlay.diagnose }));
        expect(onDiagnose).toHaveBeenCalled();
    });

    it('counts missing files from a sync status: the skipped list, else the gap to the server', () => {
        const base = { local: { files: 10, docs: 0 }, sources: [] };
        expect(missingFilesOf(null)).toBe(0);
        expect(missingFilesOf({ ...base, server: { files: 8, docs: 0 } })).toBe(2);
        expect(missingFilesOf({ ...base, server: { files: 8, docs: 0 }, skipped: [{ path: 'a', reason: 'x' }] })).toBe(1);
        expect(missingFilesOf({ ...base, skipped: [] })).toBe(0);
    });

    it('stacks in flow on a phone', () => {
        render(<SceneOverlay {...overlayProps({ narrow: true })} />);
        expect(screen.getByTestId('kg-scene-overlay').style.position).not.toBe('absolute');
    });
});

describe('QuestionBar', () => {
    const bar = (over: Partial<Parameters<typeof QuestionBar>[0]> = {}) => {
        const p = { labels: L, stations: model.stations, question: 'where' as const, onQuestion: vi.fn(), lenses, lens: 'structure' as const, onLens: vi.fn(), ...over };
        render(<QuestionBar {...p} />);
        return p;
    };

    it('keeps every former lens reachable: the More menu lists each with a "was the {lens} lens" sub-line, and picking one does what its chip did', () => {
        const p = bar();
        fireEvent.click(screen.getByRole('button', { name: L.surface.moreQuestions }));
        const menu = within(screen.getByRole('menu', { name: L.surface.moreQuestions }));
        for (const lens of lenses) {
            const q = questionForLens(lens.id);
            const primary = q !== undefined && !MORE_QUESTIONS.some((m) => m.id === q);
            if (primary) {
                // a lens that is a primary question's twin opens with that pill
                expect(document.querySelector(`button[data-question="${q}"]`), lens.id).toBeTruthy();
                continue;
            }
            const sub = fillTemplate(L.surface.overlay.lensSub, { lens: L.lenses[lens.id] });
            expect(menu.getByText(sub), lens.id).toBeTruthy();
        }
        // a question item calls onQuestion; Compare (no question) calls onLens
        fireEvent.click(menu.getByRole('menuitem', { name: new RegExp(`^${L.surface.questions.copied}`) }));
        expect(p.onQuestion).toHaveBeenCalledWith('copied');
        fireEvent.click(screen.getByRole('button', { name: L.surface.moreQuestions }));
        if (lenses.some((l) => l.id === 'compare')) {
            fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${L.lenses.compare}`) }));
            expect(p.onLens).toHaveBeenCalledWith('compare');
        }
    });

    it('marks a question whose data was never collected, and says so in its tooltip', () => {
        const bare = model.stations.map((s) => ({ ...s, cov: undefined }));
        bar({ stations: bare });
        const pill = document.querySelector('button[data-question="untested"]') as HTMLElement;
        expect(pill.title).toContain(L.surface.answerNotSetUp);
    });

    it('shows "{family} only ✕" while a family filter is on, and ✕ clears it', () => {
        const onClearFamily = vi.fn();
        bar({ family: 'Behavioural', onClearFamily });
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(L.surface.overlay.clearFamily, { family: 'Behavioural' }) }));
        expect(onClearFamily).toHaveBeenCalled();
        expect(screen.getByText(new RegExp(fillTemplate(L.surface.overlay.familyOnly, { family: 'Behavioural' })))).toBeTruthy();
    });

    it('shows no family chip without a filter', () => {
        bar();
        expect(document.querySelector('[data-family-chip]')).toBeNull();
    });
});

describe('the family filter on the surface', () => {
    it('narrows the patterns question to a family, and any other question drops it', () => {
        const names = (surface: ReturnType<typeof useSurface>) => [...(surface.lit ?? [])].map((id) => surface.stations.byId.get(id)!.name);
        let surface!: ReturnType<typeof useSurface>;
        function Probe() { surface = useSurface(graph, null); return null; }
        render(<Probe />);
        act(() => surface.setFamily('repository'));
        expect(surface.question).toBe('patterns');
        expect(surface.family).toBe('repository');
        expect(names(surface)).toEqual(['API']);
        act(() => surface.setFamily('no-such-family'));
        expect(names(surface)).toEqual([]);
        act(() => surface.setQuestion('wrong'));
        expect(surface.family).toBeNull();
    });
});

describe('ActPanel rail', () => {
    const withUnused = { ...graph, findings: [...graph.findings, unusedFinding] };
    const web = model.stations.find((s) => s.name === 'Web app')!;
    const path = pathOfLine(lines.lines[0]!, model.byId);
    const act = (over: Partial<Parameters<typeof ActPanel>[0]> = {}) => {
        const p = {
            graph: withUnused, findings: withUnused.findings, labels: L, station: null, stations: model.stations, scopeName: null, compact: false,
            onClearScope: vi.fn(), onShow: vi.fn(), onCompose: vi.fn(), onResolve: vi.fn(), onOpenPanel: vi.fn(), ...over,
        };
        render(<ActPanel {...p} />);
        return p;
    };
    const cardOf = (id: string) => document.querySelector(`[data-card="${id}"]`)!.parentElement as HTMLElement;

    it('draws at most three cards: numbered, titled, with where the finding came from', () => {
        act();
        const cards = document.querySelectorAll('[data-card]');
        expect(cards.length).toBe(3);
        expect([...cards].map((c) => c.querySelector('span')!.textContent)).toEqual(['1', '2', '3']);
        // partition-violation is an error and ranks first
        expect(cards[0]!.textContent).toContain(L.findingKinds.partitionViolation ?? '');
        expect(cardOf('f-unused').querySelector('[data-source="exact"]')).toBeTruthy();
    });

    it('offers Apply only on a finding with a deterministic fix AND a host that can apply it; Apply opens Resolve', () => {
        const noHost = act({ canApply: false });
        expect(document.querySelector('[data-act="apply"]')).toBeNull();
        expect(noHost.onResolve).not.toHaveBeenCalled();
    });

    it('Apply routes through Resolve, Prompt puts the fixed request in the composer, Show selects the nodes', () => {
        const p = act({ canApply: true });
        const apply = within(cardOf('f-unused')).getByRole('button', { name: fillTemplate(L.surface.act.cardAction, { action: L.surface.act.apply, title: L.findingKinds.unusedExport ?? 'unused-export' }) });
        fireEvent.click(apply);
        expect(p.onResolve).toHaveBeenCalledWith(unusedFinding);
        // the other cards have no Apply
        expect(document.querySelectorAll('[data-act="apply"]')).toHaveLength(1);
        fireEvent.click(within(cardOf('f-unused')).getByText(L.surface.act.prompt));
        expect(p.onCompose).toHaveBeenCalledTimes(1);
        expect((p.onCompose as ReturnType<typeof vi.fn>).mock.calls[0]![0]).not.toMatch(/[{}]/);
        fireEvent.click(within(cardOf('f-unused')).getByText(L.surface.act.show));
        expect(p.onShow).toHaveBeenCalledWith(unusedFinding.nodes);
    });

    it('has no Prompt without a composer', () => {
        act({ onCompose: undefined });
        expect(document.querySelector('[data-act="prompt"]')).toBeNull();
    });

    it('links the Fix queue with the open count, and opens the Resolve drawer', () => {
        const p = act();
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(L.surface.act.fixQueue, { count: 3 }) }));
        expect(p.onOpenPanel).toHaveBeenCalledWith('resolve');
    });

    it('is Coverage · API · Fix queue links on a phone', () => {
        const p = act({ compact: true });
        fireEvent.click(screen.getByRole('button', { name: L.surface.act.linkCoverage }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.act.linkApi }));
        expect(p.onOpenPanel).toHaveBeenNthCalledWith(1, 'coverage');
        expect(p.onOpenPanel).toHaveBeenNthCalledWith(2, 'api');
    });

    it('keeps this run as a test: composes a fixed request naming the path, its stops and its checks', () => {
        const p = act({ path, pathTitle: 'Web line · GET /users' });
        fireEvent.click(screen.getByRole('button', { name: L.surface.act.keepButton }));
        const text = (p.onCompose as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
        expect(text).toContain('Web line · GET /users');
        expect(text).toContain('main.tsx → Web app → API → repositories');
        expect(text).not.toMatch(/[{}]/);
    });

    it('offers no test card without a path or a composer', () => {
        act({ path: null });
        expect(screen.queryByText(L.surface.act.keepTitle)).toBeNull();
        expect(screen.queryByTestId('kg-done-when')).toBeNull();
    });

    it('ends with "This path is done when…", one checkable line per finding on the path', () => {
        act({ path });
        const footer = within(screen.getByTestId('kg-done-when'));
        expect(footer.getByText(L.surface.act.doneTitle)).toBeTruthy();
        expect(footer.getAllByRole('listitem')).toHaveLength(3);
        expect(footer.getAllByRole('listitem')[0]!.textContent).toContain(L.findingKinds.partitionViolation ?? '');
    });

    it('says nothing is open when the path has no findings', () => {
        act({ path, findings: [] });
        expect(within(screen.getByTestId('kg-done-when')).getByText(L.surface.act.doneNone)).toBeTruthy();
    });

    it('shows the station stats as a grid, "Not set up" muted', () => {
        act({ station: web, scopeName: 'Web app' });
        const facts = within(screen.getByTestId('kg-station-facts'));
        expect(document.querySelectorAll('[data-fact]')).toHaveLength(6);
        expect(facts.getAllByText(L.surface.notSetUp).length).toBeGreaterThan(0);
    });

    it('keeps Insights and the Lens panel in a collapsed Details section that opens on demand', () => {
        act({ children: <p>insights and lens</p> });
        const toggle = screen.getByRole('button', { name: L.surface.act.detailsTitle });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.getByText('insights and lens').closest('[hidden]')).not.toBeNull(); // mounted (state kept), hidden
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText('insights and lens').closest('[hidden]')).toBeNull();
    });
});

describe('actModel', () => {
    it('ranks errors first, then wider findings, and caps at three', () => {
        const many: Finding[] = Array.from({ length: 5 }, (_, i) => ({ ...unusedFinding, id: `f${i}`, severity: i === 4 ? 'error' : 'info' }));
        const cards = actionCards(many, true);
        expect(cards).toHaveLength(3);
        expect(cards[0]!.finding.id).toBe('f4');
        expect(cards[0]!.level).toBe(5);
        expect(cards.every((c) => c.canApply)).toBe(true);
        expect(actionCards(many, false).every((c) => !c.canApply)).toBe(true);
    });

    it('derives where a finding came from', () => {
        expect(findingSource({ kind: 'unused-export' })).toBe('exact');
        expect(findingSource({ kind: 'coverage-gap' })).toBe('analyzer');
        expect(findingSource({ kind: 'contradiction' })).toBe('model');
    });

    it('lists one check per finding and counts the rest', () => {
        const many: Finding[] = Array.from({ length: 8 }, (_, i) => ({ ...unusedFinding, id: `f${i}` }));
        const { checks, more } = acceptanceChecks(many, L, new Map());
        expect(checks).toHaveLength(6);
        expect(more).toBe(2);
    });
});

describe('PathStrip', () => {
    const path = pathOfLine(lines.lines[0]!, model.byId);
    const strip = (over: Partial<Parameters<typeof PathStrip>[0]> = {}) => {
        const p = { path, step: 1, labels: L, onStep: vi.fn(), lineName: 'Web', stations: model.byId, onOpenPanel: vi.fn(), ...over };
        render(<PathStrip {...p} />);
        return p;
    };
    const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

    it('titles the strip with the line and where it enters, in mono', () => {
        strip({ entry: 'GET /users/:id' });
        expect(screen.getByText(fillTemplate(L.surface.path.title, { line: fillTemplate(L.surface.lineName, { name: 'Web' }), entry: 'GET /users/:id' }))).toBeTruthy();
    });

    it('resets to the first stop, steps either way and runs to the end', () => {
        const p = strip();
        click(L.surface.path.reset);
        expect(p.onStep).toHaveBeenLastCalledWith(0);
        click(L.surface.pathNext);
        expect(p.onStep).toHaveBeenLastCalledWith(2);
        click(L.surface.pathBack);
        expect(p.onStep).toHaveBeenLastCalledWith(0);
        click(L.surface.path.runToEnd);
        expect(p.onStep).toHaveBeenLastCalledWith(path.stops.length - 1);
    });

    it('offers Run to end only before the last stop', () => {
        strip({ step: path.stops.length - 1 });
        expect((screen.getByRole('button', { name: L.surface.path.runToEnd }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('opens the Simulate drawer from "Simulate with values"', () => {
        const p = strip();
        click(L.surface.path.simulate);
        expect(p.onOpenPanel).toHaveBeenCalledWith('simulate');
    });

    it('notes a stop from its metrics ("no tests") and patterns', () => {
        strip();
        const repo = model.stations.find((s) => s.name === 'repositories')!;
        expect(document.querySelector(`[data-stop-note="${repo.id}"]`)!.textContent).toContain(L.surface.path.noTests);
        const api = model.stations.find((s) => s.name === 'API')!;
        expect(document.querySelector(`[data-stop-note="${api.id}"]`)!.textContent).toContain(api.patterns[0]!);
    });

    it('swaps the stop chips for the sequence diagram with the Sequence toggle', () => {
        strip();
        expect(document.querySelector('[data-lifeline]')).toBeNull();
        const toggle = screen.getByRole('button', { name: L.surface.path.sequence });
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(document.querySelectorAll('[data-lifeline]')).toHaveLength(path.stops.length);
        expect(screen.queryByRole('list', { name: L.surface.path.stops })).toBeNull();
        fireEvent.click(toggle);
        expect(document.querySelector('[data-lifeline]')).toBeNull();
    });

    it('copies the Mermaid of exactly what the Sequence camera draws', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        strip();
        click(L.copyMermaid);
        expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^sequenceDiagram\n    participant P1 as main\.tsx/));
    });

    it('is a vertical list on a phone and keeps the hops between the stops', () => {
        strip({ narrow: true });
        const list = screen.getByRole('list', { name: L.surface.path.stops });
        expect(list.style.flexDirection).toBe('column');
        expect(list.querySelectorAll('[data-hop]')).toHaveLength(path.hops.length);
    });

    it('draws a hop\'s detail (what travels over it) when the edge carries one', () => {
        const withDetail = { ...path, hops: path.hops.map((h, i) => (i === 0 ? { ...h, detail: 'PUT 1.4 MB' } : h)) };
        strip({ path: withDetail });
        expect(screen.getByText(/PUT 1\.4 MB/)).toBeTruthy();
    });
});

describe('pathNotes', () => {
    it('names the first route of the entry station, else the station', () => {
        const entry = model.stations.find((s) => s.name === 'API')!;
        expect(entryLabel(graph, entry)).toBe('GET /users/:id');
        const web = model.stations.find((s) => s.name === 'Web app')!;
        expect(entryLabel(graph, web)).toBe('Web app');
        expect(entryLabel(graph, undefined)).toBe('');
    });

    it('writes no note for a clean, tested station', () => {
        const clean = { ...model.stations[0]!, cov: 0.9, patterns: [], findingIds: [] };
        expect(stationNote(clean, L)).toBeNull();
    });
});

describe('LinesPanel rail', () => {
    const base = { lines, stations: model, overlay, labels: L, lineId: lines.lines[0]!.id, selectedStation: null, onSelectLine: vi.fn(), onSelectStation: vi.fn() };

    it('is the 250px rail with the heading, and anchors the legend to the bottom', () => {
        render(<LinesPanel {...base} rail />);
        const rail = screen.getByTestId('kg-lines-rail');
        expect(rail.style.width).toBe('250px');
        expect(screen.getByText(L.surface.rail.heading)).toBeTruthy();
        expect(screen.getByTestId('kg-surface-legend').style.marginTop).toBe('auto');
        expect(screen.getByText(L.surface.rail.legendHeading)).toBeTruthy();
    });

    it('draws a glyph per bound channel plus the issue pins, and a not-set-up channel says so', () => {
        const bare = buildStations(graph);
        render(<LinesPanel {...base} stations={bare} overlay={makeOverlay(PRESETS.ownership, model.stations.map((s) => ({ ...s, owner: undefined })))} />);
        const legend = screen.getByTestId('kg-surface-legend');
        expect(legend.querySelectorAll('svg[data-glyph]').length).toBeGreaterThanOrEqual(5);
        expect(legend.querySelector('[data-channel="pins"]')).toBeTruthy();
        expect(legend.querySelector('[data-channel="colour"][data-status="not-set-up"]')!.textContent).toContain(L.surface.notSetUp);
    });

    it('shows the stop count of every line and the stops of the selected one in mono', () => {
        render(<LinesPanel {...base} />);
        expect(document.querySelectorAll('[data-line]')).toHaveLength(lines.lines.length);
        expect(document.querySelectorAll('[data-station-row]')).toHaveLength(lines.lines[0]!.stops.length);
    });
});
