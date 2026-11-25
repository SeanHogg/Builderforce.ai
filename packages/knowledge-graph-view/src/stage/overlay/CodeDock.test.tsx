import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { SourceReader, SymbolRecord } from '../../types';
import { ROW_PX } from '../drill/CodeLayer';
import { codeTargetOf, fileTargetOf } from '../drill/codeText';
import { useCodeReading, type CodeReading } from '../drill/useCodeReading';
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

type PaneProps = Partial<Omit<CodeDockProps, 'reading'>> & { method?: string | null; pick?: string | null; onFocusSymbol?: (ref: string) => void; onReading?: (reading: CodeReading) => void };

/** The code pane, the map's bar and the step card on one reading model, as the wiring composes them. */
function Pane({ method = null, pick = null, onFocusSymbol, records: recs = records, onDrill = vi.fn(), onOut, onReading, ...rest }: PaneProps) {
    const reading = useCodeReading({ path: rest.target?.path ?? target.path, records: recs, method, scrollLine: rest.scrollLine, pick, onFocusSymbol });
    onReading?.(reading);
    const open = method ? codeTargetOf(method, recs) : null;
    return (
        <>
            <CodeTrail stack={[]} onClimb={vi.fn()} methods={[]} onMethod={vi.fn()} onLeaveCode={vi.fn()} across={null} follow={reading.follow} onFollow={reading.toggleFollow} onOut={onOut} labels={L} />
            <CodeDock target={target} name="place" reader={reader} labels={L} records={recs} reading={reading} onDrill={onDrill} onClose={vi.fn()} onOut={onOut} {...rest} />
            {open && <StepCard method={open} reading={reading} records={recs} labels={L} onDrill={onDrill} onOut={onOut} side="right" />}
        </>
    );
}

