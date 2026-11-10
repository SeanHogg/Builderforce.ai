/**
 * Drives the staged fix flow of ONE finding through the source's ports. A step the host has a
 * port for runs there; any other step is sent to the agent through the composer and recorded as
 * handed over; a finding with no codemod (or Prompt mode) sends ONE request. The state machine is
 * `fixFlow.ts` and lives in the surface, keyed by finding, so closing the drawer keeps an applied
 * fix's Undo; this hook only owns what must stop with the person leaving: the running check is
 * aborted when the finding changes or the drawer unmounts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { findingItems, findingTitle } from '../../findingText';
import { HOST_CHECK_IDS, FixStepError, type FixCheckResult, type FixPreview } from '../../fixPorts';
import type { KnowledgeGraphLabels } from '../../labels';
import type { KnowledgeGraphSource } from '../../types';
import { nextStep, stepEnabled, type FixFlowAction, type FixFlowState, type FixMode, type FixStepId, type ForwardStep } from './fixFlow';
import { effectiveMode, promptRequest, reviewRequest, stepMode, stepRequest, undoBlock, type StepMode } from './fixModes';

/** What the person sees as the one primary action. */
export interface Primary {
    /** The step it runs; null once the finding is resolved. */
    step: ForwardStep | null;
    /** `prompt`: one request to the composer; `agent`: this step goes to the agent; `host`: it runs here. */
    how: 'prompt' | StepMode;
    enabled: boolean;
}

export interface FixFlow {
    state: FixFlowState;
    mode: FixMode;
    primary: Primary;
    /** Undo: enabled when it can run; `reason` says why not. */
    undo: { enabled: boolean; reason: 'noRecord' | null };
    preview: { files: FixPreview['files']; fromHost: boolean };
    runPrimary(): void;
    runUndo(): void;
    setMode(mode: FixMode): void;
}

interface Inputs {
    finding: Finding;
    state: FixFlowState;
    dispatch(action: FixFlowAction): void;
    source: KnowledgeGraphSource | undefined;
    labels: KnowledgeGraphLabels;
    index: ReadonlyMap<string, KNode>;
    onCompose?: ((text: string) => void) | undefined;
    /** Reload the graph (after an apply, an undo or a resolve changed the code). */
    onChanged?: (() => void) | undefined;
    /** The test files of the finding's co-change partners (PRD 38 P4): the checks run them too. */
    partnerTests?: readonly string[] | undefined;
}

/** The reason text of a failure: our own codes through the catalog, anything else by its message. */
export function errorText(error: unknown, labels: KnowledgeGraphLabels): string {
    if (error instanceof FixStepError) return labels.surface.fix.errors[error.code];
    return error instanceof Error && error.message ? error.message : labels.surface.fix.errors.unknown;
}

export function useFixFlow({ finding, state, dispatch, source, labels, index, onCompose, onChanged, partnerTests }: Inputs): FixFlow {
    const id = finding.id;
    const controller = useRef<AbortController | null>(null);
    // Leaving the finding (or closing the drawer) stops its running check, and with it the process tree.
    useEffect(() => () => { controller.current?.abort(); controller.current = null; }, [id]);

    const mode = effectiveMode(state.mode, source, finding);
    const [fetched, setFetched] = useState<{ id: string; preview: FixPreview | null } | null>(null);
    useEffect(() => {
        if (mode !== 'apply' || !source?.previewFix) return;
        let live = true;
        source.previewFix(finding).then((preview) => { if (live) setFetched({ id, preview }); }, () => { if (live) setFetched({ id, preview: null }); });
        return () => { live = false; };
    }, [mode, source, finding, id]);
    const preview = useMemo(() => {
        const host = fetched?.id === id ? fetched.preview : null;
        return host ? { files: host.files, fromHost: true } : { files: finding.nodes.map((ref) => ({ path: index.get(ref)?.label ?? ref })), fromHost: false };
    }, [fetched, id, finding.nodes, index]);

    const fail = useCallback((step: FixStepId, error: unknown) => dispatch({ type: 'failed', step, error: errorText(error, labels) }), [dispatch, labels]);
    /** Runs `work`, turning a synchronous throw from a port into the same failure as a rejection. */
    const attempt = useCallback((step: FixStepId, work: () => Promise<void>) => {
        try { work().catch((error: unknown) => fail(step, error)); } catch (error) { fail(step, error); }
    }, [fail]);

    const title = findingTitle(finding, labels);
    const items = findingItems(finding, index);

    const runStep = useCallback((step: FixStepId) => {
        const applied = state.applied;
        if (stepMode(step, source, finding) === 'agent') {
            onCompose?.(stepRequest(step, title, applied, labels, items));
            dispatch({ type: 'agent', step });
            return;
        }
        dispatch({ type: 'start', step });
        const req = { finding, applied: applied ?? { changed: [] }, ...(partnerTests && partnerTests.length > 0 ? { partnerTests: [...partnerTests] } : {}) };
        if (step === 'apply') {
            attempt(step, async () => { dispatch({ type: 'applied', applied: await source!.applyFix!(finding) }); onChanged?.(); });
        } else if (step === 'checks') {
            const ctl = new AbortController();
            controller.current = ctl;
            attempt(step, async () => {
                const results: FixCheckResult[] = await source!.runFixChecks!({ ...req, signal: ctl.signal }, (update) => dispatch({ type: 'check', update }));
                dispatch({ type: 'checksDone', results });
                // The review is the agent's, and only worth asking for once the host's checks are fine.
                const fine = HOST_CHECK_IDS.every((c) => { const s = results.find((r) => r.id === c)?.status; return s === 'pass' || s === 'skipped'; });
                if (!fine) return;
                if (onCompose) { onCompose(reviewRequest(title, applied, labels, items)); dispatch({ type: 'check', update: { id: 'review', status: 'agent' } }); }
                else dispatch({ type: 'check', update: { id: 'review', status: 'skipped' } });
            });
        } else if (step === 'resolve') {
            attempt(step, async () => { await source!.markResolved!(finding); dispatch({ type: 'resolved' }); onChanged?.(); });
        } else {
            attempt(step, async () => { await source!.undoFix!(req); dispatch({ type: 'undone' }); onChanged?.(); });
        }
    }, [state.applied, source, finding, title, items, labels, onCompose, onChanged, dispatch, attempt, partnerTests]);

    const step = nextStep(state);
    const how: Primary['how'] = mode === 'prompt' ? 'prompt' : step ? stepMode(step, source, finding) : 'host';
    const composerOk = how === 'host' || !!onCompose;
    const primary: Primary = {
        step, how,
        enabled: step !== null && composerOk && (mode === 'prompt' ? state.steps.apply === 'idle' : stepEnabled(state, step)),
    };
    const block = undoBlock(source, state.applied);
    const undoMode = stepMode('undo', source, finding);
    const undo = { enabled: stepEnabled(state, 'undo') && block === null && (undoMode === 'host' || !!onCompose), reason: block };

    return {
        state, mode, primary, undo, preview,
        runPrimary() {
            if (!step || !primary.enabled) return;
            if (mode === 'prompt') { onCompose?.(promptRequest(title, labels, items)); dispatch({ type: 'promptSent' }); return; }
            runStep(step);
        },
        runUndo() { if (undo.enabled) runStep('undo'); },
        setMode: (m) => dispatch({ type: 'mode', mode: m }),
    };
}
