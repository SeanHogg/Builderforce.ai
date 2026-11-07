// @vitest-environment jsdom
/** The Act rail: cards, Apply, Prompt, the Fix queue link, keep-as-test, the done-when footer, the stat grid and Details; and its pure model. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { nodeIndex } from '../graphModel';
import { ActPanel } from './ActPanel';
import { counted } from './plural';
import { acceptanceChecks, actionCards, findingSource, testRequestFor } from './actModel';
import { pathOfLine } from './path';
import { pinNumbers } from './pinNumbers';
import { firstFindings } from './rail/stopTag';
import { graph, lines, model, unusedFinding } from './testFixtures';

const withUnused = { ...graph, findings: [...graph.findings, unusedFinding] };
const web = model.stations.find((s) => s.name === 'Web app')!;
const path = pathOfLine(lines.lines[0]!, model.byId);

const base = (over: Partial<Parameters<typeof ActPanel>[0]> = {}) => ({
    graph: withUnused, findings: withUnused.findings, labels: L, station: null, stations: model.stations, scopeName: null, compact: false,
    onClearScope: vi.fn(), onShow: vi.fn(), onCompose: vi.fn(), onResolve: vi.fn(), onOpenPanel: vi.fn(), ...over,
});
const act = (over: Partial<Parameters<typeof ActPanel>[0]> = {}) => {
    const p = base(over);
    render(<ActPanel {...p} />);
    return p;
};
const cardOf = (id: string) => document.querySelector(`[data-card="${id}"]`)!.parentElement as HTMLElement;
const composed = (p: { onCompose?: unknown }) => (p.onCompose as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;

describe('ActPanel rail', () => {
    it('draws at most three cards: numbered, titled, with where the finding came from', () => {
        act();
        const cards = document.querySelectorAll('[data-card]');
        expect(cards.length).toBe(3);
        // The pin is the finding's place in graph.findings (the number the left rail shows), whatever order the cards rank in.
        const pins = pinNumbers(withUnused.findings);
        expect([...cards].map((c) => c.querySelector('span')!.textContent)).toEqual([...cards].map((c) => String(pins.get(c.getAttribute('data-card')!))));
        expect([...cards].map((c) => c.querySelector('span')!.textContent).sort()).toEqual(['1', '2', '3']);
        expect(cards[0]!.textContent).toContain(L.findingKinds.partitionViolation ?? '');
        expect(cardOf('f-unused').querySelector('[data-source="exact"]')).toBeTruthy();
    });

    it('offers no Apply when the host cannot apply a fix', () => {
        act({ canApply: false });
        expect(document.querySelector('[data-act="apply"]')).toBeNull();
    });

    it('Apply routes through Resolve (only on the finding with a codemod), Prompt puts the fixed request in the composer, Show selects the nodes', () => {
        const p = act({ canApply: true });
        fireEvent.click(within(cardOf('f-unused')).getByRole('button', { name: fillTemplate(L.surface.act.cardAction, { action: L.surface.act.apply, title: L.findingKinds.unusedExport ?? 'unused-export' }) }));
        expect(p.onResolve).toHaveBeenCalledWith(unusedFinding);
        expect(document.querySelectorAll('[data-act="apply"]')).toHaveLength(1);
        fireEvent.click(within(cardOf('f-unused')).getByText(L.surface.act.prompt));
        expect(composed(p)).not.toMatch(/[{}]/);
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
        const text = composed(p);
        expect(text).toContain('Web line · GET /users');
        expect(text).toContain('main.tsx → Web app → API → repositories');
        expect(text).not.toMatch(/[{}]/);
    });

    it('offers no test card or footer without a path', () => {
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

    it('has no metric grid: the station card carries those stats', () => {
        act({ station: web, scopeName: 'Web app' });
        expect(document.querySelectorAll('[data-fact]')).toHaveLength(0);
        expect(screen.queryByTestId('kg-station-facts')).toBeNull();
    });

    it('keeps the full findings list, Insights and the view panel in a Details section that is COLLAPSED by default and opens on demand', () => {
        act({ children: <p>insights and view</p> });
        const toggle = screen.getByRole('button', { name: L.surface.act.detailsTitle });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        const panel = screen.getByText('insights and view').parentElement!;
        expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
        expect(screen.getByText('insights and view').closest('[hidden]')).not.toBeNull(); // still mounted: its state is kept
        expect(within(panel).getByRole('region', { name: L.findingsTitle, hidden: true })).toBeTruthy(); // the full list lives inside Details
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText('insights and view').closest('[hidden]')).toBeNull();
    });

    it('titles the rail "At {scope} · N issues", or "On this path · N to act on" with a line drawn, and the counts agree', () => {
        const { unmount } = render(<ActPanel {...base({ station: web, scopeName: 'Web app' })} />);
        expect(screen.getByTestId('kg-act-title').textContent).toBe(counted(L, 'issueAt', 3, { scope: 'Web app' }));
        // The queue and the Details list say the same number.
        expect(screen.getByRole('button', { name: fillTemplate(L.surface.act.fixQueue, { count: 3 }) })).toBeTruthy();
        expect(screen.getByRole('region', { name: L.findingsTitle, hidden: true }).textContent).toContain('(3)');
        unmount();
        render(<ActPanel {...base({ path })} />);
        expect(screen.getByTestId('kg-act-title').textContent).toBe(fillTemplate(L.surface.act.titlePath, { count: 3 }));
    });

    it('says "1 issue" for one', () => {
        act({ station: web, findings: [unusedFinding] });
        expect(screen.getByTestId('kg-act-title').textContent).toBe('At Web app · 1 issue');
    });

    it('shows a check card when nothing is open: the words, the Ask button and a Show link', () => {
        const p = act({ station: web, findings: [], onAskUntested: vi.fn() });
        expect(document.querySelectorAll('[data-card]')).toHaveLength(0);
        const card = within(screen.getByTestId('kg-act-empty').parentElement as HTMLElement);
        expect(card.getByText(L.surface.act.emptyTitle)).toBeTruthy();
        expect(card.getByText(L.surface.act.emptyStation)).toBeTruthy();
        fireEvent.click(card.getByRole('button', { name: L.surface.act.emptyAsk }));
        expect(p.onAskUntested).toHaveBeenCalled();
        fireEvent.click(card.getByRole('button', { name: L.surface.act.emptyShow }));
        expect(p.onShow).toHaveBeenCalledWith(web.refs.slice(0, 200));
    });

    it('lists the system-wide findings once at the top and leaves them off the cards, without changing the counts', () => {
        act({ model: { systemWide: new Set([unusedFinding.id]) } });
        const wide = within(screen.getByTestId('kg-act-system-wide').parentElement as HTMLElement);
        expect(wide.getByText(L.findingKinds.unusedExport ?? 'unused-export')).toBeTruthy();
        expect(document.querySelector('[data-card="f-unused"]')).toBeNull();
        expect(document.querySelectorAll('[data-card]')).toHaveLength(2);
        expect(screen.getByTestId('kg-act-title').textContent).toBe(counted(L, 'issueAt', 3, { scope: L.surface.actScopeAll }));
    });

    it('does not scope a finding through a hidden view: the findings passed are the ones counted', () => {
        // The rail is handed graph.findings scoped by stations only; nothing here narrows them again.
        act({ findings: withUnused.findings });
        expect(screen.getByRole('button', { name: fillTemplate(L.surface.act.fixQueue, { count: 3 }) })).toBeTruthy();
    });

    it('offers no test card and no footer for a one-stop path (no hops)', () => {
        act({ path: { stops: [path.stops[0]!], hops: [] } });
        expect(screen.queryByText(L.surface.act.keepTitle)).toBeNull();
        expect(screen.queryByTestId('kg-done-when')).toBeNull();
    });

    it('pins the footer outside the scrolling body', () => {
        act({ path });
        const footer = screen.getByTestId('kg-done-when');
        expect(footer.parentElement!.tagName).toBe('ASIDE');
    });
});

describe('shared pin numbering', () => {
    it('numbers findings by their place in graph.findings: the rail tag and the card agree', () => {
        const api = model.stations.find((s) => s.name === 'API')!;
        const reversed = [...withUnused.findings].reverse();
        const pins = pinNumbers(reversed);
        const first = firstFindings([api], reversed).get(api.id)!;
        expect(pins.get(first.finding.id)).toBe(first.n);
        const g = { ...withUnused, findings: reversed };
        render(<ActPanel {...{ graph: g, findings: reversed, labels: L, station: null, stations: model.stations, scopeName: null, compact: false, onClearScope: vi.fn(), onShow: vi.fn() }} />);
        const card = document.querySelector(`[data-card="${first.finding.id}"]`)!;
        expect(card.querySelector('span')!.textContent).toBe(String(first.n));
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

    describe('testRequestFor', () => {
        const index = nodeIndex(graph);
        it('names the path, its stops in order and the checks, from the catalog template alone', () => {
            const text = testRequestFor(path, 'Web line', withUnused.findings, L, index);
            expect(text).toContain('Web line');
            expect(text).toContain(path.stops.map((s) => s.name).join(' → '));
            expect(text).toContain(L.findingKinds.partitionViolation ?? '');
            expect(text).not.toMatch(/[{}]/);
        });

        it('says no finding is open when the path has none', () => {
            expect(testRequestFor(path, 'Web line', [], L, index)).toContain(L.surface.act.doneNone);
        });
    });
});
