/**
 * Semantic codebase search — MCP tool with TF-IDF ranking + symbol extraction.
 *
 * Complements the existing `codebase_search` (keyword grep) tool by building a
 * local index of all exported symbols (functions, classes, types, interfaces,
 * variables) extracted from source files.  The index is cached on disk and
 * rebuilt automatically when source files change.
 *
 * Query flow:
 *   1. Tokenise + stop-word-filter the query.
 *   2. Look up each token against the symbol index (exact + prefix matches).
 *   3. BM25-score every candidate file.
 *   4. Re-rank by: symbol match bonus + path bonus + recency bonus.
 *   5. Return top-K results with representative snippets.
 *
 * The index is stored at <projectRoot>/.builderforce/search-index.json.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDEX_VERSION = 2;
const MAX_INDEX_FILES = 5_000;
const MAX_RESULTS = 20;
const CONTEXT_LINES = 5;
const INDEX_STALENESS_MS = 5 * 60 * 1_000; // 5 min

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  "__pycache__",
  ".venv",
  "vendor",
]);

const SOURCE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "rb",
  "php",
  "cs",
  "cpp",
  "c",
  "h",
  "vue",
  "svelte",
]);

/** BM25 tuning constants */
const BM25_K1 = 1.5;
const BM25_B = 0.75;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
  /** File path relative to projectRoot */
  relPath: string;
  /** All unique lower-cased tokens extracted from file (symbols + significant words) */
  tokens: string[];
  /** Exported symbol names */
  symbols: string[];
  /** Last-modified time (ms since epoch) */
  mtime: number;
  /** Total token count (for BM25 document length) */
  tokenCount: number;
}

interface SearchIndex {
  version: number;
  projectRoot: string;
  builtAt: number;
  files: FileEntry[];
  /** Inverted index: token → array of file indices */
  invertedIndex: Record<string, number[]>;
  /** Document frequency per token (how many files contain it) */
  docFreq: Record<string, number>;
  avgDocLength: number;
}

// ---------------------------------------------------------------------------
// Symbol extraction helpers
// ---------------------------------------------------------------------------

