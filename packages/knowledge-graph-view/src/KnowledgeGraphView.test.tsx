// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { LENSES, lensesFor } from './lenses';
import { codeFixture, docsFixture, fixtureSource, mixedFixture, openList } from './testing';
import { lensIsPicked, openDetails, pickLens } from './testPicks';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';

// jsdom has no WebGL, so the view stays on the list; the 3D chunk is never requested.

vi.mock('./scene/GraphScene', () => ({ default: () => null }));

async function mount(graphs: KnowledgeGraph[], props: Partial<Parameters<typeof KnowledgeGraphView>[0]> = {}) {
    const source = fixtureSource(graphs);
    const utils = render(<div style={{ height: 600 }}><KnowledgeGraphView source={source} {...props} /></div>);
    if (graphs.length > 0) { await openList({ screen, fireEvent }); openDetails({ fireEvent }); }
    return { source, ...utils };
}

// The lens row is gone: a lens is picked through its question pill or the More questions menu.
const deps = { fireEvent };
const pick = (id: keyof typeof LENSES) => pickLens(deps, L, id);

describe('KnowledgeGraphView', () => {
    it.each([
        ['code', codeFixture()],
        ['docs', docsFixture()],
        ['mixed', mixedFixture()],
    ])('renders every lens that applies to the %s fixture', async (_name, graph) => {
        await mount([graph]);
        const offered = lensesFor(graph);
        expect(offered.length).toBeGreaterThan(0);
        for (const lens of offered) {
            pick(lens.id);
            expect(lensIsPicked(deps, L, lens.id)).toBe(true);
            expect(screen.getByText(L.lensHints[lens.id])).toBeTruthy();
        }
    });

    it('offers all nine lenses on the mixed fixture, and only the applicable ones elsewhere', async () => {
        expect(lensesFor(mixedFixture()).map((l) => l.id)).toEqual(Object.keys(LENSES));
        expect(lensesFor(docsFixture()).map((l) => l.id)).not.toContain('partitions');
        expect(lensesFor(codeFixture()).map((l) => l.id)).not.toContain('claims');
    });

    it('shows the partition matrix on Partitions and before/after on Compare', async () => {
        await mount([codeFixture()]);
        pick('partitions');
        expect(screen.getByRole('table')).toBeTruthy();
        expect(document.querySelector('[data-verdict="upward"]')).toBeTruthy();
        pick('compare');
        expect(screen.getByText(L.compareEmpty)).toBeTruthy();
    });

    it('focuses the first search hit and opens its panel', async () => {
        await mount([docsFixture()]);
        const box = screen.getByRole('searchbox', { name: L.searchLabel });
        fireEvent.change(box, { target: { value: 'termination' } });
        fireEvent.submit(box.closest('form')!);
        const panel = await screen.findByRole('dialog');
        expect(within(panel).getAllByText('policy/termination.md').length).toBeGreaterThan(0);
        const selected = screen.getAllByRole('button', { pressed: true }).find((b) => b.textContent?.includes('policy/termination.md'));
        expect(selected).toBeTruthy();
    });

    it('routes Fix with agent to onCompose with the finding’s fixed request', async () => {
        const onCompose = vi.fn();
        await mount([codeFixture()], { onCompose });
        const list = screen.getByTestId('kg-list');
        // Findings are nested: expand the group before its rows exist.
        fireEvent.click(within(list).getByRole('button', { name: /Clone group/ }));
        const clone = list.querySelector('[data-finding="clone-group"]') as HTMLElement;
        fireEvent.click(within(clone).getByRole('button', { name: L.fixWithAgent }));
        expect(onCompose).toHaveBeenCalledTimes(1);
        const text = onCompose.mock.calls[0]![0] as string;
        expect(text).toContain('clone group g1');
        expect(text).toContain('app/billing.tsx');
        expect(text).not.toMatch(/[{}]/);
    });

    it('routes the selected findings to onCompose as ONE batched request', async () => {
        const onCompose = vi.fn();
        await mount([codeFixture()], { onCompose });
        const list = screen.getByTestId('kg-list');
        fireEvent.click(within(list).getByRole('button', { name: L.selectAll }));
        fireEvent.click(within(list).getByRole('button', { name: /Fix \d+ with agent/ }));
        expect(onCompose).toHaveBeenCalledTimes(1);
        const text = onCompose.mock.calls[0]![0] as string;
        expect(text.startsWith('Resolve these 5 findings together')).toBe(true);
        expect(text).toContain('- ');
        expect(text).not.toMatch(/[{}]/);
    });

    it('offers no Fix button without a composer', async () => {
        await mount([codeFixture()]);
        expect(screen.queryByRole('button', { name: L.fixWithAgent })).toBeNull();
    });

    it('shows every finding in the list fallback', async () => {
        const graph = mixedFixture();
        await mount([graph]);
        const list = screen.getByTestId('kg-list');
        // Nested groups are lazy: expand each before its rows exist.
        const groups = within(list).getAllByRole('button', { expanded: false })
            .filter((el) => el.getAttribute('aria-expanded') !== null);
        for (const group of groups) fireEvent.click(group);
        const shown = [...list.querySelectorAll('[data-finding]')].map((el) => el.getAttribute('data-finding'));
        expect(shown.sort()).toEqual(graph.findings.map((f) => f.kind).sort());
    });

    it('gives an empty source the explained empty state with Review a folder', async () => {
        render(<KnowledgeGraphView source={fixtureSource([])} />);
        expect(await screen.findByText(L.emptyTitle)).toBeTruthy();
        expect(screen.getByText(L.emptyBody)).toBeTruthy();
        expect(screen.getByRole('button', { name: L.reviewFolder })).toBeTruthy();
    });

    it('runs the review confirm handshake: plan → the Reviews panel → Start review → done', async () => {
        const source = fixtureSource([]);
        render(<KnowledgeGraphView source={source} />);
        fireEvent.click(await screen.findByRole('button', { name: L.reviewFolder }));
        expect(source.requests).toEqual([{ pick: true }]);
        // The plan opens the Reviews panel by itself: what was counted, then what this run will do.
        const start = await screen.findByTestId('kg-review-start');
        expect(within(start).getByText(L.surface.run.review.tileUnchanged).parentElement!.textContent).toContain('1');
        // This source prices nothing: the panel says the cost comes after routing.
        expect(within(start).getByText(new RegExp(`^≈ 4 model calls · ${L.reviewPlanCostPending}`))).toBeTruthy();
        expect(source.confirmed).toEqual([]);
        fireEvent.click(screen.getByTestId('kg-footer-action'));
        expect(await screen.findByText(L.reviewDoneTitle)).toBeTruthy();
        expect(source.confirmed).toEqual([true]);
    });

    it('writes nothing when the panel is closed on the plan, and Everything again plans again with force', async () => {
        const source = fixtureSource([]);
        render(<KnowledgeGraphView source={source} />);
        fireEvent.click(await screen.findByRole('button', { name: L.reviewFolder }));
        const panel = await screen.findByTestId('kg-review-start');
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: L.close }));
        await waitFor(() => expect(source.confirmed).toEqual([false]));
        expect(panel.isConnected).toBe(false);

        fireEvent.click(await screen.findByRole('button', { name: L.reviewFolder }));
        const again = await screen.findByTestId('kg-review-start');
        fireEvent.click(within(again).getAllByRole('radio')[1]!);
        await waitFor(() => expect(source.requests.at(-1)).toMatchObject({ force: true, rootId: 'docs' }));
        const [changed, everything] = within(await screen.findByTestId('kg-review-start')).getAllByRole('radio');
        expect(everything!.getAttribute('aria-checked')).toBe('true');
        expect(changed!.getAttribute('aria-checked')).toBe('false');
    });
});
