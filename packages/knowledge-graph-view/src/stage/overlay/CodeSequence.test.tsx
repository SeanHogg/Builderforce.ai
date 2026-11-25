/** The code level's Sequence layout: a lifeline for the method and each distinct callee, one numbered arrow per call. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { SymbolRecord } from '../../types';
import type { CallStep } from '../drill/codeText';
import { CodeSequence } from './CodeSequence';

const steps: CallStep[] = [
    { line: 12, to: 'src:sys::stock.ts#reserve', kind: 'calls' },
    { line: 13, to: 'src:sys::pay.ts#charge', kind: 'calls' },
    { line: 14, to: 'src:sys::stock.ts#reserve', kind: 'calls' },
];
const byRef = new Map<string, SymbolRecord>([['src:sys::stock.ts#reserve', { ref: 'src:sys::stock.ts#reserve', name: 'reserve', kind: 'method', parent: '', line: 1, exported: true }]]);

describe('CodeSequence', () => {
    it('draws the method and each distinct callee once, and one arrow per call', () => {
        const { container } = render(<CodeSequence method="place" steps={steps} current={1} byRef={byRef} labels={L} onStep={() => {}} />);
        expect(container.querySelectorAll('[data-lifeline]')).toHaveLength(3);
        expect(container.querySelectorAll('[data-message]')).toHaveLength(3);
        expect(container.textContent).toContain('place');
        expect(container.textContent).toContain('reserve');
        expect(container.querySelector('[data-message="2"]')?.getAttribute('aria-current')).toBe('step');
    });

    it('reads a call when its arrow is pressed', () => {
        const onStep = vi.fn();
        const { getByLabelText } = render(<CodeSequence method="place" steps={steps} current={-1} byRef={byRef} labels={L} onStep={onStep} />);
        fireEvent.click(getByLabelText(fillTemplate(L.surface.code.stepAria, { n: 3, count: 3 })));
        expect(onStep).toHaveBeenCalledWith(2);
    });
});
