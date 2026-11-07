// @vitest-environment jsdom
/** The System camera as drawn: equal cards with the cap and "+N more", plurals, no "Not set up" text, the store row, the Not-layered row. */
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import { LENSES } from '../../lenses';
import { codeFixture, surfaceFixture } from '../../testing';
import type { SceneProps } from '../registry';
import { counted } from '../plural';
import { SystemTiers } from '../SystemTiers';
import { useSurface } from '../useSurface';
import { MAX_PER_TIER } from './systemModel';

function mount(graph: KnowledgeGraph, extra: Partial<SceneProps> = {}) {
    const onShow = vi.fn(), onCamera = vi.fn();
    function Harness() {
        const surface = useSurface(graph, null);
        return (
            <SystemTiers
                mode="system" graph={graph} drawn={{ nodes: graph.nodes, edges: graph.edges }} lens={LENSES.structure} labels={L} rootTitle="sys" selected={null}
                focus={[]} reducedMotion surface={surface} onSelect={vi.fn()} onShow={onShow} onCamera={onCamera} {...extra}
            />
        );
    }
    render(<Harness />);
    return { onShow, onCamera };
}

/** `count` area-less folders of one file each, in one layer: `count` stations. */
function folders(count: number, partition: string | undefined): KnowledgeGraph {
    const nodes = Array.from({ length: count }, (_, i) => ({
        ref: `src:s::${partition ?? 'x'}${i}/a.ts`, kind: 'file', label: `${partition ?? 'x'}${i}/a.ts`, pack: 'code', importance: 0.5 - i / 100, origin: 'extracted', sourceHash: `h${i}`, ...(partition ? { partition } : {}),
    }));
    return { ...surfaceFixture(), nodes, edges: [], findings: [] } as unknown as KnowledgeGraph;
}

describe('SystemTiers rows', () => {
    it(`draws at most ${MAX_PER_TIER} cards in a tier, then a "+N more" card that opens the List on that layer`, () => {
        const { onShow, onCamera } = mount(folders(9, 'domain'));
        const tier = document.querySelector('[data-tier="domain"]')!;
        expect(tier.querySelectorAll('[data-component]')).toHaveLength(MAX_PER_TIER);
        const more = tier.querySelector('[data-more="domain"]') as HTMLElement;
        expect(more.textContent).toBe(fillTemplate(L.surface.system.more, { count: 3 }));
        fireEvent.click(more);
        expect(onShow).toHaveBeenCalledTimes(1);
        expect(onShow.mock.calls[0]![0]).toHaveLength(9); // every file of the layer, not only the hidden ones
        expect(onCamera).toHaveBeenCalledWith('list');
    });

    it('gives a tier that fits no "+N more" card, and labels each tier in its band colour with the sentence to the next', () => {
        mount(surfaceFixture());
        expect(document.querySelector('[data-more]')).toBeNull();
        const entry = document.querySelector('[data-tier="entry"]')!;
        expect(entry.querySelector('h3')!.style.color).toContain('--kg-band-entry');
        expect(entry.textContent).toContain(L.surface.systemArrows.entry);
        expect((document.querySelector('[data-tier="infrastructure"] h3') as HTMLElement).style.color).toContain('--kg-band-infrastructure');
    });

    it('draws no tile for a station in no layer: one "Not layered · N parts → List" row opens the List instead', () => {
        const { onShow, onCamera } = mount(folders(5, undefined));
        expect(document.querySelectorAll('[data-component]')).toHaveLength(0);
        expect(document.querySelector('[data-tier="other"]')).toBeNull();
        const row = document.querySelector('[data-row="not-layered"]') as HTMLElement;
        expect(row.textContent).toBe(counted(L, 'notLayered', 5));
        fireEvent.click(row);
        expect(onShow).toHaveBeenCalledTimes(1);
        expect(onCamera).toHaveBeenCalledWith('list');
    });

    it('says "1 part" for a single unlayered station', () => {
        mount(folders(1, undefined));
        expect(document.querySelector('[data-row="not-layered"]')!.textContent).toBe(counted(L, 'notLayered', 1));
        expect(counted(L, 'notLayered', 1)).toBe('Not layered · 1 part → List');
    });
});

describe('SystemTiers cards', () => {
    it('writes "1 file" / "2 files" and adds the owner only when there is one', () => {
        mount(surfaceFixture());
        const meta = (name: string) => (screen.getByRole('button', { name: new RegExp(`^${name}, `) }).querySelectorAll('span')[2] as HTMLElement).textContent;
        expect(meta('repositories')).toBe('1 file · platform');
        expect(meta('API')).toBe('2 files · platform');
        expect(meta('cron')).toBe('1 file');
        expect(screen.queryByTestId('kg-kind-text')).toBeNull();
    });

    it('carries the colour-channel dot, and the kinds only in the bar tooltip', () => {
        mount(surfaceFixture());
        const repo = screen.getByRole('button', { name: new RegExp('^repositories, ') });
        expect((repo.querySelector('[data-dot]') as HTMLElement).style.background).toContain('--kg-sev-');
        expect(repo.querySelector('[data-stack]')!.getAttribute('title')).toContain('1');
        expect(repo.textContent).not.toMatch(/×/);
    });

    it('draws the ring bar when it has data, and nothing (no "Not set up" text) when the metric is not set up', () => {
        mount(surfaceFixture());
        expect(screen.getByRole('button', { name: new RegExp('^API, ') }).querySelector('[role="meter"]')).toBeTruthy();
        document.body.innerHTML = '';
        mount(codeFixture());
        const system = screen.getByTestId('kg-system');
        expect(system.querySelector('[role="meter"]')).toBeNull();
        expect(system.textContent).not.toContain(L.surface.notSetUp);
    });

    it('has no description or kind legend inside the scene', () => {
        mount(surfaceFixture());
        expect(screen.queryByTestId('kg-system-legend')).toBeNull();
    });
});

describe('SystemTiers store row', () => {
    it('draws a dashed card per data store or service a line ends in, named as the transit map names it', () => {
        mount(surfaceFixture());
        const store = document.querySelector('[data-tier="data"] [data-terminus="data"]') as HTMLElement;
        expect(store.style.border).toContain('dashed');
        expect(store.textContent).toContain(L.surface.terminus.data);
        expect(store.textContent).toContain('repositories');
    });

    it('selects the store station on click', () => {
        mount(surfaceFixture());
        fireEvent.click(document.querySelector('[data-terminus="data"]')!);
        expect(document.querySelector('[data-terminus="data"]')!.getAttribute('aria-pressed')).toBe('true');
    });

    it('says so when no line ends in a store', () => {
        mount(folders(2, 'domain'));
        expect(screen.getByText(L.surface.system.dataEmpty)).toBeTruthy();
    });
});
