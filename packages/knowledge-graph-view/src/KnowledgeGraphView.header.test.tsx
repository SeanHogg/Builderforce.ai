// @vitest-environment jsdom
/** The header: the status strip (sync pill, parity, scrubber, ⋯), the ask bar, the Panels group, Risk overlays, and the narrow layout. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from './labels';
import { QUESTIONS } from './surface/questions';
import { Toolbar } from './Toolbar';
import { fixtureSource, surfaceFixture } from './testing';
import { openMore, pressMore } from './testMenu';
import type { KnowledgeGraphSource, SyncStatus } from './types';

vi.mock('./scene/GraphScene', () => ({ default: () => <div data-testid="kg-scene" /> }));
afterEach(() => vi.restoreAllMocks());

const h = L.surface.header;
const deps = { screen, fireEvent };
const sync = (over: Partial<SyncStatus> = {}): SyncStatus => ({ local: { files: 120, docs: 0 }, server: { files: 120, docs: 0 }, sources: [{ id: 'code', state: 'collected' }], ...over });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

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
    render(<div style={{ height: 700 }}><KnowledgeGraphView source={source} /></div>);
    await screen.findByTestId('kg-transit');
}
const strip = () => within(screen.getByTestId('kg-status-strip'));
// The pill's name is its text followed by the state in words ("Review plan ready Syncing"): match on how it starts.
const startsWith = (text: string) => (name: string) => name.startsWith(text);
const askBox = () => screen.getByRole('searchbox', { name: L.searchLabel }) as HTMLInputElement;

describe('the sync pill and the parity line', () => {
    it('says Synced with how long ago, and the server parity in the strip', async () => {
        await mount(sourceOf({ syncStatus: async () => sync() }));
        const pill = await strip().findByRole('button', { name: /^Synced/ });
        expect(pill.getAttribute('data-state')).toBe('synced');
        expect((await screen.findByTestId('kg-parity')).textContent).toBe(fillTemplate(h.parityBoth, { count: (120).toLocaleString() }));
    });

    it('shows both counts when the server differs, and an error pill when files were skipped', async () => {
        await mount(sourceOf({ syncStatus: async () => sync({ server: { files: 100, docs: 0 }, skipped: [{ path: 'big.bin', reason: 'too-large' }] }) }));
        expect((await screen.findByTestId('kg-parity')).textContent).toBe(fillTemplate(h.parityDiffers, { local: '120', server: '100' }));
        const pill = await strip().findByRole('button', { name: startsWith(fillTemplate(h.skippedPill, { count: 1 })) });
        expect(pill.getAttribute('data-state')).toBe('error');
    });

    it('has no parity line when the host cannot report a sync status, and the pill is a plain status', async () => {
        await mount(sourceOf());
        expect(screen.queryByTestId('kg-parity')).toBeNull();
        expect(strip().queryByRole('button', { name: /^Synced/ })).toBeNull();
        expect(strip().getByRole('status').getAttribute('data-state')).toBe('synced');
    });

    it('opens the Sync drawer when the pill is pressed', async () => {
        await mount(sourceOf({ syncStatus: async () => sync() }));
        fireEvent.click(await strip().findByRole('button', { name: /^Synced/ }));
        expect(await screen.findByRole('dialog', { name: L.panelSync })).toBeTruthy();
        expect(screen.getByText(L.surface.drawerSubtitle.sync)).toBeTruthy();
    });
});

describe('the review in the strip', () => {
    it('opens the plan card by itself for the confirm, then shows the running state in the pill', async () => {
        await mount(sourceOf());
        await pressMore(deps, L.reviewFolder);
        const card = await screen.findByTestId('kg-review-card');
        expect(strip().getByRole('button', { name: startsWith(h.reviewPlan) })).toBeTruthy();
        fireEvent.click(within(card).getByRole('button', { name: L.reviewConfirm }));
        await waitFor(() => expect(strip().queryByRole('button', { name: startsWith(h.reviewPlan) })).toBeNull());
        expect(screen.queryByText(L.reviewPlanning)).toBeNull(); // no duplicate "Walking the folder…" pill
    });

    it('opens the card from the pill and closes it again', async () => {
        await mount(sourceOf());
        await pressMore(deps, L.reviewFolder);
        await screen.findByTestId('kg-review-card');
        fireEvent.click(strip().getByRole('button', { name: startsWith(h.reviewPlan) }));
        expect(screen.queryByTestId('kg-review-card')).toBeNull();
        fireEvent.click(strip().getByRole('button', { name: startsWith(h.reviewPlan) }));
        expect(screen.getByTestId('kg-review-card')).toBeTruthy();
    });
});

describe('the commit scrubber', () => {
    const commits = [
        { sha: 'aaaaaaa1', title: 'first', at: '2026-01-01', refs: ['src:sys::api/routes.ts'] },
        { sha: 'bbbbbbb2', title: 'second', at: '2026-01-02', refs: ['src:sys::db/repo.ts'] },
    ];

    it('picking a commit also switches the question to "What changed?"', async () => {
        await mount(sourceOf({ history: async () => ({ commits }) }));
        expect(askBox().placeholder).not.toBe(L.surface.askSentence.changed);
        fireEvent.click(await screen.findByRole('button', { name: fillTemplate(L.surface.time.commitAria, { title: 'first', at: '2026-01-01' }) }));
        expect(askBox().placeholder).toBe(L.surface.askSentence.changed);
        expect(screen.getByTestId('kg-answer-mode').textContent).toBe(L.surface.answerMode.changed);
    });
});

describe('the ⋯ menu', () => {
    it('offers Review a folder and Re-review, and Re-review plans the open root', async () => {
        const source = sourceOf();
        await mount(source);
        const menu = await openMore(deps);
        const names = [...menu.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent);
        expect(names).toEqual([L.reviewFolder, h.reReview, L.copyDiagnostics]);
        fireEvent.click(within(menu).getByRole('menuitem', { name: h.reReview }));
        await screen.findByTestId('kg-review-card');
        expect((source as ReturnType<typeof fixtureSource>).requests).toEqual([{ rootId: 'sys' }]);
    });

    it('lists Before and After only when the host keeps a baseline, and Before is disabled until one exists', async () => {
        await mount(sourceOf({ baseline: async () => null }));
        const menu = await openMore(deps);
        const before = within(menu).getByRole('menuitem', { name: new RegExp(`^${L.compareBefore}`) }) as HTMLButtonElement;
        expect(before.disabled).toBe(true);
        expect(within(menu).getByRole('menuitem', { name: new RegExp(`^${L.compareAfter}`) }).getAttribute('data-selected')).toBe('true');
    });

    it('has no Before/After for a host with no baseline', async () => {
        await mount(sourceOf());
        const menu = await openMore(deps);
        expect(within(menu).queryByRole('menuitem', { name: new RegExp(`^${L.compareBefore}`) })).toBeNull();
    });

    it('copies the diagnostics and says Copied', async () => {
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await mount(sourceOf());
        await pressMore(deps, L.copyDiagnostics);
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        expect(await screen.findByText(L.copied)).toBeTruthy();
    });

    it('does not hold the folder picker, even with several reviewed folders (the spine root crumb is its one place)', async () => {
        const second = { ...surfaceFixture('other') };
        await mount(sourceOf({}, [surfaceFixture(), second]));
        const menu = await openMore(deps);
        expect(within(menu).queryByRole('menuitem', { name: /other/ })).toBeNull();
    });
});

describe('openReview with a graph on screen', () => {
    it('opens the ⋯ menu focused on Review a folder', async () => {
        render(<div style={{ height: 700 }}><KnowledgeGraphView source={sourceOf()} openReview /></div>);
        const menu = await screen.findByRole('menu', { name: h.moreActions });
        const item = within(menu).getByRole('menuitem', { name: L.reviewFolder });
        await waitFor(() => expect(document.activeElement).toBe(item));
    });

    it('leaves the menu closed without openReview', async () => {
        await mount(sourceOf());
        expect(screen.queryByRole('menu', { name: h.moreActions })).toBeNull();
    });
});

describe('the Risk overlays trigger', () => {
    it('is the 40px accent-soft button with an accent border on a wide container', async () => {
        await mount(sourceOf());
        const trigger = screen.getByRole('button', { name: `${fillTemplate(L.surface.presetLabel, { preset: L.surface.presets.risk })} ▾` });
        expect(trigger.style.height).toBe('40px');
        expect(trigger.style.border).toContain('var(--kg-accent');
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

describe('the Panels group', () => {
    it('toggles Coverage, Patterns, API and Sync in order; a second press closes the drawer; Fix queue and Simulate have no button', async () => {
        await mount(sourceOf({ syncStatus: async () => sync() }));
        const group = within(screen.getByRole('group', { name: L.surface.panelsLabel }));
        expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual([L.panelCoverage, L.panelPatterns, L.panelApi, L.panelSync]);
        expect(group.queryByRole('button', { name: L.panelResolve })).toBeNull();
        expect(group.queryByRole('button', { name: L.panelSimulate })).toBeNull();
        fireEvent.click(group.getByRole('button', { name: L.panelCoverage }));
        expect(screen.getByRole('dialog', { name: L.panelCoverage })).toBeTruthy();
        expect(group.getByRole('button', { name: L.panelCoverage }).getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(group.getByRole('button', { name: L.panelCoverage }));
        expect(screen.queryByRole('dialog', { name: L.panelCoverage })).toBeNull();
    });
});

describe('Risk overlays', () => {
    it('opens a dialog (560px wide in CSS, which jsdom cannot read back) with the explanatory sentence', async () => {
        await mount(sourceOf());
        fireEvent.click(screen.getByRole('button', { name: `${fillTemplate(L.surface.presetLabel, { preset: L.surface.presets.risk })} ▾` }));
        const dialog = screen.getByRole('dialog', { name: L.surface.overlaysTitle });
        expect(within(dialog).getByText(h.overlaysNote)).toBeTruthy();
    });
});

describe('the ask bar', () => {
    const question = (id: string) => QUESTIONS.find((q) => q.id === id)!.id;
    it.each(QUESTIONS.map((q) => [q.id] as const))('the %s question is the placeholder as a sentence, with its answer mode beside it', (id) => {
        render(<Toolbar labels={L} narrow={false} onSearch={vi.fn()} question={question(id)} askName="Web" />);
        expect(askBox().placeholder).toBe(fillTemplate(L.surface.askSentence[id], { name: 'Web' }));
        expect(screen.getByTestId('kg-answer-mode').textContent).toBe(L.surface.answerMode[id]);
    });

    it('submits the typed text as a search', () => {
        const onSearch = vi.fn();
        render(<Toolbar labels={L} narrow={false} onSearch={onSearch} question="where" askName="Web" />);
        fireEvent.change(askBox(), { target: { value: 'invoice' } });
        fireEvent.submit(screen.getByRole('search'));
        expect(onSearch).toHaveBeenCalledWith('invoice');
    });

    it('puts the screenshot button inside the bar when the host can pinpoint', async () => {
        await mount(sourceOf({ pinpoint: vi.fn() }));
        const bar = within(screen.getByRole('search'));
        expect(bar.getByRole('button', { name: L.surface.pinpoint.button })).toBeTruthy();
        expect(bar.getByRole('searchbox', { name: L.searchLabel })).toBeTruthy();
    });

    it('has no screenshot button when the host cannot pinpoint', async () => {
        await mount(sourceOf());
        expect(screen.queryByRole('button', { name: L.surface.pinpoint.button })).toBeNull();
    });
});

describe('narrow (phone) layout', () => {
    const narrow = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 360, height: 640, top: 0, left: 0, right: 360, bottom: 640, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);

    it('keeps only the dot, Risk ▾ and ⋯ in the strip; the Panels row scrolls sideways; the ask bar is 44px', async () => {
        narrow();
        await mount(sourceOf({ syncStatus: async () => sync() }));
        const s = strip();
        expect(s.getByRole('button', { name: `${L.surface.presets.risk} ▾` })).toBeTruthy();
        expect(s.getByRole('button', { name: h.moreActions })).toBeTruthy();
        expect(screen.queryByTestId('kg-parity')).toBeNull();
        expect(screen.queryByTestId('kg-time')).toBeNull();
        // The overlay menu is not duplicated in the header row.
        expect(screen.getAllByRole('button', { name: `${L.surface.presets.risk} ▾` })).toHaveLength(1);
        const panels = screen.getByRole('group', { name: L.surface.panelsLabel });
        expect(panels.parentElement!.style.overflowX).toBe('auto');
        expect(screen.getByRole('search').style.height).toBe('44px');
        expect(screen.queryByTestId('kg-answer-mode')).toBeNull();
    });

    it('draws the wide layout otherwise: Risk overlays in the header row, not in the strip', async () => {
        await mount(sourceOf());
        expect(strip().queryByRole('button', { name: /▾$/ })).toBeNull();
        expect(screen.getByRole('search').style.height).toBe('40px');
    });
});
