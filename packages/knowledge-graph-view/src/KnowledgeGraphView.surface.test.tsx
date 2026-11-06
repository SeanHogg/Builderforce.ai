// @vitest-environment jsdom
/** The Option B+ surface end to end: the transit map, the lines, the questions, the Act panel, and the phone layout. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { lensesFor } from './lenses';
import { expandAllFindings, fixtureSource, surfaceFixture } from './testing';
import { lensIsPicked, pickLens } from './testPicks';

vi.mock('./scene/GraphScene', () => ({ default: () => <div data-testid="kg-scene" /> }));
afterEach(() => vi.restoreAllMocks());

async function mount(graph: KnowledgeGraph = surfaceFixture(), props: Partial<Parameters<typeof KnowledgeGraphView>[0]> = {}) {
    render(<div style={{ height: 700 }}><KnowledgeGraphView source={fixtureSource([graph])} {...props} /></div>);
    await screen.findByTestId('kg-transit');
}
const deps = { fireEvent };
const cameras = () => within(screen.getByRole('radiogroup', { name: L.viewModesLabel }));
const station = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, `) });
const aside = () => document.querySelector(`aside[aria-label="${L.findingsTitle}"]`) as HTMLElement;

describe('the surface', () => {
    it('opens on the transit map when the graph has entry points, with the cameras in registry order', async () => {
        await mount();
        expect(cameras().getByRole('radio', { name: L.viewTransit }).getAttribute('aria-checked')).toBe('true');
        // Sequence is no longer a camera button: the path strip's Sequence toggle draws it.
        expect([...screen.getByRole('radiogroup', { name: L.viewModesLabel }).querySelectorAll('button')].map((b) => b.textContent))
            .toEqual([L.viewTransit, L.viewSystem, L.viewGraph, L.viewMap, L.viewHeat, L.viewList]);
        expect(screen.getByTestId('kg-path')).toBeTruthy();
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
        expect(screen.getByTestId('kg-answer').textContent).toBe('1 stations');
    });

    it('lights the stations of the focused refs on the map (initial focus, search, Show)', async () => {
        await mount(surfaceFixture(), { initialFocus: ['src:sys::db/repo.ts'] });
        const dim = [...document.querySelectorAll('[data-station]')].filter((g) => g.getAttribute('opacity') === '0.4');
        expect(dim).toHaveLength(document.querySelectorAll('[data-station]').length - 1);
    });

    it('Show on a finding selects its first station through the one select path', async () => {
        await mount();
        // Expanding is idempotent (it opens only the collapsed groups), so it can be retried until the rows are there.
        await waitFor(() => {
            expandAllFindings({ fireEvent }, aside());
            expect(within(aside()).getAllByRole('button', { name: L.showFinding }).length).toBeGreaterThan(0);
        });
        fireEvent.click(within(aside()).getAllByRole('button', { name: L.showFinding })[0]!);
        await waitFor(() => expect(document.querySelectorAll('[data-station][aria-pressed="true"]')).toHaveLength(1));
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
        render(<div style={{ height: 700 }}><KnowledgeGraphView source={source} onCompose={onCompose} /></div>);
        await screen.findByTestId('kg-transit');
        const dimmed = () => [...document.querySelectorAll('[data-station]')].filter((g) => g.getAttribute('opacity') === '0.4').length;
        const total = document.querySelectorAll('[data-station]').length;

        fireEvent.change(screen.getByTestId('kg-pinpoint-file'), { target: { files: [new File(['x'], 'shot.png', { type: 'image/png' })] } });
        await screen.findByText(result.description);
        expect(source.pinpoint).toHaveBeenCalledWith(expect.any(File), 'sys');
        await waitFor(() => expect(dimmed()).toBe(total - 2)); // only the matched stations are lit
        const strip = within(screen.getByTestId('kg-path'));
        expect(strip.getAllByRole('button').map((b) => b.textContent).filter((t) => t === 'API' || t === 'repositories')).toEqual(['API', 'repositories']);
        expect(strip.queryByRole('button', { name: 'main.tsx' })).toBeNull();
        expect(screen.getByRole('button', { name: L.surface.questions.wrong }).getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(await screen.findByRole('button', { name: L.surface.pinpoint.diagnose }));
        const text = onCompose.mock.calls[0]![0] as string;
        expect(text).toContain(result.description);
        expect(text).toContain('API → repositories');
        expect(text).not.toContain('path: none'); // the findings on the path are named

        fireEvent.click(screen.getByRole('button', { name: L.surface.pinpoint.clearAria }));
        expect(await within(screen.getByTestId('kg-path')).findByRole('button', { name: 'main.tsx' })).toBeTruthy(); // the line's path is back
        await waitFor(() => expect(dimmed()).toBe(total - 3)); // no focus: the "wrong" question lights its three stations
    });

    it('a question opens its lens, and says how many stations answer', async () => {
        await mount();
        fireEvent.click(screen.getByRole('button', { name: L.surface.moreQuestions }));
        fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${L.surface.questions.copied}`) }));
        expect(lensIsPicked(deps, L, 'duplication')).toBe(true);
        expect(screen.getByTestId('kg-answer').textContent).toBe('1 stations');
    });

    it('says a question is not set up when its data was never collected', async () => {
        const bare = surfaceFixture();
        const noCoverage: KnowledgeGraph = { ...bare, nodes: bare.nodes.map(({ badges, ...n }) => (badges ? { ...n, badges: Object.fromEntries(Object.entries(badges).filter(([k]) => k !== 'coverage')) } : n)) };
        await mount(noCoverage);
        fireEvent.click(screen.getByRole('button', { name: L.surface.questions.untested }));
        expect(screen.getByTestId('kg-answer').textContent).toBe(L.surface.answerNotSetUp);
    });

    it('selecting a station scopes the Act panel and drills the spine', async () => {
        await mount();
        fireEvent.click(station('cron'));
        expect(within(screen.getByTestId('kg-spine')).getByRole('button', { name: 'cron' }).getAttribute('aria-current')).toBe('location');
        expect(within(aside()).getByText(`${L.surface.actScope.replace('{scope}', 'cron')}`)).toBeTruthy();
        expect(within(screen.getByTestId('kg-station-facts')).getByText('cron')).toBeTruthy();
        expect(aside().querySelectorAll('[data-provenance]').length).toBe(0);
        // Findings are lazy: open the group to see the rows.
        for (const b of aside().querySelectorAll('button[aria-expanded="false"]')) fireEvent.click(b);
        expect(aside().querySelectorAll('[data-finding]')).toHaveLength(1);

        fireEvent.click(station('Web app'));
        expect(within(aside()).getByText(L.findingsEmpty)).toBeTruthy();
        fireEvent.click(within(aside()).getByRole('button', { name: L.surface.actScopeAll }));
        expect(screen.queryByTestId('kg-station-facts')).toBeNull();
    });

    it('picking a line lists its stations and fills the path strip', async () => {
        await mount();
        fireEvent.click(screen.getByRole('button', { name: new RegExp(L.surface.lineName.replace('{name}', 'cron')) }));
        expect(document.querySelectorAll('[data-station-row]')).toHaveLength(3);
        const strip = within(screen.getByTestId('kg-path'));
        expect(strip.getAllByRole('button').map((b) => b.textContent)).toContain('cron');
        fireEvent.click(strip.getByRole('button', { name: L.surface.pathNext }));
        await waitFor(() => expect(screen.getByTestId('kg-station-facts')).toBeTruthy());
    });

    it('switches cameras and keeps the selection', async () => {
        await mount();
        fireEvent.click(cameras().getByRole('radio', { name: L.viewGraph }));
        await waitFor(() => expect(document.querySelector('[data-testid="kg-graph2d"] [data-id]')).not.toBeNull());
        expect(screen.queryByTestId('kg-transit')).toBeNull();
        fireEvent.click(cameras().getByRole('radio', { name: L.viewTransit }));
        expect(await screen.findByTestId('kg-transit')).toBeTruthy();
    });

    it('collapses the left panel into a sheet on a phone', async () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420, height: 700, top: 0, left: 0, right: 420, bottom: 700, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
        await mount();
        expect(screen.queryByTestId('kg-surface-legend')).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: L.surface.linesButton }));
        const sheet = await screen.findByRole('dialog');
        expect(sheet.style.bottom).toBe('0px');
        expect(within(sheet).getByTestId('kg-surface-legend')).toBeTruthy();
    });
});
