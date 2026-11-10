import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as LABELS } from './labels';
import { PartitionPicker, PICKER_Z } from './PartitionPicker';

const f = (path: string, partition?: string): KNode =>
    ({ ref: `src:r::${path}`, kind: 'file', label: path, pack: 'code', importance: 0.5, origin: 'extracted', ...(partition ? { partition } : {}) }) as KNode;
const graph = { scope: { rootId: 'r', packs: ['code'], digest: 'd' }, nodes: [f('a.ts', 'domain'), f('b.ts', 'domain'), f('c.ts', 'entry'), f('d.ts')], edges: [], findings: [], stats: { sources: 4, nodes: 4, edges: 0, stale: 0, truncated: false } } as KnowledgeGraph;

const open = (onShow = vi.fn()) => {
    render(<div><PartitionPicker graph={graph} value="domain" labels={LABELS} onShow={onShow} /><button type="button">outside</button></div>);
    fireEvent.click(screen.getByRole('button', { name: /domain/ }));
    return onShow;
};

describe('PartitionPicker', () => {
    it('opens a themed popover: opaque surface token, border, shadow, above the docked panel', () => {
        open();
        const menu = screen.getByRole('menu', { name: LABELS.surface.partitionPicker.label });
        expect(menu.style.background).toContain('--kg-bg');
        expect(menu.style.border).toContain('--kg-border');
        expect(Number(menu.style.zIndex)).toBe(PICKER_Z);
        expect(PICKER_Z).toBeGreaterThan(3);
        expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['domain2', 'entry1', `${LABELS.partitionNone}1`]);
    });

    it('lists community-placed files under their community label after the partitions, a lone one under "other communities" (PRD 38 P1)', () => {
        const c = (path: string, id: number) => ({ ...f(path), badges: { communityId: id, communityConfidence: 0.6 } }) as KNode;
        const g = { ...graph, nodes: [...graph.nodes, c('lib/e.ts', 2), c('lib/g.ts', 2), c('solo/s.ts', 7)] } as KnowledgeGraph;
        const onShow = vi.fn();
        render(<PartitionPicker graph={g} value="community:7" labels={LABELS} onShow={onShow} />);
        fireEvent.click(screen.getByRole('button', { name: /solo/ }));
        expect(screen.getAllByRole('menuitem').map((i) => i.textContent))
            .toEqual(['domain2', 'entry1', 'lib2', `${LABELS.communityOther}1`, `${LABELS.partitionNone}1`]);
        // The folded community selects the shared item.
        expect(screen.getByRole('menuitem', { name: new RegExp(LABELS.communityOther) }).getAttribute('data-selected')).toBe('true');
        fireEvent.click(screen.getByRole('menuitem', { name: /lib/ }));
        expect(onShow).toHaveBeenCalledWith(['src:r::lib/e.ts', 'src:r::lib/g.ts']);
    });

    it('closes on an outside press and on Escape', () => {
        open();
        fireEvent.pointerDown(screen.getByText('outside'));
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /domain/ }));
        fireEvent.keyDown(screen.getByRole('menuitem', { name: /domain/ }), { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('is keyboard navigable and shows the picked partition\'s files', () => {
        const onShow = open();
        const first = screen.getByRole('menuitem', { name: /domain/ });
        expect(document.activeElement).toBe(first);
        fireEvent.keyDown(first, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /entry/ }));
        fireEvent.click(screen.getByRole('menuitem', { name: /entry/ }));
        expect(onShow).toHaveBeenCalledWith(['src:r::c.ts']);
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
