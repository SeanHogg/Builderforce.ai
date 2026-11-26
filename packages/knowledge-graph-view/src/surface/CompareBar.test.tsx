import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { surfaceFixture } from '../testing';
import type { Commit } from '../types';
import { CompareBar, type CompareBarProps } from './CompareBar';
import type { CompareState } from './compareModel';

const graph = surfaceFixture();
const t = L.surface.compare;
const commit: Commit = { sha: 'abcdef0123456789', title: 'Split the router', at: '2026-01-01T00:00:00Z', refs: [] };
const god = { ...graph.findings[0]!, id: 'god-1', kind: 'god-module', nodes: [graph.nodes[5]!.ref] };
const withFinding = { ...graph, findings: [god] };

function bar(state: CompareState | null, over: Partial<CompareBarProps['compare']> = {}, props: Partial<CompareBarProps> = {}) {
    const compare = { state, comparable: true, reasons: [], playing: false, setSide: vi.fn(), play: vi.fn(), close: vi.fn(), ...over };
    render(<CompareBar compare={compare} graph={withFinding} labels={L} {...props} />);
    return compare;
}
const before = () => screen.getByRole('radio', { name: L.compareBefore }) as HTMLButtonElement;

describe('CompareBar', () => {
    it('draws nothing while there is no comparison', () => {
        bar(null);
        expect(document.querySelector('[data-compare-bar]')).toBeNull();
    });

    it('a baseline: its label, Before | After, play, close; no Apply', () => {
        const c = bar({ source: 'baseline', side: 'before' });
        expect(screen.getByText(t.sourceBaseline)).toBeTruthy();
        expect(before().getAttribute('aria-checked')).toBe('true');
        fireEvent.click(screen.getByRole('radio', { name: L.compareAfter }));
        expect(c.setSide).toHaveBeenCalledWith('after');
        fireEvent.click(screen.getByRole('button', { name: t.playBaseline }));
        expect(c.play).toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: t.close }));
        expect(c.close).toHaveBeenCalled();
        expect(document.querySelector('[data-action="compare-apply"]')).toBeNull();
    });

    it('a snapshot names itself', () => {
        bar({ source: 'snapshot', side: 'after' });
        expect(screen.getByText(t.sourceSnapshot)).toBeTruthy();
    });

    it('a commit shows its short sha and message, and replays the history', () => {
        bar({ source: 'commit', side: 'after', commit });
        expect(screen.getByText('Commit abcdef0: Split the router')).toBeTruthy();
        expect(screen.getByRole('button', { name: t.playHistory })).toBeTruthy();
    });

    it('a restructure shows the anti-pattern and its file, and Apply opens the fix flow for the finding', () => {
        const onApply = vi.fn();
        bar({ source: 'restructure', side: 'before', findingId: 'god-1' }, {}, { onApply });
        expect(document.querySelector('[data-compare-what]')?.textContent).toContain(`God module in ${graph.nodes[5]!.label}`);
        fireEvent.click(screen.getByRole('button', { name: t.apply }));
        expect(onApply).toHaveBeenCalledWith(god);
        expect(screen.getByRole('button', { name: t.playRestructure })).toBeTruthy();
    });

    it('a restructure with no Apply handler has no Apply', () => {
        bar({ source: 'restructure', side: 'before', findingId: 'god-1' });
        expect(screen.queryByRole('button', { name: t.apply })).toBeNull();
    });

    it('a baseline that is not comparable has no Before and says why', () => {
        bar({ source: 'baseline', side: 'after' }, { comparable: false, reasons: ['scope-changed'] });
        expect(before().disabled).toBe(true);
        expect(document.querySelector('[data-compare-reasons]')?.textContent).toContain(L.compareReasonScope);
    });

    it('says a restructure is being prepared, even before a comparison opens', () => {
        bar(null, {}, { status: 'loading' });
        expect(screen.getByRole('status').textContent).toBe(t.restructureLoading);
    });
});
