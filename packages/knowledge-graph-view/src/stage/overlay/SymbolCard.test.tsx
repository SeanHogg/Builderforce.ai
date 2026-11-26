/**
 * The symbol card: the ONE note-card shell for a selected, read or pinned mark (not for no mark). It names the symbol's
 * kind, its lines and counts, and its buttons drill in, open the code and the file.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { SymbolRecord } from '../../types';
import { SymbolCard, type SymbolCardProps } from './SymbolCard';

const records: SymbolRecord[] = [
    { ref: 'src:sys::a.ts#Order', name: 'Order', kind: 'class', parent: 'src:sys::a.ts', line: 1, exported: true },
    { ref: 'src:sys::a.ts#place', name: 'place', kind: 'method', parent: 'src:sys::a.ts#Order', line: 10, exported: false, relations: [{ kind: 'calls', to: 'src:b.ts#reserve', sites: [{ path: 'a.ts', line: 12, column: 1, order: 0 }] }] },
    { ref: 'src:sys::a.ts#id', name: 'id', kind: 'const', parent: 'src:sys::a.ts#Order', line: 5, exported: false },
];

function mount(over: Partial<SymbolCardProps> = {}) {
    const props: SymbolCardProps = {
        slotKey: 'node:src:sys::a.ts#Order', symbolRef: 'src:sys::a.ts#Order', name: 'Order', state: 'selected', records, markType: 'class', labels: L,
        onDrill: vi.fn(), onCode: vi.fn(), ...over,
    };
    render(<SymbolCard {...props} />);
    return props;
}

const cardEl = () => document.querySelector('[data-note-card="symbol"]');

describe('SymbolCard', () => {
    it('names the kind, the lines and the counts of a class, and says why it shows', () => {
        mount();
        const card = cardEl()!;
        expect(card.querySelector('[data-note-name]')?.textContent).toBe('Order');
        expect(card.textContent).toContain(L.legend.typeClass);
        expect(card.querySelector('[data-state]')?.getAttribute('data-state')).toBe('selected');
        expect(card.textContent).toContain('a.ts:1–');
        expect(card.querySelector('[data-chip="methods"]')?.textContent).toBe(fillTemplate(L.surface.code.methodsCount, { count: 1 }));
        expect(card.querySelector('[data-chip="fields"]')?.textContent).toBe(fillTemplate(L.surface.code.fieldsCount, { count: 1 }));
        expect(card.querySelector('[data-chip="calls"]')).toBeNull();
    });

    it('wires Drill in and Show code for a symbol with calls', () => {
        const props = mount({ symbolRef: 'src:sys::a.ts#place', slotKey: 'node:src:sys::a.ts#place', markType: 'function' });
        fireEvent.click(screen.getByRole('button', { name: L.surface.code.drillInAction }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.code.showCode }));
        expect(props.onDrill).toHaveBeenCalledTimes(1);
        expect(props.onCode).toHaveBeenCalledTimes(1);
    });

    it('disables Drill in for a symbol with no calls (never hides it), and opens the file only with a host editor', () => {
        const onOpenSource = vi.fn();
        mount();
        expect(screen.queryByRole('button', { name: L.surface.code.openFile })).toBeNull();
        document.body.innerHTML = '';
        mount({ onOpenSource });
        expect((screen.getByRole('button', { name: L.surface.code.drillInAction }) as HTMLButtonElement).disabled).toBe(true);
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
        const props = mount({ onCallers: vi.fn(), onSimulate: vi.fn(), onRestructure: vi.fn(), facts: { antiPatternOf: () => null, testReach: () => 'none', untested: () => true } });
        fireEvent.click(screen.getByRole('button', { name: t.whoCalls }));
        fireEvent.click(screen.getByRole('button', { name: t.simulate }));
        expect(props.onCallers).toHaveBeenCalledTimes(1);
        expect(props.onSimulate).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-fact="tests"]')?.textContent).toBe(t.testNone);
        expect(document.querySelector('[data-fact="risk"]')?.textContent).toBe(t.noRisk);
        document.body.innerHTML = '';
        mount({ onSimulate: vi.fn(), onRestructure: vi.fn(), facts: { antiPatternOf: () => ({ kind: 'god-module', findingId: 'f', restructurable: true }), testReach: () => 'reached', untested: () => false } });
        expect(screen.queryByRole('button', { name: t.simulate })).toBeNull();
        expect(screen.getByRole('button', { name: t.restructure })).toBeTruthy();
        expect(document.querySelector('[data-fact="anti"]')?.textContent).toBe(L.findingKinds.godModule);
        expect(document.querySelector('[data-fact="risk"]')?.textContent).toBe(fillTemplate(t.riskWord, { level: L.surface.map.statWords.anti.high }));
        document.body.innerHTML = '';
        // No coverage reading: the facts row says nothing about tests. A kind with no proposer keeps Simulate.
        mount({ onSimulate: vi.fn(), onRestructure: vi.fn(), facts: { antiPatternOf: () => ({ kind: 'cycle', findingId: 'f', restructurable: false }), testReach: () => 'unknown', untested: () => false } });
        expect(document.querySelector('[data-fact="tests"]')).toBeNull();
        expect(screen.queryByRole('button', { name: t.restructure })).toBeNull();
        expect(screen.getByRole('button', { name: t.simulate })).toBeTruthy();
        expect(document.querySelector('[data-fact="anti"]')).not.toBeNull();
    });

    it('draws the answer row when one is handed in', () => {
        mount({ answer: { icon: null, lead: 'Who calls it?', text: '' } });
        expect(document.querySelector('[data-note-answer]')?.textContent).toBe('Who calls it?');
    });

    it('shows nothing with no mark', () => {
        mount({ slotKey: null });
        expect(cardEl()).toBeNull();
    });
});
