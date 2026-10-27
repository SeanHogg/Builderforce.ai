/**
 * `repo_map` served from the LOCAL definition index — for a surface that keeps one warm
 * (the editor) while Builderforce Desktop, the reference-ranked map's usual backing, is
 * not running. The map is coarser (no cross-file reference graph, so files rank by what
 * they define and by the caller's `focus` / `query`), but it answers the same question —
 * the codebase's shape in one call — without a single read.
 *
 * Pure: the index is an injected `files()` port, so the Worker could share it as well.
 */

import type { RepoMapResult, RepoSemanticCapability, SemanticSearchResult } from "./capabilities.js";
import type { CodeSymbol } from "./symbols.js";

export interface IndexedFile {
  path: string;
  symbols: readonly CodeSymbol[];
}

export interface SymbolRepoMapOptions {
  maxTokens?: number;
  focus?: readonly string[];
  query?: string;
}

const DEFAULT_MAP_TOKENS = 1500;
/** Definitions printed per file. */
const SYMBOLS_PER_FILE = 8;
/** Rough chars-per-token for budgeting the rendered map. */
const CHARS_PER_TOKEN = 4;
const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[^/]+$/i;

function queryTerms(query: string | undefined): string[] {
  return (query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter((t) => t.length >= 3);
}

/** Higher ranks first. Focus dominates, then query matches, then how much a file exports. */
function scoreFile(file: IndexedFile, focus: readonly string[], terms: readonly string[]): number {
  const p = file.path.toLowerCase();
  let score = 0;
  if (focus.some((f) => {
    const dir = f.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").toLowerCase();
    return dir !== "" && (p === dir || p.startsWith(`${dir}/`));
  })) score += 1000;
  for (const t of terms) {
    if (p.includes(t)) score += 40;
    if (file.symbols.some((s) => s.name.toLowerCase().includes(t))) score += 25;
  }
  const exported = file.symbols.filter((s) => s.exported && s.kind !== "heading").length;
  score += Math.min(exported, 30) * 2 + Math.min(file.symbols.length, 30) * 0.5;
  if (TEST_FILE.test(file.path)) score -= 30;
  score -= file.path.split("/").length * 0.5;
  return score;
}

/** Render the map: files best-first, each with its top definitions as `line: kind name`. */
export function renderSymbolRepoMap(files: readonly IndexedFile[], opts: SymbolRepoMapOptions = {}): string {
  const budget = Math.max(200, opts.maxTokens ?? DEFAULT_MAP_TOKENS) * CHARS_PER_TOKEN;
  const focus = opts.focus ?? [];
  const terms = queryTerms(opts.query);
  const ranked = files
    .filter((f) => f.symbols.some((s) => s.kind !== "heading"))
    .map((f) => ({ f, score: scoreFile(f, focus, terms) }))
    .sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path));
  const out: string[] = [];
  let used = 0;
  for (const { f } of ranked) {
    const defs = f.symbols.filter((s) => s.kind !== "heading");
    const exported = defs.filter((s) => s.exported);
    const shown = (exported.length > 0 ? exported : defs).slice(0, SYMBOLS_PER_FILE);
    const block = [f.path, ...shown.map((s) => `  ${s.line}: ${s.kind} ${s.name}`)].join("\n");
    if (used + block.length + 1 > budget) break;
    out.push(block);
    used += block.length + 1;
  }
  return out.join("\n");
}

const NO_SEMANTIC_SEARCH =
  "Semantic search needs Builderforce Desktop, which is not running — use find_symbol or search_code instead.";

/**
 * A `repo.semantic` backing whose `repoMap` is the local index and whose `search` honestly
 * says it is unavailable (the surface withholds `semantic_search` in this state anyway).
 */
export function symbolIndexSemantic(files: () => Promise<readonly IndexedFile[]>): RepoSemanticCapability {
  return {
    async search(query): Promise<SemanticSearchResult> {
      return { ok: false, error: `${NO_SEMANTIC_SEARCH} (query: ${query})` };
    },
    async repoMap(opts): Promise<RepoMapResult> {
      try {
        return { ok: true, map: renderSymbolRepoMap(await files(), opts ?? {}) };
      } catch (e) {
        return { ok: false, error: `symbol index unavailable: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  };
}
