// @vitest-environment jsdom
/** The Resolve drawer (the staged fix flow) and the Simulate drawer (a deterministic walk), through the real surface state. */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import type { FixCheckResult, FixStepRequest, RecordedRun } from '../../fixPorts';
import { surfaceFixture } from '../../testing';
import type { KnowledgeGraphSource } from '../../types';
import type { PanelProps } from '../registry';
import { useSurface, type SurfaceModel } from '../useSurface';
import { ResolvePanel } from './ResolvePanel';
import { SimulatePanel } from './SimulatePanel';

const graph = surfaceFixture();
const seen: { surface?: SurfaceModel } = {};
const base: KnowledgeGraphSource = { scopes: async () => [], load: async () => null };

function mountPanel(Panel: typeof ResolvePanel, f: Finding | null, props: Partial<PanelProps>) {
    const all = { onShow: vi.fn(), onCompose: vi.fn(), onClose: vi.fn(), ...props };
    function Harness() {
        const surface = useSurface(graph, null);
        seen.surface = surface;
        return (
            <>
                <button type="button" onClick={() => surface.resolve(f)}>open</button>
                <button type="button" onClick={() => surface.resolve(null)}>close</button>
                <Panel graph={graph} labels={L} surface={surface} {...all} />
            </>
        );
    }
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));
    return all;
}

