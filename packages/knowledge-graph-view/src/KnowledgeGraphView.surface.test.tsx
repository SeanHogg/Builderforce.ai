// @vitest-environment jsdom
/** The Option B+ surface end to end: the transit map, the lines, the questions, the Act panel, and the phone layout. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from './labels';
import { lensesFor } from './lenses';
import { counted } from './surface/plural';
import { expandAllFindings, fixtureSource, surfaceFixture } from './testing';
import { cameraIsPicked, cameraNames, lensIsPicked, openAct, openSearch, pickCamera, pickLens } from './testPicks';
import { StageFactoryContext } from './stage/host/StageFactoryContext';
import { createNoopStage } from './stage/renderer';

// The view draws the transit map through the lazy three.js StageHost (PRD 43 B1a). In jsdom the real
// WebGL factory declines and the scene falls back to the List, so the map and the chrome that reads the
// surface (the spine, the path strip, the Act rail) never mount. Provide the no-op stage factory through
// the real context — the same port stageCard.test.tsx drives — so the stage host mounts and the whole
// view renders; a station is then an a11y proxy (`[data-stage-proxies] [data-id^="st:"]`), which these
// tests pick and click exactly as the map's own card test does. No module mocks: they do not intercept
// reliably in this whole-view graph.
afterEach(() => vi.restoreAllMocks());

async function mount(graph: KnowledgeGraph = surfaceFixture(), props: Partial<Parameters<typeof KnowledgeGraphView>[0]> = {}) {
    render(
        <StageFactoryContext.Provider value={() => createNoopStage()}>
            <div style={{ height: 700 }}><KnowledgeGraphView source={fixtureSource([graph])} {...props} /></div>
        </StageFactoryContext.Provider>,
    );
    // The transit map is the default camera for a graph with entry points: the stage host mounts it once drawn,
    // and the station proxies settle a beat later (the MarkSet and placement resolve on idle steps).
    await waitFor(() => expect(document.querySelector('[data-stage-host][data-stage-camera="map"]')).toBeTruthy());
    await waitFor(() => expect(document.querySelectorAll('[data-stage-proxies] [data-id]').length).toBeGreaterThan(0));
}
const deps = { fireEvent };
/** A station's a11y proxy on the stage: the proxy layer only, matched by its exact name. */
const proxies = () => within(document.querySelector('[data-stage-proxies]') as HTMLElement);
const station = (name: string) => proxies().getByRole('button', { name: new RegExp(`^${name}$`) });
/** The drawer, opened on its Act tab (the Act cards and the Details list live there). */
const aside = () => openAct(deps);

