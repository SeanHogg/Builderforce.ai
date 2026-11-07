/** The fix flow state machine and the table that decides who handles each step. */
import { describe, expect, it } from 'vitest';
import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { canApplyKind, codemodOf, CODEMODS } from '../codemods';
import { checksPassed, fixFlowReducer, initialFlow, isResolved, nextStep, queueState, stepEnabled } from './fixFlow';
import { effectiveMode, fixQueueCounts, fixQueueText, promptRequest, reviewRequest, stepMode, stepRequest, undoBlock } from './fixModes';

const f = (kind: string): Finding => ({ id: kind, kind, pack: 'code', nodes: [], severity: 'warn', params: {} });
const run = (s: ReturnType<typeof initialFlow>, ...a: Parameters<typeof fixFlowReducer>[1][]) => a.reduce(fixFlowReducer, s);

describe('the forward path', () => {
    it('walks apply, checks, resolve; the primary action names the next one', () => {
        let s = initialFlow('x');
        expect(nextStep(s)).toBe('apply');
        expect(stepEnabled(s, 'checks')).toBe(false);
        expect(stepEnabled(s, 'undo')).toBe(false);
        s = run(s, { type: 'start', step: 'apply' }, { type: 'applied', applied: { branch: 'fix/x', changed: ['a'], fixId: 'id' } });
        expect(s.applied?.branch).toBe('fix/x');
        expect(nextStep(s)).toBe('checks');
        expect(stepEnabled(s, 'resolve')).toBe(false); // checks first
        expect(stepEnabled(s, 'undo')).toBe(true);
        s = run(s, { type: 'start', step: 'checks' }, { type: 'checksDone', results: [{ id: 'types', status: 'pass' }, { id: 'tests', status: 'pass' }, { id: 'rescan', status: 'pass' }] });
        expect(nextStep(s)).toBe('resolve');
        s = run(s, { type: 'resolved' });
        expect(nextStep(s)).toBeNull();
        expect(isResolved(s)).toBe(true);
        expect(stepEnabled(s, 'undo')).toBe(false); // a resolved finding is not undone
    });

    it('locks every step while one runs', () => {
        expect(stepEnabled(run(initialFlow('x'), { type: 'start', step: 'apply' }), 'apply')).toBe(false);
    });

    it('a failed step keeps its reason and can be retried', () => {
        let s = run(initialFlow('x'), { type: 'start', step: 'apply' }, { type: 'failed', step: 'apply', error: 'git said no' });
        expect(s.errors.apply).toBe('git said no');
        expect(stepEnabled(s, 'apply')).toBe(true);
        s = run(s, { type: 'start', step: 'apply' });
        expect(s.errors.apply).toBeUndefined(); // the retry clears it
    });

    it('a step handed to the agent opens the next one, but gives Undo nothing of ours', () => {
        const s = run(initialFlow('x'), { type: 'agent', step: 'apply' });
        expect(nextStep(s)).toBe('checks');
        expect(stepEnabled(s, 'undo')).toBe(false);
    });

    it('ONE prompt covers apply, checks and resolve', () => {
        const s = run(initialFlow('x'), { type: 'promptSent' });
        expect(nextStep(s)).toBeNull();
        expect(isResolved(s)).toBe(false); // sent, not resolved
    });

    it('undo returns to the start but keeps the chosen mode', () => {
        const s = run(initialFlow('x'), { type: 'mode', mode: 'prompt' }, { type: 'applied', applied: { changed: [] } }, { type: 'undone' });
        expect(s.applied).toBeNull();
        expect(s.mode).toBe('prompt');
        expect(s.steps).toEqual({ apply: 'idle', checks: 'idle', resolve: 'idle', undo: 'done' });
    });
});

describe('the checks', () => {
    it('shows only the current check as running, and keeps what each reported', () => {
        let s = run(initialFlow('x'), { type: 'start', step: 'checks' });
        expect(Object.values(s.checks).every((c) => c === 'pending')).toBe(true);
        s = run(s, { type: 'check', update: { id: 'types', status: 'running' } });
        expect(s.checks).toMatchObject({ types: 'running', tests: 'pending', rescan: 'pending' });
        s = run(s, { type: 'check', update: { id: 'types', status: 'pass' } }, { type: 'check', update: { id: 'tests', status: 'running' } });
        expect(s.checks).toMatchObject({ types: 'pass', tests: 'running' });
    });

    it('a check that never reported is an error, never a skip or a pass', () => {
        const s = run(initialFlow('x'), { type: 'start', step: 'checks' }, { type: 'checksDone', results: [{ id: 'types', status: 'pass' }] });
        expect(s.checks).toMatchObject({ types: 'pass', tests: 'error', rescan: 'error' });
        expect(s.steps.checks).toBe('failed');
        expect(checksPassed(s.checks)).toBe(false);
    });

    it('a failed check fails the step and keeps its detail', () => {
        const s = run(initialFlow('x'), { type: 'checksDone', results: [{ id: 'types', status: 'fail', detail: 'TS2322 in a.ts' }, { id: 'tests', status: 'pass' }, { id: 'rescan', status: 'pass' }] });
        expect(s.steps.checks).toBe('failed');
        expect(s.details.types).toBe('TS2322 in a.ts');
    });

    it('a rejected call keeps the results already received and marks the rest as errors, with the reason', () => {
        const s = run(
            initialFlow('x'), { type: 'start', step: 'checks' },
            { type: 'check', update: { id: 'types', status: 'pass' } }, { type: 'check', update: { id: 'tests', status: 'running' } },
            { type: 'failed', step: 'checks', error: 'host went away' },
        );
        expect(s.checks).toMatchObject({ types: 'pass', tests: 'error', rescan: 'error', review: 'pending' });
        expect(s.errors.checks).toBe('host went away');
        expect(s.steps.checks).toBe('failed');
    });

    it('passes when each check passed, was skipped by the host, or is the agent\'s', () => {
        expect(checksPassed({ types: 'pass', tests: 'skipped', rescan: 'pass', review: 'agent' })).toBe(true);
        expect(checksPassed({ types: 'pass', tests: 'error', rescan: 'pass', review: 'agent' })).toBe(false);
        expect(checksPassed({ types: 'pass', tests: 'pass', rescan: 'pass', review: 'pending' })).toBe(false);
    });
});

