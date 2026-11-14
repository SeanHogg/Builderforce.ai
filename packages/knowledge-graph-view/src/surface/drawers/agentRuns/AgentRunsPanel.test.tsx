// @vitest-environment jsdom
/** The Agent runs drawer (PRD 46 §3.5): hidden without the port, the run list, a selected run's strip, findings and files, the empty states. */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate, type KnowledgeGraphLabels } from '../../../labels';
import { surfaceFixture } from '../../../testing';
import type { AgentRunReport, AgentRunSummary, AgentRunsPort, KnowledgeGraphSource } from '../../../types';
import { PANELS } from '../../panels';
import { useSurface } from '../../useSurface';
import { AgentRunsPanel } from './AgentRunsPanel';
import { AGENT_RUNS_TIMEOUT_MS } from './useAgentRuns';

const graph = surfaceFixture();
const t = L.surface.agentRuns;
const env = { webgl: false, reducedMotion: true, hasLines: true, compact: false };

const summary: AgentRunSummary = { id: '7', title: 'Fix the cron job', startedAt: '2026-11-09T10:00:00Z', endedAt: '2026-11-09T10:05:00Z', models: ['m1', 'm2'], turns: 3, counts: { info: 0, warn: 1, error: 1 } };
const report: AgentRunReport = {
    summary,
    turns: [
        { index: 1, role: 'plan', model: 'm1', kind: 'read', toolCalls: 3, promptTokens: 1000, completionTokens: 50, durationMs: 2000 },
        { index: 2, role: 'code', model: 'm2', kind: 'write', toolCalls: 1, promptTokens: 2000, completionTokens: 80, durationMs: 4000 },
        { index: 3, role: 'code', model: 'm2', kind: 'failed', toolCalls: 0, promptTokens: 500, completionTokens: 0, durationMs: 900 },
    ],
    findings: [
        { id: 'edit_churn:4', kind: 'edit_churn', severity: 'warn', params: { path: 'cron/job.ts', writes: 4 }, evidence: [{ step: 4, turn: 2, label: 'edit_file', path: 'cron/job.ts' }] },
        { id: 'unverified_writes:4', kind: 'unverified_writes', severity: 'error', params: { files: 1, writes: 4 }, evidence: [] },
    ],
    files: [{ path: 'cron/job.ts', writes: 4, checked: false }, { path: 'docs/elsewhere.md', writes: 1, checked: true }],
};

const port = (over: Partial<AgentRunsPort> = {}): AgentRunsPort => ({ list: vi.fn(async () => [summary]), report: vi.fn(async () => report), ...over });

function mount(agentRuns: AgentRunsPort | undefined, labels: KnowledgeGraphLabels = L, onCompose?: (text: string) => void) {
    const onShow = vi.fn();
    const source: KnowledgeGraphSource = { scopes: async () => [], load: async () => null, ...(agentRuns ? { agentRuns } : {}) };
    function Harness() {
        const surface = useSurface(graph, null);
        return <AgentRunsPanel graph={graph} source={source} labels={labels} surface={surface} onShow={onShow} onCompose={onCompose} onClose={vi.fn()} />;
    }
    render(<Harness />);
    return { onShow };
}

