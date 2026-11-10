/**
 * `./node-file-facts` — FileFacts v3 extraction in Node hosts (PRD 41 §B3): one tree-sitter parse (web-tree-sitter, the
 * WASM build, so it is safe in a worker thread) → memory's RAW `FileFacts` (imports and guard chains as specifiers;
 * `resolveFileFacts` resolves them against a listing), stamped with the COMPOSITE extractor tag (`factsExtractorTag`:
 * extractor version and revision, the language's grammar version, the EOL rule).
 *
 * Content identity is memory's EOL-normalized `contentHash`, and the parse reads the EOL-normalized text, so a Windows
 * `core.autocrlf` checkout and a Linux checkout give byte-identical facts. Outcomes:
 *   - no fact grammar for the path, or binary bytes → `undefined` (the file has no facts);
 *   - EOL-normalized text over {@link MAX_FACTS_PARSE_BYTES} → `cappedFileFacts` (present, empty, never comparable);
 *   - the path has a grammar that cannot load → throws `facts_grammar_unavailable` (transient: the host retries it).
 *
 * `tree-sitter-wasms` ships EVERY grammar in one package, so its version is every language's grammar version: bumping
 * it re-extracts every language (PRD 41 §B3).
 */

import { contentHash, factsExtractorTag, isBinaryBytes, type ExtractorStamp, type FileFacts } from "@seanhogg/builderforce-memory/knowledge";
import { cappedFileFacts, FILE_FACTS_LANGUAGES, fileFactsOf } from "./knowledge/facts/fileFactsOf.js";
import { parseSource, treeSitterLanguageOf, type TreeSitterExtractorOptions } from "./node-tree-sitter.js";

/**
 * The grammar package versions the facts are built from. Constants (a bundled host cannot read `package.json` at run
 * time); `node-file-facts.test.ts` holds them to the installed packages, so a dependency bump that forgets them fails.
 */
export const TREE_SITTER_WASMS_VERSION = "0.1.13";
export const WEB_TREE_SITTER_VERSION = "0.22.6";
/** This extractor's revision within memory's FACTS_EXTRACTOR_VERSION: bump when a query changes what it emits. */
export const FILE_FACTS_REVISION = 1;
/** Files whose EOL-normalized text is larger than this are not parsed for facts (capped). */
export const MAX_FACTS_PARSE_BYTES = 400_000;
/** Thrown when a path's grammar exists but cannot load: transient, never "no facts". */
export const FACTS_GRAMMAR_UNAVAILABLE = "facts_grammar_unavailable";

/** The stamp of this extractor: tree-sitter, every fact language's grammar at the bundled grammar + runtime versions. */
export function fileFactsStamp(): ExtractorStamp {
  const grammar = `${TREE_SITTER_WASMS_VERSION}+${WEB_TREE_SITTER_VERSION}`;
  return { family: "tree-sitter", revision: FILE_FACTS_REVISION, grammars: Object.fromEntries(FILE_FACTS_LANGUAGES.map((l) => [l, grammar])) };
}

export interface FileFactsOptions extends Pick<TreeSitterExtractorOptions, "wasmDir"> {
  /** The content hash of `content`, already verified by the caller (a pool read): not computed again. */
  contentHash?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Whether a path has a fact extractor (its tree-sitter language is one of {@link FILE_FACTS_LANGUAGES}). */
export const hasFileFacts = (relPath: string): boolean => FILE_FACTS_LANGUAGES.includes(treeSitterLanguageOf(relPath) ?? "");

/** The raw FileFacts of one file (root-relative POSIX `relPath`), capped facts past the cap, or undefined when it has none. */
export async function extractFileFacts(relPath: string, content: string | Uint8Array, opts: FileFactsOptions = {}): Promise<FileFacts | undefined> {
  const language = treeSitterLanguageOf(relPath);
  if (!language || !FILE_FACTS_LANGUAGES.includes(language)) return undefined;
  const bytes = typeof content === "string" ? encoder.encode(content) : content;
  if (isBinaryBytes(bytes)) return undefined;
  const hash = opts.contentHash ?? contentHash(bytes);
  const text = (typeof content === "string" ? content : decoder.decode(bytes)).replace(/\r\n?/g, "\n");
  // The cap is measured on what is parsed: the EOL-normalized text (a CRLF checkout is not "larger").
  if (encoder.encode(text).byteLength > MAX_FACTS_PARSE_BYTES) return cappedFileFacts(language, hash, FILE_FACTS_REVISION);
  const stamp = fileFactsStamp();
  const facts = await parseSource(relPath, text, (root, lang) => fileFactsOf({ language: lang, path: relPath, root, contentHash: hash, extractor: factsExtractorTag(stamp, lang) }), opts);
  if (!facts) throw new Error(FACTS_GRAMMAR_UNAVAILABLE);
  return facts;
}
