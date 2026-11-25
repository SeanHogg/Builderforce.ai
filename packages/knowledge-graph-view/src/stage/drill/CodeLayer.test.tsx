import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { SourceReader, SymbolRecord } from '../../types';
import { CodeLayer, ROW_PX, type CodeLayerProps } from './CodeLayer';
import { codeRows, VIRTUAL_AFTER, type CallStep, type CodeTarget, type Lens, type RailKind } from './codeText';

const target: CodeTarget = { ref: 'src:sys::order.ts#place', name: 'place', path: 'order.ts', startLine: 1, endLine: 400 };
const readerOf = (count: number): SourceReader => async () => ({ startLine: 1, lines: Array.from({ length: count }, (_, i) => `${i % 4 === 0 ? '    ' : ''}// line ${i + 1}`), truncated: false });
const reader = readerOf(40);

const layer = (extra: Partial<CodeLayerProps> = {}) => <CodeLayer target={target} reader={reader} labels={L} onClose={vi.fn()} onReadingLine={vi.fn()} {...extra} />;
const lines = (c: HTMLElement) => c.querySelector('[data-code-lines]') as HTMLDivElement;
function scrollRows(c: HTMLElement, rows: number) {
    lines(c).scrollTop = rows * ROW_PX;
    fireEvent.scroll(lines(c));
}

const ORDER: Lens = { ref: 'src:sys::order.ts#Order', kind: 'class', count: 4 };
const PLACE: Lens = { ref: 'src:sys::order.ts#place', kind: 'method', count: 1 };
const lens = new Map<number, Lens>([[3, ORDER], [10, PLACE]]);

describe('the type rail in the gutter', () => {
    it('colours each line by its symbol kind, and the symbol being read on the accent', async () => {
        const rails = new Map<number, RailKind>([[3, 'class'], [4, 'class'], [5, 'field'], [10, 'method'], [11, 'method']]);
        const { container } = render(layer({ rails, railSpan: { startLine: 10, endLine: 11 } }));
        await screen.findByText('// line 2');
        // The rail is the row's first cell, before the line number.
        const rail = (n: number) => container.querySelector(`[data-code-line="${n}"] > span:first-child`);
        expect(rail(3)?.getAttribute('data-rail')).toBe('class');
        expect(rail(5)?.getAttribute('data-rail')).toBe('field');
        expect(rail(3)?.hasAttribute('data-rail-on')).toBe(false);
        expect(rail(10)?.hasAttribute('data-rail-on')).toBe(true);
        expect(rail(1)?.hasAttribute('data-rail')).toBe(false);
    });

    it('is not drawn without rails (the anchored layer), nor with no source', async () => {
        const { container, rerender } = render(layer());
        await screen.findByText('// line 2');
        expect(container.querySelector('[data-rail-on], [data-rail]')).toBeNull();
        rerender(layer({ reader: undefined, rails: new Map([[1, 'class']]), lens, sticky: () => [] }));
        expect(container.querySelector('[data-code-unavailable]')).not.toBeNull();
        expect(container.querySelector('[data-code-lens], [data-rail], [data-code-sticky]')).toBeNull();
    });
});

