/**
 * packValidation — what a pack must satisfy BEFORE any row or object is written (PRD 41 A11 rule 4b, "every refusal
 * is a typed 4xx"). The codec only proves the frame is well formed; this proves the rows are rows the writer can
 * take, so a bad pack is a `422 bad_pack` and never a half-applied transaction or a 500:
 *
 *   - ids and lengths, in UTF-8 BYTES: the root (≤ 512), any key or ref (≤ 4096), a file path (≤ 1024, so a source id
 *     fits an index entry), content hashes (the hash pattern), fact keys (≤ 255 characters, already trimmed, so the leaf
 *     digest the server records is the one the client computed), kinds;
 *   - control characters: no C0 control character (or DEL) in any key, ref or id — Postgres rejects NUL in `text` and
 *     `jsonb`, and the rest only ever mean a corrupt or hostile key;
 *   - duplicates: two EXTR bodies for one hash, two files with one source id, two relations with one identity —
 *     a multi-row upsert cannot touch one row twice;
 *   - contradictions: a key both upserted and tombstoned in one pack;
 *   - provenance: a pack carries MODEL rows (human and agent rows travel by their own writers).
 */
import { factLeafKey, fileLeafKey, relationLeafKey, type Pack } from '@seanhogg/builderforce-memory/knowledge/pack';
import { KNOWLEDGE_HASH_PATTERN } from '../knowledgePerception';
import { KnowledgeSyncError } from './knowledgeSyncPorts';

const bad = (message: string): never => { throw new KnowledgeSyncError(422, 'bad_pack', message); };
const REF = /^(src|ent|fact):/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const ENCODER = new TextEncoder();
const bytesOf = (s: string): number => ENCODER.encode(s).length;

/** Root ids: the sync routes and the pack share this bound (and `normalizeRootId`). */
export const MAX_ROOT_BYTES = 512;
/** Any key or ref. */
export const MAX_KEY_BYTES = 4096;
const MAX_PATH_BYTES = 1024;
const MAX_FACT_KEY = 255;
const MAX_FACT_CONTENT = 20_000;
const MAX_KIND = 32;
const MAX_ANCHORS = 64;

/** The root id as every sync entry point reads it: trimmed (a pack route and a manifest route must agree on one root). */
export const normalizeRootId = (rootId: string): string => rootId.trim();

/** Throws unless `s` is a printable id of 1..`max` UTF-8 bytes. */
function id(what: string, s: string, max: number): void {
  if (!s) bad(`${what} is empty`);
  if (bytesOf(s) > max) bad(`${what} is over ${max} bytes`);
  if (CONTROL.test(s)) bad(`${what} holds a control character`);
}

function noDuplicates(what: string, keys: Iterable<string>): void {
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) bad(`${what}: duplicate ${JSON.stringify(k.slice(0, 80))}`);
    seen.add(k);
  }
}

/** A root id a sync entry point may act on: printable, 1..512 bytes, already trimmed. */
export function checkRootId(rootId: string): void {
  id('the root id', rootId, MAX_ROOT_BYTES);
  if (rootId !== normalizeRootId(rootId)) bad('the root id has outer whitespace');
}

export function validatePack(pack: Pack): void {
  checkRootId(pack.rootId);

  for (const f of pack.files ?? []) {
    id('a file path', f.path, MAX_PATH_BYTES);
    if (!KNOWLEDGE_HASH_PATTERN.test(f.hash)) bad(`file ${f.path}: not a content hash`);
  }
  noDuplicates('files', (pack.files ?? []).map((f) => fileLeafKey(f.path, f.hash)));

  for (const x of pack.extracted ?? []) {
    if (!KNOWLEDGE_HASH_PATTERN.test(x.hash)) bad('an extracted body names a hash that is not a content hash');
    if (x.kind === 'diff' && !KNOWLEDGE_HASH_PATTERN.test(x.prior)) bad('a diff names a prior that is not a content hash');
    for (const e of x.entries) {
      if (!REF.test(e.sourceRef)) bad('an extracted entry has a bad sourceRef');
      id('an extracted sourceRef', e.sourceRef, MAX_KEY_BYTES);
    }
  }
  noDuplicates('extracted bodies', (pack.extracted ?? []).map((x) => x.hash));

  for (const f of pack.facts ?? []) {
    if (!f.key || f.key !== f.key.trim() || f.key.length > MAX_FACT_KEY) bad(`a fact key is 1..${MAX_FACT_KEY} characters with no outer whitespace`);
    id('a fact key', f.key, MAX_KEY_BYTES);
    if (!f.content || f.content.length > MAX_FACT_CONTENT) bad(`fact ${f.key}: content is 1..${MAX_FACT_CONTENT} characters`);
    if (f.origin !== 'model') bad(`fact ${f.key}: a pack carries model rows (origin '${f.origin}' travels by its own writer)`);
    if (f.fileAnchors.length > MAX_ANCHORS) bad(`fact ${f.key}: bad anchors`);
    for (const a of f.fileAnchors) id('a fact anchor path', a.path ?? '', MAX_PATH_BYTES);
  }
  noDuplicates('facts', (pack.facts ?? []).map((f) => f.key));

  for (const r of pack.relations ?? []) {
    if (!REF.test(r.from) || !REF.test(r.to)) bad('a relation names a ref that is not a NodeRef');
    id('a relation ref', r.from, MAX_KEY_BYTES);
    id('a relation ref', r.to, MAX_KEY_BYTES);
    id('a relation kind', r.kind, MAX_KIND);
    if (r.origin !== 'model') bad('a pack carries model relations');
    if (!Number.isFinite(r.weight)) bad('a relation weight is a finite number');
  }
  noDuplicates('relations', (pack.relations ?? []).map(relationLeafKey));

  const d = pack.deletes;
  if (d) {
    for (const f of d.files) id('a file tombstone', f, MAX_PATH_BYTES + MAX_KIND);
    for (const k of d.facts) id('a fact tombstone', k, MAX_KEY_BYTES);
    for (const r of d.relations) {
      id('a relation tombstone ref', r.from, MAX_KEY_BYTES);
      id('a relation tombstone ref', r.to, MAX_KEY_BYTES);
      id('a relation tombstone kind', r.kind, MAX_KIND);
    }
  }
  // One key cannot be set and removed by the same pack: which one wins would depend on the order the server applies them.
  const gone = new Set(tombstoneKeys(pack).all);
  for (const k of leafKeysOf(pack)) if (gone.has(k)) bad(`${JSON.stringify(k.slice(0, 80))} is both upserted and tombstoned in one pack`);
}

/** The leaf keys the rows of a pack set. */
export function leafKeysOf(pack: Pack): string[] {
  return [
    ...(pack.files ?? []).map((f) => fileLeafKey(f.path, f.hash)),
    ...(pack.facts ?? []).map((f) => factLeafKey(f.key)),
    ...(pack.relations ?? []).map(relationLeafKey),
  ];
}

/** The leaf keys a pack's tombstones name: `f:<source id>`, `a:<fact key>`, `r:["<from>","<to>","<kind>"]`. */
export function tombstoneKeys(pack: Pack): { files: string[]; facts: string[]; relations: string[]; all: string[] } {
  const d = pack.deletes;
  const files = [...new Set((d?.files ?? []).map((sid) => `f:${sid}`))];
  const facts = [...new Set((d?.facts ?? []).map(factLeafKey))];
  const relations = [...new Set((d?.relations ?? []).map(relationLeafKey))];
  return { files, facts, relations, all: [...files, ...facts, ...relations] };
}
