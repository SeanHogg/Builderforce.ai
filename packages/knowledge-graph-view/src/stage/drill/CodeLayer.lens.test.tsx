import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { SymbolFacts } from '../../surface/symbolFacts';
import type { SourceReader } from '../../types';
import { CodeLayer, type CodeLayerProps } from './CodeLayer';
import type { CodeTarget, Lens } from './codeText';
import type { LensCtx } from './lensActions';

const t = L.surface.code;
const target: CodeTarget = { ref: 'src:sys::order.ts#place', name: 'place', path: 'order.ts', startLine: 1, endLine: 400 };
const reader: SourceReader = async () => ({ startLine: 1, lines: Array.from({ length: 20 }, (_, i) => `// line ${i + 1}`), truncated: false });
const ORDER: Lens = { ref: 'src:sys::order.ts#Order', kind: 'class', count: 2 };
const PLACE: Lens = { ref: 'src:sys::order.ts#place', kind: 'method', count: 1 };
const lens = new Map<number, Lens>([[3, ORDER], [10, PLACE]]);
const facts: SymbolFacts = {
    untested: (ref) => ref === PLACE.ref,
    antiPatternOf: (ref) => (ref === ORDER.ref ? { kind: 'god-module', findingId: 'f1' } : null),
};
const ctx = (over: Partial<LensCtx> = {}): LensCtx => ({ facts, inside: PLACE.ref, has: () => true, ...over });
const layer = (extra: Partial<CodeLayerProps> = {}) => <CodeLayer target={target} reader={reader} labels={L} onClose={vi.fn()} lens={lens} {...extra} />;

describe('lens rows and the gutter glyph (PRD 43 Part C2)', () => {
    it('draws the visible rows of the table on the class and method lines, and a click acts', async () => {
        const onLens = vi.fn();
        const { container } = render(layer({ lensCtx: ctx(), onLens }));
        await screen.findByText('// line 2');
        const cls = container.querySelector(`[data-code-lens="${ORDER.ref}"]`) as HTMLElement;
        const method = container.querySelector(`[data-code-lens="${PLACE.ref}"]`) as HTMLElement;
        expect(cls.textContent).toContain(fillTemplate(t.lensReferences, { count: 2 }));
        expect(cls.textContent).toContain('god-module');
        expect(method.textContent).toContain(t.lensOut);
        expect(method.textContent).toContain(t.lensSimulate);
        fireEvent.click(screen.getByRole('button', { name: new RegExp(t.lensSimulate) }));
        expect(onLens).toHaveBeenCalledWith('simulate', PLACE);
    });

    it('a row whose handler is absent is hidden', async () => {
        const { container } = render(layer({ lensCtx: ctx({ has: (id) => !['out', 'simulate', 'restructure'].includes(id) }), onLens: vi.fn() }));
        await screen.findByText('// line 2');
        const text = container.querySelector(`[data-code-lens="${PLACE.ref}"]`)!.textContent!;
        expect(text).not.toContain(t.lensOut);
        expect(text).not.toContain(t.lensSimulate);
    });

    it('the gutter shows the symbol\'s shape on its first line, a warning instead with an anti-pattern; none without the facts', async () => {
        const { container, rerender } = render(layer({ lensCtx: ctx() }));
        await screen.findByText('// line 2');
        const at = (n: number) => container.querySelector(`[data-code-line="${n}"] [data-gutter-glyph]`);
        expect(at(10)?.querySelector('[data-glyph-shape]')).not.toBeNull();
        expect(at(3)?.querySelector('[data-gutter-warn]')?.getAttribute('aria-label')).toBe(fillTemplate(t.gutterWarn, { name: 'god-module' }));
        expect(at(3)?.querySelector('[data-glyph-shape]')).toBeNull();
        expect(at(5)?.children).toHaveLength(0);
        rerender(layer());
        expect(container.querySelector('[data-gutter-glyph]')).toBeNull();
    });
});
