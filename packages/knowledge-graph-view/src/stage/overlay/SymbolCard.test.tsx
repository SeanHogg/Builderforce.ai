/**
 * The symbol card: it shows for a mark on the stage (not for no mark, nor one that left the stage), names the symbol's
 * kind, state, lines and counts, and its buttons drill in, zoom, open the code and the file.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { SymbolRecord } from '../../types';
import { StageBus, StageBusContext } from '../anchor/stageBus';
import type { Placement } from '../types';
import { SymbolCard, type SymbolCardProps } from './SymbolCard';

const records: SymbolRecord[] = [
    { ref: 'src:sys::a.ts#Order', name: 'Order', kind: 'class', parent: 'src:sys::a.ts', line: 1, exported: true },
    { ref: 'src:sys::a.ts#place', name: 'place', kind: 'method', parent: 'src:sys::a.ts#Order', line: 10, exported: false, relations: [{ kind: 'calls', to: 'src:b.ts#reserve', sites: [{ path: 'a.ts', line: 12, column: 1, order: 0 }] }] },
    { ref: 'src:sys::a.ts#id', name: 'id', kind: 'const', parent: 'src:sys::a.ts#Order', line: 5, exported: false },
];

function busWith(keys: string[]): StageBus {
    const bus = new StageBus();
    const placement = { position: new Float32Array(keys.length * 3), scale: new Float32Array(keys.map(() => 1)), links: [] } as unknown as Placement;
    bus.setPlacement(placement, keys);
    return bus;
}

function mount(over: Partial<SymbolCardProps> = {}) {
    const props: SymbolCardProps = {
        slotKey: 'node:src:sys::a.ts#Order', symbolRef: 'src:sys::a.ts#Order', name: 'Order', state: 'selected', records, markType: 'class', labels: L,
        onDrill: vi.fn(), onCode: vi.fn(), onZoomIn: vi.fn(), onZoomOut: vi.fn(), ...over,
    };
    render(
        <StageBusContext.Provider value={busWith(['node:src:sys::a.ts#Order', 'node:src:sys::a.ts#place'])}>
            <SymbolCard {...props} />
        </StageBusContext.Provider>,
    );
    return props;
}

describe('SymbolCard', () => {
    it('names the kind and state, the lines and the counts of a class', () => {
        mount();
        const card = document.querySelector('[data-symbol-card]')!;
        expect(card.textContent).toContain(L.legend.typeClass);
        expect(card.textContent).toContain(L.surface.code.stateSelected);
        expect(card.textContent).toContain('a.ts:1–');
        expect(card.querySelector('[data-chip="methods"]')?.textContent).toBe(fillTemplate(L.surface.code.methodsCount, { count: 1 }));
        expect(card.querySelector('[data-chip="fields"]')?.textContent).toBe(fillTemplate(L.surface.code.fieldsCount, { count: 1 }));
        expect(card.querySelector('[data-chip="calls"]')).toBeNull();
    });

    it('offers Drill in only for a symbol with calls, and wires its buttons', () => {
        const props = mount({ symbolRef: 'src:sys::a.ts#place', slotKey: 'node:src:sys::a.ts#place', markType: 'function' });
        fireEvent.click(screen.getByRole('button', { name: L.surface.code.drillInAction }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.code.showCode }));
        fireEvent.click(screen.getByRole('button', { name: L.zoomIn }));
        fireEvent.click(screen.getByRole('button', { name: L.zoomOut }));
        expect(props.onDrill).toHaveBeenCalledTimes(1);
        expect(props.onCode).toHaveBeenCalledTimes(1);
        expect(props.onZoomIn).toHaveBeenCalledTimes(1);
        expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    });

    it('has no Drill in for a symbol with no calls, and opens the file only with a host editor', () => {
        const onOpenSource = vi.fn();
        mount({ onOpenSource });
        expect(screen.queryByRole('button', { name: L.surface.code.drillInAction })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: L.surface.code.openFile }));
        expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ path: 'a.ts', startLine: 1 }));
    });

    it('says an external mark is imported', () => {
        mount({ markType: 'external' });
        expect(document.querySelector('[data-chip="imported"]')?.textContent).toBe(L.surface.code.imported);
    });

    it('shows Callers and Simulate only with their callbacks, and Restructure instead of Simulate for an anti-pattern', () => {
        const t = L.surface.map.card;
        mount();
        expect(screen.queryByRole('button', { name: t.whoCalls })).toBeNull();
        expect(screen.queryByRole('button', { name: t.simulate })).toBeNull();
        document.body.innerHTML = '';
        const props = mount({ onCallers: vi.fn(), onSimulate: vi.fn(), onRestructure: vi.fn(), facts: { antiPatternOf: () => null, untested: () => true } });
        fireEvent.click(screen.getByRole('button', { name: t.whoCalls }));
        fireEvent.click(screen.getByRole('button', { name: t.simulate }));
        expect(props.onCallers).toHaveBeenCalledTimes(1);
        expect(props.onSimulate).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-fact="tests"]')?.textContent).toBe(t.testNone);
        document.body.innerHTML = '';
        mount({ onSimulate: vi.fn(), onRestructure: vi.fn(), facts: { antiPatternOf: () => ({ kind: 'god-module', findingId: 'f' }), untested: () => false } });
        expect(screen.queryByRole('button', { name: t.simulate })).toBeNull();
        expect(screen.getByRole('button', { name: t.restructure })).toBeTruthy();
        expect(document.querySelector('[data-fact="anti"]')?.textContent).toBe(L.findingKinds.godModule);
    });

    it('shows nothing with no mark', () => {
        mount({ slotKey: null });
        expect(document.querySelector('[data-symbol-card]')).toBeNull();
    });

    it('is hidden for a mark that is not on the stage', () => {
        mount({ slotKey: 'node:gone' });
        expect(document.querySelector('[data-symbol-card]')?.hasAttribute('hidden')).toBe(true);
    });
});
