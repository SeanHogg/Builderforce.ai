/**
 * The staged fix flow as a pure state machine: Apply to branch, Run checks, Mark resolved, Undo.
 * Each step is `idle | running | done | failed`, or `agent` once it was handed to the agent. Which
 * step comes next depends only on the ones before it, and the person sees ONE primary action
 * whose label advances. Failures keep their reason (`errors`, per check `details`). No React and
 * no source here: the hook feeds this its actions, and the surface keeps the state per finding.
 */

import { FIX_CHECK_IDS, HOST_CHECK_IDS, type AppliedFix, type FixCheckId, type FixCheckResult, type FixCheckStatus, type FixCheckUpdate } from '../../fixPorts';

export type FixStepId = 'apply' | 'checks' | 'resolve' | 'undo';
export const FIX_STEP_IDS: readonly FixStepId[] = ['apply', 'checks', 'resolve', 'undo'];

/** The steps that make up the forward path; the primary action walks them. */
export type ForwardStep = 'apply' | 'checks' | 'resolve';

export type StepState = 'idle' | 'running' | 'done' | 'failed' | 'agent';

/** `apply`: the deterministic fix; `prompt`: one request to the composer. `null`: whatever the finding allows. */
export type FixMode = 'apply' | 'prompt';

export interface FixFlowState {
    findingId: string;
    mode: FixMode | null;
    steps: Record<FixStepId, StepState>;
    applied: AppliedFix | null;
    checks: Record<FixCheckId, FixCheckStatus>;
    /** Why a check failed or never ran (host text), per check. */
    details: Partial<Record<FixCheckId, string>>;
    /** Why a step failed (the error's own message), per step. */
    errors: Partial<Record<FixStepId, string>>;
}

const pendingChecks = (): Record<FixCheckId, FixCheckStatus> => Object.fromEntries(FIX_CHECK_IDS.map((id) => [id, 'pending'])) as Record<FixCheckId, FixCheckStatus>;

export const initialFlow = (findingId: string, mode: FixMode | null = null): FixFlowState => ({
    findingId, mode, applied: null, checks: pendingChecks(), details: {}, errors: {},
    steps: { apply: 'idle', checks: 'idle', resolve: 'idle', undo: 'idle' },
});

export type FixFlowAction =
    | { type: 'mode'; mode: FixMode }
    | { type: 'start'; step: FixStepId }
    | { type: 'applied'; applied: AppliedFix }
    | { type: 'check'; update: FixCheckUpdate }
    | { type: 'checksDone'; results: readonly FixCheckResult[] }
    | { type: 'resolved' }
    | { type: 'undone' }
    | { type: 'failed'; step: FixStepId; error?: string }
    | { type: 'agent'; step: FixStepId }
    /** One request covered apply, checks and resolve (a finding with no codemod, or Prompt mode). */
    | { type: 'promptSent' };

const isFinal = (s: FixCheckStatus): boolean => s !== 'pending' && s !== 'running';

/** The checks, taken together, are fine: each passed, was skipped by the host, or is the agent's. An `error` or `fail` is not. */
export const checksPassed = (checks: Readonly<Record<FixCheckId, FixCheckStatus>>): boolean => FIX_CHECK_IDS.every((id) => checks[id] === 'pass' || checks[id] === 'skipped' || checks[id] === 'agent');

/** Checks the host never settled become errors (never skips or passes); the agent's review is left as it is. */
function settleUnreported(checks: Record<FixCheckId, FixCheckStatus>): Record<FixCheckId, FixCheckStatus> {
    const out = { ...checks };
    for (const id of HOST_CHECK_IDS) if (!isFinal(out[id])) out[id] = 'error';
    return out;
}

export function fixFlowReducer(state: FixFlowState, action: FixFlowAction): FixFlowState {
    const set = (step: FixStepId, to: StepState): FixFlowState => ({ ...state, steps: { ...state.steps, [step]: to } });
    const without = (step: FixStepId): Partial<Record<FixStepId, string>> => { const { [step]: _drop, ...rest } = state.errors; return rest; };
    switch (action.type) {
        case 'mode':
            return { ...state, mode: action.mode };
        case 'start':
            return {
                ...set(action.step, 'running'), errors: without(action.step),
                ...(action.step === 'checks' ? { checks: pendingChecks(), details: {} } : null),
            };
        case 'applied':
            return { ...set('apply', 'done'), applied: action.applied };
        case 'check': {
            const { id, status, detail } = action.update;
            const details = { ...state.details };
            if (detail) details[id] = detail; else delete details[id];
            return { ...state, checks: { ...state.checks, [id]: status }, details };
        }
        case 'checksDone': {
            const checks = { ...state.checks };
            const details = { ...state.details };
            for (const r of action.results) { checks[r.id] = r.status; if (r.detail) details[r.id] = r.detail; }
            const settled = settleUnreported(checks);
            return { ...state, checks: settled, details, steps: { ...state.steps, checks: checksPassedHost(settled) ? 'done' : 'failed' } };
        }
        case 'resolved':
            return set('resolve', 'done');
        case 'undone':
            return { ...initialFlow(state.findingId, state.mode), steps: { ...initialFlow(state.findingId).steps, undo: 'done' } };
        case 'failed':
            return {
                ...set(action.step, 'failed'),
                errors: { ...state.errors, ...(action.error ? { [action.step]: action.error } : null) },
                ...(action.step === 'checks' ? { checks: settleUnreported(state.checks) } : null),
            };
        case 'agent':
            return set(action.step, 'agent');
        case 'promptSent':
            return { ...state, steps: { ...state.steps, apply: 'agent', checks: 'agent', resolve: 'agent' } };
    }
}

/** The host's checks all fine (the review is sent separately, after them). */
const checksPassedHost = (checks: Readonly<Record<FixCheckId, FixCheckStatus>>): boolean => HOST_CHECK_IDS.every((id) => checks[id] === 'pass' || checks[id] === 'skipped');

const handed = (s: StepState): boolean => s === 'done' || s === 'agent';

/** The forward step the primary action runs next, or null when the finding is resolved. Pure. */
export function nextStep(state: FixFlowState): ForwardStep | null {
    if (!handed(state.steps.apply)) return 'apply';
    if (!handed(state.steps.checks)) return 'checks';
    if (!handed(state.steps.resolve)) return 'resolve';
    return null;
}

/** A step may run once the ones it depends on are done (or were handed to the agent), and nothing else is running. */
export function stepEnabled(state: FixFlowState, step: FixStepId): boolean {
    if (FIX_STEP_IDS.some((s) => state.steps[s] === 'running')) return false;
    switch (step) {
        case 'apply': return !handed(state.steps.apply);
        case 'checks': return handed(state.steps.apply) && !handed(state.steps.checks);
        case 'resolve': return handed(state.steps.apply) && handed(state.steps.checks) && state.steps.resolve !== 'done';
        case 'undo': return state.steps.apply === 'done' && state.steps.resolve !== 'done';
    }
}

/** True once the finding is resolved (by the host, or its single request went to the agent). */
export const isResolved = (state: FixFlowState): boolean => state.steps.resolve === 'done';

export type QueueState = 'open' | 'applied' | 'resolved';

/** Where a finding stands: resolved, applied (checking), or open. Pure. */
export function queueState(flow: FixFlowState | undefined): QueueState {
    if (!flow) return 'open';
    if (isResolved(flow)) return 'resolved';
    return flow.steps.apply === 'done' || flow.steps.apply === 'agent' ? 'applied' : 'open';
}
