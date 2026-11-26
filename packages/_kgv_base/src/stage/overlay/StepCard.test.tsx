import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { SourceLocation, SymbolRecord } from '../../types';
import { codeTargetOf, type CallStep } from '../drill/codeText';
import type { CodeReading } from '../drill/useCodeReading';
import { StepCard } from './StepCard';

const T = L.surface.code;
const records: SymbolRecord[] = [
    { ref: 'src:sys::order.ts#Order', name: 'Order', kind: 'class', parent: 'src:sys::order.ts', line: 1, exported: true },
    { ref: 'src:sys::order.ts#place', name: 'place', kind: 'method', parent: 'src:sys::order.ts#Order', line: 10, exported: false },
    { ref: 'src:sys::order.ts#cancel', name: 'cancel', kind: 'method', parent: 'src:sys::order.ts#Order', line: 20, exported: false },
    { ref: 'src:sys::api.ts#post', name: 'post', kind: 'function', parent: 'src:sys::api.ts', line: 3, exported: true, relations: [{ kind: 'calls', to: 'src:sys::order.ts#place' }] },
    { ref: 'src:sys::cli.ts#run', name: 'run', kind: 'function', parent: 'src:sys::cli.ts', line: 7, exported: true, relations: [{ kind: 'calls', to: 'src:sys::order.ts#place' }] },
];
const method = codeTargetOf('src:sys::order.ts#place', records)!;
const steps: CallStep[] = [
    { line: 12, to: 'src:sys::order.ts#cancel', kind: 'calls' },
    { line: 13, to: 'src:sys::pay.ts#charge', kind: 'calls' },
    { line: 14, to: 'src:sys::order.ts#Order', kind: 'reads' },
    { line: 15, to: 'src:sys::base.ts#Base', kind: 'extends' },
];
const SOURCE: Record<number, string> = { 12: '    this.cancel();', 13: '    await pay.charge(this);', 14: '    if (this.status) {', 15: '    super.place();' };

/** A reading model at step `current`; `text` false: the pane has not read the text (or has no `readSource`). */
function readingAt(current: number, text = true): CodeReading {
    return {
        follow: true, toggleFollow: vi.fn(), steps, span: method, current, line: null, chain: [], fileSymbols: [], byRef: new Map(),
        jump: undefined, jumpTo: vi.fn(), onReadingLine: vi.fn(), cursor: null, pickLine: vi.fn(), onViewport: vi.fn(), inView: null,
        onText: vi.fn(), lineText: (line) => text ? SOURCE[line] : undefined, goStep: vi.fn(),
    };
}

const card = (current: number, extra: { text?: boolean; onOpenSource?: (location: SourceLocation) => void } = {}) => render(
    <StepCard method={method} reading={readingAt(current, extra.text ?? true)} records={records} labels={L} onDrill={vi.fn()} {...(extra.onOpenSource ? { onOpenSource: extra.onOpenSource } : {})} side="right" />,
);
const chip = (c: HTMLElement, name: string) => c.querySelector(`[data-chip="${name}"]`)?.textContent;

describe('the step card chips', () => {
    it('with no current call: the calls in order and the callers of the method', () => {
        const { container } = card(-1);
        expect(container.textContent).toContain(fillTemplate(T.callsInOrder, { count: 4 }));
        expect(chip(container, 'callers')).toBe(fillTemplate(T.callers, { count: 2 }));
    });

    it('name what the step does: a call, a read, a super call', () => {
        expect(chip(card(0).container, 'kind')).toBe(T.kindCalls);
        expect(chip(card(2).container, 'kind')).toBe(T.kindReads);
        expect(chip(card(3).container, 'kind')).toBe(T.kindSuper);
    });

    it('say same file or another', () => {
        expect(chip(card(0).container, 'file')).toBe(T.sameFile);
        expect(chip(card(1).container, 'file')).toBe(T.otherFile);
    });

    it('say awaited or sync from the line of the call, and nothing before the text is read', () => {
        expect(chip(card(1).container, 'await')).toBe(T.awaited);
        expect(chip(card(0).container, 'await')).toBe(T.sync);
        expect(card(1, { text: false }).container.querySelector('[data-chip="await"]')).toBeNull();
    });
});

describe('a callee whose code is not loaded', () => {
    it('opens in the host editor at its file', () => {
        const onOpenSource = vi.fn();
        const { container } = card(1, { onOpenSource });
        expect(container.querySelector('[data-action="drill-callee"]')).toBeNull();
        const open = container.querySelector('[data-action="open-callee"]') as HTMLButtonElement;
        expect(open.textContent).toBe(fillTemplate(T.openCallee, { name: 'charge' }));
        fireEvent.click(open);
        expect(onOpenSource).toHaveBeenCalledWith({ path: 'pay.ts', startLine: 1, endLine: 1 });
    });

    it('a loaded callee drills instead, and with no host editor there is no Open', () => {
        const onOpenSource = vi.fn();
        expect(card(0, { onOpenSource }).container.querySelector('[data-action="open-callee"]')).toBeNull();
        expect(card(1).container.querySelector('[data-action="open-callee"]')).toBeNull();
    });
});
