// @vitest-environment jsdom
/** The header: Out, the spine, the search that expands into the ask input, the review status button, the Panels button and the drawer it toggles; the toolbar's compare bar; and the wrapped (<=900px) layout. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from './labels';
import { counted } from './surface/plural';
import { QUESTIONS } from './surface/questions';
import { Toolbar } from './Toolbar';
import { fixtureSource, surfaceFixture } from './testing';
import { openSearch } from './testPicks';

import type { KnowledgeGraphSource, SyncStatus } from './types';
import { StageFactoryContext } from './stage/host/StageFactoryContext';
import { createNoopStage } from './stage/renderer';

// The view draws every placement camera through the lazy three.js StageHost (PRD 43 B1a). In jsdom the
// real WebGL factory declines and the scene falls back to the List, so the header chrome these tests
// assert on (the spine, the scene overlay's tools, the Act rail) never mounts. Provide the no-op stage
// factory through the real context — the same port stageCard.test.tsx drives — so the stage host mounts
// and the whole view renders. No module mocks: they do not intercept reliably in this whole-view graph.
afterEach(() => vi.restoreAllMocks());

const h = L.surface.header;

const sync = (over: Partial<SyncStatus> = {}): SyncStatus => ({ local: { files: 120, docs: 0 }, server: { files: 120, docs: 0 }, sources: [{ id: 'code', state: 'collected' }], ...over });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** The view with the no-op stage factory the test host "can draw": the stage host mounts in jsdom. */
function view(element: ReactNode) {
    return (
        <StageFactoryContext.Provider value={() => createNoopStage()}>
            <div style={{ height: 700 }}>{element}</div>
        </StageFactoryContext.Provider>
    );
}

/** A source over the surface fixture, with the optional host methods the header reads. */
function sourceOf(extra: Partial<KnowledgeGraphSource> = {}, graphs: KnowledgeGraph[] = [surfaceFixture()]): KnowledgeGraphSource {
    const base = fixtureSource(graphs);
    // ONE instant for every root: the view opens the most recently reviewed, so a clock tick between two roots would reorder them.
    const reviewed = minutesAgo(2);
    return {
        ...base,
        scopes: async () => graphs.map((g, i) => ({ rootId: g.scope.rootId, title: i === 0 ? 'Builderforce' : g.scope.rootId, packs: g.scope.packs, lastReviewedAt: reviewed })),
        ...extra,
    };
}

async function mount(source: KnowledgeGraphSource) {
    render(view(<KnowledgeGraphView source={source} />));
    // The scene's "a graph is loaded and drawn" gate: the stage host mounts only once a real graph paints.
    await waitFor(() => expect(document.querySelector('[data-stage-host]')).toBeTruthy());
}
const strip = () => within(screen.getByTestId('kg-status-strip'));
/** The ask input: the search icon button expands it (where the header does not wrap). */
const askBox = () => openSearch({ fireEvent }, L);
const toolbar = (over: Partial<Parameters<typeof Toolbar>[0]> = {}) => (
    <Toolbar labels={L} wrapped={false} onSearch={vi.fn()} question="where" askName="Web" {...over} />
);

describe('the status chip and the action button', () => {
    it('says Reviewed with how long ago and in sync, with the dot in the synced colour', async () => {
        await mount(sourceOf({ syncStatus: async () => sync() }));
        const chip = await screen.findByTestId('kg-status-chip');
        await waitFor(() => expect(chip.getAttribute('data-state')).toBe('synced'));
        expect(chip.textContent).toContain('in sync');
    });

    it('says how many files were not stored, in the error colour, and opens the Server tab', async () => {
        await mount(sourceOf({ syncStatus: async () => sync({ server: { files: 100, docs: 0 }, skipped: [{ path: 'big.bin', reason: 'too-large' }] }) }));
        const chip = await screen.findByTestId('kg-status-chip');
        await waitFor(() => expect(chip.textContent).toContain(counted(L, 'fileNotStored', 1)));
        expect(chip.getAttribute('data-state')).toBe('error');
        fireEvent.click(chip);
        const panel = await screen.findByTestId('kg-drawer');
        expect(within(panel).getByRole('tab', { name: new RegExp(`^${L.surface.run.review.tabServer}`) }).getAttribute('aria-selected')).toBe('true');
        expect(within(panel).getByTestId('kg-review-parity').textContent).toBe(fillTemplate(h.parityDiffers, { local: '120', server: '100' }));
    });

    it('has exactly one button on the strip (the status chip) and no parity line, ⋯ menu or review card', async () => {
        await mount(sourceOf({ syncStatus: async () => sync() }));
        await screen.findByTestId('kg-status-chip');
        expect(strip().getAllByRole('button')).toHaveLength(1);
        expect(screen.queryByTestId('kg-review-action')).toBeNull();
        expect(screen.queryByTestId('kg-parity')).toBeNull();
        expect(screen.queryByTestId('kg-review-card')).toBeNull();
        expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
    });

    it('opens the Reviews panel when the button is pressed, and counts nothing until Start review', async () => {
        // Opening does not plan (RunPanel.tsx): planning walks and hashes every file, which opening the panel did not ask for.
        const source = sourceOf({ syncStatus: async () => sync() }) as KnowledgeGraphSource & { requests: unknown[] };
        await mount(source);
        fireEvent.click(await screen.findByTestId('kg-status-chip'));
        const panel = await screen.findByTestId('kg-drawer');
        fireEvent.click(within(panel).getByRole('tab', { name: new RegExp(`^${L.surface.run.review.tabReview}`) })); // synced: the chip opens on Runs
        expect(await within(panel).findByTestId('kg-review-idle')).toBeTruthy();
        expect(within(panel).queryByTestId('kg-review-planning')).toBeNull();
        expect(source.requests).toEqual([]);
    });
});

