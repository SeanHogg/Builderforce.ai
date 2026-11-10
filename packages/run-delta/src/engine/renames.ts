/**
 * engine/renames.ts — THE in-house rename matcher (PRD 41 §C1). It runs everywhere, git or not, so
 * the digest never depends on the git version or `diff.renameLimit`:
 *
 *   1. exact normalized-hash equality (memory `contentHash`, EOL-normalized sha256);
 *   2. otherwise token-set Jaccard ≥ {@link RENAME_MIN_JACCARD} over normalized tokens (memory `tokenize`);
 *   3. candidates are taken greedily: exact first, then by descending similarity, then ascending
 *      `from` path, then ascending `to` path.
 *
 * Similarity is compared as exact integer ratios, so no float enters an ordering.
 */

import { contentHash } from '@seanhogg/builderforce-memory/knowledge';
import { tokenize } from '@seanhogg/builderforce-memory/retrieval';
import { compareStr } from './text.js';

export const RENAME_MIN_JACCARD = 0.5;

export interface RenameSide {
    path: string;
    /** EOL-normalized sha256; computed from `text` when absent. */
    hash?: string;
    text?: string;
}

export interface RenamePair {
    from: string;
    to: string;
    /** `exact` = hash equality; `similar` = Jaccard ≥ 0.5. */
    kind: 'exact' | 'similar';
}

interface Candidate { from: string; to: string; exact: boolean; inter: number; union: number }

const encoder = new TextEncoder();

function hashOf(side: RenameSide): string | undefined {
    if (side.hash) return side.hash;
    return side.text === undefined ? undefined : contentHash(encoder.encode(side.text));
}

function tokenSet(text: string | undefined): Set<string> | undefined {
    return text === undefined ? undefined : new Set(tokenize(text));
}

/** Pairs deleted files with added files. Each path is used at most once. Output sorted by `to`. */
export function matchRenames(deleted: readonly RenameSide[], added: readonly RenameSide[]): RenamePair[] {
    const olds = [...deleted].sort((a, b) => compareStr(a.path, b.path));
    const news = [...added].sort((a, b) => compareStr(a.path, b.path));
    const oldHash = olds.map(hashOf), newHash = news.map(hashOf);
    const oldTokens = olds.map((f) => tokenSet(f.text)), newTokens = news.map((f) => tokenSet(f.text));

    const candidates: Candidate[] = [];
    for (let i = 0; i < olds.length; i++) {
        for (let j = 0; j < news.length; j++) {
            if (oldHash[i] !== undefined && oldHash[i] === newHash[j]) {
                candidates.push({ from: olds[i]!.path, to: news[j]!.path, exact: true, inter: 1, union: 1 });
                continue;
            }
            const a = oldTokens[i], b = newTokens[j];
            if (!a || !b || a.size === 0 || b.size === 0) continue;
            let inter = 0;
            for (const t of a) if (b.has(t)) inter++;
            const union = a.size + b.size - inter;
            if (inter >= RENAME_MIN_JACCARD * union) candidates.push({ from: olds[i]!.path, to: news[j]!.path, exact: false, inter, union });
        }
    }
    candidates.sort((p, q) => Number(q.exact) - Number(p.exact)
        || q.inter * p.union - p.inter * q.union
        || compareStr(p.from, q.from)
        || compareStr(p.to, q.to));

    const usedFrom = new Set<string>(), usedTo = new Set<string>();
    const out: RenamePair[] = [];
    for (const c of candidates) {
        if (usedFrom.has(c.from) || usedTo.has(c.to)) continue;
        usedFrom.add(c.from);
        usedTo.add(c.to);
        out.push({ from: c.from, to: c.to, kind: c.exact ? 'exact' : 'similar' });
    }
    return out.sort((p, q) => compareStr(p.to, q.to));
}
