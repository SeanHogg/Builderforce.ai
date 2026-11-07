/**
 * The `duplicate-copy` finding (PRD 41 A9 rule 2): a folder that looks like a stray copy of a system. The
 * analysis stamps its `params` with `copy`, `original`, `similarity` and `reason`; this is the ONE reader.
 */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../../labels';

export const DUPLICATE_COPY_KIND = 'duplicate-copy';

export type CopyReason = 'no-git' | 'name-mismatch' | 'later-name';

export interface DuplicateCopy {
    id: string;
    /** The folder that looks like the stray copy, and the one it is a copy of. */
    copy: string;
    original: string;
    /** Whole percent of the sampled file hashes that match. */
    similarity: number;
    reason: CopyReason;
    /** The finding's nodes, for Show. */
    nodes: string[];
}

const REASONS: readonly CopyReason[] = ['no-git', 'name-mismatch', 'later-name'];

export const isDuplicateCopy = (f: Pick<Finding, 'kind'>): boolean => f.kind === DUPLICATE_COPY_KIND;

/** The finding read as a copy; null when it is not one or names no folders. A fraction (0.93) and a percent (93) both read as 93. */
export function duplicateCopyOf(f: Finding): DuplicateCopy | null {
    if (!isDuplicateCopy(f)) return null;
    const copy = String(f.params.copy ?? ''), original = String(f.params.original ?? '');
    if (!copy || !original) return null;
    const raw = Number(f.params.similarity);
    const similarity = Number.isFinite(raw) ? Math.round(raw <= 1 ? raw * 100 : raw) : 0;
    const reason = REASONS.find((r) => r === f.params.reason) ?? 'later-name';
    return { id: f.id, copy, original, similarity, reason, nodes: [...f.nodes] };
}

const REASON_KEY = { 'no-git': 'reasonNoGit', 'name-mismatch': 'reasonNameMismatch', 'later-name': 'reasonLaterName' } as const;

export const reasonText = (reason: CopyReason, labels: KnowledgeGraphLabels): string => labels.surface.duplicateCopy[REASON_KEY[reason]];