describe('the review in the strip', () => {
    it('Start review in the panel counts and starts in one press, and the chip leaves the ready state', async () => {
        const source = sourceOf() as KnowledgeGraphSource & { confirmed: boolean[] };
        await mount(source);
        fireEvent.click(await screen.findByTestId('kg-status-chip'));
        fireEvent.click(within(await screen.findByTestId('kg-drawer')).getByRole('tab', { name: new RegExp(`^${L.surface.run.review.tabReview}`) })); // the chip opens on Runs
        await screen.findByTestId('kg-review-idle');
        fireEvent.click(screen.getByTestId('kg-footer-action'));
        await waitFor(() => expect(source.confirmed).toEqual([true]));
        await waitFor(() => expect(screen.getByTestId('kg-status-chip').getAttribute('data-kind')).not.toBe('ready'));
    });
});

describe('the compare bar (the commit scrubber)', () => {
    const commits = [
        { sha: 'aaaaaaa1', title: 'first', at: '2026-01-01', refs: ['src:sys::api/routes.ts'] },
        { sha: 'bbbbbbb2', title: 'second', at: '2026-01-02', refs: ['src:sys::db/repo.ts'] },
    ];

    it('shows only while "What changed?" is asked, and closing it leaves the question', async () => {
        await mount(sourceOf({ history: async () => ({ commits }) }));
        expect(screen.queryByTestId('kg-time')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: L.surface.questions.changed }));
        expect(await screen.findByTestId('kg-time')).toBeTruthy();
        fireEvent.click(screen.getByTestId('kg-time-close'));
        expect(screen.queryByTestId('kg-time')).toBeNull();
    });

    it('picking a commit keeps the question on "What changed?"', async () => {
        await mount(sourceOf({ history: async () => ({ commits }) }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.questions.changed }));
        fireEvent.click(await screen.findByRole('button', { name: fillTemplate(L.surface.time.commitAria, { title: 'first', at: '2026-01-01' }) }));
        expect(askBox().placeholder).toBe(fillTemplate(L.surface.askSentence.changed, { name: 'Builderforce' }));
    });
});

