import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { SourceReader, SymbolRecord } from '../../types';
import { ROW_PX } from '../drill/CodeLayer';
import { codeTargetOf, fileTargetOf } from '../drill/codeText';
import { useCodeReading } from '../drill/useCodeReading';
import { CodeDock, codePaneWidth, SPLIT_MIN_PX, type CodeDockProps } from './CodeDock';
import { CodeTrail } from './CodeTrail';
import { StepCard } from './StepCard';

const records: SymbolRecord[] = [
    { ref: 'src:sys::order.ts#Order', name: 'Order', kind: 'class', parent: 'src:sys::order.ts', line: 1, exported: true },
    { ref: 'src:sys::order.ts#place', name: 'place', kind: 'method', parent: 'src:sys::order.ts#Order', line: 10, exported: false },
    { ref: 'src:sys::order.ts#cancel', name: 'cancel', kind: 'method', parent: 'src:sys::order.ts#Order', line: 20, exported: false },
];
const reader: SourceReader = async () => ({ startLine: 1, lines: Array.from({ length: 40 }, (_, i) => `// line ${i + 1}`), truncated: false });
const target = fileTargetOf(codeTargetOf('src:sys::order.ts#place', records)!);
const site = (line: number, order: number) => ({ path: 'order.ts', line, column: 1, order });
const withCalls: SymbolRecord[] = records.map((r) => r.name !== 'place' ? r : {
    ...r, relations: [{ kind: 'calls', to: 'src:stock.ts#reserve', sites: [site(12, 0)] }, { kind: 'calls', to: 'src:pay.ts#charge', sites: [site(13, 1)] }],
});

type PaneProps = Partial<Omit<CodeDockProps, 'reading'>> & { method?: string | null; pick?: string | null; onFocusSymbol?: (ref: string) => void };

/** The code pane, the map's bar and the step card on one reading model, as the wiring composes them. */
function Pane({ method = null, pick = null, onFocusSymbol, records: recs = records, onDrill = vi.fn(), onOut, ...rest }: PaneProps) {
    const reading = useCodeReading({ path: target.path, records: recs, method, scrollLine: rest.scrollLine, pick, onFocusSymbol });
    const open = method ? codeTargetOf(method, recs) : null;
    return (
        <>
            <CodeTrail stack={[]} onClimb={vi.fn()} methods={[]} onMethod={vi.fn()} onLeaveCode={vi.fn()} across={null} follow={reading.follow} onFollow={reading.toggleFollow} onOut={onOut} labels={L} />
            <CodeDock target={target} name="place" reader={reader} labels={L} records={recs} reading={reading} onDrill={onDrill} onClose={vi.fn()} onOut={onOut} {...rest} />
            {open && <StepCard method={open} reading={reading} records={recs} labels={L} onDrill={onDrill} onOut={onOut} side="right" />}
        </>
    );
}

/** Scroll the lines so `rows` rows are above the top (jsdom: the reading line is then line `rows + 1`). */
function scrollTo(container: HTMLElement, rows: number) {
    const lines = container.querySelector('[data-code-lines]') as HTMLDivElement;
    lines.scrollTop = rows * ROW_PX;
    fireEvent.scroll(lines);
}

