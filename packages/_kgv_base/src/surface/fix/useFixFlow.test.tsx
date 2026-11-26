// @vitest-environment jsdom
/** useFixFlow: what the person sees when a step fails, when they leave mid-run, and when the host cannot undo. */
import { useCallback, useReducer } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { FixStepError, type FixCheckResult, type FixStepRequest } from '../../fixPorts';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { KnowledgeGraphSource } from '../../types';
import { fixFlowReducer, initialFlow, type FixFlowAction, type FixFlowState } from './fixFlow';
import { useFixFlow } from './useFixFlow';

const finding = (id: string, kind = 'unused-file'): Finding => ({ id, kind, pack: 'code', nodes: ['src:r::a.ts'] as never, severity: 'warn', params: {} });
const base: KnowledgeGraphSource = { scopes: async () => [], load: async () => null };
const index = new Map();
const PASS = (): FixCheckResult[] => [{ id: 'types', status: 'pass' }, { id: 'tests', status: 'pass' }, { id: 'rescan', status: 'pass' }];

interface Props { finding: Finding; source?: KnowledgeGraphSource; onCompose?: (t: string) => void; onChanged?: () => void }

function useHarness(p: Props) {
    const [flows, dispatchFlows] = useReducer((m: Record<string, FixFlowState>, a: { id: string; action: FixFlowAction }) => ({ ...m, [a.id]: fixFlowReducer(m[a.id] ?? initialFlow(a.id), a.action) }), {});
    const id = p.finding.id;
    const dispatch = useCallback((action: FixFlowAction) => dispatchFlows({ id, action }), [id]);
    const flow = useFixFlow({ finding: p.finding, state: flows[id] ?? initialFlow(id), dispatch, source: p.source, labels: L, index, onCompose: p.onCompose, onChanged: p.onChanged });
    return { flow, flows };
}
const mount = (p: Props) => renderHook((props: Props) => useHarness(props), { initialProps: p });
const settle = () => act(async () => { await Promise.resolve(); });

describe('a failure shows its reason', () => {
    it('keeps the message of a rejected port', async () => {
        const h = mount({ finding: finding('a'), source: { ...base, applyFix: vi.fn().mockRejectedValue(new Error('The work tree has changes (a.ts).')) } });
        act(() => h.result.current.flow.runPrimary());
        await waitFor(() => expect(h.result.current.flow.state.steps.apply).toBe('failed'));
        expect(h.result.current.flow.state.errors.apply).toBe('The work tree has changes (a.ts).');
        expect(h.result.current.flow.primary.enabled).toBe(true); // and it can be retried
    });

    it('treats a port that throws synchronously the same way', async () => {
        const h = mount({ finding: finding('a'), source: { ...base, applyFix: (() => { throw new Error('sync boom'); }) as never } });
        act(() => h.result.current.flow.runPrimary());
        await waitFor(() => expect(h.result.current.flow.state.errors.apply).toBe('sync boom'));
    });

    it('words its own error codes through the catalog', async () => {
        const h = mount({ finding: finding('a'), source: { ...base, applyFix: vi.fn().mockRejectedValue(new FixStepError('noRoot')) } });
        act(() => h.result.current.flow.runPrimary());
        await waitFor(() => expect(h.result.current.flow.state.errors.apply).toBe(L.surface.fix.errors.noRoot));
    });

    it('keeps the checks already reported when the call rejects, and marks the rest as errors', async () => {
        const runFixChecks = vi.fn(async (_req: FixStepRequest, onUpdate: (u: { id: 'types'; status: 'pass' }) => void) => { onUpdate({ id: 'types', status: 'pass' }); throw new Error('host went away'); });
        const h = mount({ finding: finding('a'), source: { ...base, applyFix: async () => ({ changed: ['a.ts'], fixId: 'f' }), runFixChecks: runFixChecks as never } });
        act(() => h.result.current.flow.runPrimary());
        await waitFor(() => expect(h.result.current.flow.state.steps.apply).toBe('done'));
        act(() => h.result.current.flow.runPrimary());
        await waitFor(() => expect(h.result.current.flow.state.steps.checks).toBe('failed'));
        expect(h.result.current.flow.state.checks).toMatchObject({ types: 'pass', tests: 'error', rescan: 'error' });
        expect(h.result.current.flow.state.errors.checks).toBe('host went away');
    });
});

describe('leaving mid-run', () => {
    function slowChecks() {
        const seen: { signal?: AbortSignal; finish?: (r: FixCheckResult[]) => void } = {};
        const runFixChecks = vi.fn((req: FixStepRequest) => new Promise<FixCheckResult[]>((resolve) => { seen.signal = req.signal; seen.finish = resolve; }));
        return { seen, source: { ...base, applyFix: async () => ({ changed: ['a.ts'], fixId: 'f' }), runFixChecks } as KnowledgeGraphSource };
    }
    async function toChecks(h: ReturnType<typeof mount>) {
        act(() => h.result.current.flow.runPrimary());
        await waitFor(() => expect(h.result.current.flow.state.steps.apply).toBe('done'));
        act(() => h.result.current.flow.runPrimary());
    }

    it('unmounting aborts the running check', async () => {
        const { seen, source } = slowChecks();
        const h = mount({ finding: finding('a'), source });
        await toChecks(h);
        expect(seen.signal?.aborted).toBe(false);
        h.unmount();
        expect(seen.signal?.aborted).toBe(true);
    });

    it('switching finding aborts it too, and the late result lands on the finding it belongs to', async () => {
        const { seen, source } = slowChecks();
        const h = mount({ finding: finding('a'), source });
        await toChecks(h);
        h.rerender({ finding: finding('b'), source });
        expect(seen.signal?.aborted).toBe(true);
        expect(h.result.current.flow.state.findingId).toBe('b');
        expect(h.result.current.flow.state.steps.checks).toBe('idle'); // b is untouched
        await act(async () => { seen.finish!(PASS()); await Promise.resolve(); });
        expect(h.result.current.flows['a']!.steps.checks).toBe('done');
        expect(h.result.current.flows['b']).toBeUndefined();
    });
});

