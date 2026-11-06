/**
 * Fixtures for the portable-pack tests: a small docs folder reviewed (deterministic
 * extraction, no judgement model) through the shared review runner over an in-memory
 * store, then packed with `packFromStore`.
 */

import { localSnapshotStore, type KnowledgeSnapshot, type KnowledgeStore } from '@seanhogg/builderforce-memory/knowledge';
import { InMemoryIngestManifest, type IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { packFromStore } from './packGraph.js';
import type { PortableKnowledgePack } from './portablePack.js';
import { memorySource } from './reviewRunner.fixtures.test-util.js';
import { runKnowledgeReview } from './reviewRunner.js';

export const PACK_DOCS: Record<string, string> = {
    'lease.md': '# Lease\n\nThe lease ends on 1 June.\n\n## Termination\n\nEither party may terminate the lease with 30 days written notice to the landlord.\n',
    'policy.md': '# Policy\n\nRent is paid monthly.\n\n## Deposits\n\nDeposits are returned within 14 days.\n',
    'guide/moving.md': '# Moving out\n\nReturn the keys and photograph every room.\n',
};

export const PACK_CLOCK = () => '2026-11-06T00:00:00.000Z';

export interface ReviewedDocs {
    pack: PortableKnowledgePack;
    store: KnowledgeStore;
    manifest: IngestManifest;
    extracted: KnowledgeSnapshot['extracted'];
}

/** Reviews `files` as root `rootId` (no judgement) and packs the result. */
export async function reviewedDocs(files: Record<string, string> = PACK_DOCS, rootId = 'docs'): Promise<ReviewedDocs> {
    let snapshot: string | undefined;
    const store = localSnapshotStore({ read: async () => snapshot, write: async (s) => { snapshot = s; } });
    const manifest = new InMemoryIngestManifest();
    await runKnowledgeReview({ source: memorySource(files, rootId), store, manifest });
    const extracted = (JSON.parse(snapshot ?? '{}') as Partial<KnowledgeSnapshot>).extracted ?? {};
    const pack = await packFromStore({ name: rootId, rootId, title: rootId, store, manifest, extracted, now: PACK_CLOCK });
    return { pack, store, manifest, extracted };
}
