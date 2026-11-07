/**
 * packValidation — what a pack must satisfy BEFORE any row or object is written (PRD 41 A11 rule 4b, "every refusal
 * is a typed 4xx"). The codec only proves the frame is well formed; this proves the rows are rows the writer can
 * take, so a bad pack is a `422 bad_pack` and never a half-applied transaction or a 500:
 *
 *   - ids and lengths: the root (≤ 512), content hashes (the hash pattern, ≤ 160), paths, fact keys (≤ 255, already
 *     trimmed, so the leaf digest the server records is the one the client computed), refs, kinds;
 *   - duplicates: two EXTR bodies for one hash, two files with one source id, two relations with one identity —
 *     a multi-row upsert cannot touch one row twice;
 *   - provenance: a pack carries MODEL rows (human and agent rows travel by their own writers).
 */
import { fileLeafKey, relationLeafKey, type Pack } from '@seanhogg/builderforce-memory/knowledge/pack';
import { KNOWLEDGE_HASH_PATTERN } from '../knowledgePerception';
import { KnowledgeSyncError } from './knowledgeSyncPorts';

const bad = (message: string): never => { throw new KnowledgeSyncError(422, 'bad_pack', message); };
const REF = /^(src|ent|fact):/;

export const MAX_ROOT_ID = 512;
const MAX_PATH = 1024;
const MAX_FACT_KEY = 255;
const MAX_FACT_CONTENT = 20_000;
const MAX_REF = 4096;
const MAX_KIND = 32;
const MAX_ANCHORS = 64;

function noDuplicates(what: string, keys: Iterable<string>): void {
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) bad(`${what}: duplicate ${JSON.stringify(k.slice(0, 80))}`);
    seen.add(k);
  }
}

export function validatePack(pack: Pack): void {
  if (!pack.rootId || pack.rootId.length > MAX_ROOT_ID) bad(`the root id is 1..${MAX_ROOT_ID} characters`);

  for (const f of pack.files ?? []) {
    if (!f.path || f.path.length > MAX_PATH) bad(`a file path is 1..${MAX_PATH} characters`);
    if (!KNOWLEDGE_HASH_PATTERN.test(f.hash)) bad(`file ${f.path}: not a content hash`);
  }
  noDuplicates('files', (pack.files ?? []).map((f) => fileLeafKey(f.path, f.hash)));

  for (const x of pack.extracted ?? []) {
    if (!KNOWLEDGE_HASH_PATTERN.test(x.hash)) bad('an extracted body names a hash that is not a content hash');
    if (x.kind === 'diff' && !KNOWLEDGE_HASH_PATTERN.test(x.prior)) bad('a diff names a prior that is not a content hash');
    for (const e of x.entries) {
      if (!REF.test(e.sourceRef) || e.sourceRef.length > MAX_REF) bad('an extracted entry has a bad sourceRef');
    }
  }
  noDuplicates('extracted bodies', (pack.extracted ?? []).map((x) => x.hash));

  for (const f of pack.facts ?? []) {
    if (!f.key || f.key !== f.key.trim() || f.key.length > MAX_FACT_KEY) bad(`a fact key is 1..${MAX_FACT_KEY} characters with no outer whitespace`);
    if (!f.content || f.content.length > MAX_FACT_CONTENT) bad(`fact ${f.key}: content is 1..${MAX_FACT_CONTENT} characters`);
    if (f.origin !== 'model') bad(`fact ${f.key}: a pack carries model rows (origin '${f.origin}' travels by its own writer)`);
    if (f.fileAnchors.length > MAX_ANCHORS || f.fileAnchors.some((a) => !a.path || a.path.length > MAX_PATH)) bad(`fact ${f.key}: bad anchors`);
  }
  noDuplicates('facts', (pack.facts ?? []).map((f) => f.key));

  for (const r of pack.relations ?? []) {
    if (!REF.test(r.from) || !REF.test(r.to) || r.from.length > MAX_REF || r.to.length > MAX_REF) bad('a relation names a ref that is not a NodeRef');
    if (!r.kind || r.kind.length > MAX_KIND) bad(`a relation kind is 1..${MAX_KIND} characters`);
    if (r.origin !== 'model') bad('a pack carries model relations');
    if (!Number.isFinite(r.weight)) bad('a relation weight is a finite number');
  }
  noDuplicates('relations', (pack.relations ?? []).map(relationLeafKey));

  const d = pack.deletes;
  if (d) {
    for (const id of d.files) if (!id || id.length > MAX_PATH + MAX_KIND) bad('a file tombstone is a source id');
    for (const k of d.facts) if (!k || k.length > MAX_FACT_KEY) bad('a fact tombstone is a fact key');
    for (const r of d.relations) if (!r.from || !r.to || !r.kind || r.kind.length > MAX_KIND) bad('a relation tombstone names from, to and kind');
  }
}

/** The leaf keys a pack's tombstones name: `f:<source id>`, `a:<fact key>`, `r:<from>␀<to>␀<kind>`. */
export function tombstoneKeys(pack: Pack): { files: string[]; facts: string[]; relations: string[]; all: string[] } {
  const d = pack.deletes;
  const files = [...new Set((d?.files ?? []).map((id) => `f:${id}`))];
  const facts = [...new Set((d?.facts ?? []).map((k) => `a:${k}`))];
  const relations = [...new Set((d?.relations ?? []).map(relationLeafKey))];
  return { files, facts, relations, all: [...files, ...facts, ...relations] };
}