describe('the flows', () => {
    it('sends the review to the agent only after the host\'s checks are fine', async () => {
        const onCompose = vi.fn();
        const h = mount({ finding: finding('a'), onCompose, source: { ...base, applyFix: async () => ({ changed: ['a.ts'], fixId: 'f' }), runFixChecks: async () => PASS() } });
        act(() => h.result.current.flow.runPrimary());
        await waitFor(() => expect(h.result.current.flow.state.steps.apply).toBe('done'));
        act(() => h.result.current.flow.runPrimary());
        await waitFor(() => expect(h.result.current.flow.state.checks.review).toBe('agent'));
        expect(onCompose).toHaveBeenCalledTimes(1);
        expect(h.result.current.flow.state.steps.checks).toBe('done');
    });

    it('does not ask for the review when a check failed', async () => {
        const onCompose = vi.fn();
        const failing = async (): Promise<FixCheckResult[]> => [{ id: 'types', status: 'fail', detail: 'x' }, { id: 'tests', status: 'pass' }, { id: 'rescan', status: 'pass' }];
        const h = mount({ finding: finding('a'), onCompose, source: { ...base, applyFix: async () => ({ changed: [], fixId: 'f' }), runFixChecks: failing } });
        act(() => h.result.current.flow.runPrimary());
        await waitFor(() => expect(h.result.current.flow.state.steps.apply).toBe('done'));
        act(() => h.result.current.flow.runPrimary());
        await waitFor(() => expect(h.result.current.flow.state.steps.checks).toBe('failed'));
        expect(onCompose).not.toHaveBeenCalled();
    });

    it('a finding with no codemod sends ONE request to the composer, not four', async () => {
        const onCompose = vi.fn();
        const h = mount({ finding: finding('a', 'cycle'), onCompose, source: { ...base, applyFix: vi.fn() } });
        expect(h.result.current.flow.mode).toBe('prompt');
        act(() => h.result.current.flow.runPrimary());
        await settle();
        expect(onCompose).toHaveBeenCalledTimes(1);
        expect(h.result.current.flow.state.steps).toMatchObject({ apply: 'agent', checks: 'agent', resolve: 'agent' });
        expect(h.result.current.flow.primary.step).toBeNull();
    });

    it('Prompt mode on a fixable finding also sends one request', async () => {
        const onCompose = vi.fn();
        const applyFix = vi.fn();
        const h = mount({ finding: finding('a'), onCompose, source: { ...base, applyFix } });
        expect(h.result.current.flow.mode).toBe('apply');
        act(() => h.result.current.flow.setMode('prompt'));
        act(() => h.result.current.flow.runPrimary());
        expect(onCompose).toHaveBeenCalledTimes(1);
        expect(applyFix).not.toHaveBeenCalled();
    });

    it('falls back to the finding\'s files when the host cannot preview', () => {
        const h = mount({ finding: finding('a'), source: { ...base, applyFix: vi.fn() } });
        expect(h.result.current.flow.preview).toEqual({ files: [{ path: 'src:r::a.ts' }], fromHost: false });
    });

    it('uses the host\'s preview when it has one', async () => {
        const previewFix = vi.fn(async () => ({ files: [{ path: 'a.ts', removed: 2, lines: ['-export const x'] }] }));
        const h = mount({ finding: finding('a'), source: { ...base, applyFix: vi.fn(), previewFix } });
        await waitFor(() => expect(h.result.current.flow.preview.fromHost).toBe(true));
        expect(h.result.current.flow.preview.files[0]!.removed).toBe(2);
    });
});

describe('undo', () => {
    it('is blocked, with a reason, when the host handed out no fix id, and does not call the host', async () => {
        const undoFix = vi.fn();
        const h = mount({ finding: finding('a'), source: { ...base, applyFix: async () => ({ changed: ['a.ts'] }), undoFix } });
        act(() => h.result.current.flow.runPrimary());
        await waitFor(() => expect(h.result.current.flow.state.steps.apply).toBe('done'));
        expect(h.result.current.flow.undo).toEqual({ enabled: false, reason: 'noRecord' });
        act(() => h.result.current.flow.runUndo());
        expect(undoFix).not.toHaveBeenCalled();
    });

    it('runs through the host with the fix id and returns the flow to its start', async () => {
        const undoFix = vi.fn().mockResolvedValue(undefined);
        const onChanged = vi.fn();
        const h = mount({ finding: finding('a'), onChanged, source: { ...base, applyFix: async () => ({ changed: ['a.ts'], fixId: 'f1' }), undoFix } });
        act(() => h.result.current.flow.runPrimary());
        await waitFor(() => expect(h.result.current.flow.state.steps.apply).toBe('done'));
        act(() => h.result.current.flow.runUndo());
        await waitFor(() => expect(h.result.current.flow.state.steps.undo).toBe('done'));
        expect(undoFix).toHaveBeenCalledWith(expect.objectContaining({ applied: { changed: ['a.ts'], fixId: 'f1' } }));
        expect(h.result.current.flow.state.steps.apply).toBe('idle');
        expect(onChanged).toHaveBeenCalledTimes(2); // the apply and the undo both reload the graph
    });
});
