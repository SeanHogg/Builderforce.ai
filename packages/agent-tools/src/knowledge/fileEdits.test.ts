import { describe, expect, it } from 'vitest';
import {
    localSnapshotStore, sha256Hex, type DirectorySource, type JudgementPort, type KnowledgeGraph,
} from '@seanhogg/builderforce-memory/knowledge';
import { InMemoryIngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { editedManifestKey, markFileEdited, watchFileEdits, type FileEditPorts } from './fileEdits.js';
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
        expect((await ports.manifest.get('knowledge:docs:files'))?.find((f) => f.id === 'lease.md')?.hash).toBe(`h:lease.md:${DOCS['lease.md']!.length}`);
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
        const stop = watchFileEdits({ ...edit, source, onEdited: (paths) => told.push(paths) });
        expect(stop).toBeTypeOf('function');
        disk['lease.md'] = `${DOCS['lease.md']}edited\n`;
        source.fire(['lease.md', 'README.txt']);
        await new Promise((r) => setTimeout(r, 20));
        expect(told).toEqual([['lease.md', 'README.txt']]);
        expect((await graph())!.nodes.some((n) => n.stale)).toBe(true);
        stop!();
    });
});