describe('lens lines', () => {
    it('sit one row above their definition; a jump to a definition lands on its lens row (rowOfLine) and reads the line; a click acts', async () => {
        const onLens = vi.fn(), onReadingLine = vi.fn();
        const { container } = render(layer({ lens, onLens, onReadingLine, scrollLine: 10 }));
        await screen.findByText('// line 2');
        const rows = [...container.querySelectorAll('[data-code-line], [data-code-lens]')];
        expect(rows.slice(0, 4).map((r) => r.getAttribute('data-code-line') ?? `lens:${r.getAttribute('data-code-lens')}`)).toEqual(['1', '2', `lens:${ORDER.ref}`, '3']);
        // Lines 1–9 and line 3's lens row come before line 10's lens row.
        expect(codeRows(40, 1, lens).rowOfLine(10)).toBe(10);
        expect(lines(container).scrollTop).toBe(10 * ROW_PX);
        expect(container.querySelector('[data-reading]')?.getAttribute('data-code-line')).toBe('10');
        expect(onReadingLine).toHaveBeenLastCalledWith(10);
        const classLens = container.querySelector(`[data-code-lens="${ORDER.ref}"]`) as HTMLElement;
        expect(classLens.textContent).toBe(`${fillTemplate(L.surface.code.lensReferences, { count: 4 })} · ${L.surface.code.showInMap}`);
        const methodLens = container.querySelector(`[data-code-lens="${PLACE.ref}"]`) as HTMLElement;
        expect(methodLens.textContent).toContain(fillTemplate(L.surface.code.lensCaller, { count: 1 }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.code.showInMap }));
        expect(onLens).toHaveBeenLastCalledWith('show', ORDER);
        fireEvent.click(screen.getByRole('button', { name: L.surface.code.drillIn }));
        expect(onLens).toHaveBeenLastCalledWith('drill', PLACE);
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(L.surface.code.lensReferences, { count: 4 }) }));
        expect(onLens).toHaveBeenLastCalledWith('references', ORDER);
    });

    it('a lens row is ROW_PX tall, keeps its definition indent and dims outside the open method', async () => {
        const { container } = render(layer({ lens, span: { startLine: 10, endLine: 19 } }));
        await screen.findByText('// line 2');
        const classLens = container.querySelector(`[data-code-lens="${ORDER.ref}"]`) as HTMLElement;
        const methodLens = container.querySelector(`[data-code-lens="${PLACE.ref}"]`) as HTMLElement;
        expect(classLens.style.height).toBe(`${ROW_PX}px`);
        expect(classLens.style.opacity).toBe('0.3');
        expect(methodLens.style.opacity).toBe('');
        // Every fourth line from 1 is indented: line 10 is not, so neither is its lens.
        expect(methodLens.textContent?.startsWith(' ')).toBe(false);
    });

    it('scrolling over a lens row reads the definition below it', async () => {
        const onReadingLine = vi.fn();
        const { container } = render(layer({ lens, onReadingLine }));
        await screen.findByText('// line 2');
        scrollRows(container, 2);
        expect(onReadingLine).toHaveBeenLastCalledWith(3);
        scrollRows(container, 3);
        expect(onReadingLine).toHaveBeenCalledTimes(2);
        scrollRows(container, 4);
        expect(onReadingLine).toHaveBeenLastCalledWith(4);
    });
});

describe('the sticky header', () => {
    const Order: SymbolRecord = { ref: ORDER.ref, name: 'Order', kind: 'class', parent: 'src:sys::order.ts', line: 3, exported: true };
    const sticky = (first: number) => first > 3 ? [Order] : [];

    it('pins the enclosing symbols of the top line, with no height of its own, and a row goes to its line', async () => {
        const onJump = vi.fn();
        const { container } = render(layer({ sticky, onJump, rails: new Map([[3, 'class']]) }));
        await screen.findByText('// line 2');
        expect(container.querySelector('[data-code-sticky]')).toBeNull();
        scrollRows(container, 6);
        const header = screen.getByRole('group', { name: L.surface.code.stickyAria });
        expect(header.style.position).toBe('sticky');
        expect(parseFloat(header.style.height)).toBe(0);
        const row = header.querySelector('[data-sticky-line="3"]') as HTMLElement;
        expect(row.textContent).toContain('// line 3');
        expect(row.querySelector('[data-rail="class"]')).not.toBeNull();
        fireEvent.click(row);
        expect(onJump).toHaveBeenCalledWith(3);
        scrollRows(container, 0);
        expect(container.querySelector('[data-code-sticky]')).toBeNull();
    });
});

