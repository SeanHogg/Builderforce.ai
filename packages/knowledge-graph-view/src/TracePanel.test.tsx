// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TracePanel } from './TracePanel';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { codeFixture, docsFixture } from './testing';

function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('TracePanel', () => {
    afterEach(() => vi.restoreAllMocks());

    it('draws layer lanes for code and copies the trace as a Mermaid sequence diagram', async () => {
        const writeText = vi.fn(async (_text: string): Promise<void> => undefined);
        stubClipboard(writeText);
        render(<TracePanel graph={codeFixture()} from="src:code::app/page.tsx" labels={L} />);
        expect(screen.getAllByText('presentation').length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: L.copyMermaid }));
        expect(await screen.findByText(L.copied)).toBeTruthy();
        const text = writeText.mock.calls[0]![0] as string;
        expect(text.startsWith('sequenceDiagram')).toBe(true);
        expect(text).toContain('participant');
        expect(text).toContain('app/page.tsx references');
        expect(text).toContain('[skips]');
    });

    it('draws one lane per document for docs', () => {
        stubClipboard(async () => undefined);
        render(<TracePanel graph={docsFixture()} from="src:docs::lease.md#termination" labels={L} />);
        expect(screen.getAllByText('lease.md › Termination').length).toBeGreaterThan(0);
        expect(screen.getAllByText('policy/termination.md').length).toBeGreaterThan(0);
    });

    it('falls back to selectable text when the clipboard refuses', async () => {
        stubClipboard(async () => { throw new Error('denied'); });
        render(<TracePanel graph={codeFixture()} from="src:code::app/page.tsx" labels={L} />);
        fireEvent.click(screen.getByRole('button', { name: L.copyMermaid }));
        expect(await screen.findByText(L.copyFailed)).toBeTruthy();
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('sequenceDiagram');
    });

    it('says so when nothing is reached', () => {
        render(<TracePanel graph={codeFixture()} from="src:code::infrastructure/legacy.ts" labels={L} />);
        expect(screen.getByText(L.traceEmpty)).toBeTruthy();
    });
});
