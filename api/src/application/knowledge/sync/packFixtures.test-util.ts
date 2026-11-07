/** Packs for the apply tests: a root's files, facts and relations, and the digest a client would assert for them. */
import { rootDigestOf, type Pack, type PackFileRow } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { Extracted, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';

export const ROOT = 'ws:test';
/** Padded with '0' (not a hex digit that can also lead a value): 0xa and 0xaa must not collide. */
export const hashOf = (i: number): string => i.toString(16).padStart(64, '0');
export const refOf = (root: string, p: string): `src:${string}` => `src:${root}::${p}`;

export const extraction = (root: string, path: string, hash: string, symbols = 3): Extracted => ({
  sourceRef: refOf(root, path), sourceHash: hash,
  nodes: [{ ref: refOf(root, path), kind: 'file', label: path, pack: 'code', importance: 0.5, origin: 'extracted', sourceHash: hash },
    ...Array.from({ length: symbols }, (_, s) => ({ ref: refOf(root, `${path}#s${s}`), kind: 'symbol', label: `s${s}`, pack: 'code', importance: 0.1, origin: 'extracted' as const, sourceHash: hash }))],
  edges: [], keys: [],
});

export interface Rows { files: PackFileRow[]; facts: StoredFact[]; relations: StoredRelation[] }

/** A model fact anchored to a file, as a client's review writes it. */
export const factOf = (key: string, path: string, content = `fact ${key}`): StoredFact =>
  ({ key, content, source: 'review', importance: 0.5, origin: 'model', fileAnchors: [{ path, contentHash: 'c' }] });

/** `n` files, `facts` facts anchored to the first files, and one relation: the whole local state of a root. */
export function rowsFor(n: number, facts = 2, root = ROOT): Rows {
  const files: PackFileRow[] = Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.ts`, hash: hashOf(i + 1), bytes: 100 + i }));
  const fs = Array.from({ length: facts }, (_, i) => factOf(`claim:${i}`, files[i % Math.max(1, n)]!.path));
  const relations: StoredRelation[] = n > 0 && facts > 0
    ? [{ from: refOf(root, files[0]!.path), to: 'fact:claim:0', kind: 'about', weight: 1, origin: 'model', sourceHash: files[0]!.hash }]
    : [];
  return { files, facts: fs, relations };
}

/** A pack that sets exactly `rows` (full bodies), asserting the digest of `state` (default: `rows`). */
export function packOf(rows: Rows, o: { root?: string; generation?: number; state?: Rows } = {}): Pack {
  const root = o.root ?? ROOT;
  const state = o.state ?? rows;
  return {
    rootId: root, baseGeneration: o.generation ?? 0, files: rows.files, facts: rows.facts, relations: rows.relations,
    extracted: rows.files.map((f) => ({ kind: 'full' as const, hash: f.hash, entries: [extraction(root, f.path, f.hash)] })),
    targetDigest: rootDigestOf(root, state),
  };
}
