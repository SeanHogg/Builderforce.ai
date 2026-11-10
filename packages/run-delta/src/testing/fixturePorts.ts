/**
 * testing/fixturePorts.ts — in-memory {@link DeltaPorts} over two file maps, for the engine's fixture
 * tests. Not exported from the package.
 */

import { contentHash } from '@seanhogg/builderforce-memory/knowledge';
import type { ChangedFileInput, DeltaPorts, RunChangeSetInput, SideFacts, SideText, UnresolvedFile } from '../contract.js';

export type Files = Record<string, string | undefined>;

export interface FixtureOptions {
    beforeFacts?: Partial<SideFacts>;
    afterFacts?: Partial<SideFacts>;
    attribution?: Record<string, ChangedFileInput['attribution']>;
    unresolved?: Record<string, UnresolvedFile['reason']>;
    churn?: Record<string, number>;
    pastScores?: number[];
    mode?: RunChangeSetInput['mode'];
    headSwitched?: boolean;
}

const encoder = new TextEncoder();
const hash = (text: string) => contentHash(encoder.encode(text));

export function facts(partial: Partial<SideFacts> = {}): SideFacts {
    return {
        manifestGeneration: 'g1', merkleRoot: 'm1', findings: [], imports: new Map(), badges: new Map(), meta: {},
        ...partial,
    };
}

export function fixture(before: Files, after: Files, opts: FixtureOptions = {}): { input: RunChangeSetInput; ports: DeltaPorts } {
    const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    const files: ChangedFileInput[] = paths
        .filter((p) => before[p] !== after[p])
        .map((p) => ({
            path: p,
            ...(before[p] !== undefined ? { beforeHash: hash(before[p]!) } : {}),
            ...(after[p] !== undefined ? { afterHash: hash(after[p]!) } : {}),
            attribution: opts.attribution?.[p] ?? (before[p] === undefined ? 'run-authored' : 'run-modified-existing'),
            status: before[p] === undefined ? 'added' : after[p] === undefined ? 'deleted' : 'modified',
        }));
    const side = (map: Files, which: 'before' | 'after') => async (_s: 'before' | 'after', ps: readonly string[]) => {
        const out = new Map<string, SideText | UnresolvedFile>();
        for (const p of ps) {
            const reason = which === 'before' ? opts.unresolved?.[p] : undefined;
            if (reason) out.set(p, { path: p, reason });
            else if (map[p] !== undefined) out.set(p, { path: p, hash: hash(map[p]!), text: map[p]! });
        }
        return out;
    };
    const ports: DeltaPorts = {
        texts: (s, ps) => (s === 'before' ? side(before, 'before') : side(after, 'after'))(s, ps),
        facts: async (s) => facts(s === 'before' ? opts.beforeFacts : opts.afterFacts),
        churn: async () => new Map(Object.entries(opts.churn ?? {})),
        pastScores: async () => opts.pastScores ?? [],
    };
    return {
        input: { runId: 'run-1', mode: opts.mode ?? 'interactive', files, ...(opts.headSwitched ? { headSwitched: true } : {}) },
        ports,
    };
}
