import { describe, expect, it, vi } from 'vitest';
import {
    filesManifestKey, localSnapshotStore, sha256Hex, type DirectorySource, type JudgementPort, type KnowledgeGraph,
} from '@seanhogg/builderforce-memory/knowledge';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { editedManifestKey, knownKeysCache, markFileEdited, markFilesEdited, pruneEditedFiles, watchFileEdits, type FileEditPorts } from './fileEdits.js';
import { forgetRootPorts, rootPorts } from './rootPorts.js';
import { buildStoredGraph, reviewPacks, runKnowledgeReview, type KnowledgeReviewPorts } from './reviewRunner.js';

const ROOT_PATH = '/work/docs';
const DOCS: Record<string, string> = {
    'lease.md': '# Lease\n\nThe lease ends on 1 June.\n\n## Termination\n\nEither party may terminate with 30 days notice.\n',
    'policy.md': '# Policy\n\nRent is paid monthly.\n\n## Deposits\n\nDeposits are returned within 14 days.\n',
};

function memorySource(files: Record<string, string>): DirectorySource & { fire(paths: string[]): void } {
    let listener: ((paths: string[]) => void) | undefined;
    return {
        rootId: 'docs',
        title: 'docs',
        async *list() {
            for (const [path, text] of Object.entries(files)) yield { path, hash: `h:${path}:${text.length}`, size: text.length };
        },
        async read(path) {
            return { id: path, tenantId: 'docs', title: path, content: { kind: 'text', text: files[path] ?? '', mediaType: 'text/markdown' } };
        },
        watch(cb) { listener = cb; return () => { listener = undefined; }; },
        fire: (paths) => listener?.(paths),
    };
}

/** One claim per section, quoted from the section. */
const judge: JudgementPort = {
    async judge(req) {
        return {
            extract: req.items.map((i) => ({ ref: i.ref, claims: [{ subject: 'lease', predicate: 'says', object: i.text.slice(0, 12), quote: i.text.slice(0, 20) }], entities: [] })),
            invalid: 0,
        };
    },
};

async function reviewed(files: Record<string, string>) {
    let snapshot: string | undefined;
    const source = memorySource(files);
    const ports: KnowledgeReviewPorts = {
        source,
        store: localSnapshotStore({ read: async () => snapshot, write: async (s) => { snapshot = s; } }),
        manifest: new InMemoryIngestManifest(),
        judgement: judge,
    };
    await runKnowledgeReview(ports);
    // The disk the files are read from, as bytes — what the real sources hash.
    const disk: Record<string, string> = { ...files };
    const edit: FileEditPorts = {
        rootId: 'docs', rootPath: ROOT_PATH, store: ports.store, manifest: ports.manifest, packs: reviewPacks({}),
        fs: {
            readFile: async (abs) => {
                const text = disk[abs.slice(ROOT_PATH.length + 1)];
                if (text === undefined) throw new Error('gone');
                return new TextEncoder().encode(text);
            },
        },
    };
    const graph = (): Promise<KnowledgeGraph | null> => buildStoredGraph({ rootId: 'docs', store: ports.store, manifest: ports.manifest, packs: reviewPacks({}) });
    return { ports, source, disk, edit, graph };
}

