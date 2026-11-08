/**
 * The browser's local knowledge as ROWS in IndexedDB: memory's `RowPersistence` (what `localSnapshotStore(undefined, { rows })`
 * persists through), the browser's twin of the editor's SQLite file (`agent-tools` `node-knowledge/sqliteRows.ts`).
 *
 * Stores (`knowledgeDb.ts`): `scopes`, `facts`, `relations`, `extracted`, `recheck`, `manifest`, `meta`. `apply` runs in ONE readwrite
 * transaction and awaits nothing but IndexedDB requests inside it:
 *   1. read `meta.gen`; when it is not the generation this instance last saw, another tab wrote;
 *   2. write the change (every upsert is a `put`, every delete is by key: a retry with a SUPERSET of a committed change is idempotent)
 *      and drain the manifest buffer into `manifest`, so a manifest never runs ahead of the facts it describes;
 *   3. `gen + 1`; on a mismatch return every row (no extract bodies) as `reloaded`, read AFTER the change in the same transaction.
 * The manifest buffer is taken synchronously when `apply` is called and put back if the transaction fails. Loads of extract
 * bodies are their own readonly transactions and run beside an `apply`.
 */

import type { Extracted, KnowledgeSnapshot, RowChange, RowPersistence, ScopeRecord, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import type { ChunkFingerprint } from '@seanhogg/builderforce-memory/ingest';
import { ManifestBuffer, type ManifestSink } from '@builderforce/agent-tools/knowledge';
import { knowledgeDb, promisify, type KnowledgeDb, type KnowledgeDbOptions, type KnowledgeStoreName } from './knowledgeDb';

const GENERATION = 'gen';
const ROW_STORES: readonly KnowledgeStoreName[] = ['scopes', 'facts', 'relations', 'recheck', 'meta'];
const WRITE_STORES: readonly KnowledgeStoreName[] = ['scopes', 'facts', 'relations', 'extracted', 'recheck', 'manifest', 'meta'];

type Pending = ReturnType<ManifestBuffer['take']>;
type Stores = (name: KnowledgeStoreName) => IDBObjectStore;

const generationOf = async (store: Stores): Promise<number> => Number((await promisify(store('meta').get(GENERATION))) ?? 0);

/** Every row except the extract bodies (those load lazily per hash). */
async function readAll(store: Stores): Promise<KnowledgeSnapshot> {
  const [scopes, factKeys, facts, relationKeys, relations, recheck] = await Promise.all([
    promisify(store('scopes').getAll()) as Promise<ScopeRecord[]>,
    promisify(store('facts').getAllKeys()),
    promisify(store('facts').getAll()) as Promise<StoredFact[]>,
    promisify(store('relations').getAllKeys()),
    promisify(store('relations').getAll()) as Promise<StoredRelation[]>,
    promisify(store('recheck').getAllKeys()),
  ]);
  const factsByRoot: Record<string, StoredFact[]> = {};
  factKeys.forEach((key, i) => { (factsByRoot[(key as string[])[0]!] ??= []).push(facts[i]!); });
  const relationsByRoot: Record<string, StoredRelation[]> = {};
  relationKeys.forEach((key, i) => { (relationsByRoot[(key as string[])[0]!] ??= []).push(relations[i]!); });
  return {
    version: 1,
    scopes,
    facts: factsByRoot,
    relations: relationsByRoot,
    ...(recheck.length > 0 ? { recheck: recheck as string[] } : {}),
  };
}

function writeChange(store: Stores, change: RowChange): void {
  const { upserts, deletes } = change;
  for (const s of upserts.scopes) store('scopes').put(s, s.rootId);
  for (const [root, f] of upserts.facts) store('facts').put(f, [root, f.key]);
  for (const [root, r] of upserts.relations) store('relations').put(r, [root, r.from, r.to, r.kind]);
  for (const [hash, entries] of upserts.extracted) store('extracted').put(entries, hash);
  for (const hash of upserts.recheck) store('recheck').put(true, hash);
  for (const id of deletes.scopes) store('scopes').delete(id);
  for (const [root, key] of deletes.facts) store('facts').delete([root, key]);
  for (const [root, from, to, kind] of deletes.relations) store('relations').delete([root, from, to, kind]);
  for (const hash of deletes.extracted) store('extracted').delete(hash);
  for (const hash of deletes.recheck) store('recheck').delete(hash);
}

function writeManifest(store: IDBObjectStore, entries: Pending): void {
  for (const [sourceId, value] of entries) {
    if (value === null) store.delete(sourceId);
    else store.put(value, sourceId);
  }
}

export class IndexedDbKnowledgeRows implements RowPersistence, ManifestSink {
  /** The buffer the manifest and this persistence share: `apply` drains it inside its transaction. */
  readonly buffer = new ManifestBuffer();
  /** The generation this instance last saw (undefined before its first load or apply: a fresh database reads as 0). */
  private seen: number | undefined;
  /** One gate for the steps that talk about the whole store (load, apply, the changed-elsewhere check, a manifest-only commit). */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: KnowledgeDb) {}

  private serial<T>(step: () => Promise<T>): Promise<T> {
    const run = this.tail.then(step);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** IndexedDB is always writable (there is no newer-format file here). */
  assertWritable(): void { /* nothing to refuse */ }

  load(): Promise<KnowledgeSnapshot | undefined> {
    return this.serial(async () => {
      const { generation, snapshot } = await this.db.run(ROW_STORES, 'readonly', async (store) => ({
        generation: await generationOf(store),
        snapshot: await readAll(store),
      }));
      this.seen = generation;
      const empty = snapshot.scopes.length === 0 && Object.keys(snapshot.facts).length === 0 && !snapshot.recheck;
      return empty ? undefined : snapshot;
    });
  }

  apply(change: RowChange): Promise<{ generation: number; reloaded?: KnowledgeSnapshot }> {
    // Taken SYNCHRONOUSLY, before any await: exactly the entries set before this change was built.
    const taken = this.buffer.take();
    return this.serial(() => this.applyTaken(change, taken)).catch((error: unknown) => { this.buffer.restore(taken); throw error; });
  }

  private async applyTaken(change: RowChange, taken: Pending): Promise<{ generation: number; reloaded?: KnowledgeSnapshot }> {
    const { next, reloaded } = await this.db.run(WRITE_STORES, 'readwrite', async (store) => {
      const current = await generationOf(store);
      const mismatch = current !== (this.seen ?? 0);
      writeChange(store, change);
      writeManifest(store('manifest'), taken);
      const next = current + 1;
      store('meta').put(next, GENERATION);
      // After the change, in the same transaction, so `reloaded` contains it.
      return { next, reloaded: mismatch ? await readAll(store) : undefined };
    });
    // Only after the commit: a retry of a committed change then sees a mismatch and just reloads.
    this.seen = next;
    return { generation: next, ...(reloaded ? { reloaded } : {}) };
  }

  loadExtracted(hash: string): Promise<Extracted[] | undefined> {
    return this.db.run(['extracted'], 'readonly', (store) => promisify(store('extracted').get(hash)) as Promise<Extracted[] | undefined>);
  }

  loadAllExtracted(): Promise<Record<string, Extracted[]>> {
    return this.db.run(['extracted'], 'readonly', async (store) => {
      const [keys, values] = await Promise.all([promisify(store('extracted').getAllKeys()), promisify(store('extracted').getAll()) as Promise<Extracted[][]>]);
      const out: Record<string, Extracted[]> = {};
      keys.forEach((key, i) => { out[key as string] = values[i]!; });
      return out;
    });
  }

  /** True when another tab (or this one, through another instance) committed since this instance last loaded or applied. */
  changedElsewhere(): Promise<boolean> {
    return this.serial(async () => (await this.db.run(['meta'], 'readonly', generationOf)) !== (this.seen ?? 0));
  }

  async readCommitted(sourceId: string): Promise<ChunkFingerprint[] | undefined> {
    return this.db.run(['manifest'], 'readonly', (store) => promisify(store('manifest').get(sourceId)) as Promise<ChunkFingerprint[] | undefined>);
  }

  /** A manifest-only commit (no fact changed, so the generation stays). The entries are taken when this is CALLED. */
  commitBuffered(only?: readonly string[]): Promise<void> {
    const taken = this.buffer.take(only);
    if (taken.size === 0) return Promise.resolve();
    return this.serial(() => this.db.run(['manifest'], 'readwrite', async (store) => { writeManifest(store('manifest'), taken); }))
      .catch((error: unknown) => { this.buffer.restore(taken); throw error; });
  }
}

/** The rows persistence over `builderforce-knowledge` (or the shared connection `opts.db`). */
export function indexedDbKnowledgeRows(opts: KnowledgeDbOptions & { db?: KnowledgeDb } = {}): IndexedDbKnowledgeRows {
  return new IndexedDbKnowledgeRows(opts.db ?? knowledgeDb(opts));
}
