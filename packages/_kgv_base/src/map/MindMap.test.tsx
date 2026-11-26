// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { MindMap } from './MindMap';

const file = (path: string): KNode => ({ ref: `src:r::${path}` as KNode['ref'], kind: 'file', label: path, pack: 'code', importance: 0.5, origin: 'extracted' });
const out = (name: string) => fillTemplate(L.surface.overlay.outTo, { name });

/** Holds the focus the way the real view does: `onShow` sets it, and the map is handed it back. */
function Host({ nodes }: { nodes: KNode[] }) {
    const [focus, setFocus] = useState<string[]>([]);
    return (
        <div style={{ height: 400 }}>
            <MindMap nodes={nodes} findings={[]} rootTitle="repo" selected={null} focus={focus} onSelect={() => undefined} onShow={setFocus} labels={L} label={L.regionLabel} />
        </div>
    );
}

const ready = (c: HTMLElement) => waitFor(() => expect(c.querySelector('svg')).toBeTruthy());
const branch = (c: HTMLElement, id: string) => c.querySelector(`g[data-id="${id}"]`)!;
/** The map is recomputed on idle after every click, so a branch that the click reveals appears a moment later. */
const appears = async (c: HTMLElement, id: string): Promise<Element> => {
    await waitFor(() => expect(c.querySelector(`g[data-id="${id}"]`)).toBeTruthy());
    return branch(c, id);
};
/** The root's id holds a NUL character, which a CSS attribute selector cannot match: select it by its kind. */
const rootBranch = (c: HTMLElement): Element => c.querySelector('g[data-branch="root"]')!;
const outButton = (c: HTMLElement) => c.querySelector('[data-testid="kg-map-out"]');