describe('what the ⋯ menu held, now in the Reviews panel', () => {
    it('shows Before and After on the Server tab only when the host keeps a baseline', async () => {
        await mount(sourceOf({ baseline: async () => null, syncStatus: async () => sync() }));
        fireEvent.click(await screen.findByTestId('kg-status-chip'));
        const panel = await screen.findByTestId('kg-drawer');
        fireEvent.click(within(panel).getByRole('tab', { name: new RegExp(`^${L.surface.run.review.tabServer}`) }));
        expect(within(panel).getByText(L.surface.run.review.revisionTitle)).toBeTruthy();
        expect((within(panel).getByRole('radio', { name: L.compareBefore }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('has no revision control for a host with no baseline', async () => {
        await mount(sourceOf({ syncStatus: async () => sync() }));
        fireEvent.click(await screen.findByTestId('kg-status-chip'));
        const panel = await screen.findByTestId('kg-drawer');
        fireEvent.click(within(panel).getByRole('tab', { name: new RegExp(`^${L.surface.run.review.tabServer}`) }));
        expect(within(panel).queryByText(L.surface.run.review.revisionTitle)).toBeNull();
    });

    it('copies the diagnostics from the Diagnostics tab and says Copied', async () => {
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await mount(sourceOf());
        fireEvent.click(await screen.findByTestId('kg-status-chip'));
        const panel = await screen.findByTestId('kg-drawer');
        fireEvent.click(within(panel).getByRole('tab', { name: L.surface.run.review.tabDiagnostics }));
        fireEvent.click(within(panel).getByRole('button', { name: L.copyDiagnostics }));
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        expect(await screen.findByText(L.copied)).toBeTruthy();
    });
});

describe('openReview with a graph on screen', () => {
    it('opens the Reviews panel', async () => {
        render(view(<KnowledgeGraphView source={sourceOf()} openReview />));
        expect(await screen.findByTestId('kg-drawer')).toBeTruthy();
    });

    it('leaves the panel closed without openReview', async () => {
        await mount(sourceOf());
        expect(screen.queryByTestId('kg-drawer')).toBeNull();
    });
});

describe('the spine root crumb', () => {
    it('is a menu of the reviewed folders when there are several, and switches the folder', async () => {
        await mount(sourceOf({}, [surfaceFixture(), surfaceFixture('other')]));
        const nav = within(screen.getByTestId('kg-spine'));
        fireEvent.click(nav.getByRole('button', { name: 'Builderforce ▾' }));
        const menu = screen.getByRole('menu', { name: h.rootsLabel });
        expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Builderforce', 'other']);
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'other' }));
        await waitFor(() => expect(nav.getByRole('button', { name: 'other ▾' })).toBeTruthy());
    });

    it('is a plain crumb with one folder', async () => {
        await mount(sourceOf());
        const nav = within(screen.getByTestId('kg-spine'));
        expect(nav.getByRole('button', { name: 'Builderforce' })).toBeTruthy();
        expect(screen.queryByRole('menu', { name: h.rootsLabel })).toBeNull();
    });
});

describe('the right edge chevrons and the drawer', () => {
    it('opens the drawer from the right edge and closes it from the drawer header', async () => {
        await mount(sourceOf({ syncStatus: async () => sync() }));
        expect(screen.queryByTestId('kg-drawer')).toBeNull();
        const button = screen.getByTestId('kg-panels-button');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(button.textContent).toBe('‹');
        expect(button.style.insetInlineEnd).toBe('0px');
        fireEvent.click(button);
        const drawer = within(screen.getByTestId('kg-drawer'));
        expect(screen.queryByTestId('kg-panels-button')).toBeNull();
        const close = drawer.getByTestId('kg-drawer-close');
        expect(close.textContent).toBe('›');
        expect(close.getAttribute('aria-expanded')).toBe('true');
        expect(drawer.getAllByRole('tab').map((t) => t.getAttribute('aria-label')).slice(0, 4)).toEqual([h.drawerTabAct, L.panelCoverage, L.panelPatterns, L.panelApi]);
        expect(drawer.getByRole('tab', { name: h.drawerTabAct }).getAttribute('aria-selected')).toBe('true');
        expect(screen.queryByTestId('kg-act-title')).not.toBeNull();
        fireEvent.click(drawer.getByRole('tab', { name: L.panelCoverage }));
        expect(drawer.getByRole('tab', { name: L.panelCoverage }).getAttribute('aria-selected')).toBe('true');
        expect(screen.queryByTestId('kg-act-title')).toBeNull();
        fireEvent.click(close);
        expect(screen.queryByTestId('kg-drawer')).toBeNull();
        expect(screen.getByTestId('kg-panels-button')).toBeTruthy();
    });

    it('has Simulate as a tab, not a toolbar toggle', async () => {
        await mount(sourceOf());
        expect(document.querySelector('[data-simulate-toggle]')).toBeNull();
        fireEvent.click(screen.getByTestId('kg-panels-button'));
        expect(within(screen.getByTestId('kg-drawer')).getByRole('tab', { name: L.panelSimulate })).toBeTruthy();
    });
});

describe('the ask bar', () => {
    const question = (id: string) => QUESTIONS.find((q) => q.id === id)!.id;
    it.each(QUESTIONS.map((q) => [q.id] as const))('the %s question is the placeholder as a sentence', (id) => {
        render(toolbar({ question: question(id) }));
        expect(askBox().placeholder).toBe(fillTemplate(L.surface.askSentence[id], { name: 'Web' }));
    });

    it('is a search icon button that expands into the input, and Escape collapses it', () => {
        render(toolbar());
        expect(screen.queryByRole('searchbox', { name: L.searchLabel })).toBeNull();
        const input = askBox();
        expect(screen.getByTestId('kg-search-button').getAttribute('aria-expanded')).toBe('true');
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByRole('searchbox', { name: L.searchLabel })).toBeNull();
    });

    it('follows the question in its placeholder and keeps what was typed', () => {
        const { rerender } = render(toolbar());
        expect(askBox().value).toBe('');
        fireEvent.change(askBox(), { target: { value: 'invoice' } });
        rerender(toolbar({ question: 'wrong' }));
        expect(askBox().placeholder).toBe(fillTemplate(L.surface.askSentence.wrong, { name: 'Web' }));
        expect(askBox().value).toBe('invoice'); // what was typed stays
    });

    it('draws no "answered as" note: the answer is the stage card\'s', () => {
        render(toolbar({ question: 'wrong' }));
        askBox();
        expect(screen.queryByTestId('kg-answer')).toBeNull();
        expect(screen.queryByTestId('kg-answer-mode')).toBeNull();
    });

    it('submits the typed text as a search', () => {
        const onSearch = vi.fn();
        render(toolbar({ onSearch }));
        fireEvent.change(askBox(), { target: { value: 'invoice' } });
        fireEvent.submit(screen.getByRole('search'));
        expect(onSearch).toHaveBeenCalledWith('invoice');
    });

    it('puts the screenshot button inside the bar when the host can pinpoint', async () => {
        await mount(sourceOf({ pinpoint: vi.fn() }));
        askBox();
        const bar = within(screen.getByRole('search'));
        expect(bar.getByRole('button', { name: L.surface.pinpoint.button })).toBeTruthy();
        expect(bar.getByRole('searchbox', { name: L.searchLabel })).toBeTruthy();
    });

    it('has no screenshot button when the host cannot pinpoint', async () => {
        await mount(sourceOf());
        askBox();
        expect(screen.queryByRole('button', { name: L.surface.pinpoint.button })).toBeNull();
    });
});

describe('the wrapped (<=900px) layout', () => {
    const narrow = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 640, top: 0, left: 0, right: 360, bottom: 640, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);

    it('wraps the header, keeps only the status dot, shows the input and the Code | Picture switch instead of the search button, and opens the drawer as a bottom sheet', async () => {
        narrow();
        await mount(sourceOf({ syncStatus: async () => sync() }));
        expect(screen.getByTestId('kg-header').style.flexWrap).toBe('wrap');
        const s = strip();
        expect(s.getByTestId('kg-status-chip').textContent).toBe(''); // the chip shrinks to its dot; the words stay in its accessible name
        expect(s.getByTestId('kg-status-chip').getAttribute('aria-label')).toContain('in sync');
        expect(screen.queryByTestId('kg-search-button')).toBeNull();
        expect(screen.getByRole('searchbox', { name: L.searchLabel })).toBeTruthy();
        expect(screen.getByRole('group', { name: h.panesLabel })).toBeTruthy();
        fireEvent.click(screen.getByTestId('kg-panels-button'));
        expect(screen.getByTestId('kg-drawer').getAttribute('data-sheet')).toBe('true');
    });

    it('draws the desktop header otherwise: one nowrap row, the search button, a right-hand drawer', async () => {
        await mount(sourceOf());
        expect(screen.getByTestId('kg-header').style.flexWrap).toBe('nowrap');
        expect(screen.getByTestId('kg-search-button')).toBeTruthy();
        expect(screen.queryByRole('group', { name: h.panesLabel })).toBeNull();
        fireEvent.click(screen.getByTestId('kg-panels-button'));
        expect(screen.getByTestId('kg-drawer').getAttribute('data-sheet')).toBeNull();
    });

    it('offers Code | Picture on a wide container too once the drawer column leaves the stage too narrow to split (ONE rule: the stage box)', async () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
        await mount(sourceOf());
        expect(screen.getByTestId('kg-header').style.flexWrap).toBe('nowrap');
        // 1200px (950 beside a Lines rail): code and picture side by side.
        expect(screen.queryByRole('group', { name: h.panesLabel })).toBeNull();
        fireEvent.click(screen.getByTestId('kg-panels-button')); // the 340px drawer column: 860 (610) left, too narrow to split
        expect(screen.getByRole('group', { name: h.panesLabel })).toBeTruthy();
    });
});

describe('the toolbar', () => {
    it('is the views, 3D | Flat and the questions in the scene overlay, with no Panels group, Risk overlays or Simulate toggle', async () => {
        await mount(sourceOf());
        const overlay = within(screen.getByTestId('kg-scene-overlay'));
        expect(overlay.getByRole('group', { name: L.viewModesLabel })).toBeTruthy();
        expect(overlay.getByRole('group', { name: L.surface.questionsLabel })).toBeTruthy();
        expect(overlay.queryByRole('button', { name: L.panelCoverage })).toBeNull();
        expect(overlay.queryByRole('button', { name: new RegExp(L.surface.presets.risk + ' ▾') })).toBeNull();
    });
});
