// @vitest-environment jsdom
/** Copy diagnostics lives in the header in EVERY status; the Panels button hides itself while there is no drawer to open. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { fixtureSource } from './testing';
import type { KnowledgeGraphSource } from './types';

afterEach(cleanup);

describe('the header in a state with no graph', () => {
    it('regression: Copy diagnostics copies the timeline, decisions and host log; the Panels button is hidden', async () => {
        const writeText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const source: KnowledgeGraphSource = {
            ...fixtureSource([]),
            loadTrace: async () => ({ now: 1, entries: [], inFlight: [], log: ['2026-11-26T00:00:00Z lastSeen: read missed (absent)'] }),
        };
        render(<div style={{ height: 600 }}><KnowledgeGraphView source={source} /></div>);
        await screen.findByRole('button', { name: L.reviewFolder });
        expect(screen.queryByTestId('kg-panels-button')).toBeNull();
        fireEvent.click(screen.getByTestId('kg-diagnostics-button'));
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        const text = String((writeText.mock.calls[0] as unknown[])[0]);
        expect(text).toContain('first paint');
        expect(text).toContain('view scopes');
        expect(text).toContain('lastSeen: read missed (absent)');
    });
});
