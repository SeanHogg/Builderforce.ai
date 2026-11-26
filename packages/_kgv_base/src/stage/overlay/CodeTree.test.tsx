import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { MarkType } from '../../shapes';
import type { Station } from '../../surface/stations';
import type { SymbolFacts } from '../../surface/symbolFacts';
import { CodeTree, type CodeTreeProps } from './CodeTree';

const t = L.surface.code;
const station = (id: string, name: string): Station => ({ id, name, refs: [`src:sys::${id}.ts`] } as unknown as Station);
const stations = [station('api', 'API'), station('orders', 'Orders'), station('db', 'Db')];
const facts: SymbolFacts = {
    untested: (ref) => ref === 'src:sys::orders.ts',
    testReach: (ref) => (ref === 'src:sys::orders.ts' ? 'none' : 'reached'),
    antiPatternOf: (ref) => (ref === 'src:sys::orders.ts' ? { kind: 'god-module', findingId: 'f1', restructurable: true } : null),
};
const types = new Map<string, MarkType>([['api', 'function'], ['orders', 'class'], ['db', 'data']]);

function tree(over: Partial<CodeTreeProps> = {}) {
    const props: CodeTreeProps = {
        ancestors: [{ depth: 0, name: 'System' }], onClimb: vi.fn(), stations, keyOf: (s) => `st:${s.id}`, types, facts, selected: null,
        canEnter: (id) => id !== 'db', onSelect: vi.fn(), onEnter: vi.fn(), onHover: vi.fn(), labels: L, ...over,
    };
    return { props, ...render(<CodeTree {...props} />) };
}
const row = (c: HTMLElement, id: string) => c.querySelector(`[data-outline-member="src:sys::${id}.ts"]`) as HTMLElement;

describe('the code pane level tree', () => {
    it('lists the ancestors then the members with a glyph, a no-test tag, an anti-pattern mark and a kind tag', () => {
        const { container } = tree();
        expect(container.querySelectorAll('[data-tree-ancestor]')).toHaveLength(1);
        expect(container.querySelectorAll('[data-outline-member]')).toHaveLength(3);
        expect(row(container, 'api').querySelector('[data-glyph-shape]')).not.toBeNull();
        expect(row(container, 'api').querySelector('[data-mark="kind"]')).not.toBeNull();
        expect(row(container, 'orders').querySelector('[data-mark="no-test"]')?.textContent).toBe(t.rowNoTest);
        expect(row(container, 'orders').querySelector('[data-mark="anti-pattern"]')?.getAttribute('aria-label')).toBe(fillTemplate(t.rowAntiPattern, { name: 'God module' }));
    });

    it('reads every file of a multi-file station: an offender in refs[1] still marks the row', () => {
        const multi = { id: 'multi', name: 'Multi', refs: ['src:sys::clean.ts', 'src:sys::orders.ts'] } as unknown as Station;
        const { container } = tree({ stations: [multi] });
        const r = container.querySelector('[data-outline-member]')!;
        expect(r.querySelector('[data-mark="anti-pattern"]')).not.toBeNull();
        expect(r.querySelector('[data-mark="no-test"]')).not.toBeNull();
    });

    it('a click selects through the stage path; the picked row is current; a second click goes inside', () => {
        const onSelect = vi.fn(), onEnter = vi.fn();
        const { container } = tree({ onSelect, onEnter, selected: 'st:orders' });
        fireEvent.click(row(container, 'api').querySelector('button')!);
        expect(onSelect).toHaveBeenCalledWith('st:api');
        expect(row(container, 'orders').querySelector('[aria-current="true"]')).not.toBeNull();
        fireEvent.click(row(container, 'orders').querySelector('button')!);
        expect(onEnter).toHaveBeenCalledWith('orders');
    });

    it('an ancestor climbs the drill; hovering a row lights its shape', () => {
        const onClimb = vi.fn(), onHover = vi.fn();
        const { container } = tree({ onClimb, onHover });
        fireEvent.click(container.querySelector('[data-tree-ancestor="0"]')!);
        expect(onClimb).toHaveBeenCalledWith(0);
        fireEvent.mouseEnter(row(container, 'api').querySelector('button')!);
        expect(onHover).toHaveBeenCalledWith('st:api');
        fireEvent.mouseLeave(row(container, 'api').querySelector('button')!);
        expect(onHover).toHaveBeenLastCalledWith(null);
    });

    it('says so when the level is empty', () => {
        const { container } = tree({ stations: [] });
        expect(container.querySelector('[data-outline-empty]')?.textContent).toBe(t.levelEmpty);
    });
});