/** Regex patterns for extracting named symbols from common languages. */
const SYMBOL_PATTERNS: RegExp[] = [
  // TypeScript / JavaScript exports
  /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
  // TypeScript / JavaScript non-export declarations
  /(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
  /(?:^|\s)class\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
  /(?:^|\s)(?:type|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
  // Python
  /^def\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  /^class\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  // Go
  /^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)/gm,
  /^type\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  // Rust
  /^(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  /^(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  /^(?:pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  // Java / Kotlin
  /(?:public|private|protected|static)?\s+(?:class|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
];

/** Extract symbol names from source text. */
function extractSymbols(text: string): string[] {
  const symbols = new Set<string>();
  for (const pattern of SYMBOL_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const sym = m[1];
      if (sym && sym.length >= 2) {
        symbols.add(sym);
      }
    }
  }
  return Array.from(symbols);
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "and",
  "or",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "with",
  "by",
  "from",
  "how",
  "what",
  "where",
  "when",
  "which",
  "who",
  "all",
  "any",
  "each",
  "find",
  "get",
  "show",
  "list",
  "related",
  "about",
  "code",
  "file",
  "files",
  "new",
  "return",
  "const",
  "let",
  "var",
  "function",
  "class",
  "type",
  "interface",
  "import",
  "export",
  "null",
  "undefined",
  "true",
  "false",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
]);

/** Tokenise a string into significant lowercase tokens. */
function tokenise(text: string): string[] {
  return (
    text
      // split camelCase/PascalCase into words
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
  );
}

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

async function walkSourceFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const queue = [root];

  while (queue.length > 0 && results.length < MAX_INDEX_FILES) {
    const dir = queue.shift()!;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".builderForceAgents") {
        continue;
      }
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) {
          results.push(full);
        }
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Index build / load
// ---------------------------------------------------------------------------

function indexPath(projectRoot: string): string {
  return path.join(projectRoot, ".builderForceAgents", "search-index.json");
}

async function buildIndex(projectRoot: string): Promise<SearchIndex> {
  const files = await walkSourceFiles(projectRoot);
  const entries: FileEntry[] = [];
  const invertedIndex: Record<string, number[]> = {};
  const docFreq: Record<string, number> = {};
  let totalTokens = 0;

  for (let i = 0; i < files.length; i++) {
    const absPath = files[i];
    const relPath = path.relative(projectRoot, absPath);

    let text: string;
    let mtime: number;
    try {
      const stat = await fs.stat(absPath);
      mtime = stat.mtimeMs;
      text = await fs.readFile(absPath, "utf-8");
    } catch {
      continue;
    }

    const symbols = extractSymbols(text);
    // Tokens = symbols split into words + file path parts + identifier words from text
    const pathTokens = tokenise(relPath.replace(/[/\\]/g, " ").replace(/\.[^.]+$/, ""));
    const symbolTokens = symbols.flatMap((s) => tokenise(s));
    // Sample content tokens (first 200 lines to keep index small)
    const contentSample = text.split("\n").slice(0, 200).join("\n");
    const contentTokens = tokenise(contentSample);

    const allTokens = [...new Set([...pathTokens, ...symbolTokens, ...contentTokens])];
    totalTokens += allTokens.length;

    const entry: FileEntry = {
      relPath,
      tokens: allTokens,
      symbols,
      mtime,
      tokenCount: allTokens.length,
    };
    const idx = entries.length;
    entries.push(entry);

    // Build inverted index
    for (const tok of allTokens) {
      if (!invertedIndex[tok]) {
        invertedIndex[tok] = [];
        docFreq[tok] = 0;
      }
      invertedIndex[tok].push(idx);
      docFreq[tok]++;
    }
  }

  const avgDocLength = entries.length > 0 ? totalTokens / entries.length : 1;

  const index: SearchIndex = {
    version: INDEX_VERSION,
    projectRoot,
    builtAt: Date.now(),
    files: entries,
    invertedIndex,
    docFreq,
    avgDocLength,
  };

  // Persist to disk (best-effort)
  try {
    const idxPath = indexPath(projectRoot);
    await fs.mkdir(path.dirname(idxPath), { recursive: true });
    await fs.writeFile(idxPath, JSON.stringify(index));
  } catch {
    // not fatal
  }

  return index;
}

async function loadOrBuildIndex(projectRoot: string): Promise<SearchIndex> {
  try {
    const idxPath = indexPath(projectRoot);
    const stat = await fs.stat(idxPath);
    if (Date.now() - stat.mtimeMs < INDEX_STALENESS_MS) {
      const raw = await fs.readFile(idxPath, "utf-8");
      const cached = JSON.parse(raw) as SearchIndex;
      if (cached.version === INDEX_VERSION && cached.projectRoot === projectRoot) {
        return cached;
      }
    }
  } catch {
    // no cached index — build one
  }
  return buildIndex(projectRoot);
}

// ---------------------------------------------------------------------------
// BM25 scoring
// ---------------------------------------------------------------------------

function bm25Score(queryTokens: string[], fileEntry: FileEntry, index: SearchIndex): number {
  const N = index.files.length;
  const dl = fileEntry.tokenCount;
  const avgdl = index.avgDocLength;

  let score = 0;
  for (const q of queryTokens) {
    // Find all tokens in the file that start with q (prefix match)
    const tf = fileEntry.tokens.filter((t) => t === q || t.startsWith(q + "_")).length;
    if (tf === 0) {
      continue;
    }

    const df = index.docFreq[q] ?? 1;
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl)));
    score += idf * tfNorm;
  }
  return score;
}

// ---------------------------------------------------------------------------
// Snippet extraction
// ---------------------------------------------------------------------------