describe('editing a reviewed document marks its claims stale (§5.2)', () => {
    it('reviews into file, section and claim nodes, none stale', async () => {
        const { graph } = await reviewed(DOCS);
        const g = (await graph())!;
        const kinds = new Set(g.nodes.map((n) => n.kind));
        expect([...kinds]).toEqual(expect.arrayContaining(['file', 'section', 'claim']));
        expect(g.nodes.some((n) => n.stale)).toBe(false);
    });

    it('marks the edited file\'s model knowledge stale at the new hash, and only that file\'s', async () => {
        const { edit, disk, graph } = await reviewed(DOCS);
        const before = (await graph())!.nodes.filter((n) => n.kind === 'claim').length;
        disk['lease.md'] = `${DOCS['lease.md']}\nThe lease now ends on 1 July.\n`;
        expect(await markFileEdited(edit, 'lease.md')).toEqual({ path: 'lease.md', reviewed: true, staled: true });

        const g = (await graph())!;
        const claims = g.nodes.filter((n) => n.kind === 'claim');
        expect(claims).toHaveLength(before);
        const stale = claims.filter((n) => n.stale);
        expect(stale.length).toBeGreaterThan(0);
        // The other document's claims are untouched.
        expect(stale.length).toBeLessThan(claims.length);
        expect(g.nodes.filter((n) => n.stale).every((n) => n.kind === 'claim')).toBe(true);
        expect(g.stats.stale).toBeGreaterThan(0);
        // The graph is built with the file's NEW hash.
        expect(g.nodes.find((n) => n.ref === 'src:docs::lease.md')?.sourceHash).toBe(sha256Hex(new TextEncoder().encode(disk['lease.md']!)));
    });

    it('is idempotent for unchanged bytes, leaves unreviewed files alone and keeps the review manifest', async () => {
        const { edit, disk, ports } = await reviewed(DOCS);
        disk['lease.md'] = `${DOCS['lease.md']}more\n`;
        expect((await markFileEdited(edit, 'lease.md')).staled).toBe(true);
        expect((await markFileEdited(edit, 'lease.md')).staled).toBe(false);
        expect(await markFileEdited(edit, 'brand-new.md')).toEqual({ path: 'brand-new.md', reviewed: false, staled: false });
        // A later review still sees the file as changed from its own manifest, so it is judged again.
        expect((await ports.manifest.get(filesManifestKey('docs')))?.find((f) => f.id === 'lease.md')?.hash).toBe(`h:lease.md:${DOCS['lease.md']!.length}`);
        expect((await ports.manifest.get(editedManifestKey('docs')))?.map((f) => f.id)).toEqual(['lease.md']);
    });

    it('a deleted file drops out of the graph\'s sources and its claims go stale', async () => {
        const { edit, disk, graph } = await reviewed(DOCS);
        delete disk['policy.md'];
        expect((await markFileEdited(edit, 'policy.md')).staled).toBe(true);
        const g = (await graph())!;
        expect(g.nodes.some((n) => n.ref === 'src:docs::policy.md')).toBe(false);
        expect(g.nodes.some((n) => n.kind === 'claim' && n.stale)).toBe(true);
    });

    it('watchFileEdits applies it to every change the source reports and tells the host', async () => {
        const { edit, disk, source, graph } = await reviewed(DOCS);
        const told: string[][] = [];
        const stop = watchFileEdits({ ...edit, source, debounceMs: 5, onEdited: (paths) => told.push(paths) });
        expect(stop).toBeTypeOf('function');
        disk['lease.md'] = `${DOCS['lease.md']}edited\n`;
        source.fire(['lease.md', 'README.txt']);
        await new Promise((r) => setTimeout(r, 40));
        expect(told).toEqual([['lease.md', 'README.txt']]);
        expect((await graph())!.nodes.some((n) => n.stale)).toBe(true);
        stop!();
    });
});

describe('edits are batched, and survive a throwing host', () => {
    it('settles a burst into one batch: one read of the known keys, one told batch', async () => {
        const { edit, disk, source } = await reviewed({ ...DOCS });
        const facts = vi.spyOn(edit.store, 'facts');
        const told: string[][] = [];
        const stop = watchFileEdits({ ...edit, source, debounceMs: 20, onEdited: (paths) => told.push(paths) });
        disk['lease.md'] = `${DOCS['lease.md']}one\n`;
        disk['policy.md'] = `${DOCS['policy.md']}two\n`;
        source.fire(['lease.md']);
        source.fire(['policy.md', 'lease.md']);
        await new Promise((r) => setTimeout(r, 80));
        expect(told).toEqual([['lease.md', 'policy.md']]);
        expect(facts).toHaveBeenCalledTimes(1);
        stop!();
    });

    it('a handler that throws never stops the later batches', async () => {
        const { edit, disk, source, graph } = await reviewed({ ...DOCS });
        const errors: unknown[] = [];
        let calls = 0;
        const stop = watchFileEdits({
            ...edit, source, debounceMs: 5,
            onEdited: () => { calls += 1; throw new Error('host broke'); },
            onError: (e) => { errors.push(e); throw new Error('and so did its error handler'); },
        });
        disk['lease.md'] = `${DOCS['lease.md']}one\n`;
        source.fire(['lease.md']);
        await new Promise((r) => setTimeout(r, 40));
        disk['policy.md'] = `${DOCS['policy.md']}two\n`;
        source.fire(['policy.md']);
        await new Promise((r) => setTimeout(r, 40));
        expect(calls).toBe(2);
        expect(errors).toHaveLength(2);
        expect((await graph())!.nodes.filter((n) => n.stale).length).toBeGreaterThan(0);
        stop!();
    });

    it('holds the known entity keys across saves, and reads them again only when the host drops them', async () => {
        const { edit, disk, source } = await reviewed({ ...DOCS });
        const facts = vi.spyOn(edit.store, 'facts');
        const keys = knownKeysCache(edit.store, 'docs');
        const told: string[][] = [];
        const stop = watchFileEdits({ ...edit, source, debounceMs: 5, knownKeys: keys, onEdited: (paths) => told.push(paths) });
        for (const text of ['one', 'two', 'three']) {
            disk['lease.md'] = `${DOCS['lease.md']}${text}\n`;
            source.fire(['lease.md']);
            await new Promise((r) => setTimeout(r, 30));
        }
        expect(told).toHaveLength(3);
        expect(facts).toHaveBeenCalledTimes(1);
        keys.invalidate();
        disk['lease.md'] = `${DOCS['lease.md']}four\n`;
        source.fire(['lease.md']);
        await new Promise((r) => setTimeout(r, 30));
        expect(facts).toHaveBeenCalledTimes(2);
        stop!();
    });

    it('stopping the watcher drops what has not settled', async () => {
        const { edit, disk, source } = await reviewed({ ...DOCS });
        const told: string[][] = [];
        const stop = watchFileEdits({ ...edit, source, debounceMs: 20, onEdited: (paths) => told.push(paths) });
        disk['lease.md'] = 'changed';
        source.fire(['lease.md']);
        stop!();
        await new Promise((r) => setTimeout(r, 60));
        expect(told).toEqual([]);
    });
});

