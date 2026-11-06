/**
 * PRD 40 "Measure", as an acceptance test: a pack created from a docs folder in one
 * workspace answers a question that only the folder's content can answer, in a CLEAN
 * workspace (no snapshot, no index, no folder, no embedder) — the right card reaches the
 * model's context and the answer cites it.
 */

import { describe, expect, it } from 'vitest';
import { packGraph } from '../packGraph.js';
import { PACK_DOCS, reviewedDocs } from '../packFixtures.test-util.js';
import { parsePack, serializePack } from '../portablePack.js';
import { knowledgeAskExecutor, KNOWLEDGE_ASK } from './knowledgeAsk.js';
import { packRetrievalPort, withPacks, type KnowledgePackEntry, type PackRegistry } from './packRetrieval.js';
import { createKnowledgeIndexRegistry } from './registry.js';
import { manualIdle } from './testkit.test-util.js';

const QUESTION = 'what does the lease say about termination';
const signal = () => new AbortController().signal;

/** A fresh host: no workspace roots, no files, no embedder — nothing but what is loaded into it. */
const cleanHost = () => createKnowledgeIndexRegistry({ workspaceRoots: () => [], rootIdOf: (r) => r, idle: manualIdle() });

describe('PRD 40 measure — a pack answers in a clean workspace', () => {
    it('create → file → load in a clean host → ask: the lease card is in context and cited', async () => {
        // 1. Workspace A: review the docs folder (deterministic extraction only) and create the pack.
        const { pack } = await reviewedDocs(PACK_DOCS, 'docs-a');
        // 2. The file moves to a clean workspace.
        const onDisk = serializePack(pack);
        const loaded = parsePack(onDisk);
        expect(serializePack(loaded)).toBe(onDisk);

        // 3. Workspace B: load it — index the pack's graph under its own root.
        const host = cleanHost();
        const graph = await packGraph(loaded);
        expect(graph).not.toBeNull();
        await host.get(loaded.rootId).upsertFromGraph(graph!);
        const entry: KnowledgePackEntry = { name: loaded.name, rootId: loaded.rootId, title: loaded.title, loadedAt: loaded.createdAt };
        const packs: PackRegistry = { list: async () => [entry] };
        const port = packRetrievalPort({ indexOf: (rootId) => host.get(rootId) });

        // 4. Ask something only the folder answers — no workspace index at all.
        const ask = knowledgeAskExecutor({ index: async () => withPacks(undefined, packs, port) });
        const out = await ask.run(QUESTION, signal());

        expect(out?.actionId).toBe(KNOWLEDGE_ASK);
        expect(out?.context).toContain('lease.md');
        expect(out?.text).toContain('lease.md');
        // The termination SECTION's own content reaches the model, not just the file's name.
        expect(out?.context).toContain('written notice');
        expect(out?.context).toContain('Termination');
        const focus = (out?.chips?.[0]?.args as { focus: string[] } | undefined)?.focus ?? [];
        // A section's ref slug is its breadcrumb path (docsExtract: `lease/termination`), not the bare heading.
        expect(focus).toContain('src:docs-a::lease.md#lease/termination');
    });

    it('the same question in a clean host WITHOUT the pack loaded answers nothing', async () => {
        const host = cleanHost();
        const port = packRetrievalPort({ indexOf: (rootId) => host.get(rootId) });
        const none: PackRegistry = { list: async () => [] };
        const ask = knowledgeAskExecutor({ index: async () => withPacks(undefined, none, port) });
        expect(await ask.run(QUESTION, signal())).toBeUndefined();
    });

    it('a loaded pack does not answer a question its content has nothing to say about', async () => {
        const { pack } = await reviewedDocs(PACK_DOCS, 'docs-a');
        const host = cleanHost();
        await host.get(pack.rootId).upsertFromGraph((await packGraph(pack))!);
        const entry: KnowledgePackEntry = { name: pack.name, rootId: pack.rootId, title: pack.title, loadedAt: pack.createdAt };
        const port = packRetrievalPort({ indexOf: (rootId) => host.get(rootId) });
        const ask = knowledgeAskExecutor({ index: async () => withPacks(undefined, { list: async () => [entry] }, port) });
        expect(await ask.run('where is the zzqx handled', signal())).toBeUndefined();
    });
});
