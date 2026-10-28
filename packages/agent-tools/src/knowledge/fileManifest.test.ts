import { describe, expect, it } from 'vitest';
import { filesManifestKey } from '@seanhogg/builderforce-memory/knowledge';
import { manifestFileName, migratingRootFiles, snapshotFileName, type KnowledgeFiles } from './fileManifest.js';

function memoryFiles(seed: Record<string, string> = {}): KnowledgeFiles & { store: Map<string, string> } {
    const store = new Map(Object.entries(seed));
    return { store, read: async (name) => store.get(name), write: async (name, text) => { store.set(name, text); } };
}

const OLD = 'app';
const NEW = 'vscode:github.com/acme/app';

describe('migratingRootFiles — a local graph survives the root-id change', () => {
    it('reads the old stem when the new one is absent, moves the root id, and writes the new one', async () => {
        const snapshot = {
            version: 1,
            scopes: [{ rootId: OLD, title: OLD, packs: ['code'] }],
            facts: { [OLD]: [{ key: 'note:1', content: 'app owns billing', fileAnchors: [{ path: 'src/a.ts' }] }] },
            relations: { [OLD]: [{ from: 'fact:note:1', to: `src:${OLD}::src/a.ts`, kind: 'about' }] },
            extracted: { h1: [{ sourceRef: `src:${OLD}::src/a.ts`, sourceHash: 'h1' }] },
        };
        const manifest = { [filesManifestKey(OLD)]: [{ id: 'src/a.ts', hash: 'h1' }], [`knowledge:${OLD}:analysis`]: [] };
        const disk = memoryFiles({ [snapshotFileName(OLD)]: JSON.stringify(snapshot), [manifestFileName(OLD)]: JSON.stringify(manifest) });
        const files = migratingRootFiles(disk, NEW, OLD);

        const migrated = JSON.parse((await files.read(snapshotFileName(NEW)))!);
        expect(migrated.scopes).toEqual([{ rootId: NEW, title: OLD, packs: ['code'] }]);
        expect(migrated.facts[NEW][0].content).toBe('app owns billing');
        expect(migrated.relations[NEW][0].to).toBe(`src:${NEW}::src/a.ts`);
        expect(migrated.extracted.h1[0].sourceRef).toBe(`src:${NEW}::src/a.ts`);
        expect(disk.store.get(snapshotFileName(NEW))).toBe(JSON.stringify(migrated));

        const m = JSON.parse((await files.read(manifestFileName(NEW)))!);
        expect(Object.keys(m).sort()).toEqual([filesManifestKey(NEW), `knowledge:${NEW}:analysis`].sort());
        // The old files stay where they were.
        expect(disk.store.has(snapshotFileName(OLD))).toBe(true);
    });

    it('prefers the new file once it exists, and leaves other names alone', async () => {
        const disk = memoryFiles({ [snapshotFileName(OLD)]: '{"version":1}', [snapshotFileName(NEW)]: '{"version":1,"scopes":[]}' });
        const files = migratingRootFiles(disk, NEW, OLD);
        expect(await files.read(snapshotFileName(NEW))).toBe('{"version":1,"scopes":[]}');
        expect(await files.read('other.json')).toBeUndefined();
    });

    it('is a pass-through with no legacy id, and treats a corrupt legacy file as none', async () => {
        const disk = memoryFiles({ [snapshotFileName(OLD)]: '{nope' });
        expect(migratingRootFiles(disk, NEW, undefined)).toBe(disk);
        expect(await migratingRootFiles(disk, NEW, OLD).read(snapshotFileName(NEW))).toBeUndefined();
    });
});
