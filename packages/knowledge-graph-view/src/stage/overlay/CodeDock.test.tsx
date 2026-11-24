import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { SourceReader, SymbolRecord } from '../../types';
import { ROW_PX } from '../drill/CodeLayer';
import { codeTargetOf, fileTargetOf } from '../drill/codeText';
import { CodeDock } from './CodeDock';

const records: SymbolRecord[] = [
    { ref: 'src:order.ts::Order', name: 'Order', kind: 'class', parent: 'src:order.ts', line: 1, exported: true },
    { ref: 'src:order.ts::place', name: 'place', kind: 'method', parent: 'src:order.ts::Order', line: 10, exported: false },
    { ref: 'src:order.ts::cancel', name: 'cancel', kind: 'method', parent: 'src:order.ts::Order', line: 20, exported: false },
];
const reader: SourceReader = async () => ({ startLine: 1, lines: Array.from({ length: 40 }, (_, i) => `// line ${i + 1}`), truncated: false });
const target = fileTargetOf(codeTargetOf('src:order.ts::place', records)!);

describe('scrolling the docked code moves the stage', () => {
    it('names the symbol at the top once per symbol boundary', async () => {
        const onFocusSymbol = vi.fn();
        const { container } = render(
            <CodeDock target={target} name="place" reader={reader} labels={L} records={records} onDrill={vi.fn()} onClose={vi.fn()} onFocusSymbol={onFocusSymbol} />,
        );
        await screen.findByText('// line 1');
        const lines = container.querySelector('[data-code-lines]') as HTMLDivElement;
        lines.scrollTop = 12 * ROW_PX;
        fireEvent.scroll(lines);
        expect(onFocusSymbol).toHaveBeenCalledTimes(1);
        expect(onFocusSymbol).toHaveBeenCalledWith('src:order.ts::place');
        fireEvent.scroll(lines);
        expect(onFocusSymbol).toHaveBeenCalledTimes(1);
    });

    it('"Open at line" opens at the line on show', async () => {
        const onOpenSource = vi.fn();
        const { container } = render(
            <CodeDock target={target} name="place" reader={reader} labels={L} records={records} scrollLine={10} onDrill={vi.fn()} onClose={vi.fn()} onOpenSource={onOpenSource} />,
        );
        await screen.findByText('// line 1');
        fireEvent.click(container.querySelector('[data-action="open-at-line"]') as HTMLButtonElement);
        expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ path: target.path, startLine: 10 }));
    });
});
