/**
 * BuilderForceAgentsLLM in-memory RAG.
 *
 * Walks the workspace directory, scores source files by keyword overlap
 * with the user query, and returns the top-N most relevant excerpts.
 * No external dependencies — pure Node.js fs + simple TF-IDF-style scoring.
 *
 * ## v1 Implementation Note (keyword overlap only)
 *
 * The current scorer uses **term frequency without IDF** — it counts how many
 * query tokens appear anywhere in a file.  This is essentially a weighted
 * keyword grep, not full semantic retrieval.  It works well for exact symbol
 * lookups (function names, type names) but produces poor results for semantic
 * or conceptual queries (e.g. "how does authentication work").
 *
 * @todo Replace the tokenise/score pair with a proper TF-IDF implementation,
 *       or embed a lightweight sentence-transformer for semantic similarity, once
 *       the retrieval quality becomes a measurable bottleneck.
 */

import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".md", ".json"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache", "coverage"]);
const MAX_SCAN_FILES = 800;
const MAX_EXCERPT_CHARS = 600;
const DEFAULT_TOP_K = 3;

// ── File walker ───────────────────────────────────────────────────────────────

async function walkSourceFiles(dir: string, files: string[] = []): Promise<string[]> {
  if (files.length >= MAX_SCAN_FILES) {
    return files;
  }
  let entries: import("node:fs").Dirent<string>[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (files.length >= MAX_SCAN_FILES) {
      break;
    }
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        await walkSourceFiles(path.join(dir, entry.name), files);
      }
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

// ── Keyword tokeniser ─────────────────────────────────────────────────────────

function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[\s\W]+/)
      .filter((t) => t.length > 2),
  );
}

// ── Scorer ────────────────────────────────────────────────────────────────────

function score(queryTokens: Set<string>, fileContent: string): number {
  const fileTokens = tokenise(fileContent);
  let hits = 0;
  for (const t of queryTokens) {
    if (fileTokens.has(t)) {
      hits++;
    }
  }
  return hits;
}

const RAG_CONCURRENCY = 20;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a formatted string of the most relevant file excerpts for the query.
 * Returns an empty string when the workspace has no matching files.
 */
export async function retrieveRelevantContext(opts: {
  query: string;
  workspaceDir: string;
  topK?: number;
  maxExcerptChars?: number;
}): Promise<string> {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const maxChars = opts.maxExcerptChars ?? MAX_EXCERPT_CHARS;
  const queryTokens = tokenise(opts.query);
  if (queryTokens.size === 0) {
    return "";
  }

  const files = await walkSourceFiles(opts.workspaceDir);
  if (files.length === 0) {
    return "";
  }

  // FIX #4: process in bounded batches to avoid memory pressure on large repos.
  const scored: Array<{ file: string; score: number; excerpt: string }> = [];

  for (let i = 0; i < files.length; i += RAG_CONCURRENCY) {
    const batch = files.slice(i, i + RAG_CONCURRENCY);
    await Promise.all(
      batch.map(async (file) => {
        try {
          const content = await fs.readFile(file, "utf-8");
          const s = score(queryTokens, content);
          if (s > 0) {
            scored.push({
              file,
              score: s,
              excerpt: content.slice(0, maxChars) + (content.length > maxChars ? "\n…" : ""),
            });
          }
        } catch {
          // skip unreadable files
        }
      }),
    );
  }

  if (scored.length === 0) {
    return "";
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);

  const sections = top.map(
    (entry) => `### ${path.relative(opts.workspaceDir, entry.file)}\n${entry.excerpt}`,
  );

  return `## Relevant codebase context\n\n${sections.join("\n\n")}`;
}