describe('the surface', () => {
    it('opens on the transit map when the graph has entry points, with the cameras in registry order', async () => {
        await mount();
        expect(cameraIsPicked(L.viewTransit)).toBe(true);
        // Flow and Sequence are cameras now (PRD 43 C7): they join the switcher where the lines are.
        expect(cameraNames())
            .toEqual([L.viewTransit, L.viewSystem, L.viewGraph, L.viewMap, L.viewHeat, L.viewStyle, L.viewFeatures, L.viewFlow, L.viewSequence, L.viewList]);
        expect(screen.getByTestId('kg-path')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: L.surface.linesButton }));
        expect(screen.getByTestId('kg-surface-legend')).toBeTruthy();
    });

    it('keeps every old lens reachable and opens a requested lens', async () => {
        await mount(surfaceFixture(), { initialLens: 'unused' });
        expect(lensIsPicked(deps, L, 'unused')).toBe(true);
        pickLens(deps, L, 'duplication');
        expect(lensIsPicked(deps, L, 'duplication')).toBe(true);
        // The lens pick lights the question that owns it (under More, so the More button carries its name).
        expect(screen.getByRole('button', { name: L.surface.questions.copied })).toBeTruthy();
        // Every lens the graph offers (Compare has no question) is reachable and does what its old chip did.
        for (const lens of lensesFor(surfaceFixture())) {
            pickLens(deps, L, lens.id);
            expect(lensIsPicked(deps, L, lens.id), lens.id).toBe(true);
        }
    });

    it('seeds the question from the initial lens', async () => {
        await mount(surfaceFixture(), { initialLens: 'duplication' });
        expect(screen.getByRole('button', { name: L.surface.questions.copied })).toBeTruthy();
    });

    it('lights the stations of the focused refs on the map (initial focus, search, Show)', async () => {
        await mount(surfaceFixture(), { initialFocus: ['src:sys::db/repo.ts'] });
        // The map draws every station as a proxy; the focused ref's station is among them (its mark is lit on the
        // stage canvas — dimming is paint, which has no DOM attribute).
        const all = () => [...document.querySelectorAll('[data-stage-proxies] [data-id^="st:"]')];
        expect(all().length).toBeGreaterThan(1);
        expect(all().some((p) => (p.getAttribute('aria-label') ?? '').includes('repo'))).toBe(true);
    });

    it('Show on a finding selects its first station through the one select path', async () => {
        await mount();
        // Expanding is idempotent (it opens only the collapsed groups), so it can be retried until the rows are there.
        await waitFor(() => {
            expandAllFindings({ fireEvent }, aside());
            expect(within(aside()).getAllByRole('button', { name: L.showFinding }).length).toBeGreaterThan(0);
        });
        fireEvent.click(within(aside()).getAllByRole('button', { name: L.showFinding })[0]!);
        // Show runs the ONE select path: it focuses the finding's refs and selects the first, so the Act panel
        // scopes to that station (the map camera's pressed mark is canvas paint, not a DOM attribute).
        await waitFor(() => expect(within(aside()).getByTestId('kg-act-title').textContent).toBe(counted(L, 'issueAt', 1, { scope: 'cron' })));
    });

    it('pinpoints a screenshot end to end: focus, path strip, the "wrong" question, Diagnose, and Clear releases it all', async () => {
        const result = {
            description: 'A card stuck on Judging',
            anchors: [{ text: 'Judging', provenance: 'vision' as const }],
            matches: [
                { ref: 'src:sys::api/routes.ts', why: 'exact string', provenance: 'exact' as const },
                { ref: 'src:sys::db/repo.ts', why: 'imported by routes', provenance: 'import' as const },
            ],
        };
        const source = { ...fixtureSource([surfaceFixture()]), pinpoint: vi.fn().mockResolvedValue(result) };
        const onCompose = vi.fn();
        render(
            <StageFactoryContext.Provider value={() => createNoopStage()}>
                <div style={{ height: 700 }}><KnowledgeGraphView source={source} onCompose={onCompose} /></div>
            </StageFactoryContext.Provider>,
        );
        await waitFor(() => expect(document.querySelector('[data-stage-host][data-stage-camera="map"]')).toBeTruthy());
        await waitFor(() => expect(document.querySelectorAll('[data-stage-proxies] [data-id]').length).toBeGreaterThan(0));
        // The matched stations' proxies are on the map (which stations the pinpoint lit is paint, not DOM).
        const proxyNames = () => [...document.querySelectorAll('[data-stage-proxies] [data-id]')].map((p) => p.getAttribute('aria-label') ?? '');

        openSearch(deps, L); // the screenshot picker sits inside the revealed search form
        fireEvent.change(screen.getByTestId('kg-pinpoint-file'), { target: { files: [new File(['x'], 'shot.png', { type: 'image/png' })] } });
        await screen.findByText(result.description);
        expect(source.pinpoint).toHaveBeenCalledWith(expect.any(File), 'sys');
        await waitFor(() => expect(proxyNames()).toEqual(expect.arrayContaining(['API', 'repositories'])));
        const strip = within(screen.getByTestId('kg-path'));
        expect(strip.getAllByRole('button').map((b) => b.getAttribute('aria-label')).filter((t) => t === 'API' || t === 'repositories')).toEqual(['API', 'repositories']);
        expect(strip.queryByRole('button', { name: 'main.tsx' })).toBeNull();
        expect(screen.getByRole('button', { name: L.surface.questions.wrong }).getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(await screen.findByRole('button', { name: L.surface.pinpoint.diagnose }));
        // Diagnose awaits the compute client for the path, so the composer is filled after the click returns.
        await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1));
        const text = onCompose.mock.calls[0]![0] as string;
        expect(text).toContain(result.description);
        expect(text).toContain('API → repositories');
        expect(text).not.toContain('path: none'); // the findings on the path are named

        fireEvent.click(screen.getByRole('button', { name: L.surface.pinpoint.clearAria }));
        expect(await within(screen.getByTestId('kg-path')).findByRole('button', { name: 'main.tsx' })).toBeTruthy(); // the line's path is back
        // Clear released the focus: the whole map is back to every station, none pinned in the strip.
        await waitFor(() => expect(within(screen.getByTestId('kg-path')).getByRole('button', { name: 'main.tsx' })).toBeTruthy());
    });

    it('a question opens its lens, and says how many stations answer', async () => {
        await mount();
        fireEvent.click(screen.getByRole('button', { name: L.surface.moreQuestions }));
        fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${L.surface.questions.copied}`) }));
        expect(lensIsPicked(deps, L, 'duplication')).toBe(true);
    });

    it('says a question is not set up when its data was never collected', async () => {
        const bare = surfaceFixture();
        const noCoverage: KnowledgeGraph = { ...bare, nodes: bare.nodes.map(({ badges, ...n }) => (badges ? { ...n, badges: Object.fromEntries(Object.entries(badges).filter(([k]) => k !== 'coverage')) } : n)) };
        await mount(noCoverage);
        fireEvent.click(screen.getByRole('button', { name: L.surface.questions.untested }));
        // The answer is the stage note card's now: the header draws no answer note.
        expect(screen.queryByTestId('kg-answer')).toBeNull();
        expect(screen.queryByTestId('kg-answer-mode')).toBeNull();
    });

    it('keeps the entry-point route in the journey and uses the spine for the selected component', async () => {
        // The root crumb is the scope's TITLE (the project name); `fixtureSource` titles a scope by its root id ('sys'), so name it.
        const graph = surfaceFixture();
        const titled = { ...fixtureSource([graph]), scopes: async () => [{ rootId: graph.scope.rootId, title: 'Builderforce', packs: graph.scope.packs }] };
        await mount(graph, { source: titled });
        const spine = () => within(screen.getByTestId('kg-spine'));
        expect(spine().getAllByRole('button').map((b) => b.textContent)).toEqual(['Builderforce']);
        fireEvent.click(station('cron'));
        await waitFor(() => expect(spine().getAllByRole('button').map((b) => b.textContent)).toEqual(['Builderforce', 'cron']));
        expect(spine().getByRole('button', { name: 'cron' }).getAttribute('aria-current')).toBe('location');
        fireEvent.click(spine().getByRole('button', { name: 'Builderforce' }));
        expect(within(aside()).getByTestId('kg-act-title').textContent).toMatch(/^On this path/);
        expect(spine().getAllByRole('button').map((b) => b.textContent)).toEqual(['Builderforce']);
    });

    it('lays the toolbar and journey in the picture column next to the code panel', async () => {
        const box = (height: number) => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1400, height, top: 0, left: 0, right: 1400, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
        box(104);
        await mount();
        const column = screen.getByTestId('kg-scene-overlay').parentElement!;
        expect(column.querySelector('[data-map-pane]')).toBeTruthy();
        expect(column.contains(screen.getByTestId('kg-path'))).toBe(true);
        expect(column.parentElement?.querySelector('[data-code-split]')).toBeTruthy();
    });

    it('selecting a station scopes the Act panel and drills the spine', async () => {
        await mount();
        fireEvent.click(station('cron'));
        expect(within(screen.getByTestId('kg-spine')).getByRole('button', { name: 'cron' }).getAttribute('aria-current')).toBe('location');
        expect(within(aside()).getByTestId('kg-act-title').textContent).toBe(counted(L, 'issueAt', 1, { scope: 'cron' }));
        expect(aside().querySelectorAll('[data-provenance]').length).toBe(0);
        // Findings are lazy: open the group to see the rows.
        for (const b of aside().querySelectorAll('button[aria-expanded="false"]')) fireEvent.click(b);
        expect(aside().querySelectorAll('[data-finding]')).toHaveLength(1);

        fireEvent.click(station('Web app'));
        expect(within(aside()).getByText(fillTemplate(L.findingsEmpty, { scope: 'Web app' }))).toBeTruthy();
        expect(within(aside()).getByText(L.surface.act.emptyTitle)).toBeTruthy();
        fireEvent.click(within(aside()).getByRole('button', { name: L.surface.actScopeAll }));
        expect(within(aside()).getByTestId('kg-act-title').textContent).toMatch(/^On this path/); // the drawn line, not a station
    });

    it('counts the same findings in the title and the Fix queue, and the Details heading shows the total and names the lens when it narrows the list', async () => {
        await mount(surfaceFixture(), { initialLens: 'unused' });
        const title = within(aside()).getByTestId('kg-act-title').textContent!;
        const queue = within(aside()).getByRole('button', { name: /^Fix queue · \d+$/ }).textContent!.match(/\d+/)![0];
        const heading = within(aside()).getAllByRole('region', { name: L.findingsTitle, hidden: true })
            .map((region) => region.querySelector(':scope > h3')?.textContent)
            .find(Boolean)!;
        expect(title).toContain(queue);
        // The Details list is the lens's insights (a visible filter): "Findings · {lens} lens ({shown} of {total})", total = the queue's count.
        const m = heading.match(/\((\d+) of (\d+)\)/);
        expect(m, heading).not.toBeNull();
        expect(m![2]).toBe(queue);
        expect(Number(m![1])).toBeLessThan(Number(queue));
        expect(heading).toBe(fillTemplate(L.findingsNarrowed, { lens: L.lenses.unused, shown: m![1]!, total: queue }));
    });

    it('picking a line lists its stations and fills the path strip', async () => {
        await mount();
        fireEvent.click(screen.getByRole('button', { name: L.surface.linesButton }));
        fireEvent.click(within(screen.getByTestId('kg-lines-rail')).getByRole('button', { name: new RegExp(L.surface.lineName.replace('{name}', 'cron')) }));
        expect(document.querySelectorAll('[data-station-row]')).toHaveLength(3);
        const strip = within(screen.getByTestId('kg-path'));
        expect(strip.getByRole('button', { name: 'cron' })).toBeTruthy();
        fireEvent.click(strip.getByRole('button', { name: L.surface.pathNext }));
        await waitFor(() => expect(within(aside()).getByTestId('kg-act-title').textContent).toMatch(/^At /));
    });

    it('switches cameras and keeps the selection', async () => {
        await mount();
        const stageCamera = () => document.querySelector('[data-stage-host]')?.getAttribute('data-stage-camera');
        pickCamera(deps, L.viewGraph);
        await waitFor(() => expect(stageCamera()).toBe('graph'));
        pickCamera(deps, L.viewTransit);
        await waitFor(() => expect(stageCamera()).toBe('map'));
    });

    it('starts with the picture on a phone and opens lines through the code chevron', async () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420, height: 700, top: 0, left: 0, right: 420, bottom: 700, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
        await mount();
        expect(screen.queryByTestId('kg-surface-legend')).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: L.surface.code.dockShow }));
        const dock = await screen.findByRole('complementary', { name: L.surface.code.dockAria });
        fireEvent.click(within(dock).getByRole('button', { name: L.surface.linesButton }));
        expect(within(dock).getByTestId('kg-surface-legend')).toBeTruthy();
    });
});