describe('ResolvePanel (the staged fix flow)', () => {
    const unused: Finding = { id: 'u', kind: 'unused-file', pack: 'code', nodes: ['src:sys::cron/job.ts'] as never, severity: 'info', params: { count: 1, files: 1 }, requestKey: 'knowledgeGraph.fix.unusedFile' };
    const t = L.surface.fix;
    const act = (name: string) => document.querySelector(`[data-act="${name}"]`) as HTMLButtonElement;
    const click = (name: string) => fireEvent.click(act(name));
    const PASS = async () => [{ id: 'types', status: 'pass' }, { id: 'tests', status: 'pass' }, { id: 'rescan', status: 'pass' }] as never;

    it('asks which finding when none was chosen', () => {
        mountPanel(ResolvePanel, null, {});
        expect(screen.getByText(L.surface.resolve.empty)).toBeTruthy();
    });

    it('shows the queue counts, the mode switch, the four checks and the permissions note', () => {
        mountPanel(ResolvePanel, unused, { source: { ...base, applyFix: vi.fn() } });
        expect(screen.getByTestId('kg-fix-queue').textContent).toMatch(/open of .* shown · .* in the repo/);
        expect(screen.getByRole('radio', { name: t.mode.apply })).toBeTruthy();
        expect([...document.querySelectorAll('[data-check]')].map((li) => li.getAttribute('data-check'))).toEqual(['types', 'tests', 'rescan', 'review']);
        expect(screen.getByText(t.permNote)).toBeTruthy();
    });

    it('one primary action whose label advances: apply, run checks, mark resolved, resolved', async () => {
        const applyFix = vi.fn().mockResolvedValue({ branch: 'fix/unused', changed: ['cron/job.ts'], fixId: 'f1' });
        const markResolved = vi.fn().mockResolvedValue(undefined);
        mountPanel(ResolvePanel, unused, { source: { ...base, applyFix, runFixChecks: PASS as never, markResolved, undoFix: vi.fn() } });
        expect(act('primary').textContent).toBe(t.primary.apply);
        expect(act('undo')).toBeNull(); // nothing to undo yet
        click('primary');
        const done = await screen.findByTestId('kg-resolve-done');
        expect(applyFix).toHaveBeenCalledWith(unused);
        expect(done.textContent).toContain('cron/job.ts');
        expect(screen.getByText(fillTemplate(t.appliedOn, { branch: 'fix/unused' }))).toBeTruthy();
        expect(act('primary').textContent).toBe(t.primary.checks);
        expect(act('undo').disabled).toBe(false);

        click('primary');
        await waitFor(() => expect(act('primary').textContent).toBe(t.primary.resolve));
        for (const id of ['types', 'tests', 'rescan']) expect(document.querySelector(`[data-check="${id}"]`)!.getAttribute('data-status')).toBe('pass');
        expect(document.querySelector('[data-check="review"]')!.getAttribute('data-status')).toBe('agent'); // the agent's, through the composer

        click('primary');
        await waitFor(() => expect(act('primary').textContent).toBe(t.primary.resolved));
        expect(markResolved).toHaveBeenCalledWith(unused);
        expect(act('primary').disabled).toBe(true);
        expect(act('undo').disabled).toBe(true); // a resolved finding is not undone
    });

    it('keeps an applied fix\'s Undo when the drawer is closed and opened again', async () => {
        const undoFix = vi.fn().mockResolvedValue(undefined);
        mountPanel(ResolvePanel, unused, { source: { ...base, applyFix: vi.fn().mockResolvedValue({ changed: ['a.ts'], fixId: 'f1' }), undoFix } });
        click('primary');
        await screen.findByTestId('kg-resolve-done');
        fireEvent.click(screen.getByText('close'));
        expect(screen.queryByTestId('kg-fix-flow')).toBeNull();
        fireEvent.click(screen.getByText('open'));
        expect(act('undo').disabled).toBe(false); // the flow lives in the surface
        click('undo');
        await waitFor(() => expect(undoFix).toHaveBeenCalledTimes(1));
    });

    it('shows why a step failed, as an alert', async () => {
        mountPanel(ResolvePanel, unused, { source: { ...base, applyFix: vi.fn().mockRejectedValue(new Error('The work tree has changes (a.ts).')) } });
        click('primary');
        const alert = await screen.findByTestId('kg-fix-error');
        expect(alert.textContent).toBe('The work tree has changes (a.ts).');
        expect(alert.getAttribute('role')).toBe('alert');
    });

    it('shows a check\'s failure reason, and a check that never reported as an error', async () => {
        const runFixChecks = vi.fn(async () => [{ id: 'types', status: 'fail', detail: 'a.ts(1,1): TS2322' }] as never);
        mountPanel(ResolvePanel, unused, { source: { ...base, applyFix: vi.fn().mockResolvedValue({ changed: ['a.ts'], fixId: 'f' }), runFixChecks, markResolved: vi.fn() } });
        click('primary');
        await screen.findByTestId('kg-resolve-done');
        click('primary');
        await waitFor(() => expect(document.querySelector('[data-check="types"]')!.getAttribute('data-status')).toBe('fail'));
        expect(document.querySelector('[data-check-why="types"]')!.textContent).toBe('a.ts(1,1): TS2322');
        expect(document.querySelector('[data-check="tests"]')!.getAttribute('data-status')).toBe('error');
        expect(document.querySelector('[data-check-why="tests"]')!.textContent).toBe(t.checkNoReport);
        expect(act('primary').textContent).toBe(t.primary.checks); // retry, not resolve
    });

    it('disables Undo with its reason when the host handed out no fix id', async () => {
        mountPanel(ResolvePanel, unused, { source: { ...base, applyFix: vi.fn().mockResolvedValue({ changed: ['a.ts'] }), undoFix: vi.fn() } });
        click('primary');
        await screen.findByTestId('kg-resolve-done');
        expect(act('undo').disabled).toBe(true);
        expect(screen.getByTestId('kg-fix-undo-reason').textContent).toBe(t.undoNoRecord);
    });

    it('a finding with no codemod shows the read-only prompt and sends ONE request', () => {
        const { onCompose } = mountPanel(ResolvePanel, graph.findings[0]!, { source: { ...base, applyFix: vi.fn() } });
        expect(screen.getByRole('radio', { name: t.mode.apply }).hasAttribute('disabled')).toBe(true);
        expect((screen.getByLabelText(t.promptTitle) as HTMLTextAreaElement).readOnly).toBe(true);
        expect(screen.getByText(t.promptNote)).toBeTruthy();
        expect(act('primary').textContent).toBe(t.primary.prompt);
        click('primary');
        expect(onCompose).toHaveBeenCalledTimes(1);
        expect(act('primary').disabled).toBe(true);
    });

    it('lists the files the fix changes (the host\'s preview with its removed lines)', async () => {
        mountPanel(ResolvePanel, unused, { source: { ...base, applyFix: vi.fn(), previewFix: async () => ({ files: [{ path: 'cron/job.ts', removed: 3, lines: ['-export const old = 1'] }] }) } });
        await waitFor(() => expect(screen.getByTestId('kg-fix-preview').textContent).toContain('−3'));
        expect(screen.getByTestId('kg-fix-preview').textContent).toContain('export const old');
    });

    it('the fix queue is a clickable list of the findings in scope', () => {
        mountPanel(ResolvePanel, unused, { source: base });
        const rows = document.querySelectorAll('[data-queue]');
        expect(rows.length).toBe(graph.findings.length);
        fireEvent.click(rows[rows.length - 1]!);
        expect(seen.surface!.resolving?.id).toBe(graph.findings[graph.findings.length - 1]!.id);
    });

    it('repeats the header Before/After toggle inside the flow', () => {
        const onChange = vi.fn();
        mountPanel(ResolvePanel, unused, { source: base, revision: { value: 'after', hasBefore: true, onChange } });
        fireEvent.click(screen.getByRole('radio', { name: L.compareBefore }));
        expect(onChange).toHaveBeenCalledWith('before');
    });
});

