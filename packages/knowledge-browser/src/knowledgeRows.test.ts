import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { RowChange, ScopeRecord, StoredFact } from '@seanhogg/builderforce-memory/knowledge';
import { bufferedManifest } from '@builderforce/agent-tools/knowledge';
import { knowledgeDb } from './knowledgeDb';
import { indexedDbKnowledgeFiles } from './knowledgeFiles';
import { indexedDbKnowledgeRows } from './knowledgeRows';

const change = (up: Partial<RowChange['upserts']> = {}, del: Partial<RowChange['deletes']> = {}): RowChange => ({
  upserts: { scopes: [], facts: [], relations: [], extracted: [], recheck: [], ...up },
  deletes: { scopes: [], facts: [], relations: [], extracted: [], recheck: [], ...del },
});
const scope = { rootId: 'r', title: 'r', packs: ['docs'] } as unknown as ScopeRecord;
const fact = (key: string) => ({ key, content: key }) as unknown as StoredFact;

describe('IndexedDB knowledge rows', () => {
  it('round-trips an apply through load, with lazily loaded extract bodies', async () => {
    const idb = new IDBFactory();
    const rows = indexedDbKnowledgeRows({ idb });
    expect(await rows.load()).toBeUndefined();
    await rows.apply(change({ scopes: [scope], facts: [['r', fact('f1')]], extracted: [['h1', [{ sourceRef: 's' } as never]]], recheck: ['h2'] }));
    const again = indexedDbKnowledgeRows({ idb });
    const snap = await again.load();
    expect(snap?.scopes.map((s) => s.rootId)).toEqual(['r']);
    expect(snap?.facts['r']?.map((f) => f.key)).toEqual(['f1']);
    expect(snap?.recheck).toEqual(['h2']);
    expect(await again.loadExtracted('h1')).toHaveLength(1);
    expect(Object.keys(await again.loadAllExtracted())).toEqual(['h1']);
  });

  it('re-applying the same change (a retry of a committed one) is idempotent', async () => {
    const idb = new IDBFactory();
    const rows = indexedDbKnowledgeRows({ idb });
    await rows.load();
    const c = change({ scopes: [scope], facts: [['r', fact('f1')]] });
    await rows.apply(c);
    await rows.apply(c);
    await rows.apply(change({}, { facts: [['r', 'f1']] }));
    await rows.apply(change({}, { facts: [['r', 'f1']] }));
    const snap = await indexedDbKnowledgeRows({ idb }).load();
    expect(snap?.scopes).toHaveLength(1);
    expect(snap?.facts['r'] ?? []).toEqual([]);
  });

  it("returns another instance's write as `reloaded`, containing this instance's own change", async () => {
    const idb = new IDBFactory();
    const a = indexedDbKnowledgeRows({ idb });
    const b = indexedDbKnowledgeRows({ idb });
    await a.load();
    await b.load();
    await a.apply(change({ facts: [['r', fact('from-a')]] }));
    expect(await b.changedElsewhere()).toBe(true);
    const out = await b.apply(change({ facts: [['r', fact('from-b')]] }));
    expect(out.reloaded?.facts['r']?.map((f) => f.key).sort()).toEqual(['from-a', 'from-b']);
    expect(await b.changedElsewhere()).toBe(false);
    // The next apply by b sees nothing new.
    expect((await b.apply(change())).reloaded).toBeUndefined();
  });

  it('commits the manifest in the same apply as the facts, and a manifest-only entry on its own', async () => {
    const idb = new IDBFactory();
    const rows = indexedDbKnowledgeRows({ idb });
    await rows.load();
    const manifest = bufferedManifest(rows.buffer, rows);
    await manifest.set('files:r', [{ id: 'a.md', hash: 'h' }]);
    expect(await indexedDbKnowledgeRows({ idb }).readCommitted('files:r')).toEqual([{ id: 'a.md', hash: 'h' }]);

    // Buffered entry rides with the next apply.
    rows.buffer.set('files:r', [{ id: 'b.md', hash: 'h2' }]);
    await rows.apply(change({ facts: [['r', fact('f1')]] }));
    expect(await rows.readCommitted('files:r')).toEqual([{ id: 'b.md', hash: 'h2' }]);
    expect(rows.buffer.size).toBe(0);
    await manifest.delete('files:r');
    expect(await rows.readCommitted('files:r')).toBeUndefined();
  });

  it('copies a version 1 `manifests` record into the manifest store on upgrade', async () => {
    const idb = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const open = idb.open('builderforce-knowledge', 1);
      open.onupgradeneeded = () => { open.result.createObjectStore('manifests'); };
      open.onsuccess = () => {
        const tx = open.result.transaction('manifests', 'readwrite');
        tx.objectStore('manifests').put({ 'files:old': [{ id: 'x.md', hash: 'h' }] }, 'old');
        tx.oncomplete = () => { open.result.close(); resolve(); };
      };
      open.onerror = () => reject(open.error);
    });
    const rows = indexedDbKnowledgeRows({ idb });
    expect(await rows.readCommitted('files:old')).toEqual([{ id: 'x.md', hash: 'h' }]);
  });
});

describe('IndexedDB knowledge files', () => {
  it('reads, writes, renames (atomically replacing) and removes', async () => {
    const idb = new IDBFactory();
    const files = indexedDbKnowledgeFiles({ db: knowledgeDb({ idb }) });
    expect(await files.read('a')).toBeUndefined();
    await files.write('a.tmp', 'one');
    await files.write('a', 'old');
    await files.rename!('a.tmp', 'a');
    expect(await files.read('a')).toBe('one');
    expect(await files.read('a.tmp')).toBeUndefined();
    await files.remove!('a');
    expect(await files.read('a')).toBeUndefined();
    await expect(files.rename!('missing', 'b')).rejects.toThrow(/ENOENT/);
  });
});
