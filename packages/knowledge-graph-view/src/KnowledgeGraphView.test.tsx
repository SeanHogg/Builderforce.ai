// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { LENSES, lensesFor } from './lenses';
import { codeFixture, docsFixture, fixtureSource, mixedFixture } from './testing';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';

// jsdom has no WebGL, so the view stays on the list; the 3D chunk is never requested.
vi.mock('./scene/GraphScene', () => ({ default: () => null }));

async function mount(graphs: KnowledgeGraph[], props: Partial<Parameters<typeof KnowledgeGraphView>[0]> = {}) {
    const source = fixtureSource(graphs);
    const utils = render(<div style={{ height: 600 }}><KnowledgeGraphView source={source} {...props} /></div>);
    if (graphs.length > 0) await screen.findByTestId('kg-list');
    return { source, ...utils };
}

const lensButton = (id: keyof typeof LENSES) =>
    within(screen.getByRole('navigation', { name: L.lensesLabel })).getByRole('button', { name: L.lenses[id] });

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
            fireEvent.click(lensButton(lens.id));
            expect(lensButton(lens.id).getAttribute('aria-pressed')).toBe('true');
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
        fireEvent.click(lensButton('partitions'));
        expect(screen.getByRole('table')).toBeTruthy();
        expect(document.querySelector('[data-verdict="upward"]')).toBeTruthy();
        fireEvent.click(lensButton('compare'));
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
        const clone = list.querySelector('[data-finding="clone-group"]') as HTMLElement;
        fireEvent.click(within(clone).getByRole('button', { name: L.fixWithAgent }));
        expect(onCompose).toHaveBeenCalledTimes(1);
        const text = onCompose.mock.calls[0]![0] as string;
        expect(text).toContain('clone group g1');
        expect(text).toContain('app/billing.tsx');
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
        const shown = [...list.querySelectorAll('[data-finding]')].map((el) => el.getAttribute('data-finding'));
        expect(shown.sort()).toEqual(graph.findings.map((f) => f.kind).sort());
    });

    it('gives an empty source the explained empty state with Review a folder', async () => {
        render(<KnowledgeGraphView source={fixtureSource([])} />);
        expect(await screen.findByText(L.emptyTitle)).toBeTruthy();
        expect(screen.getByText(L.emptyBody)).toBeTruthy();
        expect(screen.getByRole('button', { name: L.reviewFolder })).toBeTruthy();
    });

    it('runs the review confirm handshake: plan → chip → Confirm → done', async () => {
        const source = fixtureSource([]);
        render(<KnowledgeGraphView source={source} />);
        fireEvent.click(await screen.findByRole('button', { name: L.reviewFolder }));
        expect(source.requests).toEqual([{ pick: true }]);
        expect(await screen.findByText('docs: 3 files')).toBeTruthy();
        expect(screen.getByText('1 unchanged since the last review')).toBeTruthy();
        expect(screen.getByText('≈ 4 model calls')).toBeTruthy();
        expect(source.confirmed).toEqual([]);
        fireEvent.click(screen.getByRole('button', { name: L.reviewConfirm }));
        expect(await screen.findByText(L.reviewDoneTitle)).toBeTruthy();
        expect(source.confirmed).toEqual([true]);
    });

    it('writes nothing on Cancel, and Re-review all plans again with force', async () => {
        const source = fixtureSource([]);
        render(<KnowledgeGraphView source={source} />);
        fireEvent.click(await screen.findByRole('button', { name: L.reviewFolder }));
        fireEvent.click(await screen.findByRole('button', { name: L.reviewCancel }));
        expect(await screen.findByText(L.reviewCancelled)).toBeTruthy();
        expect(source.confirmed).toEqual([false]);

        fireEvent.click(screen.getByRole('button', { name: L.reviewFolder }));
        fireEvent.click(await screen.findByRole('button', { name: L.reviewRereviewAll }));
        await waitFor(() => expect(source.requests.at(-1)).toMatchObject({ force: true, rootId: 'docs' }));
        expect(await screen.findByText('0 unchanged since the last review')).toBeTruthy();
    });
});