describe('SimulatePanel', () => {
    const t = L.surface.simulate;
    const stopIds = () => seen.surface!.path.stops.map((s) => s.id);
    const recorded = (): RecordedRun => ({
        values: [
            { stopId: stopIds()[0]!, name: 'amount', value: '100', direction: 'in' },
            { stopId: stopIds().at(-1)!, name: 'response', value: '{"ok":true}', direction: 'out' },
        ],
        presets: [{ name: 'big order', values: { amount: '9999' } }],
    });

    it('says plainly that it is simulated, not executed', () => {
        mountPanel(SimulatePanel as never, null, {});
        expect(screen.getByTestId('kg-sim-banner').textContent).toBe(t.simulatedBanner);
    });

    it('with no recorded values it offers nothing to edit (never invents one), and still walks the hops', () => {
        mountPanel(SimulatePanel as never, null, { source: base, rootId: 'sys' });
        expect(screen.getByTestId('kg-sim-no-values')).toBeTruthy();
        expect(screen.getByTestId('kg-sim-code').textContent).toContain('enter');
        expect(screen.getByTestId('kg-sim-result').getAttribute('data-origin')).toBe('none');
    });

    it('steps with the shared index (Step, Run to end), showing recorded values, then edited ones as unknown results', async () => {
        const recordedValues = vi.fn(async () => recorded());
        mountPanel(SimulatePanel as never, null, { source: { ...base, recordedValues }, rootId: 'sys' });
        await screen.findByLabelText(fillTemplate(t.editAria, { name: 'amount' }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.path.runToEnd }));
        expect(seen.surface!.step).toBe(seen.surface!.path.stops.length - 1);
        expect(screen.getByTestId('kg-sim-result').textContent).toContain('{"ok":true}');
        expect(screen.getByTestId('kg-sim-vars').textContent).toContain('100');

        fireEvent.change(screen.getByLabelText(fillTemplate(t.editAria, { name: 'amount' })), { target: { value: '5' } });
        expect(screen.getByTestId('kg-sim-result').getAttribute('data-origin')).toBe('unknown');
        expect(screen.getByTestId('kg-sim-vars').textContent).toContain('5');

        fireEvent.click(screen.getByRole('button', { name: t.presetRecorded })); // back to the recorded values
        expect(screen.getByTestId('kg-sim-result').getAttribute('data-origin')).toBe('recorded');
    });

    it('sends the real run and the save-as-test request through the composer, never a result', async () => {
        const recordedValues = vi.fn(async () => recorded());
        const props = mountPanel(SimulatePanel as never, null, { source: { ...base, recordedValues }, rootId: 'sys' });
        await screen.findByLabelText(fillTemplate(t.editAria, { name: 'amount' }));
        fireEvent.click(screen.getByRole('button', { name: t.run }));
        expect(props.onCompose).toHaveBeenLastCalledWith(expect.stringContaining('amount=100'));
        fireEvent.click(screen.getByRole('button', { name: /\.test\.ts$/ }));
        expect(props.onCompose).toHaveBeenLastCalledWith(expect.stringMatching(/\.test\.ts that drives this path/));
        expect(screen.getByText(t.sent)).toBeTruthy();
    });

    it('forgets the edits and the stubs when the path changes', async () => {
        mountPanel(SimulatePanel as never, null, { source: { ...base, recordedValues: vi.fn(async () => recorded()) }, rootId: 'sys' });
        const input = await screen.findByLabelText(fillTemplate(t.editAria, { name: 'amount' }));
        fireEvent.change(input, { target: { value: '5' } });
        fireEvent.click(screen.getAllByRole('checkbox')[0]!);
        expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true);
        const [a, b] = seen.surface!.stations.stations;
        act(() => seen.surface!.pinPath([a!.refs[0]!, b!.refs[0]!]));
        await waitFor(() => expect((screen.getByLabelText(fillTemplate(t.editAria, { name: 'amount' })) as HTMLInputElement).value).toBe(''));
        expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(false);
    });

    it('toggling a stub clears the "sent" note, since what was sent no longer matches', () => {
        mountPanel(SimulatePanel as never, null, { source: base });
        fireEvent.click(screen.getByRole('button', { name: t.run }));
        expect(screen.getByText(t.sent)).toBeTruthy();
        fireEvent.click(screen.getAllByRole('checkbox')[0]!);
        expect(screen.queryByText(t.sent)).toBeNull();
    });

    it('can start the walk at the stop the person is on instead of at the entry', () => {
        mountPanel(SimulatePanel as never, null, { source: base });
        expect(screen.getByRole('radio', { name: t.startStop }).hasAttribute('disabled')).toBe(true); // already at the entry
        const second = seen.surface!.path.stops[1]!.name;
        act(() => seen.surface!.setStep(1));
        fireEvent.click(screen.getByRole('radio', { name: t.startStop }));
        expect(screen.getByTestId('kg-sim-code').textContent).toContain('enter ' + second);
        fireEvent.click(screen.getByRole('radio', { name: t.startEntry }));
        expect(screen.getByTestId('kg-sim-code').textContent).toContain('enter ' + second); // step 1 of the full walk is the same stop
        expect(screen.getByTestId('kg-sim-code').textContent).not.toContain('enter ' + seen.surface!.path.stops[0]!.name);
    });

    it('cannot run without a composer, and says so', () => {
        mountPanel(SimulatePanel as never, null, { onCompose: undefined });
        expect((screen.getByRole('button', { name: t.run }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText(t.noComposer)).toBeTruthy();
    });
});
