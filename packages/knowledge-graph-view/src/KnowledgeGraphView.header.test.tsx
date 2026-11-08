// @vitest-environment jsdom
/** The header: the status strip (status chip, action button, scrubber), the ask bar, the Panels group, Risk overlays, and the narrow layout. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from './labels';
import { counted } from './surface/plural';
import { QUESTIONS } from './surface/questions';
import { Toolbar } from './Toolbar';
import { fixtureSource, surfaceFixture } from './testing';

import type { KnowledgeGraphSource, SyncStatus } from './types';

vi.mock('./scene/GraphScene', () => ({ default: () => <div data-testid="kg-scene" /> }));
afterEach(() => vi.restoreAllMocks());

const h = L.surface.header;

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
const askBox = () => screen.getByRole('searchbox', { name: L.searchLabel }) as HTMLInputElement;

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
        const panel = await screen.findByRole('dialog', { name: 'Builderforce' });
        expect(within(panel).getByRole('tab', { name: new RegExp(`^${L.surface.run.review.tabServer}`) }).getAttribute('aria-selected')).toBe('true');
        expect(within(panel).getByTestId('kg-review-parity').textContent).toBe(fillTemplate(h.parityDiffers, { local: '120', server: '100' }));
    });

    it('has exactly one action button on the strip and no parity line, ⋯ menu or review card', async () => {
        await mount(sourceOf({ syncStatus: async () => sync() }));
        await screen.findByTestId('kg-status-chip');
        expect(screen.getAllByTestId('kg-review-action')).toHaveLength(1);
        expect(screen.queryByTestId('kg-parity')).toBeNull();
        expect(screen.queryByTestId('kg-review-card')).toBeNull();
        expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
    });

    it('opens the Reviews panel when the button is pressed, and counts the files at once', async () => {
        await mount(sourceOf({ syncStatus: async () => sync() }));
        fireEvent.click(await screen.findByTestId('kg-review-action'));
        const panel = await screen.findByRole('dialog', { name: 'Builderforce' });
        expect(await within(panel).findByTestId('kg-review-start')).toBeTruthy();
        expect(screen.getByTestId('kg-status-chip').getAttribute('data-kind')).toBe('ready');
    });
});

describe('the review in the strip', () => {
    it('opens the Reviews panel by itself for the plan, and the chip says it is running after Start', async () => {
        await mount(sourceOf());
        fireEvent.click(await screen.findByTestId('kg-review-action'));
        await screen.findByTestId('kg-review-start');
        expect(screen.getByTestId('kg-status-chip').textContent).toContain(L.surface.run.review.chipReady);
        fireEvent.click(screen.getByTestId('kg-footer-action'));
        await waitFor(() => expect(screen.getByTestId('kg-status-chip').getAttribute('data-kind')).not.toBe('ready'));
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

describe('what the ⋯ menu held, now in the Reviews panel', () => {
    it('shows Before and After on the Server tab only when the host keeps a baseline', async () => {
        await mount(sourceOf({ baseline: async () => null, syncStatus: async () => sync() }));
        fireEvent.click(await screen.findByTestId('kg-status-chip'));
        const panel = await screen.findByRole('dialog', { name: 'Builderforce' });
        fireEvent.click(within(panel).getByRole('tab', { name: new RegExp(`^${L.surface.run.review.tabServer}`) }));
        expect(within(panel).getByText(L.surface.run.review.revisionTitle)).toBeTruthy();
        expect((within(panel).getByRole('radio', { name: L.compareBefore }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('has no revision control for a host with no baseline', async () => {
        await mount(sourceOf({ syncStatus: async () => sync() }));
        fireEvent.click(await screen.findByTestId('kg-status-chip'));
        const panel = await screen.findByRole('dialog', { name: 'Builderforce' });
        fireEvent.click(within(panel).getByRole('tab', { name: new RegExp(`^${L.surface.run.review.tabServer}`) }));
        expect(within(panel).queryByText(L.surface.run.review.revisionTitle)).toBeNull();
    });

    it('copies the diagnostics from the Diagnostics tab and says Copied', async () => {
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await mount(sourceOf());
        fireEvent.click(await screen.findByTestId('kg-review-action'));
        const panel = await screen.findByRole('dialog', { name: 'Builderforce' });
        fireEvent.click(within(panel).getByRole('tab', { name: L.surface.run.review.tabDiagnostics }));
        fireEvent.click(within(panel).getByRole('button', { name: L.copyDiagnostics }));
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        expect(await screen.findByText(L.copied)).toBeTruthy();
    });
});

describe('openReview with a graph on screen', () => {
    it('opens the Reviews panel', async () => {
        render(<div style={{ height: 700 }}><KnowledgeGraphView source={sourceOf()} openReview /></div>);
        expect(await screen.findByRole('dialog', { name: 'Builderforce' })).toBeTruthy();
    });

    it('leaves the panel closed without openReview', async () => {
        await mount(sourceOf());
        expect(screen.queryByRole('dialog', { name: 'Builderforce' })).toBeNull();
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
    it('toggles Coverage, Patterns and API in order (Reviews opens from the strip); a second press closes the drawer; Fix queue and Simulate have no button', async () => {
        await mount(sourceOf({ syncStatus: async () => sync() }));
        const group = within(screen.getByRole('group', { name: L.surface.panelsLabel }));
        expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual([L.panelCoverage, L.panelPatterns, L.panelApi]);
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

    it('shows the question as the value (not a placeholder hint) until something is typed, which replaces it', () => {
        const onSearch = vi.fn();
        const { rerender } = render(<Toolbar labels={L} narrow={false} onSearch={onSearch} question="where" askName="Web" />);
        const sentence = fillTemplate(L.surface.askSentence.where, { name: 'Web' });
        expect(askBox().value).toBe(sentence);
        rerender(<Toolbar labels={L} narrow={false} onSearch={onSearch} question="wrong" askName="Web" />);
        expect(askBox().value).toBe(fillTemplate(L.surface.askSentence.wrong, { name: 'Web' })); // follows the question
        fireEvent.change(askBox(), { target: { value: 'invoice' } });
        expect(askBox().value).toBe('invoice');
        rerender(<Toolbar labels={L} narrow={false} onSearch={onSearch} question="where" askName="Web" />);
        expect(askBox().value).toBe('invoice'); // what was typed stays
    });

    it('renders ONE note: "not set up" alone, without the answer mode', () => {
        render(<Toolbar labels={L} narrow={false} onSearch={vi.fn()} question="untested" askName="Web" answer={L.surface.answerNotSetUp} />);
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByTestId('kg-answer').textContent).toBe(L.surface.answerNotSetUp);
        expect(screen.queryByTestId('kg-answer-mode')).toBeNull();
    });

    it('renders ONE note: the answer mode, then the answer', () => {
        render(<Toolbar labels={L} narrow={false} onSearch={vi.fn()} question="wrong" askName="Web" answer="3 stations" />);
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByTestId('kg-answer').textContent).toBe(`${L.surface.answerMode.wrong} · 3 stations`);
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

    it('keeps only the chip dot, the action button and Risk ▾ in the strip; the Panels row scrolls sideways; the ask bar is 44px', async () => {
        narrow();
        await mount(sourceOf({ syncStatus: async () => sync() }));
        const s = strip();
        expect(s.queryByRole('button', { name: `${L.surface.presets.risk} ▾` })).toBeNull(); // the overlays live in the scene overlay's tools
        expect(s.getByTestId('kg-review-action')).toBeTruthy();
        expect(s.getByTestId('kg-status-chip').textContent).toBe(''); // the chip shrinks to its dot; the words stay in its accessible name
        expect(s.getByTestId('kg-status-chip').getAttribute('aria-label')).toContain('in sync');
        expect(screen.queryByTestId('kg-parity')).toBeNull();
        expect(screen.queryByTestId('kg-time')).toBeNull();
        // The overlay menu is not duplicated in the header row.
        expect(screen.getAllByRole('button', { name: `${L.surface.presets.risk} ▾` })).toHaveLength(1);
        const panels = screen.getByRole('group', { name: L.surface.panelsLabel });
        expect(panels.parentElement!.style.overflowX).toBe('auto');
        expect(screen.getByRole('search').style.height).toBe('44px');
        expect(screen.queryByTestId('kg-answer-mode')).toBeNull();
    });

    it('draws the wide layout otherwise: Risk overlays in the scene overlay, not in the strip', async () => {
        await mount(sourceOf());
        expect(strip().queryByRole('button', { name: /▾$/ })).toBeNull();
        expect(screen.getByRole('search').style.height).toBe('40px');
    });
});

describe('the canvas tools and panel toggles', () => {
    it('puts the Risk overlays trigger and the Coverage button inside the scene overlay', async () => {
        await mount(sourceOf());
        const overlay = within(screen.getByTestId('kg-scene-overlay'));
        expect(overlay.getByRole('button', { name: `${fillTemplate(L.surface.presetLabel, { preset: L.surface.presets.risk })} ▾` })).toBeTruthy();
        expect(overlay.getByRole('button', { name: L.panelCoverage })).toBeTruthy();
    });

    it('hides the Act panel when the right toggle is pressed, and brings it back', async () => {
        window.localStorage.removeItem('kg.panelVisibility.v1');
        await mount(sourceOf());
        expect(screen.queryByTestId('kg-act-title')).not.toBeNull();
        fireEvent.click(screen.getByRole('button', { name: L.surface.panelToggles.hideRight }));
        expect(screen.queryByTestId('kg-act-title')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: L.surface.panelToggles.showRight }));
        expect(screen.queryByTestId('kg-act-title')).not.toBeNull();
        window.localStorage.removeItem('kg.panelVisibility.v1');
    });
});