describe('a clicked line and the lines on screen', () => {
    const steps: CallStep[] = [{ line: 6, to: 'src:pay.ts#charge', kind: 'calls' }];

    it('a row click picks its line; the cursor line is the reading row; a step number does not pick', async () => {
        const onPickLine = vi.fn(), onStep = vi.fn();
        const { container, rerender } = render(layer({ onPickLine, steps, onStep }));
        await screen.findByText('// line 2');
        fireEvent.click(container.querySelector('[data-code-line="7"]') as HTMLElement);
        expect(onPickLine).toHaveBeenCalledWith(7);
        rerender(layer({ onPickLine, steps, onStep, cursorLine: 7 }));
        expect(container.querySelector('[data-reading]')?.getAttribute('data-code-line')).toBe('7');
        fireEvent.click(container.querySelector('[data-code-step="1"]') as HTMLElement);
        expect(onStep).toHaveBeenCalledWith(0);
        expect(onPickLine).toHaveBeenCalledTimes(1);
    });

    it('onViewport reports the lines on screen once per change, and onText the text read', async () => {
        const onViewport = vi.fn(), onText = vi.fn();
        const { container } = render(layer({ onViewport, onText }));
        await screen.findByText('// line 2');
        expect(onText).toHaveBeenCalledWith(expect.objectContaining({ startLine: 1, lines: expect.any(Array) }));
        // jsdom measures no height: the rows rendered are on screen.
        expect(onViewport).toHaveBeenLastCalledWith(1, 40);
        scrollRows(container, 5);
        expect(onViewport).toHaveBeenLastCalledWith(6, 40);
        const calls = onViewport.mock.calls.length;
        scrollRows(container, 5);
        expect(onViewport).toHaveBeenCalledTimes(calls);
    });
});

describe('a long file stays exact past VIRTUAL_AFTER with lens rows', () => {
    const COUNT = 3000;
    // A lens above every 50th line: 60 extra rows, all ROW_PX tall.
    const many = new Map<number, Lens>(Array.from({ length: COUNT / 50 }, (_, i) => [i * 50 + 1, { ref: `src:sys::big.ts#m${i}`, kind: 'method', count: 0 }] as const));
    const big = readerOf(COUNT);
    const steps: CallStep[] = [{ line: 2499, to: 'src:pay.ts#charge', kind: 'calls' }, { line: 2900, to: 'src:pay.ts#refund', kind: 'calls' }];

    it('the reading line and a step jump land on their own rows', async () => {
        expect(COUNT).toBeGreaterThan(VIRTUAL_AFTER);
        const onReadingLine = vi.fn();
        const props = { reader: big, lens: many, onReadingLine, steps };
        const { container, rerender } = render(layer({ ...props, scrollLine: 2499 }));
        await screen.findByText('// line 2499');
        const layout = codeRows(COUNT, 1, many);
        expect(lines(container).scrollTop).toBe(layout.rowOfLine(2499) * ROW_PX);
        expect(onReadingLine).toHaveBeenLastCalledWith(2499);
        expect(container.querySelector('[data-reading]')?.getAttribute('data-code-line')).toBe('2499');
        const row = container.querySelector('[data-code-line="2499"]') as HTMLElement;
        expect(row.style.top).toBe(`${layout.rowOfLine(2499) * ROW_PX}px`);
        // A step: the pane is sent to its line and marks the call there.
        rerender(layer({ ...props, scrollLine: 2900, currentStep: 1 }));
        await act(async () => {});
        expect(onReadingLine).toHaveBeenLastCalledWith(2900);
        expect(container.querySelector('[data-call-site]')?.getAttribute('data-code-line')).toBe('2900');
        expect(container.querySelector('[data-reading]')?.getAttribute('data-code-line')).toBe('2900');
        // And scrolling by rows reads exactly: one row down from 2900 is 2901's lens row, which reads 2901.
        scrollRows(container, layout.rowOfLine(2900) + 1);
        expect(onReadingLine).toHaveBeenLastCalledWith(2901);
        // Onto a lens row (above 2951): the definition below it.
        expect(layout.rows[layout.rowOfLine(2951)]).toEqual({ lens: 'src:sys::big.ts#m59' });
        scrollRows(container, layout.rowOfLine(2951));
        expect(onReadingLine).toHaveBeenLastCalledWith(2951);
    });
});