describe('an edit is only as good as the review it was made on', () => {
    it('stops hiding anything once a review has judged the file again, and is pruned', async () => {
        const files = { ...DOCS };
        const { ports, edit, disk, graph } = await reviewed(files);
        disk['lease.md'] = `${DOCS['lease.md']}\nThe lease now ends on 1 July.\n`;
        files['lease.md'] = disk['lease.md']!;
        await markFileEdited(edit, 'lease.md');
        expect((await graph())!.nodes.some((n) => n.stale)).toBe(true);

        await runKnowledgeReview(ports);
        expect(await ports.manifest.get(editedManifestKey('docs'))).toEqual([]);
        const g = (await graph())!;
        expect(g.nodes.some((n) => n.stale)).toBe(false);
        expect(g.nodes.find((n) => n.ref === 'src:docs::lease.md')?.sourceHash).toBe(`h:lease.md:${files['lease.md']!.length}`);
    });

    it("keeps the edit while the review has not reached the file (its base is still the review's)", async () => {
        const { ports, edit, disk, graph } = await reviewed({ ...DOCS });
        disk['lease.md'] = `${DOCS['lease.md']}more\n`;
        await markFileEdited(edit, 'lease.md');
        await pruneEditedFiles(ports.manifest, 'docs');
        expect((await ports.manifest.get(editedManifestKey('docs')))?.map((f) => f.id)).toEqual(['lease.md']);
        expect((await graph())!.nodes.some((n) => n.stale)).toBe(true);
    });

    it('a deleted file that is created again is not hidden by its old deletion', async () => {
        const files = { ...DOCS };
        const { ports, edit, disk, graph } = await reviewed(files);
        delete disk['policy.md'];
        delete files['policy.md'];
        await markFileEdited(edit, 'policy.md');
        expect((await graph())!.nodes.some((n) => n.ref === 'src:docs::policy.md')).toBe(false);

        await runKnowledgeReview(ports); // retires the file
        files['policy.md'] = DOCS['policy.md']!;
        disk['policy.md'] = DOCS['policy.md']!;
        await runKnowledgeReview(ports); // and it is back
        expect((await graph())!.nodes.some((n) => n.ref === 'src:docs::policy.md')).toBe(true);
    });

    it('an entry from before bases were recorded is spent, never trusted', async () => {
        const { ports, graph } = await reviewed({ ...DOCS });
        await ports.manifest.set(editedManifestKey('docs'), [{ id: 'lease.md', hash: 'deadbeef' }]);
        expect((await graph())!.nodes.find((n) => n.ref === 'src:docs::lease.md')?.sourceHash).toBe(`h:lease.md:${DOCS['lease.md']!.length}`);
    });

    it('re-extracts code from its NEW content, not from definitions known before the edit', async () => {
        const root = 'code';
        let snapshot: string | undefined;
        const store = localSnapshotStore({ read: async () => snapshot, write: async (s) => { snapshot = s; } });
        const manifest = new InMemoryIngestManifest();
        const disk: Record<string, string> = { 'a.ts': 'export function one() {}\n' };
        const source: DirectorySource = {
            rootId: root, title: root,
            async *list() { for (const [path, text] of Object.entries(disk)) yield { path, hash: `h:${text.length}`, size: text.length }; },
            async read(path) { return { id: path, tenantId: root, title: path, content: { kind: 'text', text: disk[path] ?? '', mediaType: 'text/typescript' } }; },
        };
        await runKnowledgeReview({ source, store, manifest });
        disk['a.ts'] = 'export function one() {}\nexport function two() {}\nexport function three() {}\n';
        const result = await markFilesEdited({
            rootId: root, rootPath: '/w', store, manifest, packs: reviewPacks({}),
            fs: { readFile: async (abs) => new TextEncoder().encode(disk[abs.slice('/w/'.length)] ?? '') },
        }, ['a.ts']);
        expect(result).toEqual([{ path: 'a.ts', reviewed: true, staled: true }]);
        const hash = sha256Hex(new TextEncoder().encode(disk['a.ts']!));
        const extracted = (await store.getExtracted?.(hash))?.find((e) => e.sourceRef === 'src:code::a.ts');
        expect(extracted?.nodes[0]?.badges?.['exports']).toBe(3);
    });
});