/** Scroll the lines so source `line`'s row is the top one (jsdom: the reading line); the pane's lens rows count as rows. */
function scrollTo(container: HTMLElement, line: number) {
    const lines = container.querySelector('[data-code-lines]') as HTMLDivElement;
    const rows = [...lines.querySelectorAll('[data-code-line], [data-code-lens]')];
    lines.scrollTop = rows.findIndex((r) => r.getAttribute('data-code-line') === String(line)) * ROW_PX;
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
        scrollTo(container, 13);
        expect(onFocusSymbol).toHaveBeenCalledTimes(1);
        expect(onFocusSymbol).toHaveBeenCalledWith('src:sys::order.ts#place');
        scrollTo(container, 14);
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
        scrollTo(container, 13);
        expect(onFocusSymbol).not.toHaveBeenCalled();
        fireEvent.click(follow);
        expect(onFocusSymbol).toHaveBeenCalledWith('src:sys::order.ts#place');
    });

    it('with a method open, numbers its calls; the reading line keeps the method lit and makes its call current', async () => {
        const onFocusSymbol = vi.fn();
        const { container } = render(<Pane records={withCalls} method="src:sys::order.ts#place" onFocusSymbol={onFocusSymbol} />);
        await screen.findByText('// line 1');
        expect([...container.querySelectorAll('[data-code-step]')].map((b) => b.getAttribute('data-code-step'))).toEqual(['1', '2']);
        expect((container.querySelector('[data-code-line="5"]') as HTMLElement).style.opacity).toBe('0.3');
        scrollTo(container, 14);
        expect(container.querySelector('[data-code-step="2"]')?.hasAttribute('data-current')).toBe(true);
        expect(container.querySelector('[data-code-line="13"]')?.hasAttribute('data-call-site')).toBe(true);
        // The method keeps the reading ring; its current callee is the step card's (and the stage's amber call).
        expect(onFocusSymbol).toHaveBeenLastCalledWith('src:sys::order.ts#place');
        expect(container.querySelector('[data-step-callee]')?.textContent).toBe('charge');
    });

    it('the crumbs name where you read, and a crumb scrolls to its symbol', async () => {
        const { container } = render(<Pane />);
        await screen.findByText('// line 1');
        scrollTo(container, 22);
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
        // Scrolled past line 1, its symbol also heads the sticky header: two copies of the line.
        await screen.findAllByText('// line 1');
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

describe('the editor chrome around the code', () => {
    const deepRefs = (r: SymbolRecord): SymbolRecord => ({ ...r, ref: r.ref.replace('order.ts', 'app/orders/order.ts'), parent: r.parent.replace('order.ts', 'app/orders/order.ts') });
    const deep = records.map(deepRefs);
    const deepTarget = fileTargetOf(codeTargetOf(deep[1]!.ref, deep)!);

    it('the breadcrumb names the folders, then the file, then the symbols being read', async () => {
        const { container } = render(<Pane records={deep} target={deepTarget} />);
        await screen.findByText('// line 1');
        expect(deepTarget.path.split('/')).toHaveLength(3);
        const folders = [...container.querySelectorAll('[data-crumb-folder]')].map((f) => f.textContent);
        expect(folders).toEqual(deepTarget.path.split('/').slice(0, -1).map((f) => `${f} ›`));
        expect(container.querySelector('[data-crumb-file]')?.textContent).toBe('order.ts');
        expect(container.querySelector('[data-crumb-file]')?.tagName).toBe('B');
        expect([...container.querySelectorAll('[data-code-crumbs] button')].map((b) => b.textContent)).toEqual(['Order']);
    });

    it('the Outline lists the symbols of the file by line, nested, marks the one being read, and a row selects and scrolls to it', async () => {
        const onSelect = vi.fn();
        const { container } = render(<Pane onSelect={onSelect} />);
        await screen.findByText('// line 1');
        expect(screen.queryByRole('list', { name: L.surface.code.outlineAria })).toBeNull();
        const toggle = container.querySelector('[data-action="outline"]') as HTMLButtonElement;
        expect(toggle.textContent).toBe(L.surface.code.outline);
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        const list = screen.getByRole('list', { name: L.surface.code.outlineAria });
        const rows = [...list.querySelectorAll('[data-outline-row]')] as HTMLElement[];
        expect(rows.map((r) => r.textContent)).toEqual(['Order', 'place', 'cancel']);
        expect(parseFloat(rows[0]!.style.paddingLeft || '0')).toBe(0);
        expect(rows[1]!.style.paddingLeft).toBe('14px');
        expect(rows[1]!.querySelector('[data-glyph-shape]')).not.toBeNull();
        expect(rows[0]!.getAttribute('aria-current')).toBe('true');
        fireEvent.click(rows[2]!);
        expect(onSelect).toHaveBeenCalledWith('node:src:sys::order.ts#cancel');
        expect(container.querySelector('[data-reading]')?.getAttribute('data-code-line')).toBe('20');
        expect((list.querySelector('[data-outline-row="src:sys::order.ts#cancel"]') as HTMLElement).getAttribute('aria-current')).toBe('true');
    });

    it('the tabs show the file of the method and the one opened across; the home tab goes back', async () => {
        const onHomeTab = vi.fn();
        const other = 'src/pay.ts';
        const { container, rerender } = render(<Pane files={{ home: target.path, across: null }} onHomeTab={onHomeTab} />);
        await screen.findByText('// line 1');
        const tablist = screen.getByRole('tablist', { name: L.surface.code.tabsAria });
        expect([...tablist.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true']);
        // A callee opened across: its file is on show, and the file of the method is the tab back.
        const across = { ...target, path: other };
        rerender(<Pane target={across} files={{ home: target.path, across: other }} onHomeTab={onHomeTab} />);
        const tabs = [...container.querySelectorAll('[role="tab"]')] as HTMLElement[];
        expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([[target.path.slice(target.path.lastIndexOf('/') + 1), 'false'], ['pay.ts', 'true']]);
        fireEvent.click(tabs[1]!);
        expect(onHomeTab).not.toHaveBeenCalled();
        fireEvent.click(tabs[0]!);
        expect(onHomeTab).toHaveBeenCalledTimes(1);
    });

    it('lens lines: the references of a class (a toast) and Show in map; the callers of a method (a toast) and Drill in', async () => {
        const called: SymbolRecord[] = [
            ...records.map((r) => r.name !== 'place' ? r : { ...r, relations: [{ kind: 'calls', to: 'src:sys::order.ts#cancel' }] }),
            { ref: 'src:sys::api.ts#post', name: 'post', kind: 'function', parent: 'src:sys::api.ts', line: 3, exported: true, relations: [{ kind: 'calls', to: 'src:sys::order.ts#place' }] },
        ];
        const toast = vi.fn(), onSelect = vi.fn(), followCode = vi.fn(), onDrill = vi.fn();
        const { container } = render(<Pane records={called} toast={toast} onSelect={onSelect} followCode={followCode} onDrill={onDrill} />);
        await screen.findByText('// line 1');
        const buttons = (ref: string) => [...(container.querySelector(`[data-code-lens="${ref}"]`) as HTMLElement).querySelectorAll('button')];
        // post calls place: one outside symbol reaches into Order.
        const [refs, show] = buttons('src:sys::order.ts#Order');
        expect(refs!.textContent).toBe(fillTemplate(L.surface.code.lensReferences, { count: 1 }));
        fireEvent.click(refs!);
        expect(toast).toHaveBeenLastCalledWith(fillTemplate(L.surface.code.referencesToast, { count: 1, name: 'Order' }));
        fireEvent.click(show!);
        expect(onSelect).toHaveBeenCalledWith('node:src:sys::order.ts#Order');
        expect(followCode).toHaveBeenCalledWith('src:sys::order.ts#Order');
        const [callers, drill] = buttons('src:sys::order.ts#cancel');
        expect(callers!.textContent).toBe(fillTemplate(L.surface.code.lensCaller, { count: 1 }));
        fireEvent.click(callers!);
        expect(toast).toHaveBeenLastCalledWith(fillTemplate(L.surface.code.calledBy, { names: 'place' }));
        fireEvent.click(drill!);
        expect(onDrill).toHaveBeenCalledWith('src:sys::order.ts#cancel');
        // A lens click does not pick its line.
        expect(container.querySelector('[data-reading]')?.getAttribute('data-code-line')).toBe('1');
    });

    it('a clicked line is read (the stage follows it) until the code scrolls again', async () => {
        const onFocusSymbol = vi.fn();
        let reading: CodeReading | undefined;
        const { container } = render(<Pane onFocusSymbol={onFocusSymbol} onReading={(r) => { reading = r; }} />);
        await screen.findByText('// line 1');
        fireEvent.click(container.querySelector('[data-code-line="21"]') as HTMLElement);
        expect(reading!.cursor).toBe(21);
        expect(container.querySelector('[data-reading]')?.getAttribute('data-code-line')).toBe('21');
        expect(onFocusSymbol).toHaveBeenLastCalledWith('src:sys::order.ts#cancel');
        expect(reading!.chain.map((r) => r.name)).toEqual(['Order', 'cancel']);
        scrollTo(container, 12);
        expect(reading!.cursor).toBeNull();
        expect(container.querySelector('[data-reading]')?.getAttribute('data-code-line')).toBe('12');
    });

    it('while Follow is on, the symbols on screen are in view, the same array until they change; off, none', async () => {
        let reading: CodeReading | undefined;
        const { container } = render(<Pane onReading={(r) => { reading = r; }} />);
        await screen.findByText('// line 1');
        // jsdom measures no height: every rendered line is on screen.
        expect(reading!.inView).toEqual(['src:sys::order.ts#Order', 'src:sys::order.ts', 'src:sys::order.ts#place', 'src:sys::order.ts#cancel']);
        scrollTo(container, 12);
        const was = reading!.inView;
        expect(was).toEqual(['src:sys::order.ts#place', 'src:sys::order.ts', 'src:sys::order.ts#cancel']);
        scrollTo(container, 13);
        expect(reading!.inView).toBe(was);
        fireEvent.click(container.querySelector('[data-code-trail] [data-action="follow"]') as HTMLButtonElement);
        expect(reading!.inView).toBeNull();
    });

    it('with no readSource the pane says so, and draws no lens, rail or sticky header', () => {
        const { container } = render(<Pane reader={undefined} />);
        expect(container.querySelector('[data-code-unavailable]')).not.toBeNull();
        expect(container.querySelector('[data-code-lens], [data-rail], [data-code-sticky], [data-code-line]')).toBeNull();
    });
});
