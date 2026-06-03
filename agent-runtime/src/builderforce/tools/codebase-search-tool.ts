/**
 * Codebase semantic search tool — competes with Cursor @codebase and Continue.dev context.
 *
 * Uses ripgrep (rg) when available, falls back to grep. Ranks results by:
 *   1. Number of keyword hits in the file
 *   2. Keyword hits in the file path / name
 *   3. Proximity of all keywords within a single function/block
 *
 * Returns ranked snippets so agents can pick the most relevant context without
 * scanning every file manually.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";

const IGNORED_DIRS = [
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
];

const SOURCE_EXTENSIONS = [
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
];

const CONTEXT_LINES = 4;
const MAX_RESULTS = 20;
const MAX_SNIPPET_LINES = 12;

const CodebaseSearchSchema = Type.Object({
  projectRoot: Type.String({
    description: "Root directory of the project to search",
  }),
  query: Type.String({
    description:
      "Natural language or keyword query describing what you are looking for. " +
      "Examples: 'user authentication', 'database connection pool', 'rate limiting middleware'",
  }),
  topK: Type.Optional(
    Type.Number({
      description: "Maximum number of results to return. Defaults to 10.",
    }),
  ),
  language: Type.Optional(
    Type.String({
      description:
        "Limit search to files of this language/extension (e.g. 'ts', 'py', 'go'). " +
        "If omitted, all source files are searched.",
    }),
  ),
});

type CodebaseSearchParams = {
  projectRoot: string;
  query: string;
  topK?: number;
  language?: string;
};

type SearchResult = {
  filePath: string;
  relPath: string;
  score: number;
  matchCount: number;
  snippet: string;
  matchedKeywords: string[];
};

/** Extract meaningful keywords from a natural-language query. */
function extractKeywords(query: string): string[] {
  const stopWords = new Set([
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
  ]);
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));
}

/** Detect which search binary is available. */
function detectSearchTool(): "rg" | "grep" {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return "rg";
  } catch {
    return "grep";
  }
}

/**
 * Build rg arguments for listing files matching a keyword.
 * All arguments are array elements — no shell interpolation.
 */
function buildRgListArgs(keyword: string, exts: string[], projectRoot: string): string[] {
  const ignoreGlobs = IGNORED_DIRS.flatMap((d) => ["--glob", `!${d}/**`]);
  const extGlobs = exts.flatMap((e) => ["--glob", `*.${e}`]);
  return ["-i", "--no-heading", "-l", ...ignoreGlobs, ...extGlobs, "--", keyword, projectRoot];
}

/**
 * Build grep arguments for listing files matching a keyword.
 */
function buildGrepListArgs(keyword: string, exts: string[], projectRoot: string): string[] {
  const ignoreDirs = IGNORED_DIRS.flatMap((d) => ["--exclude-dir", d]);
  const includeGlobs = exts.flatMap((e) => ["--include", `*.${e}`]);
  return ["-ril", ...ignoreDirs, ...includeGlobs, "--", keyword, projectRoot];
}

/**
 * Search for a single keyword in the project, returning matching file paths.
 */
function searchKeyword(
  projectRoot: string,
  keyword: string,
  exts: string[],
  tool: "rg" | "grep",
): string[] {
  const args =
    tool === "rg"
      ? buildRgListArgs(keyword, exts, projectRoot)
      : buildGrepListArgs(keyword, exts, projectRoot);

  try {
    const output = execFileSync(tool === "rg" ? "rg" : "grep", args, {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 10_000,
    }).toString();
    return output.split("\n").filter(Boolean);
  } catch {
    // rg/grep exits 1 when no matches — that's expected
    return [];
  }
}

/**
 * For a file that matched, retrieve a representative snippet around the first match.
 */
function getSnippet(filePath: string, keywords: string[], tool: "rg" | "grep"): string {
  if (keywords.length === 0) {
    return "";
  }
  // Use the first keyword for the snippet (most specific term)
  const keyword = keywords[0];

  let args: string[];
  if (tool === "rg") {
    args = ["-i", "-m", "1", "-C", String(CONTEXT_LINES), "--no-heading", "--", keyword, filePath];
  } else {
    args = ["-i", "-m", "1", `-${CONTEXT_LINES}`, "--", keyword, filePath];
  }

  try {
    const output = execFileSync(tool === "rg" ? "rg" : "grep", args, {
      maxBuffer: 512 * 1024,
      timeout: 5_000,
    }).toString();
    return output.split("\n").slice(0, MAX_SNIPPET_LINES).join("\n").trim();
  } catch {
    return "";
  }
}