describe('one store and manifest per root (the watcher never writes back a pre-review snapshot)', () => {
    const emptyStore = () => localSnapshotStore({ read: async () => undefined, write: async () => undefined });

    it('hands every user of a root the same pair', () => {
        forgetRootPorts();
        const open = { store: vi.fn(emptyStore), manifest: vi.fn(() => new InMemoryIngestManifest()) };
        const a = rootPorts('r', open);
        const again = rootPorts('r', open);
        expect(again.store).toBe(a.store);
        expect(again.manifest).toBe(a.manifest);
        expect(open.store).toHaveBeenCalledTimes(1);
        expect(open.manifest).toHaveBeenCalledTimes(1);
        expect(rootPorts('other', open).store).not.toBe(a.store);
        forgetRootPorts('r');
        expect(rootPorts('r', open).store).not.toBe(a.store);
    });

    it('an unlinked watcher and a linked review share ONE manifest record, and each project its own store', () => {
        forgetRootPorts();
        const open = { store: emptyStore, manifest: vi.fn(() => new InMemoryIngestManifest()) };
        const watcher = rootPorts('r', open, { variant: 'local', location: '/ws' });
        const review = rootPorts('r', open, { variant: 'project-7', location: '/ws' });
        expect(review.manifest).toBe(watcher.manifest);
        expect(open.manifest).toHaveBeenCalledTimes(1);
        expect(review.store).not.toBe(watcher.store);
        // The same root id in another folder is another manifest file.
        expect(rootPorts('r', open, { location: '/elsewhere' }).manifest).not.toBe(watcher.manifest);
    });

    it("a watcher edit after a review through another handle keeps the review's results", async () => {
        forgetRootPorts();
        let snapshot: string | undefined;
        const open = {
            store: () => localSnapshotStore({ read: async () => snapshot, write: async (s) => { snapshot = s; } }),
            manifest: () => new InMemoryIngestManifest(),
        };
        // The watcher opened its handle BEFORE the review, and read the (empty) snapshot.
        const watcher = rootPorts('docs', open);
        await watcher.store.facts({ rootId: 'docs' });

        const files = { ...DOCS };
        const reviewHandle = rootPorts('docs', open);
        await runKnowledgeReview({ source: memorySource(files), store: reviewHandle.store, manifest: reviewHandle.manifest, judgement: judge });
        const claims = async () => (await watcher.store.facts({ rootId: 'docs' })).length;
        const reviewedClaims = await claims();
        expect(reviewedClaims).toBeGreaterThan(0);

        const disk: Record<string, string> = { ...files, 'lease.md': `${files['lease.md']}edited\n` };
        await markFileEdited({
            rootId: 'docs', rootPath: ROOT_PATH, store: watcher.store, manifest: watcher.manifest, packs: reviewPacks({}),
            fs: { readFile: async (abs) => new TextEncoder().encode(disk[abs.slice(ROOT_PATH.length + 1)] ?? '') },
        }, 'lease.md');
        expect(await claims()).toBe(reviewedClaims);
        // And what is on disk agrees: a fresh store over the same persistence sees the review's claims.
        const fresh = localSnapshotStore({ read: async () => snapshot, write: async (s) => { snapshot = s; } });
        expect((await fresh.facts({ rootId: 'docs' })).length).toBe(reviewedClaims);
    });
});
