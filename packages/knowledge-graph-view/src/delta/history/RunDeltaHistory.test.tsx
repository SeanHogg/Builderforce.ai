// @vitest-environment jsdom
/** The run delta history and trend (PRD 41 §C11.3): newest-first rows, localized words, a verdict matrix whose cells carry shape and name, the blast line, and the empty / error / too-few states. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/react';
import type { RunDeltaSummary } from '@builderforce/run-delta';
import { DEFAULT_RUN_DELTA_LABELS } from '../labels';
import { DEFAULT_RUN_DELTA_HISTORY_LABELS, runDeltaHistoryLabels } from './historyLabels';
import { newestFirst, trendModel } from './historyModel';
import { DeltaHistoryList } from './DeltaHistoryList';
import { DeltaTrend } from './DeltaTrend';
import { RunDeltaHistory } from './RunDeltaHistory';
import { footerPanel } from './footerPanel';
import { RunDeltaPanel } from '../RunDeltaPanel';
import type { RunDelta } from '@builderforce/run-delta/contract';

const L = DEFAULT_RUN_DELTA_LABELS;
const H = DEFAULT_RUN_DELTA_HISTORY_LABELS;
const time = (iso: string) => `t(${iso.slice(0, 10)})`;

function summary(over: Partial<RunDeltaSummary> & Pick<RunDeltaSummary, 'runId' | 'computedAt'>): RunDeltaSummary {
    return {
        repoKey: 'https://example.test/repo.git',
        surface: 'cloud',
        mode: 'interactive',
        headline: 'same',
        summary: { verdict: 'same', clauses: [], unchanged: ['security'], notMeasured: [] },
        verdicts: { security: 'same', quality: 'same' },
        counts: { introduced: 0, resolved: 0 },
        blastRadius: { score: 1, band: 'low' },
        blocking: [],
        digest: `d-${over.runId}`,
        ...over,
    };
}

const RUNS: RunDeltaSummary[] = [
    summary({ runId: 'r1', computedAt: '2026-11-01T10:00:00Z', blastRadius: { score: 2, band: 'low' } }),
    summary({
        runId: 'r3', computedAt: '2026-11-03T10:00:00Z', headline: 'worse', surface: 'vscode',
        verdicts: { security: 'worse', quality: 'better' }, counts: { introduced: 2, resolved: 1 },
        blastRadius: { score: 9.5, band: 'high' }, blocking: ['guard-removed'],
    }),
    summary({ runId: 'r2', computedAt: '2026-11-02T10:00:00Z', headline: 'better', verdicts: { security: 'better' }, blastRadius: { score: 4, band: 'medium' } }),
];

describe('historyModel', () => {
    it('orders newest first and drops a re-listed duplicate', () => {
        expect(newestFirst([...RUNS, RUNS[0]!]).map((r) => r.runId)).toEqual(['r3', 'r2', 'r1']);
    });

    it('builds an oldest-first verdict matrix with gaps where a run does not report a dimension', () => {
        const m = trendModel(RUNS);
        expect(m.runs.map((r) => r.runId)).toEqual(['r1', 'r2', 'r3']);
        expect(m.dimensions).toEqual(['quality', 'security']);
        expect(m.cells).toEqual([['same', null, 'better'], ['same', 'better', 'worse']]);
        expect(m.counts).toEqual({ worse: 1, better: 1 });
        expect(m.blast).toMatchObject({ min: 2, max: 9.5 });
        expect(trendModel(RUNS, 2).runs.map((r) => r.runId)).toEqual(['r2', 'r3']);
    });

    it('merges a run that touched several repositories into ONE column: worst verdicts, largest blast radius', () => {
        const other = summary({
            runId: 'r3', repoKey: 'https://example.test/web.git', computedAt: '2026-11-03T10:05:00Z', headline: 'not_comparable',
            verdicts: { security: 'better', performance: 'not_comparable' }, counts: { introduced: 1, resolved: 0 },
            blastRadius: { score: 12, band: 'high' }, blocking: ['test-deleted'],
        });
        const m = trendModel([...RUNS, other]);
        expect(m.runs.map((r) => r.runId)).toEqual(['r1', 'r2', 'r3']);
        const r3 = m.runs[2]!;
        expect(r3.headline).toBe('worse');
        expect(r3.verdicts).toEqual({ security: 'worse', quality: 'better', performance: 'not_comparable' });
        expect(r3.blastRadius).toEqual({ score: 12, band: 'high' });
        expect(r3.counts).toEqual({ introduced: 3, resolved: 1 });
        expect(r3.blocking).toEqual(['guard-removed', 'test-deleted']);
        expect(m.dimensions).toEqual(['performance', 'quality', 'security']);
    });
});

describe('footerPanel', () => {
    it('carries a section under the run delta panel body through its renderPanel slot', () => {
        const delta = {
            version: 1, runId: 'r1', headline: 'same', digest: 'd', blocking: [], excluded: [],
            summary: { verdict: 'same', clauses: [], unchanged: [], notMeasured: [] },
            blastRadius: { score: 1, band: 'low', formula: 'v1', reasons: [] }, dimensions: [],
        } as unknown as RunDelta;
        const renderPanel = footerPanel(<RunDeltaHistory items={RUNS} labels={L} historyLabels={H} bare />, { closeLabel: L.close, compact: false, width: 440 });
        const { getByRole, container } = render(<RunDeltaPanel open delta={delta} labels={L} onClose={() => {}} compact={false} renderPanel={renderPanel} />);
        const panel = getByRole('dialog', { name: L.panelTitle });
        expect(panel.querySelector('[data-run-delta-history-section]')).toBeTruthy();
        expect(container.querySelectorAll('li[data-run]')).toHaveLength(3);
    });
});

describe('DeltaHistoryList', () => {
    it('renders each run newest first with its verdict word and icon, counts, band and a blocked marker', () => {
        const { container } = render(<DeltaHistoryList items={RUNS} labels={L} historyLabels={H} formatTime={time} />);
        const rows = [...container.querySelectorAll('li[data-run]')];
        expect(rows.map((r) => r.getAttribute('data-run'))).toEqual(['r3', 'r2', 'r1']);
        const worst = rows[0] as HTMLElement;
        expect(within(worst).getByText('t(2026-11-03)')).toBeTruthy();
        expect(within(worst).getByText(H.surfaces.vscode)).toBeTruthy();
        expect(within(worst).getByText(L.verdicts.worse)).toBeTruthy();
        expect(worst.querySelector('[data-verdict="worse"] svg')).toBeTruthy();
        expect(within(worst).getByText('2 new · 1 resolved')).toBeTruthy();
        expect(within(worst).getByText('Blast radius: high')).toBeTruthy();
        expect(within(worst).getByText(H.blocked)).toBeTruthy();
        expect(within(rows[1] as HTMLElement).queryByText(H.blocked)).toBeNull();
        // Without onSelect the rows are not buttons.
        expect(container.querySelector('button')).toBeNull();
    });

    it('opens a run when a row is selected', () => {
        const onSelect = vi.fn();
        const { getByRole } = render(<DeltaHistoryList items={RUNS} labels={L} historyLabels={H} formatTime={time} onSelect={onSelect} />);
        fireEvent.click(getByRole('button', { name: 'Open the run delta from t(2026-11-02)' }));
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ runId: 'r2' }));
    });

    it('takes its words from the catalog', () => {
        const german = runDeltaHistoryLabels((key) => ({ blocked: 'Blockiert', 'surfaces.vscode': 'Im Editor' } as Record<string, string>)[key]);
        const { getByText } = render(<DeltaHistoryList items={RUNS} labels={L} historyLabels={german} formatTime={time} />);
        expect(getByText('Blockiert')).toBeTruthy();
        expect(getByText('Im Editor')).toBeTruthy();
    });
});

describe('DeltaTrend', () => {
    it('draws one named, shaped cell per reported verdict and a blast point per run', () => {
        const { container, getByRole } = render(<DeltaTrend items={RUNS} labels={L} historyLabels={H} formatTime={time} />);
        expect(getByRole('img', { name: '3 runs: 1 worse, 1 better' })).toBeTruthy();
        const cells = container.querySelectorAll('[data-cell]');
        expect(cells).toHaveLength(5);
        const worse = container.querySelector('[data-cell="security:2"]')!;
        expect(worse.getAttribute('data-verdict')).toBe('worse');
        expect(worse.querySelector('title')!.textContent).toBe('Security: Worse (t(2026-11-03))');
        expect(worse.querySelector('svg path')).toBeTruthy();
        expect(container.querySelectorAll('circle[data-point]')).toHaveLength(3);
        expect(getByRole('img', { name: 'Latest blast radius score 9.5 (high); range 2 to 9.5' })).toBeTruthy();
    });

    it('waits for a second run before drawing a trend', () => {
        const { container, getByText } = render(<DeltaTrend items={RUNS.slice(0, 1)} labels={L} historyLabels={H} />);
        expect(getByText(H.tooFewRuns)).toBeTruthy();
        expect(container.querySelector('svg')).toBeNull();
    });
});

describe('RunDeltaHistory', () => {
    it('shows the empty state, then the error with a retry', () => {
        const { getByText, rerender } = render(<RunDeltaHistory items={[]} labels={L} historyLabels={H} />);
        expect(getByText(H.empty)).toBeTruthy();
        const retry = vi.fn();
        rerender(<RunDeltaHistory items={[]} labels={L} historyLabels={H} error onRetry={retry} />);
        fireEvent.click(getByText(H.retry));
        expect(retry).toHaveBeenCalledOnce();
    });

    it('shows the trend and the list, and loads older runs', () => {
        const more = vi.fn();
        const { container, getByText } = render(<RunDeltaHistory items={RUNS} labels={L} historyLabels={H} formatTime={time} hasMore onLoadMore={more} />);
        expect(container.querySelector('[data-run-delta-trend]')).toBeTruthy();
        expect(container.querySelectorAll('li[data-run]')).toHaveLength(3);
        fireEvent.click(getByText(H.loadMore));
        expect(more).toHaveBeenCalledOnce();
    });

    it('keeps the rows when loading older runs fails, with the retry in place of "show older"', () => {
        const retry = vi.fn();
        const { container, getByText, queryByText } = render(
            <RunDeltaHistory items={RUNS} labels={L} historyLabels={H} hasMore onLoadMore={() => {}} error onRetry={retry} />,
        );
        expect(container.querySelectorAll('li[data-run]')).toHaveLength(3);
        expect(getByText(H.loadError)).toBeTruthy();
        expect(queryByText(H.loadMore)).toBeNull();
        fireEvent.click(getByText(H.retry));
        expect(retry).toHaveBeenCalledOnce();
    });

    it('says when a run could not be opened, and writes numbers with the host formatter', () => {
        const { getByText, getByRole } = render(
            <RunDeltaHistory items={RUNS} labels={L} historyLabels={H} openError formatNumber={(n) => `#${n}`} />,
        );
        expect(getByText(H.openError)).toBeTruthy();
        expect(getByRole('img', { name: '#3 runs: #1 worse, #1 better' })).toBeTruthy();
    });
});