describe('scrolling the code moves the stage', () => {
    it('names the symbol on the reading line once per symbol boundary', async () => {
        const onFocusSymbol = vi.fn();
        const { container } = render(<Pane onFocusSymbol={onFocusSymbol} />);
        await screen.findByText('// line 1');
        // jsdom has no layout: the reading line is the top line, and opening lights the symbol there.
        expect(onFocusSymbol).toHaveBeenLastCalledWith('src:sys::order.ts#Order');
        onFocusSymbol.mockClear();
        scrollTo(container, 12);
        expect(onFocusSymbol).toHaveBeenCalledTimes(1);
        expect(onFocusSymbol).toHaveBeenCalledWith('src:sys::order.ts#place');
        scrollTo(container, 13);
        expect(onFocusSymbol).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-reading]')?.getAttribute('data-code-line')).toBe('14');
    });

    it('Follow off (on the map bar): scrolling no longer moves the stage', async () => {
        const onFocusSymbol = vi.fn();
        const { container } = render(<Pane onFocusSymbol={onFocusSymbol} />);
        await screen.findByText('// line 1');
        const follow = container.querySelector('[data-code-trail] [data-action="follow"]') as HTMLButtonElement;
        fireEvent.click(follow);
        expect(follow.getAttribute('aria-pressed')).toBe('false');
        onFocusSymbol.mockClear();
        scrollTo(container, 12);
        expect(onFocusSymbol).not.toHaveBeenCalled();
        fireEvent.click(follow);
        expect(onFocusSymbol).toHaveBeenCalledWith('src:sys::order.ts#place');
    });

    it('with a method open, numbers its calls; the reading line keeps the method lit and makes its call current', async () => {
        const onFocusSymbol = vi.fn();
        const { container } = render(<Pane records={withCalls} method="src:sys::order.ts#place" onFocusSymbol={onFocusSymbol} />);
        await screen.findByText('// line 1');
        expect([...container.querySelectorAll('[data-code-step]')].map((b) => b.getAttribute('data-code-step'))).toEqual(['1', '2']);
        expect((container.querySelector('[data-code-line="5"]') as HTMLElement).style.opacity).toBe('0.45');
        scrollTo(container, 13);
        expect(container.querySelector('[data-code-step="2"]')?.hasAttribute('data-current')).toBe(true);
        expect(container.querySelector('[data-code-line="13"]')?.hasAttribute('data-call-site')).toBe(true);
        // The method keeps the reading ring; its current callee is the step card's (and the stage's amber call).
        expect(onFocusSymbol).toHaveBeenLastCalledWith('src:sys::order.ts#place');
        expect(container.querySelector('[data-step-callee]')?.textContent).toBe('charge');
    });

    it('the crumbs name where you read, and a crumb scrolls to its symbol', async () => {
        const { container } = render(<Pane />);
        await screen.findByText('// line 1');
        scrollTo(container, 21);
        const crumbs = [...container.querySelectorAll('[data-code-crumbs] button')];
        expect(crumbs.map((b) => b.textContent)).toEqual(['Order', 'cancel']);
        expect(crumbs[1]!.getAttribute('aria-current')).toBe('location');
        fireEvent.click(crumbs[0]!);
        expect((container.querySelector('[data-code-lines]') as HTMLDivElement).scrollTop).toBe(0);
    });

    it('Out (on the map bar, or Escape in the code) leaves the level, and shows only when there is one to leave', async () => {
        const onOut = vi.fn();
        const { container, rerender } = render(<Pane onOut={onOut} />);
        await screen.findByText('// line 1');
        fireEvent.click(container.querySelector('[data-code-trail] [data-action="out"]') as HTMLButtonElement);
        fireEvent.keyDown(container.querySelector('[data-code-lines]') as HTMLElement, { key: 'Escape' });
        expect(onOut).toHaveBeenCalledTimes(2);
        rerender(<Pane />);
        expect(container.querySelector('[data-action="out"]')).toBeNull();
    });

    it('"Open at line" opens at the line on show', async () => {
        const onOpenSource = vi.fn();
        const { container } = render(<Pane scrollLine={10} onOpenSource={onOpenSource} />);
        await screen.findByText('// line 1');
        fireEvent.click(container.querySelector('[data-action="open-at-line"]') as HTMLButtonElement);
        expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ path: target.path, startLine: 10 }));
    });

    it('a stage hover tints that symbol in the code', async () => {
        const { container } = render(<Pane hover="src:sys::order.ts#cancel" />);
        await screen.findByText('// line 1');
        expect(container.querySelector('[data-code-line="20"]')?.hasAttribute('data-marked')).toBe(true);
        expect(container.querySelector('[data-code-line="5"]')?.hasAttribute('data-marked')).toBe(false);
    });
});

