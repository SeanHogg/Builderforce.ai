import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { MarkType } from '../../shapes';
import type { Station } from '../../surface/stations';
import type { SymbolFacts } from '../../surface/symbolFacts';
import { CodeOutline, type CodeOutlineProps } from './CodeOutline';

const t = L.surface.code;
const station = (id: string, name: string): Station => ({ id, name, refs: [`src:sys::${id}.ts`] } as unknown as Station);
const stations = [station('api', 'API'), station('orders', 'Orders'), station('db', 'Db')];
const facts: SymbolFacts = {
    untested: (ref) => ref === 'src:sys::orders.ts',
    antiPatternOf: (ref) => (ref === 'src:sys::orders.ts' ? { kind: 'god-module', findingId: 'f1' } : null),
};
const types = new Map<string, MarkType>([['api', 'function'], ['orders', 'class'], ['db', 'data']]);

function outline(over: Partial<CodeOutlineProps> = {}) {
    const props: CodeOutlineProps = {
        stations, keyOf: (s) => `st:${s.id}`, types, facts, selected: null, canEnter: (id) => id !== 'db', onSelect: vi.fn(), onEnter: vi.fn(), labels: L, ...over,
    };
    return { props, ...render(<CodeOutline {...props} />) };
}
const row = (c: HTMLElement, id: string) => c.querySelector(`[data-outline-member="src:sys::${id}.ts"]`) as HTMLElement;

describe('the docked outline of the level', () => {
    it('lists the members with their shape glyph, a no-test mark and an anti-pattern mark', () => {
        const { container } = outline();
        expect(container.querySelectorAll('[data-outline-member]')).toHaveLength(3);
        expect(row(container, 'api').querySelector('[data-glyph-shape]')).not.toBeNull();
        expect(row(container, 'api').querySelector('[data-mark]')).toBeNull();
        expect(row(container, 'orders').querySelector('[data-mark="no-test"]')?.textContent).toBe(t.rowNoTest);
        expect(row(container, 'orders').querySelector('[data-mark="anti-pattern"] svg')?.getAttribute('aria-label')).toBe(fillTemplate(t.rowAntiPattern, { name: 'God module' }));
    });

    it('a click on a row selects through the stage path (the slot key), and marks it current', () => {
        const onSelect = vi.fn();
        const { container } = outline({ onSelect, selected: 'st:orders' });
        fireEvent.click(row(container, 'api').querySelector('button')!);
        expect(onSelect).toHaveBeenCalledWith('st:api');
        expect(row(container, 'orders').querySelector('[aria-current="true"]')).not.toBeNull();
    });

    it('Go inside shows only where there is an inside and runs the enter path', () => {
        const onEnter = vi.fn();
        const { container } = outline({ onEnter });
        expect(row(container, 'db').querySelector('[data-row-action="enter"]')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(t.rowGoInside, { name: 'API' }) }));
        expect(onEnter).toHaveBeenCalledWith('api');
    });

    it('Restructure shows for an anti-pattern only when the host handles it', () => {
        const { container, rerender, props } = outline();
        expect(container.querySelector('[data-row-action="restructure"]')).toBeNull();
        const onRestructure = vi.fn();
        rerender(<CodeOutline {...props} onRestructure={onRestructure} />);
        expect(container.querySelectorAll('[data-row-action="restructure"]')).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(t.rowRestructure, { name: 'Orders' }) }));
        expect(onRestructure).toHaveBeenCalledWith('src:sys::orders.ts');
    });

    it('says so when the level is empty, and notes a host that cannot read source; Hide is a button only when handled', () => {
        const onHide = vi.fn();
        const { container } = outline({ stations: [], note: t.levelNoSource, onHide });
        expect(container.querySelector('[data-outline-empty]')?.textContent).toBe(t.levelEmpty);
        expect(container.querySelector('[data-outline-note]')?.textContent).toBe(t.levelNoSource);
        fireEvent.click(screen.getByRole('button', { name: t.dockHide }));
        expect(onHide).toHaveBeenCalled();
    });
});