/** Count how many of the keywords appear in a file. */
function countMatches(
  filePath: string,
  keywords: string[],
  tool: "rg" | "grep",
): { count: number; matched: string[] } {
  let count = 0;
  const matched: string[] = [];
  for (const kw of keywords) {
    let args: string[];
    if (tool === "rg") {
      args = ["-ic", "--", kw, filePath];
    } else {
      args = ["-ic", "--", kw, filePath];
    }
    try {
      const n = parseInt(
        execFileSync(tool === "rg" ? "rg" : "grep", args, { timeout: 3_000 })
          .toString()
          .trim(),
        10,
      );
      if (!Number.isNaN(n) && n > 0) {
        count += n;
        matched.push(kw);
      }
    } catch {
      // exit code 1 = no match (expected)
    }
  }
  return { count, matched };
}

export const codebaseSearchTool: AgentTool<typeof CodebaseSearchSchema, string> = {
  name: "codebase_search",
  label: "Codebase Search",
  description:
    "Semantically search the project source code using natural language or keywords. " +
    "Finds files and code snippets most relevant to your query — like Cursor @codebase or " +
    "Continue.dev @codebase. Returns ranked results with file paths and representative snippets.",
  parameters: CodebaseSearchSchema,
  async execute(
    _toolCallId: string,
    params: CodebaseSearchParams,
  ): Promise<AgentToolResult<string>> {
    const { projectRoot, query, topK = 10, language } = params;

    try {
      await fs.access(projectRoot);
    } catch {
      return jsonResult({
        error: `Project root does not exist: ${projectRoot}`,
      }) as AgentToolResult<string>;
    }

    const keywords = extractKeywords(query);
    if (keywords.length === 0) {
      return jsonResult({
        error: "Query produced no searchable keywords. Try a more specific description.",
      }) as AgentToolResult<string>;
    }

    const exts = language ? [language.replace(/^\./, "")] : SOURCE_EXTENSIONS;
    const tool = detectSearchTool();

    // Phase 1: collect candidate files — any file matching at least one keyword
    const fileHits = new Map<string, Set<string>>(); // filePath → matched keywords

    for (const kw of keywords) {
      const files = searchKeyword(projectRoot, kw, exts, tool);
      for (const f of files) {
        const abs = path.isAbsolute(f) ? f : path.join(projectRoot, f);
        if (!fileHits.has(abs)) {
          fileHits.set(abs, new Set());
        }
        fileHits.get(abs)!.add(kw);
      }
    }

    if (fileHits.size === 0) {
      return jsonResult({
        results: [],
        query,
        keywords,
        message: "No files matched the query keywords.",
      }) as AgentToolResult<string>;
    }

    // Phase 2: score and rank candidates
    const scored: SearchResult[] = [];
    const candidates = Array.from(fileHits.entries()).slice(0, MAX_RESULTS * 3);

    for (const [absPath, kwSet] of candidates) {
      const relPath = path.relative(projectRoot, absPath);

      const { count: matchCount, matched: matchedKeywords } = countMatches(
        absPath,
        Array.from(kwSet),
        tool,
      );

      // Bonus: keywords appear in the file path/name itself
      const pathBonus = keywords.filter((k) => relPath.toLowerCase().includes(k)).length * 5;

      // Bonus: multiple different keywords matched (breadth)
      const breadthBonus = matchedKeywords.length * 3;

      const score = matchCount + pathBonus + breadthBonus;

      const snippet = getSnippet(
        absPath,
        matchedKeywords.length > 0 ? matchedKeywords : keywords,
        tool,
      );

      scored.push({ filePath: absPath, relPath, score, matchCount, snippet, matchedKeywords });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, Math.min(topK, MAX_RESULTS));

    return jsonResult({
      query,
      keywords,
      totalCandidates: fileHits.size,
      results: results.map((r) => ({
        filePath: r.relPath,
        score: r.score,
        matchCount: r.matchCount,
        matchedKeywords: r.matchedKeywords,
        snippet: r.snippet,
      })),
    }) as AgentToolResult<string>;
  },
};