describe('MindMap', () => {
    // packages/foo holds only src: the files of foo and of foo/src are the same.
    const chain = [file('packages/foo/src/a.ts'), file('packages/foo/src/b.ts'), file('packages/bar/x.ts')];

    it('expands the clicked folder, and Out goes up exactly one level each time', async () => {
        const { container } = render(<Host nodes={chain} />);
        await ready(container);
        expect(outButton(container)).toBeNull();

        fireEvent.click(await appears(container, 'packages'));
        await waitFor(() => expect(outButton(container)?.textContent).toBe(out('repo')));
        expect(await appears(container, 'packages/foo')).toBeTruthy();
        expect(container.querySelector('g[data-id="packages/foo/src"]')).toBeNull(); // foo is not expanded yet

        fireEvent.click(await appears(container, 'packages/foo'));
        await waitFor(() => expect(outButton(container)?.textContent).toBe(out('packages')));
        fireEvent.click(await appears(container, 'packages/foo/src'));
        await waitFor(() => expect(outButton(container)?.textContent).toBe(out('foo')));
        // The files of foo and foo/src are the same; Out still moves to foo, and src folds back.
        fireEvent.click(outButton(container)!);
        await waitFor(() => expect(outButton(container)?.textContent).toBe(out('packages')));
        fireEvent.click(outButton(container)!);
        await waitFor(() => expect(outButton(container)?.textContent).toBe(out('repo')));
        fireEvent.click(outButton(container)!);
        await waitFor(() => expect(outButton(container)).toBeNull());
    });

    it('labels the root, hides the labels a crowded ring has no room for, and shows one on hover', async () => {
        const crowded = Array.from({ length: 300 }, (_, i) => file(`a-rather-long-folder-name-${String(i).padStart(3, '0')}/x.ts`));
        const { container } = render(<Host nodes={crowded} />);
        await ready(container);
        expect(rootBranch(container).getAttribute('data-labelled')).toBe('1');
        const hidden = [...container.querySelectorAll('g[data-branch="folder"][data-labelled="0"]')];
        expect(hidden.length).toBeGreaterThan(0);
        // A hidden label keeps its full name for hover and screen readers.
        expect(hidden[0]!.querySelector('title')?.textContent).toMatch(/^a-rather-long-folder-name-\d{3} \(1\)$/);
        expect(hidden[0]!.getAttribute('aria-label')).toBeTruthy();
        fireEvent.pointerEnter(hidden[0]!);
        await waitFor(() => expect(container.querySelector(`g[data-id="${hidden[0]!.getAttribute('data-id')}"]`)?.getAttribute('data-labelled')).toBe('1'));
    });

    it('says it is laying out until the map lands, instead of showing a blank canvas', async () => {
        const { container, getByTestId } = render(<Host nodes={chain} />);
        expect(getByTestId('kg-laying-out').textContent).toBe(L.surface.scene.layingOut);
        await ready(container);
        expect(container.querySelector('[data-testid="kg-laying-out"]')).toBeNull();
    });

    it('marks folders expanded or not, and goes Out on Escape and Backspace', async () => {
        const { container } = render(<Host nodes={chain} />);
        await ready(container);
        await appears(container, 'packages/foo');
        expect(branch(container, 'packages').getAttribute('aria-expanded')).toBe('true'); // open by default: its folders show
        expect(branch(container, 'packages/foo').getAttribute('aria-expanded')).toBe('false');
        expect(branch(container, 'packages/foo').getAttribute('aria-pressed')).toBeNull();

        fireEvent.click(branch(container, 'packages/foo'));
        await waitFor(() => expect(outButton(container)?.textContent).toBe(out('packages')));
        fireEvent.keyDown(container.querySelector('[data-testid="kg-map"]')!, { key: 'Escape' });
        await waitFor(() => expect(outButton(container)?.textContent).toBe(out('repo')));
        fireEvent.click(await appears(container, 'packages/foo'));
        await waitFor(() => expect(outButton(container)?.textContent).toBe(out('packages')));
        fireEvent.keyDown(container.querySelector('[data-testid="kg-map"]')!, { key: 'Backspace' });
        await waitFor(() => expect(outButton(container)?.textContent).toBe(out('repo')));
    });

    it('puts the Out button before the SVG in the DOM and lets it shrink with an ellipsis', async () => {
        const { container } = render(<Host nodes={chain} />);
        await ready(container);
        fireEvent.click(await appears(container, 'packages'));
        await waitFor(() => expect(outButton(container)).toBeTruthy());
        const button = outButton(container)!;
        const svg = container.querySelector('svg')!;
        expect(button.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const style = (button as HTMLElement).style;
        expect(style.maxWidth).toBe('calc(100% - 16px)');
        expect(style.textOverflow).toBe('ellipsis');
    });

    it('pages the focused folder\'s files through the "+N more" leaf', async () => {
        const many = Array.from({ length: 20 }, (_, i) => file(`docs/f${String(i).padStart(2, '0')}.ts`));
        const { container } = render(<Host nodes={many} />);
        await ready(container);
        fireEvent.click(await appears(container, 'docs'));
        const files = () => [...container.querySelectorAll('g[data-branch="file"]')].map((g) => g.getAttribute('data-id')).sort().join();
        await waitFor(() => expect(container.querySelector('g[data-branch="more"]')).toBeTruthy());
        const first = files();
        expect(first.split(',')).toHaveLength(8);
        fireEvent.click(container.querySelector('g[data-branch="more"]')!);
        await waitFor(() => expect(files()).not.toBe(first));
        expect(files().split(',')).toHaveLength(8);
        fireEvent.click(container.querySelector('g[data-branch="more"]')!);
        await waitFor(() => expect(files().split(',')).toHaveLength(4)); // the last page: no more leaf
        expect(container.querySelector('g[data-branch="more"]')).toBeNull();
    });

    it('pages the "+N folders" leaf until every folder has been shown', async () => {
        const wide = Array.from({ length: 900 }, (_, i) => file(`d${String(i).padStart(4, '0')}/x.ts`));
        const { container } = render(<Host nodes={wide} />);
        await ready(container);
        const seen = new Set<string>();
        for (let page = 0; page < 20; page++) {
            for (const g of container.querySelectorAll('g[data-branch="folder"]')) seen.add(g.getAttribute('data-id')!);
            const leaf = container.querySelector('g[data-branch="more"]');
            if (!leaf) break;
            const before = [...container.querySelectorAll('g[data-branch="folder"]')].map((g) => g.getAttribute('data-id')).join();
            fireEvent.click(leaf);
            await waitFor(() => expect([...container.querySelectorAll('g[data-branch="folder"]')].map((g) => g.getAttribute('data-id')).join()).not.toBe(before));
        }
        expect(seen.size).toBe(900);
    });
});
