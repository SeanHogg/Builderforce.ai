/**
 * Shared fixtures for the review runner's tests (`reviewRunner.test.ts`,
 * `reviewRunner.cleanup.test.ts`): a two-document folder, a counting judgement port and the
 * review ports over them.
 */

import { localSnapshotStore, type DirectorySource, type JudgementPort } from '@seanhogg/builderforce-memory/knowledge';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { editedManifestKey } from './fileEdits.js';
import type { KnowledgeReviewPorts } from './reviewRunner.js';

const DOCS: Record<string, string> = {
    'lease.md': '# Lease\n\nThe lease ends on 1 June.\n\n## Termination\n\nEither party may terminate with 30 days notice.\n',
    'policy.md': '# Policy\n\nRent is paid monthly.\n\n## Deposits\n\nDeposits are returned within 14 days.\n',
};

export function memorySource(files: Record<string, string>): DirectorySource {
    return {
        rootId: 'docs',
        title: 'docs',
        async *list() {
            for (const [path, text] of Object.entries(files)) yield { path, hash: `h:${path}:${text.length}`, size: text.length };
        },
        async read(path) {
            return { id: path, tenantId: 'docs', title: path, content: { kind: 'text', text: files[path] ?? '', mediaType: 'text/markdown' } };
        },
    };
}

/** A judgement port that answers every section with one claim, counting its calls. */
export function countingJudgement(): JudgementPort & { calls: number } {
    const port = {
        calls: 0,
        async judge(req: Parameters<JudgementPort['judge']>[0]) {
            port.calls += 1;
            return {
                extract: req.items.map((i) => ({ ref: i.ref, claims: [{ subject: 'lease', predicate: 'says', object: 'something', quote: i.text.slice(0, 20) }], entities: [] })),
                invalid: 0,
            };
        },
    };
    return port;
}

export function ports(judgement?: JudgementPort): KnowledgeReviewPorts {
    let snapshot: string | undefined;
    return {
        source: memorySource(DOCS),
        store: localSnapshotStore({ read: async () => snapshot, write: async (s) => { snapshot = s; } }),
        manifest: new InMemoryIngestManifest(),
        ...(judgement ? { judgement } : {}),
    };
}

/** Makes the step after memory's `done` (pruning the superseded edits) fail: the manifest throws when it is read. */
export function failPruneStep(p: KnowledgeReviewPorts): void {
    const base = p.manifest;
    p.manifest = {
        get: (key) => { if (key === editedManifestKey('docs')) throw new Error('manifest down'); return base.get(key); },
        set: (key, value) => base.set(key, value),
        delete: (key) => base.delete(key),
    };
}
