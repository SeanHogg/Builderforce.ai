/**
 * Applying the selected anti-pattern groups: a group whose kind has a host codemod is applied
 * finding by finding through the host's `applyFix` port, a few at a time (`mapBounded`), with
 * progress and a Cancel that stops after the calls in flight. EVERYTHING else (and any codemod that
 * failed, when there is a composer) goes to the agent as ONE batched request, never one per finding
 * and never a model call. A group of thousands of findings lists a capped sample plus a "+N more of
 * this kind" line.
 */

import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { findingBatchRequest } from '../../findingText';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import type { AppliedFix } from '../../fixPorts';
import type { KnowledgeGraphSource } from '../../types';
import { canApplyKind } from '../codemods';
import { counted } from '../plural';
import type { AntiPatternGroup } from './antiPatternGroups';

/** Findings of one group named in the batch request, at most. */
export const BATCH_SAMPLE = 10;
/** Host `applyFix` calls in flight at once. */
export const APPLY_CONCURRENCY = 4;

export interface BatchEntry { findings: readonly Finding[]; total: number }

/** The samples that appear in a batch request for these entries (so the flow can mark exactly those as handed over). */
export const batchSample = (entries: readonly BatchEntry[]): Finding[] => entries.flatMap((e) => e.findings.slice(0, BATCH_SAMPLE));

/** `findingBatchRequest` over a capped sample per entry, under ONE intro that counts every finding. */
export function cappedBatchRequest(entries: readonly BatchEntry[], labels: KnowledgeGraphLabels, index: ReadonlyMap<string, KNode>): string {
    const total = entries.reduce((n, e) => n + e.total, 0);
    const lines = entries.flatMap((e) => {
        const sample = e.findings.slice(0, BATCH_SAMPLE);
        const body = findingBatchRequest(sample, labels, index).split('\n').slice(1);
        return e.total > sample.length ? [...body, `- ${fillTemplate(labels.surface.patterns.moreOfKind, { count: e.total - sample.length })}`] : body;
    });
    return [counted(labels, 'fixBatch', total), ...lines].join('\n');
}

/**
 * Runs `work` over `items` with at most `limit` in flight, in order of start. Stops starting new
 * ones once `stopped()` is true (the ones in flight finish). Results sit at their item's index; an
 * item never started has no entry.
 */
export async function mapBounded<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>, stopped: () => boolean = () => false): Promise<Array<R | undefined>> {
    const out: Array<R | undefined> = new Array<R | undefined>(items.length).fill(undefined);
    let next = 0;
    const worker = async () => {
        while (!stopped() && next < items.length) {
            const at = next++;
            out[at] = await work(items[at]!);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return out;
}

export interface ApplyOutcome {
    /** Findings the host applied, with what it changed. */
    applied: Array<{ finding: Finding; fix: AppliedFix }>;
    /** Findings named in the ONE agent request (empty when none was sent). */
    composed: Finding[];
    /** Host codemods that failed and were NOT handed to the agent (there was no composer): the person is told. */
    failed: Finding[];
    /** Cancel stopped the run before every codemod was tried. */
    cancelled: boolean;
    /** The finding the Resolve flow opens on. */
    first: Finding | null;
}

export interface ApplyDeps {
    source: KnowledgeGraphSource | undefined;
    labels: KnowledgeGraphLabels;
    index: ReadonlyMap<string, KNode>;
    onCompose?: ((text: string) => void) | undefined;
    /** Called after each host call settles: how many of how many. */
    onProgress?: ((done: number, total: number) => void) | undefined;
    /** True once the person pressed Cancel. */
    cancelled?: (() => boolean) | undefined;
}

/** Whether Apply can do everything selected: host codemods run without a composer, anything else needs one. */
export const canApplyAll = (groups: readonly AntiPatternGroup[], source: KnowledgeGraphSource | undefined, hasComposer: boolean): boolean =>
    hasComposer || groups.every((g) => canApplyKind(source, g.kind));

export async function applyAntiPatterns(groups: readonly AntiPatternGroup[], { source, labels, index, onCompose, onProgress, cancelled }: ApplyDeps): Promise<ApplyOutcome> {
    const stopped = cancelled ?? (() => false);
    const hostFindings = groups.filter((g) => canApplyKind(source, g.kind)).flatMap((g) => g.findings);
    const entries: BatchEntry[] = groups.filter((g) => !canApplyKind(source, g.kind)).map((g) => ({ findings: g.findings, total: g.count }));
    let done = 0;
    const results = await mapBounded(hostFindings, APPLY_CONCURRENCY, async (finding) => {
        let result: { finding: Finding; fix: AppliedFix } | null = null;
        try { result = { finding, fix: await source!.applyFix!(finding) }; } catch { result = null; }
        onProgress?.(++done, hostFindings.length);
        return { finding, result };
    }, stopped);
    const applied = results.flatMap((r) => (r?.result ? [r.result] : []));
    const failed = results.flatMap((r) => (r && !r.result ? [r.finding] : []));
    const wasCancelled = stopped();
    // A codemod that failed is the agent's to do instead, when there is an agent to ask.
    if (failed.length > 0 && onCompose && !wasCancelled) entries.push({ findings: failed, total: failed.length });
    const composed = entries.length > 0 && onCompose && !wasCancelled ? batchSample(entries) : [];
    if (composed.length > 0) onCompose!(cappedBatchRequest(entries, labels, index));
    return {
        applied, composed, cancelled: wasCancelled,
        failed: onCompose && !wasCancelled ? [] : failed,
        first: applied[0]?.finding ?? composed[0] ?? null,
    };
}
