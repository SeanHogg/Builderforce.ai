import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { SourceReader, SymbolRecord } from '../../types';
import { StageBus, StageBusContext } from '../anchor/stageBus';
import { ROW_PX } from '../drill/CodeLayer';
import { codeTargetOf, fileTargetOf } from '../drill/codeText';
import { CodeDock } from './CodeDock';

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

/** The docked panel still mounts `useSlotAnchor` (with no slot), which needs a bus. */
const bus = new StageBus();
const wrapper = ({ children }: { children: ReactNode }) => <StageBusContext.Provider value={bus}>{children}</StageBusContext.Provider>;

/** Scroll the docked lines so `rows` rows are above the top (jsdom: the reading line is then line `rows + 1`). */
function scrollTo(container: HTMLElement, rows: number) {
    const lines = container.querySelector('[data-code-lines]') as HTMLDivElement;
    lines.scrollTop = rows * ROW_PX;
    fireEvent.scroll(lines);
}

describe('scrolling the docked code moves the stage', () => {
    it('names the symbol on the reading line once per symbol boundary', async () => {
        const onFocusSymbol = vi.fn();
        const { container } = render(
            <CodeDock target={target} name="place" reader={reader} labels={L} records={records} onDrill={vi.fn()} onClose={vi.fn()} onFocusSymbol={onFocusSymbol} />,
            { wrapper },
        );
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

    it('Follow off: scrolling no longer moves the stage', async () => {
        const onFocusSymbol = vi.fn();
        const { container } = render(
            <CodeDock target={target} name="place" reader={reader} labels={L} records={records} onDrill={vi.fn()} onClose={vi.fn()} onFocusSymbol={onFocusSymbol} />,
            { wrapper },
        );
        await screen.findByText('// line 1');
        const follow = container.querySelector('[data-action="follow"]') as HTMLButtonElement;
        fireEvent.click(follow);
        expect(follow.getAttribute('aria-pressed')).toBe('false');
        onFocusSymbol.mockClear();
        scrollTo(container, 12);
        expect(onFocusSymbol).not.toHaveBeenCalled();
        fireEvent.click(follow);
        expect(onFocusSymbol).toHaveBeenCalledWith('src:sys::order.ts#place');
    });

    it('with a method open, numbers its calls and follows the current call', async () => {
        const onFocusSymbol = vi.fn();
        const { container } = render(
            <CodeDock target={target} name="place" reader={reader} labels={L} records={withCalls} method="src:sys::order.ts#place" onDrill={vi.fn()} onClose={vi.fn()} onFocusSymbol={onFocusSymbol} />,
            { wrapper },
        );
        await screen.findByText('// line 1');
        expect([...container.querySelectorAll('[data-code-step]')].map((b) => b.getAttribute('data-code-step'))).toEqual(['1', '2']);
        expect((container.querySelector('[data-code-line="5"]') as HTMLElement).style.opacity).toBe('0.45');
        scrollTo(container, 13);
        expect(container.querySelector('[data-code-step="2"]')?.hasAttribute('data-current')).toBe(true);
        expect(onFocusSymbol).toHaveBeenLastCalledWith('src:pay.ts#charge');
        expect(container.querySelector('[data-code-step-status]')?.textContent).toContain('charge');
    });

    it('the trail names where you read, and a crumb scrolls to its symbol', async () => {
        const { container } = render(
            <CodeDock target={target} name="place" reader={reader} labels={L} records={records} onDrill={vi.fn()} onClose={vi.fn()} />,
            { wrapper },
        );
        await screen.findByText('// line 1');
        scrollTo(container, 21);
        const crumbs = [...container.querySelectorAll('[data-code-crumbs] button')];
        expect(crumbs.map((b) => b.textContent)).toEqual(['Order', 'cancel']);
        expect(crumbs[1]!.getAttribute('aria-current')).toBe('location');
        fireEvent.click(crumbs[0]!);
        expect((container.querySelector('[data-code-lines]') as HTMLDivElement).scrollTop).toBe(0);
    });

    it('Out leaves the level, and shows only when there is one to leave', async () => {
        const onOut = vi.fn();
        const { container, rerender } = render(
            <CodeDock target={target} name="place" reader={reader} labels={L} records={records} onDrill={vi.fn()} onClose={vi.fn()} onOut={onOut} />,
            { wrapper },
        );
        await screen.findByText('// line 1');
        fireEvent.click(container.querySelector('[data-action="out"]') as HTMLButtonElement);
        expect(onOut).toHaveBeenCalledTimes(1);
        rerender(<CodeDock target={target} name="place" reader={reader} labels={L} records={records} onDrill={vi.fn()} onClose={vi.fn()} />);
        expect(container.querySelector('[data-action="out"]')).toBeNull();
    });

    it('"Open at line" opens at the line on show', async () => {
        const onOpenSource = vi.fn();
        const { container } = render(
            <CodeDock target={target} name="place" reader={reader} labels={L} records={records} scrollLine={10} onDrill={vi.fn()} onClose={vi.fn()} onOpenSource={onOpenSource} />,
            { wrapper },
        );
        await screen.findByText('// line 1');
        fireEvent.click(container.querySelector('[data-action="open-at-line"]') as HTMLButtonElement);
        expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ path: target.path, startLine: 10 }));
    });
});

