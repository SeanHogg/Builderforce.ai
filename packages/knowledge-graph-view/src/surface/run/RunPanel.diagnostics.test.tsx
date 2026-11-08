// @vitest-environment jsdom
/** The Diagnostics tab: collapsible groups from the ONE structured source, the group with a failure first and open, a "Taken" stamp, Refresh, and Copy of the same text. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { createKit, DIAG, diagnosticsOf, r } from './runPanelKit';
import { attentionFirst } from './DiagnosticsTab';

const { machine, portOf, Harness, tab } = createKit({ fn: vi.fn as never, act, screen });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const open = (diagnostics = diagnosticsOf()) => {
    render(<Harness port={portOf().port} review={machine({ status: 'idle' })} diagnostics={diagnostics} />);
    fireEvent.click(tab(r.tabDiagnostics));
};

describe('the Diagnostics tab', () => {
    it('shows the groups as <details>: the one with a failure comes first and is open, the others are collapsed', () => {
        open();
        const groups = [...screen.getByTestId('kg-diagnostics-tab').querySelectorAll('details')] as HTMLDetailsElement[];
        expect(groups.map((g) => g.dataset.testid ?? g.getAttribute('data-testid'))).toEqual(['kg-diag-review', 'kg-diag-graph', 'kg-diag-sync']);
        expect(groups.map((g) => g.open)).toEqual([true, false, false]);
        expect(within(groups[0]!).getByText('review')).toBeTruthy(); // a key / value row
        expect(screen.getByText(r.diagSync)).toBeTruthy();
    });

    it('stamps when the snapshot was taken (HH:MM:SS), and Refresh takes another', () => {
        const diagnostics = vi.fn(diagnosticsOf());
        open(diagnostics);
        expect(screen.getByTestId('kg-diag-taken').textContent).toMatch(/^Taken \d{2}:\d{2}:\d{2}$/);
        const before = diagnostics.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: r.diagRefresh }));
        expect(diagnostics.mock.calls.length).toBeGreaterThan(before);
    });

    it('Copy diagnostics copies the full text, the same one the groups were built from', async () => {
        const writeText = vi.fn(async (_text: string): Promise<void> => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        open();
        fireEvent.click(screen.getByRole('button', { name: L.copyDiagnostics }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(DIAG));
        expect(await screen.findByText(L.copied)).toBeTruthy();
    });

    it('says so when there is nothing to show, instead of breaking the panel', () => {
        open(() => { throw new Error('no graph yet'); });
        expect(screen.getByText(r.diagEmpty)).toBeTruthy();
    });
});

describe('attentionFirst', () => {
    it('puts the groups with something to look at first and keeps every other order', () => {
        const s = (id: 'graph' | 'review' | 'sync' | 'lines', attention: boolean) => ({ id, lines: [], attention });
        expect(attentionFirst([s('graph', false), s('review', true), s('lines', false), s('sync', true)]).map((x) => x.id)).toEqual(['review', 'sync', 'graph', 'lines']);
    });
});