describe('the step card steps the calls of the open method', () => {
    const method = 'src:sys::order.ts#place';
    /** Three calls, two on one line; only `cancel` has a loaded record, so only it gets "Into". */
    const stepped: SymbolRecord[] = records.map((r) => r.name !== 'place' ? r : {
        ...r, relations: [
            { kind: 'calls', to: 'src:sys::order.ts#cancel', sites: [site(12, 0)] },
            { kind: 'calls', to: 'src:pay.ts#charge', sites: [site(12, 1)] },
            { kind: 'calls', to: 'src:stock.ts#reserve', sites: [site(15, 2)] },
        ],
    });
    const status = (c: HTMLElement) => c.querySelector('[data-step-of]')?.textContent ?? '';
    const click = (c: HTMLElement, sel: string) => fireEvent.click(c.querySelector(sel) as HTMLElement);
    const pane = (extra: PaneProps = {}) => <Pane records={stepped} method={method} {...extra} />;

    it('names the method and its calls until one is current; Step through starts at the first', async () => {
        const { container } = render(pane());
        await screen.findByText('// line 1');
        const card = container.querySelector('[data-step-card]') as HTMLElement;
        expect(card.textContent).toContain(L.surface.code.codeLevel);
        expect(card.textContent).toContain('Calls in order: 3');
        click(container, '[data-action="step-through"]');
        expect(status(container)).toBe('Call 1 of 3');
        expect(container.querySelector('[data-step-card]')?.textContent).toContain('line 12');
    });

    it('Next reaches both calls on one line and wraps around; Previous wraps back', async () => {
        const { container } = render(pane());
        await screen.findByText('// line 1');
        click(container, '[data-action="step-through"]');
        click(container, '[data-action="next-step"]');
        expect(status(container)).toBe('Call 2 of 3');
        click(container, '[data-action="next-step"]');
        click(container, '[data-action="next-step"]');
        expect(status(container)).toBe('Call 1 of 3');
        click(container, '[data-action="prev-step"]');
        expect(status(container)).toBe('Call 3 of 3');
    });

    it('a gutter number goes to its call and makes it current', async () => {
        const { container } = render(pane());
        await screen.findByText('// line 1');
        click(container, '[data-code-step="3"]');
        expect(status(container)).toBe('Call 3 of 3');
        expect(container.querySelector('[data-code-step="3"]')?.hasAttribute('data-current')).toBe(true);
    });

    it('a callee picked on the stage goes to its call', async () => {
        const { container, rerender } = render(pane());
        await screen.findByText('// line 1');
        rerender(pane({ pick: 'src:stock.ts#reserve' }));
        expect(status(container)).toBe('Call 3 of 3');
    });

    it('"Into" drills to the current callee when it is loaded, and says whether it is in this file', async () => {
        const onDrill = vi.fn();
        const { container } = render(pane({ onDrill }));
        await screen.findByText('// line 1');
        click(container, '[data-action="step-through"]');
        expect(container.querySelector('[data-step-card]')?.textContent).toContain(L.surface.code.sameFile);
        click(container, '[data-action="drill-callee"]');
        expect(onDrill).toHaveBeenCalledWith('src:sys::order.ts#cancel');
        click(container, '[data-action="next-step"]');
        expect(container.querySelector('[data-action="drill-callee"]')).toBeNull();
        expect(container.querySelector('[data-step-card]')?.textContent).toContain(L.surface.code.otherFile);
    });
});

describe('the split layout', () => {
    it('gives the code 42% of a box wide enough for both sides, and floats it over a narrower one', () => {
        expect(codePaneWidth(1000)).toBe(420);
        expect(codePaneWidth(SPLIT_MIN_PX)).toBe(Math.round(SPLIT_MIN_PX * 0.42));
        expect(codePaneWidth(SPLIT_MIN_PX - 1)).toBe(0);
    });
});