describe('stepping the calls of the open method', () => {
    const method = 'src:sys::order.ts#place';
    /** Three calls, two on one line; only `cancel` has a loaded record, so only it gets "Into". */
    const stepped: SymbolRecord[] = records.map((r) => r.name !== 'place' ? r : {
        ...r, relations: [
            { kind: 'calls', to: 'src:sys::order.ts#cancel', sites: [site(12, 0)] },
            { kind: 'calls', to: 'src:pay.ts#charge', sites: [site(12, 1)] },
            { kind: 'calls', to: 'src:stock.ts#reserve', sites: [site(15, 2)] },
        ],
    });
    const status = (c: HTMLElement) => c.querySelector('[data-code-step-status]')?.textContent ?? '';
    const click = (c: HTMLElement, sel: string) => fireEvent.click(c.querySelector(sel) as HTMLElement);
    const dockFor = (extra: Partial<Parameters<typeof CodeDock>[0]> = {}) => (
        <CodeDock target={target} name="place" reader={reader} labels={L} records={stepped} method={method} onDrill={vi.fn()} onClose={vi.fn()} {...extra} />
    );

    it('Next reaches both calls on one line and wraps around; Previous wraps back', async () => {
        const { container } = render(dockFor(), { wrapper });
        await screen.findByText('// line 1');
        click(container, '[data-action="next-step"]');
        expect(status(container)).toContain('Call 1 of 3');
        click(container, '[data-action="next-step"]');
        expect(status(container)).toContain('Call 2 of 3');
        click(container, '[data-action="next-step"]');
        click(container, '[data-action="next-step"]');
        expect(status(container)).toContain('Call 1 of 3');
        click(container, '[data-action="prev-step"]');
        expect(status(container)).toContain('Call 3 of 3');
    });

    it('a step number scrolls to its call and makes it current', async () => {
        const { container } = render(dockFor(), { wrapper });
        await screen.findByText('// line 1');
        click(container, '[data-code-step="3"]');
        expect(status(container)).toContain('Call 3 of 3');
        expect(container.querySelector('[data-code-step="3"]')?.hasAttribute('data-current')).toBe(true);
    });

    it('a callee picked on the stage scrolls to its call', async () => {
        const { container, rerender } = render(dockFor(), { wrapper });
        await screen.findByText('// line 1');
        rerender(dockFor({ pick: 'src:stock.ts#reserve' }));
        expect(status(container)).toContain('Call 3 of 3');
    });

    it('"Into" drills to the current callee when it is loaded', async () => {
        const onDrill = vi.fn();
        const { container } = render(dockFor({ onDrill }), { wrapper });
        await screen.findByText('// line 1');
        click(container, '[data-action="next-step"]');
        click(container, '[data-action="drill-callee"]');
        expect(onDrill).toHaveBeenCalledWith('src:sys::order.ts#cancel');
        click(container, '[data-action="next-step"]');
        expect(container.querySelector('[data-action="drill-callee"]')).toBeNull();
    });

    it('a stage hover tints that symbol in the code', async () => {
        const { container } = render(dockFor({ method: null, hover: 'src:sys::order.ts#cancel' }), { wrapper });
        await screen.findByText('// line 1');
        expect(container.querySelector('[data-code-line="20"]')?.hasAttribute('data-marked')).toBe(true);
        expect(container.querySelector('[data-code-line="5"]')?.hasAttribute('data-marked')).toBe(false);
    });

    it('the method trail replaces the crumbs and goes back to a method', async () => {
        const onTrail = vi.fn();
        const trail = [{ ref: method, name: 'place' }, { ref: 'src:sys::order.ts#cancel', name: 'cancel' }];
        const { container } = render(dockFor({ trail, onTrail }), { wrapper });
        await screen.findByText('// line 1');
        const crumbs = [...container.querySelectorAll('[data-trail]')];
        expect(crumbs.map((b) => b.textContent)).toEqual(['place', 'cancel']);
        expect(crumbs[1]!.getAttribute('aria-current')).toBe('location');
        fireEvent.click(crumbs[0]!);
        expect(onTrail).toHaveBeenCalledWith(0);
    });
});
