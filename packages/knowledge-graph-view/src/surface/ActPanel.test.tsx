// @vitest-environment jsdom
/** The Act rail: cards, Apply, Prompt, the Fix queue link, keep-as-test, the done-when footer, the stat grid and Details; and its pure model. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { nodeIndex } from '../graphModel';
import { ActPanel } from './ActPanel';
import { acceptanceChecks, actionCards, findingSource, testRequestFor } from './actModel';
import { pathOfLine } from './path';
import { graph, lines, model, unusedFinding } from './testFixtures';

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
const composed = (p: { onCompose?: unknown }) => (p.onCompose as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;

describe('ActPanel rail', () => {
    it('draws at most three cards: numbered, titled, with where the finding came from', () => {
        act();
        const cards = document.querySelectorAll('[data-card]');
        expect(cards.length).toBe(3);
        expect([...cards].map((c) => c.querySelector('span')!.textContent)).toEqual(['1', '2', '3']);
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

    it('shows the station stats as a grid, "Not set up" muted', () => {
        act({ station: web, scopeName: 'Web app' });
        expect(document.querySelectorAll('[data-fact]')).toHaveLength(6);
        expect(within(screen.getByTestId('kg-station-facts')).getAllByText(L.surface.notSetUp).length).toBeGreaterThan(0);
    });

    it('keeps Insights and the Lens panel in a Details section that is OPEN by default and collapses on demand', () => {
        act({ children: <p>insights and lens</p> });
        const toggle = screen.getByRole('button', { name: L.surface.act.detailsTitle });
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.getAttribute('aria-controls')).toBe(screen.getByText('insights and lens').parentElement!.id);
        expect(screen.getByText('insights and lens').closest('[hidden]')).toBeNull();
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.getByText('insights and lens').closest('[hidden]')).not.toBeNull(); // still mounted: its state is kept
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