describe('AgentRunsPanel', () => {
    const row = PANELS.find((p) => p.id === 'agentRuns')!;

    it('is offered only when the source records agent runs', () => {
        expect(row.available(graph, env)).toBe(false);
        expect(row.available(graph, { ...env, hasAgentRuns: true })).toBe(true);
    });

    it('lists the runs with their meta and counts in words', async () => {
        mount(port());
        const list = await screen.findByTestId('kg-agent-run-list');
        expect(within(list).getByText('Fix the cron job')).toBeTruthy();
        expect(within(list).getByText(fillTemplate(t.runMeta, { turns: 3, models: 'm1, m2' }))).toBeTruthy();
        expect(within(list).getByText(fillTemplate(t.runCounts, { error: 1, warn: 1, info: 0 }))).toBeTruthy();
    });

    it('shows the selected run: one titled bar per turn, findings worst first in localized words, and the files', async () => {
        const p = port();
        const { onShow } = mount(p);
        fireEvent.click(await screen.findByRole('button', { name: /Fix the cron job/ }));
        await screen.findByTestId('kg-agent-run-findings');
        // The graph's root goes with the id, so the host can say where it sits on disk (`AgentRunReport.root`).
        expect(p.report).toHaveBeenCalledWith('7', graph.scope.rootId);

        const bars = screen.getByTestId('kg-agent-run-strip').querySelectorAll('rect');
        expect(bars).toHaveLength(3);
        expect([...bars].map((b) => b.getAttribute('data-kind'))).toEqual(['read', 'write', 'failed']);
        expect(bars[1]!.querySelector('title')!.textContent).toContain('Turn 2');

        const items = within(screen.getByTestId('kg-agent-run-findings')).getAllByRole('listitem').filter((li) => li.hasAttribute('data-kind'));
        expect(items.map((li) => li.getAttribute('data-severity'))).toEqual(['error', 'warn']);
        expect(screen.getByText(t.findings.unverified_writes.title)).toBeTruthy();
        expect(screen.getByText('cron/job.ts was written 4 times.')).toBeTruthy();
        expect(screen.getByText('Turn 2 · edit_file')).toBeTruthy();

        const files = screen.getByTestId('kg-agent-run-files');
        expect(within(files).getByText(t.fileUnchecked)).toBeTruthy();
        expect(within(files).getByText(t.notOnGraph)).toBeTruthy();
        fireEvent.click(within(files).getByRole('button', { name: t.showOnGraph }));
        expect(onShow).toHaveBeenCalledWith(['src:sys::cron/job.ts']);
    });

    it('reads a localized catalog: finding words come from the labels, params filled in', async () => {
        const de = { ...L, surface: { ...L.surface, agentRuns: { ...t, findings: { ...t.findings, edit_churn: { title: 'Dauernd umgeschrieben', description: '{path} wurde {writes}-mal geschrieben.' } } } } };
        mount(port(), de);
        fireEvent.click(await screen.findByRole('button', { name: /Fix the cron job/ }));
        expect(await screen.findByText('Dauernd umgeschrieben')).toBeTruthy();
        expect(screen.getByText('cron/job.ts wurde 4-mal geschrieben.')).toBeTruthy();
    });

    it('says so when no run is recorded', async () => {
        mount(port({ list: async () => [] }));
        expect(await screen.findByText(t.emptyRuns)).toBeTruthy();
    });

    it('says the list could not be read when the host fails, and Retry reads it again', async () => {
        const list = vi.fn().mockRejectedValueOnce(new Error('host error')).mockResolvedValueOnce([summary]);
        mount(port({ list }));
        expect(await screen.findByTestId('kg-agent-runs-failed')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: L.retry }));
        expect(await screen.findByTestId('kg-agent-run-list')).toBeTruthy();
        expect(list).toHaveBeenCalledTimes(2);
    });

    it('says the list could not be read when the port throws instead of answering', async () => {
        mount(port({ list: () => { throw new Error('no host'); } }));
        expect(await screen.findByTestId('kg-agent-runs-failed')).toBeTruthy();
    });

    // regression: the drawer sat on "Reading the recorded agent runs…" for good when the host never answered.
    it('stops waiting on a host that never answers: the failed state with Retry, after AGENT_RUNS_TIMEOUT_MS', async () => {
        vi.useFakeTimers();
        try {
            const list = vi.fn((): Promise<AgentRunSummary[]> => new Promise(() => undefined));
            mount(port({ list }));
            expect(screen.getByTestId('kg-agent-runs-loading')).toBeTruthy();
            await act(async () => { vi.advanceTimersByTime(AGENT_RUNS_TIMEOUT_MS - 1); });
            expect(screen.getByTestId('kg-agent-runs-loading')).toBeTruthy();
            await act(async () => { vi.advanceTimersByTime(1); });
            expect(screen.getByTestId('kg-agent-runs-failed')).toBeTruthy();
            list.mockResolvedValueOnce([summary]);
            await act(async () => { fireEvent.click(screen.getByRole('button', { name: L.retry })); });
            expect(screen.getByTestId('kg-agent-run-list')).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('reads an answer that is not a list (a host without the op) as no runs, never as still loading', async () => {
        mount(port({ list: async () => undefined as unknown as AgentRunSummary[] }));
        expect(await screen.findByText(t.emptyRuns)).toBeTruthy();
    });

    it('says a run has nothing to flag', async () => {
        mount(port({ report: async () => ({ ...report, findings: [] }) }));
        fireEvent.click(await screen.findByRole('button', { name: /Fix the cron job/ }));
        expect(await screen.findByText(t.emptyFindings)).toBeTruthy();
    });

    it('exposes a Fix and a Review action on each run row, next to (not inside) the select button', async () => {
        mount(port());
        const row = (await screen.findByTestId('kg-agent-run-list')).querySelector('[data-run-row="7"]')!;
        const withinRow = within(row as HTMLElement);
        expect(withinRow.getByRole('button', { name: t.actionsFixAria })).toBeTruthy();
        expect(withinRow.getByRole('button', { name: t.actionsReviewAria })).toBeTruthy();
        // The select button's own name still carries the title, unambiguous (the aria labels deliberately omit it).
        expect(withinRow.getByRole('button', { name: /Fix the cron job/ })).toBeTruthy();
        expect(withinRow.getByRole('button', { name: /Fix the cron job/ }).closest('button')?.querySelector('button')).toBeNull();
    });

    it('Fix reads the report and hands a findings prompt to a new chat through onCompose', async () => {
        const onCompose = vi.fn();
        const p = port();
        mount(p, L, onCompose);
        fireEvent.click((await screen.findByTestId('kg-agent-run-list')).querySelector('[data-run-fix]')!);
        await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(1));
        expect(p.report).toHaveBeenCalledWith('7', graph.scope.rootId);
        const prompt = onCompose.mock.calls[0]![0] as string;
        expect(prompt).toContain('Fix the cron job');
        expect(prompt).toContain('1 errors · 1 warnings · 0 notes');
        expect(prompt).toContain(t.findings.unverified_writes.title);
        expect(prompt).toContain('1 files (4 writes) had no successful check afterwards.');
        expect(prompt).toContain(t.findings.edit_churn.title);
        expect(prompt).toContain('cron/job.ts was written 4 times.');
        expect(prompt).toContain('cron/job.ts');
        expect(prompt).toContain('docs/elsewhere.md');
    });

    it('Review reads the report, selects the run and focuses its files and evidence on the graph', async () => {
        const p = port();
        const { onShow } = mount(p, L, vi.fn());
        fireEvent.click((await screen.findByTestId('kg-agent-run-list')).querySelector('[data-run-review]')!);
        await waitFor(() => expect(p.report).toHaveBeenCalledWith('7', graph.scope.rootId));
        // The run is selected: its detail sections render.
        expect(await screen.findByTestId('kg-agent-run-findings')).toBeTruthy();
        // Both the report's file and the finding's evidence path map to the same graph node, de-duplicated.
        expect(onShow).toHaveBeenCalledWith(['src:sys::cron/job.ts']);
    });

    it('Fix is disabled when the host has no composer (onCompose absent), Review still works', async () => {
        const { onShow } = mount(port());
        const fix = (await screen.findByRole('button', { name: t.actionsFixAria })) as HTMLButtonElement;
        expect(fix.disabled).toBe(true);
        const review = screen.getByRole('button', { name: t.actionsReviewAria });
        fireEvent.click(review);
        await waitFor(() => expect(onShow).toHaveBeenCalledWith(['src:sys::cron/job.ts']));
    });

    it('a run with nothing on the graph does not call onShow on Review (and does not throw)', async () => {
        const local: AgentRunReport = {
            ...report,
            files: [{ path: 'elsewhere/never.ts', writes: 1, checked: true }],
            findings: [],
        };
        const { onShow } = mount(port({ report: async () => local }));
        fireEvent.click((await screen.findByTestId('kg-agent-run-list')).querySelector('[data-run-review]')!);
        await screen.findByText(t.emptyFindings);
        expect(onShow).not.toHaveBeenCalled();
    });

    it('a Fix or Review whose report read fails is spent quietly (no unhandled rejection)', async () => {
        const onCompose = vi.fn();
        const { onShow } = mount(port({ report: async () => null }), L, onCompose);
        fireEvent.click((await screen.findByTestId('kg-agent-run-list')).querySelector('[data-run-fix]')!);
        fireEvent.click(screen.getAllByRole('button', { name: t.actionsReviewAria })[0]!);
        await waitFor(() => expect(screen.getByTestId('kg-agent-runs')).toBeTruthy());
        expect(onCompose).not.toHaveBeenCalled();
        expect(onShow).not.toHaveBeenCalled();
    });

    it('drops a report that answers after another run was selected', async () => {
        const other: AgentRunSummary = { ...summary, id: '8', title: 'Second run' };
        let release: (r: AgentRunReport) => void = () => undefined;
        const slow = new Promise<AgentRunReport>((r) => { release = r; });
        const p = port({ list: async () => [summary, other], report: vi.fn((id: string) => (id === '7' ? slow : Promise.resolve({ ...report, findings: [] }))) });
        mount(p);
        fireEvent.click(await screen.findByRole('button', { name: /Fix the cron job/ }));
        fireEvent.click(screen.getByRole('button', { name: /Second run/ }));
        await screen.findByText(t.emptyFindings);
        release(report);
        await waitFor(() => expect(screen.queryByTestId('kg-agent-run-findings')).toBeNull());
    });
});