function extractSnippet(projectRoot: string, relPath: string, queryTokens: string[]): string {
  if (queryTokens.length === 0) {
    return "";
  }
  const absPath = path.join(projectRoot, relPath);
  const keyword = queryTokens[0];
  try {
    // Try rg first, then grep
    let args: string[];
    let bin: string;
    try {
      execFileSync("rg", ["--version"], { stdio: "ignore" });
      bin = "rg";
      args = ["-i", "-m", "1", "-C", String(CONTEXT_LINES), "--no-heading", "--", keyword, absPath];
    } catch {
      bin = "grep";
      args = ["-i", "-m", "1", `-${CONTEXT_LINES}`, "--", keyword, absPath];
    }
    const out = execFileSync(bin, args, { maxBuffer: 256 * 1024, timeout: 5_000 }).toString();
    return out.split("\n").slice(0, 12).join("\n").trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const SemanticSearchSchema = Type.Object({
  projectRoot: Type.String({
    description: "Root directory of the project to search",
  }),
  query: Type.String({
    description:
      "Natural language query or symbol name. Examples: 'user authentication flow', " +
      "'database connection pool', 'PaymentService class', 'handleCheckout'",
  }),
  topK: Type.Optional(
    Type.Number({ description: "Number of results to return (default 10, max 20)" }),
  ),
  language: Type.Optional(
    Type.String({ description: "Limit to files of this extension, e.g. 'ts', 'py'" }),
  ),
  rebuild: Type.Optional(
    Type.Boolean({
      description: "Force rebuild the search index. Use when files have changed significantly.",
    }),
  ),
});

type SemanticSearchParams = {
  projectRoot: string;
  query: string;
  topK?: number;
  language?: string;
  rebuild?: boolean;
};

export const semanticSearchTool: AgentTool<typeof SemanticSearchSchema, string> = {
  name: "codebase_semantic_search",
  label: "Semantic Codebase Search",
  description:
    "Semantically search the project source code using a TF-IDF ranked index of all exported " +
    "symbols (functions, classes, types, interfaces) plus file content. Returns ranked files " +
    "and representative snippets. Builds a local index on first use (.builderforce/search-index.json). " +
    "Better than keyword search for natural language queries and symbol lookups.",
  parameters: SemanticSearchSchema,
  async execute(
    _toolCallId: string,
    params: SemanticSearchParams,
  ): Promise<AgentToolResult<string>> {
    const { projectRoot, query, topK = 10, language, rebuild = false } = params;

    try {
      await fs.access(projectRoot);
    } catch {
      return jsonResult({
        error: `Project root does not exist: ${projectRoot}`,
      }) as AgentToolResult<string>;
    }

    // Load or build index
    let index: SearchIndex;
    if (rebuild) {
      index = await buildIndex(projectRoot);
    } else {
      index = await loadOrBuildIndex(projectRoot);
    }

    if (index.files.length === 0) {
      return jsonResult({
        results: [],
        query,
        indexedFiles: 0,
        message: "No source files found in project root.",
      }) as AgentToolResult<string>;
    }

    // Tokenise query — also treat raw query words as potential symbol names
    const queryTokens = [
      ...tokenise(query),
      // Include raw camelCase/PascalCase terms without splitting (for symbol lookups)
      ...query
        .split(/\s+/)
        .filter((t) => /^[A-Z]/.test(t) && t.length >= 3)
        .map((t) => t.toLowerCase()),
    ];

    if (queryTokens.length === 0) {
      return jsonResult({
        error: "Query produced no searchable tokens.",
      }) as AgentToolResult<string>;
    }

    // Filter by language extension if requested
    const candidates = language
      ? index.files.filter((f) => f.relPath.endsWith(`.${language.replace(/^\./, "")}`))
      : index.files;

    // Score all candidate files
    const scored = candidates
      .map((f) => {
        const fileIdx = index.files.indexOf(f);
        let score = bm25Score(queryTokens, f, index);

        // Symbol exact-match bonus (high signal — the file exports what was asked)
        const symbolMatches = f.symbols.filter((s) =>
          queryTokens.some((q) => s.toLowerCase().includes(q)),
        ).length;
        score += symbolMatches * 4;

        // Path bonus
        const pathScore = queryTokens.filter((q) => f.relPath.toLowerCase().includes(q)).length * 3;
        score += pathScore;

        // Recency bonus (files modified in last 7 days)
        const ageDays = (Date.now() - f.mtime) / (1000 * 60 * 60 * 24);
        if (ageDays < 7) {
          score += 1;
        }

        return { file: f, score, fileIdx, symbolMatches };
      })
      .filter((r) => r.score > 0)
      .toSorted((a, b) => b.score - a.score)
      .slice(0, Math.min(topK, MAX_RESULTS));

    const results = scored.map((r) => ({
      filePath: r.file.relPath,
      score: Math.round(r.score * 100) / 100,
      symbols: r.file.symbols.slice(0, 8),
      symbolMatches: r.symbolMatches,
      snippet: extractSnippet(projectRoot, r.file.relPath, queryTokens),
    }));

    return jsonResult({
      query,
      queryTokens,
      indexedFiles: index.files.length,
      builtAt: new Date(index.builtAt).toISOString(),
      results,
    }) as AgentToolResult<string>;
  },
};