describe('who handles a step', () => {
    it('the host, only where it has the port (apply also needs a codemod)', () => {
        const all = { applyFix: async () => ({ changed: [] }), runFixChecks: async () => [], markResolved: async () => undefined, undoFix: async () => undefined };
        expect(stepMode('apply', all, f('unused-export'))).toBe('host');
        expect(stepMode('apply', all, f('cycle'))).toBe('agent');
        expect(stepMode('checks', all, f('cycle'))).toBe('host');
        expect(stepMode('resolve', {}, f('cycle'))).toBe('agent');
        expect(stepMode('undo', undefined, f('cycle'))).toBe('agent');
    });

    it('a finding with no codemod gets the prompt flow, whatever mode was asked', () => {
        const source = { applyFix: async () => ({ changed: [] }) };
        expect(effectiveMode(null, source, f('unused-file'))).toBe('apply');
        expect(effectiveMode('prompt', source, f('unused-file'))).toBe('prompt');
        expect(effectiveMode('apply', source, f('cycle'))).toBe('prompt');
        expect(effectiveMode(null, undefined, f('unused-file'))).toBe('prompt');
    });

    it('undo is blocked, with a reason, when the host handed out no fix id', () => {
        const source = { undoFix: async () => undefined };
        expect(undoBlock(source, { changed: ['a'] })).toBe('noRecord');
        expect(undoBlock(source, { changed: ['a'], fixId: 'x' })).toBeNull();
        expect(undoBlock(source, null)).toBeNull();
        expect(undoBlock({}, { changed: ['a'] })).toBeNull(); // the agent does it
    });

    it('codemods are data: a non-builtin kind needs the host to list it', () => {
        const applyFix = async () => ({ changed: [] });
        expect(CODEMODS.map((r) => r.kind)).toContain('god-file');
        expect(canApplyKind({ applyFix }, 'unused-file')).toBe(true);
        expect(canApplyKind({ applyFix }, 'god-file')).toBe(false);
        expect(canApplyKind({ applyFix, applyFixKinds: ['god-file'] }, 'god-file')).toBe(true);
        expect(canApplyKind({ applyFix, applyFixKinds: ['god-file'] }, 'unused-file')).toBe(false);
        expect(canApplyKind({}, 'unused-file')).toBe(false);
        expect(codemodOf('god-file')?.labelKey).toBe('splitByCommand');
    });

    it('every codemod row has a label in the catalog', () => {
        for (const r of CODEMODS) expect(L.surface.fix.codemod[r.labelKey]).toBeTruthy();
    });
});

describe('queue counts, state and agent requests', () => {
    it('counts open of shown, and the repo total', () => {
        const c = fixQueueCounts([f('a'), f('b'), f('c')], 40, new Set(['a']));
        expect(c).toEqual({ open: 2, shown: 3, repo: 40 });
        expect(fixQueueText(c, L)).toBe('2 open of 3 shown · 40 in the repo');
        expect(fixQueueCounts([f('a'), f('b')], 1, new Set()).repo).toBe(2);
    });

    it('a finding is open, applied (checking) or resolved', () => {
        expect(queueState(undefined)).toBe('open');
        expect(queueState(run(initialFlow('x'), { type: 'applied', applied: { changed: [] } }))).toBe('applied');
        expect(queueState(run(initialFlow('x'), { type: 'applied', applied: { changed: [] } }, { type: 'resolved' }))).toBe('resolved');
    });

    it('fills a fixed request per step, one prompt, and the review', () => {
        expect(stepRequest('checks', 'Cycle', { branch: 'fix/c', changed: [] }, L, 'a, b')).toContain('fix/c');
        expect(stepRequest('undo', 'Cycle', null, L, 'a')).toContain(L.surface.fix.branchUnknown);
        expect(promptRequest('Cycle', L, 'a')).toContain('Cycle: a');
        expect(reviewRequest('Cycle', { branch: 'fix/c', changed: [] }, L, 'a')).toContain('fix/c');
    });
});
