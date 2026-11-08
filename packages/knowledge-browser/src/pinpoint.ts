/**
 * The browser's pinpoint adapters (PRD 38, Option B+, "Core use"). The matching is the
 * shared core (`@builderforce/agent-tools/knowledge` `matchAnchors`); the browser supplies:
 *
 *   vision        - the host's `describe(dataUrl)` (the web calls the gateway's
 *                   `/llm/v1/chat/completions` with the user's session; the gateway moves
 *                   an image request onto a vision-capable model, or answers 400
 *                   `model_input_unsupported`, which the person sees);
 *   catalog keys  - the host's `catalogKeys(text)`: the app's own i18n catalogs, in hand;
 *   search        - a literal scan of the directory a review opened this session (exact,
 *                   verified lines); without one, the server's knowledge search, whose hits
 *                   carry no line and are marked unverified (the core only trusts them when
 *                   they come from looking up a catalog KEY);
 *   graph         - the root's server-built graph.
 */

import {
  blobDataUrl, checkPinpointImage, matchAnchors, parseVisionReply, sourcePathOf, type PinpointHit, type PinpointMatchResult,
} from '@builderforce/agent-tools/knowledge';
import { isDocumentPath, type DirectorySource, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeClient } from '@builderforce/knowledge-client';

/** Files a literal scan reads at most, and the largest it reads. */
const SCAN_MAX_FILES = 3000;
const SCAN_MAX_FILE_BYTES = 400_000;
/** Text kept in memory for the scan, in total. */
const SCAN_MAX_TOTAL_CHARS = 24_000_000;
const HITS_PER_FILE = 3;
const MAX_HITS = 100;
/** Server search hits asked for per literal. */
const SERVER_HITS = 20;

/** What the host provides for vision and the app's catalogs. */
export interface PinpointHost {
  /** Reads the screenshot (a `data:image/...;base64,` URL): the description and the verbatim strings. */
  describe(imageDataUrl: string): Promise<string>;
  /** Catalog keys whose value is `text`. */
  catalogKeys?(text: string): Promise<string[]>;
}

export interface PinpointDeps {
  client: Pick<KnowledgeClient, 'search'>;
  host: PinpointHost;
  /** The directory a review opened (or a provider re-opens), when there is one. */
  directory(rootId: string): Promise<DirectorySource | null>;
  graph(rootId: string): Promise<KnowledgeGraph | null>;
}

/** The directory's text files, read once (bounded), as `path -> text`. */
async function readCorpus(dir: DirectorySource): Promise<Map<string, string>> {
  const corpus = new Map<string, string>();
  let chars = 0;
  for await (const entry of dir.list()) {
    if (corpus.size >= SCAN_MAX_FILES || chars >= SCAN_MAX_TOTAL_CHARS) break;
    if (entry.size > SCAN_MAX_FILE_BYTES) continue;
    // pdf/office files are bytes; the page source's read() would hand back raw UTF-8 of a zip. Extraction is the review's, not this scan's.
    if (isDocumentPath(entry.path)) continue;
    try {
      const doc = await dir.read(entry.path);
      if (doc.content.kind !== 'text') continue;
      corpus.set(entry.path, doc.content.text);
      chars += doc.content.text.length;
    } catch {
      // An unreadable file is simply not searched.
    }
  }
  return corpus;
}

/** Lines of the corpus that contain `literal` (case-sensitive), bounded. */
export function scanCorpus(corpus: ReadonlyMap<string, string>, literal: string): PinpointHit[] {
  const hits: PinpointHit[] = [];
  for (const [path, text] of corpus) {
    if (!text.includes(literal)) continue;
    let found = 0;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && found < HITS_PER_FILE; i++) {
      const line = lines[i]!;
      if (!line.includes(literal)) continue;
      hits.push({ path, line: i + 1, text: line.trim().slice(0, 200), verified: true });
      found += 1;
    }
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}

export async function pinpointImage(deps: PinpointDeps, image: Blob, rootId: string): Promise<PinpointMatchResult> {
  checkPinpointImage(image);
  const seen = parseVisionReply(await deps.host.describe(await blobDataUrl(image)));
  const dir = await deps.directory(rootId);
  // The PROMISE is kept, not its result: matchAnchors searches several literals concurrently, and each would otherwise start its own full read.
  let corpus: Promise<Map<string, string>> | undefined;
  return matchAnchors({
    rootId,
    ...(deps.host.catalogKeys ? { catalogKeys: deps.host.catalogKeys } : {}),
    search: async (literal) => {
      if (dir) {
        corpus ??= readCorpus(dir);
        return scanCorpus(await corpus, literal);
      }
      const hits = await deps.client.search(rootId, literal, SERVER_HITS);
      return hits.flatMap((h) => {
        const path = sourcePathOf(h.id, rootId);
        return path ? [{ path, line: 0, text: '', verified: false, tier: h.tier }] : [];
      });
    },
    graph: () => deps.graph(rootId),
  }, seen);
}
