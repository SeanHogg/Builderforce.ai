/**
 * Who handles each fix step: the HOST (it implements the port) or the AGENT (the step is sent
 * through the composer). One table, so a step is never a dead button. Also the fixed requests the
 * hand-offs send, which flow a finding gets (the deterministic fix, or ONE prompt), and the fix
 * queue's counts. Pure.
 */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import type { KnowledgeGraphSource } from '../../types';
import type { AppliedFix } from '../../fixPorts';
import { canApplyKind } from '../codemods';
import type { FixMode, FixStepId } from './fixFlow';

export type StepMode = 'host' | 'agent';

type Ports = Pick<KnowledgeGraphSource, 'applyFix' | 'applyFixKinds' | 'runFixChecks' | 'markResolved' | 'undoFix'>;

/** The host handles a step when it has the port for it; apply also needs a codemod for the finding's kind. */
export function stepMode(step: FixStepId, source: Ports | undefined, finding: Pick<Finding, 'kind'>): StepMode {
    switch (step) {
        case 'apply': return canApplyKind(source, finding.kind) ? 'host' : 'agent';
        case 'checks': return source?.runFixChecks ? 'host' : 'agent';
        case 'resolve': return source?.markResolved ? 'host' : 'agent';
        case 'undo': return source?.undoFix ? 'host' : 'agent';
    }
}

/**
 * Which flow the finding gets: the deterministic fix when the person wants it AND a codemod exists
 * for the kind on this host, otherwise ONE prompt to the composer (never four requests).
 */
export function effectiveMode(wanted: FixMode | null, source: Ports | undefined, finding: Pick<Finding, 'kind'>): FixMode {
    const codemod = canApplyKind(source, finding.kind);
    return codemod && wanted !== 'prompt' ? 'apply' : 'prompt';
}

/** Why Undo cannot run, or null: the host would undo by an id it never handed out. */
export function undoBlock(source: Ports | undefined, applied: AppliedFix | null): 'noRecord' | null {
    return source?.undoFix && applied && !applied.fixId ? 'noRecord' : null;
}

type RequestKey = 'requestApply' | 'requestChecks' | 'requestResolve' | 'requestUndo' | 'requestPrompt' | 'requestReview';

function request(key: RequestKey, title: string, applied: AppliedFix | null, labels: KnowledgeGraphLabels, items: string): string {
    const t = labels.surface.fix;
    return fillTemplate(t[key], { title, items, branch: applied?.branch ?? t.branchUnknown });
}

/** The fixed request sent to the agent for one step (never a model call to make it). */
export function stepRequest(step: FixStepId, title: string, applied: AppliedFix | null, labels: KnowledgeGraphLabels, items: string): string {
    return request({ apply: 'requestApply', checks: 'requestChecks', resolve: 'requestResolve', undo: 'requestUndo' }[step] as RequestKey, title, applied, labels, items);
}

/** The ONE request a finding with no codemod sends: fix it, run the four checks, report. */
export const promptRequest = (title: string, labels: KnowledgeGraphLabels, items: string): string => request('requestPrompt', title, null, labels, items);

/** The fourth check, always the agent's: a review of the change for new findings. */
export const reviewRequest = (title: string, applied: AppliedFix | null, labels: KnowledgeGraphLabels, items: string): string => request('requestReview', title, applied, labels, items);

export interface QueueCounts { open: number; shown: number; repo: number }

/** "N open of M shown · K in the repo": open = shown and not resolved; repo = every finding of the graph. */
export function fixQueueCounts(shown: readonly Pick<Finding, 'id'>[], repoTotal: number, resolved: ReadonlySet<string>): QueueCounts {
    return { open: shown.filter((f) => !resolved.has(f.id)).length, shown: shown.length, repo: Math.max(repoTotal, shown.length) };
}

export const fixQueueText = (c: QueueCounts, labels: KnowledgeGraphLabels): string => fillTemplate(labels.surface.fix.queue, { open: c.open, shown: c.shown, repo: c.repo });
