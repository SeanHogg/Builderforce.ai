/**
 * Node-native code-intelligence tool backends (`run*` functions).
 *
 * These are the on-prem tools that read the checked-out working tree directly
 * (`git`, `rg`/`grep`, the project's `.builderForceAgents` knowledge dir, AST code
 * maps). They have NO cloud concretion — a bare Worker/DO cannot shell out — so they
 * use `node:*` directly. The pure logic lives here in the `run*` functions; the live
 * native `create*Tool` `AgentTool`s (`builderforce/tools/*-tool.ts`) delegate to the
 * SAME implementation (DRY). 100% pi-free. (The earlier duplicate `*Tool`
 * `ToolDefinition` wrappers + `NODE_CODE_TOOLS` array were deleted with the
 * `builderforce-local` engine — PRD 11 §5.5(a).)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { buildCodeMap, buildDependencyGraph } from "../code-map.js";
import {
  loadCustomAgentRoles,
  loadProjectArchitecture,
  loadProjectContext,
  loadProjectGovernance,
  loadProjectRules,
  resolveBuilderForceAgentsDir,
} from "../project-context.js";

// ── git_history ────────────────────────────────────────────────────────────────

export interface GitHistoryOpts {
  path?: string;
  limit?: number;
  author?: string;
}

export function runGitHistory(projectRoot: string, opts: GitHistoryOpts): Record<string, unknown> {
  const { path: targetPath, limit = 50, author } = opts;
  try {
    // SECURITY (C1): build an argv array and run WITHOUT a shell (execFileSync), so
    // `author`/`path`/`projectRoot` — which are LLM/agent-chosen and therefore
    // prompt-injection reachable — can never break out into shell command
    // substitution. The previous `execSync` string-interpolation was RCE: double
    // quotes do not stop `$(…)`. Mirrors the safe execFileSync usage in
    // cbSearchKeyword/ssExtractSnippet below. `limit` is coerced to a bounded int.
    const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit) || 50)), 1000);
    const args = ["-C", projectRoot, "log", "--format=%H%x00%an%x00%ae%x00%at%x00%s", "--name-only", "-n", String(safeLimit)];
    if (author) args.push(`--author=${author}`);
    if (targetPath) args.push("--", targetPath);

    const output = execFileSync("git", args, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
    const commits: Array<{ sha: string; author: string; date: Date; message: string; filesChanged: string[] }> = [];
    const blocks = output.split("\n\n").filter((b) => b.trim());
    for (const block of blocks) {
      const lines = block.split("\n");
      if (lines.length < 1) continue;
      const [hash, authorName, authorEmail, timestamp, message] = lines[0].split("\x00");
      const filesChanged = lines.slice(1).filter((f) => f.trim());
      commits.push({
        sha: hash,
        author: `${authorName} <${authorEmail}>`,
        date: new Date(Number.parseInt(timestamp) * 1000),
        message,
        filesChanged,
      });
    }
    const authors = new Set(commits.map((c) => c.author));
    const files = new Set(commits.flatMap((c) => c.filesChanged));
    return {
      totalCommits: commits.length,
      uniqueAuthors: authors.size,
      uniqueFiles: files.size,
      commits: commits.slice(0, 20).map((c) => ({
        sha: c.sha.slice(0, 8),
        author: c.author,
        date: c.date.toISOString(),
        message: c.message,
        filesChanged: c.filesChanged.length,
      })),
      topAuthors: Array.from(authors)
        .map((a) => ({ author: a, commits: commits.filter((c) => c.author === a).length }))
        .toSorted((a, b) => b.commits - a.commits)
        .slice(0, 10),
      topFiles: Array.from(files)
        .map((file) => ({ file, commits: commits.filter((c) => c.filesChanged.includes(file)).length }))
        .toSorted((a, b) => b.commits - a.commits)
        .slice(0, 10),
    };
  } catch (error) {
    return { error: `Failed to analyze git history: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ── code_analysis ──────────────────────────────────────────────────────────────

export interface CodeAnalysisOpts {
  filePatterns?: string[];
  includeTests?: boolean;
}

export async function runCodeAnalysis(projectRoot: string, opts: CodeAnalysisOpts): Promise<Record<string, unknown>> {
  try {
    const context = await loadProjectContext(projectRoot);
    const patterns =
      opts.filePatterns || (context?.languages.includes("typescript") ? ["**/*.ts", "**/*.tsx"] : ["**/*.js"]);
    const codeMap = await buildCodeMap(projectRoot, patterns);
    const dependencyGraph = buildDependencyGraph(codeMap);

    const functionCount = Array.from(codeMap.files.values()).reduce((s, f) => s + f.functions.length, 0);
    const classCount = Array.from(codeMap.files.values()).reduce((s, f) => s + f.classes.length, 0);
    const interfaceCount = Array.from(codeMap.files.values()).reduce((s, f) => s + f.interfaces.length, 0);

    return {
      summary: {
        fileCount: codeMap.files.size,
        functionCount,
        classCount,
        interfaceCount,
        dependencyCount: codeMap.dependencies.size,
        exportCount: codeMap.exports.size,
      },
      files: Array.from(codeMap.files.entries()).map(([p, info]) => ({
        path: p,
        language: info.language,
        functions: info.functions.length,
        classes: info.classes.length,
        interfaces: info.interfaces.length,
      })),
      topLevelExports: Array.from(codeMap.exports.entries())
        .slice(0, 50)
        .map(([_key, exp]) => ({ name: exp.name, kind: exp.kind, file: exp.file })),
      dependencyGraph: Array.from(dependencyGraph.entries())
        .slice(0, 50)
        .map(([file, node]) => ({ file, dependencies: node.dependencies.length, dependents: node.dependents.length })),
    };
  } catch (error) {
    return { error: `Failed to analyze code: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ── project_knowledge ────────────────────────────────────────────────────────────

export async function runProjectKnowledge(projectRoot: string, query: string): Promise<Record<string, unknown>> {
  try {
    const result: Record<string, unknown> = {};
    if (query === "context" || query === "all") {
      const context = await loadProjectContext(projectRoot);
      if (context) result.context = context;
    }
    if (query === "rules" || query === "all") {
      const rules = await loadProjectRules(projectRoot);
      if (rules) result.rules = rules;
    }
    if (query === "governance" || query === "all") {
      const gov = await loadProjectGovernance(projectRoot);
      if (gov) result.governance = gov;
    }
    if (query === "architecture" || query === "all") {
      const architecture = await loadProjectArchitecture(projectRoot);
      if (architecture) result.architecture = architecture;
    }
    if (query === "agents" || query === "all") {
      const agents = await loadCustomAgentRoles(projectRoot);
      if (agents.length > 0) result.agents = agents;
    }
    if (query === "memory" || query === "all") {
      const dir = resolveBuilderForceAgentsDir(projectRoot);
      try {
        const files = (await fs.readdir(dir.memoryDir)).filter((f) => f.endsWith(".md")).toSorted().slice(-7);
        if (files.length > 0) {
          const contents = await Promise.all(files.map((f) => fs.readFile(path.join(dir.memoryDir, f), "utf-8")));
          result.memory = contents.join("\n\n---\n\n");
        }
      } catch {
        // missing/empty — silent
      }
    }
    if (Object.keys(result).length === 0) {
      return { error: "No project knowledge found. Initialize with 'builderforce init' first." };
    }
    return result;
  } catch (error) {
    return { error: `Failed to load project knowledge: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ── codebase_search (ripgrep/grep keyword ranking) ───────────────────────────────

/** Directories never walked by the on-prem code tools (searcher + file lister). Shared
 *  so the disk capability provider's `list_files` uses the SAME ignore set (DRY). */
export const IGNORED_DIRS = [
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage", ".cache", "__pycache__", ".venv", "vendor",
];
const SOURCE_EXTENSIONS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "kt", "swift", "rb", "php", "cs", "cpp", "c", "h", "vue", "svelte",
];
const CB_CONTEXT_LINES = 4;
const CB_MAX_RESULTS = 20;
const CB_MAX_SNIPPET_LINES = 12;

const CB_STOP_WORDS = new Set([
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "that", "this",
  "these", "those", "it", "its", "with", "by", "from", "how", "what", "where", "when", "which", "who", "all", "any",
  "each", "find", "get", "show", "list", "related", "about", "code", "file", "files",
]);

function cbExtractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !CB_STOP_WORDS.has(w));
}

/**
 * Repo-relative path in POSIX separators, matching what `list_files` returns from its
 * own walk. Without this, Windows hosts hand the model `src\pricing.ts` from one tool
 * and `src/pricing.ts` from another — two tools describing the same tree inconsistently.
 */
function relPosix(projectRoot: string, absPath: string): string {
  return path.relative(projectRoot, absPath).split(path.sep).join("/");
}

function detectSearchTool(): "rg" | "grep" {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return "rg";
  } catch {
    return "grep";
  }
}

function cbSearchKeyword(projectRoot: string, keyword: string, exts: string[], tool: "rg" | "grep"): string[] {
  // GNU grep only accepts the ATTACHED `--include=GLOB` form. Passing `--include` and
  // the glob as two argv entries makes grep swallow the glob as its pattern, leaving
  // the real keyword in file position -> exit 2. That failure was previously caught
  // below and returned as "no matches", so on any host without ripgrep `search_code`
  // reported `total: 0` for code that plainly exists, and the tool then told the model
  // the symbol was not referenced. Keep these attached.
  const args =
    tool === "rg"
      ? ["-i", "--no-heading", "-l", ...IGNORED_DIRS.flatMap((d) => ["--glob", `!${d}/**`]), ...exts.flatMap((e) => ["--glob", `*.${e}`]), "--", keyword, projectRoot]
      : ["-ril", ...IGNORED_DIRS.map((d) => `--exclude-dir=${d}`), ...exts.map((e) => `--include=*.${e}`), "--", keyword, projectRoot];
  try {
    const output = execFileSync(tool === "rg" ? "rg" : "grep", args, { maxBuffer: 4 * 1024 * 1024, timeout: 10_000 }).toString();
    return output.split("\n").filter(Boolean);
  } catch (err) {
    // Both tools exit 1 for "searched fine, found nothing" — the only genuinely empty
    // result. Anything else (exit >= 2, ENOENT, timeout) is a BROKEN SEARCH, and
    // reporting it as an empty result would have the agent assert the code is absent.
    if ((err as { status?: number }).status === 1) return [];
    throw new Error(
      `code search failed (${tool} exited ${(err as { status?: number }).status ?? "abnormally"}): ${
        (err as { stderr?: Buffer }).stderr?.toString().trim() || (err as Error).message
      }`,
    );
  }
}

function cbGetSnippet(filePath: string, keywords: string[], tool: "rg" | "grep"): string {
  if (keywords.length === 0) return "";
  const keyword = keywords[0];
  const args =
    tool === "rg"
      ? ["-i", "-m", "1", "-C", String(CB_CONTEXT_LINES), "--no-heading", "--", keyword, filePath]
      : ["-i", "-m", "1", `-${CB_CONTEXT_LINES}`, "--", keyword, filePath];
  try {
    const output = execFileSync(tool === "rg" ? "rg" : "grep", args, { maxBuffer: 512 * 1024, timeout: 5_000 }).toString();
    return output.split("\n").slice(0, CB_MAX_SNIPPET_LINES).join("\n").trim();
  } catch {
    return "";
  }
}

function cbCountMatches(filePath: string, keywords: string[], tool: "rg" | "grep"): { count: number; matched: string[] } {
  let count = 0;
  const matched: string[] = [];
  for (const kw of keywords) {
    try {
      const n = parseInt(
        execFileSync(tool === "rg" ? "rg" : "grep", ["-ic", "--", kw, filePath], { timeout: 3_000 }).toString().trim(),
        10,
      );
      if (!Number.isNaN(n) && n > 0) {
        count += n;
        matched.push(kw);
      }
    } catch {
      // exit 1 = no match
    }
  }
  return { count, matched };
}

export interface CodebaseSearchOpts {
  query: string;
  topK?: number;
  language?: string;
}

export async function runCodebaseSearch(projectRoot: string, opts: CodebaseSearchOpts): Promise<Record<string, unknown>> {
  const { query, topK = 10, language } = opts;
  try {
    await fs.access(projectRoot);
  } catch {
    return { error: `Project root does not exist: ${projectRoot}` };
  }
  const keywords = cbExtractKeywords(query);
  if (keywords.length === 0) {
    return { error: "Query produced no searchable keywords. Try a more specific description." };
  }
  const exts = language ? [language.replace(/^\./, "")] : SOURCE_EXTENSIONS;
  const tool = detectSearchTool();

  const fileHits = new Map<string, Set<string>>();
  try {
    for (const kw of keywords) {
      for (const f of cbSearchKeyword(projectRoot, kw, exts, tool)) {
        const abs = path.isAbsolute(f) ? f : path.join(projectRoot, f);
        if (!fileHits.has(abs)) fileHits.set(abs, new Set());
        fileHits.get(abs)!.add(kw);
      }
    }
  } catch (err) {
    // Surface a broken search as an ERROR, never as an empty result set: the caller
    // turns "no results" into "this symbol is not referenced, say so instead of
    // inventing an edit", which would make the agent deny that existing code exists.
    return { error: (err as Error).message, query, keywords };
  }
  if (fileHits.size === 0) {
    return { results: [], query, keywords, message: "No files matched the query keywords." };
  }

  const scored: Array<{ relPath: string; score: number; matchCount: number; snippet: string; matchedKeywords: string[] }> = [];
  for (const [absPath, kwSet] of Array.from(fileHits.entries()).slice(0, CB_MAX_RESULTS * 3)) {
    const relPath = relPosix(projectRoot, absPath);
    const { count: matchCount, matched: matchedKeywords } = cbCountMatches(absPath, Array.from(kwSet), tool);
    const pathBonus = keywords.filter((k) => relPath.toLowerCase().includes(k)).length * 5;
    const breadthBonus = matchedKeywords.length * 3;
    const score = matchCount + pathBonus + breadthBonus;
    const snippet = cbGetSnippet(absPath, matchedKeywords.length > 0 ? matchedKeywords : keywords, tool);
    scored.push({ relPath, score, matchCount, snippet, matchedKeywords });
  }
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, Math.min(topK, CB_MAX_RESULTS));
  return {
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
  };
}

// ── codebase_semantic_search (BM25 + symbol index) ───────────────────────────────

const INDEX_VERSION = 2;
const MAX_INDEX_FILES = 5_000;
const SS_MAX_RESULTS = 20;
const SS_CONTEXT_LINES = 5;
const INDEX_STALENESS_MS = 5 * 60 * 1_000;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

const SS_IGNORED_DIRS = new Set(IGNORED_DIRS);
const SS_SOURCE_EXTENSIONS = new Set(SOURCE_EXTENSIONS);

const SYMBOL_PATTERNS: RegExp[] = [
  /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
  /(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
  /(?:^|\s)class\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
  /(?:^|\s)(?:type|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
  /^def\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  /^class\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  /^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)/gm,
  /^type\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  /^(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  /^(?:pub\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  /^(?:pub\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  /(?:public|private|protected|static)?\s+(?:class|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
];

function ssExtractSymbols(text: string): string[] {
  const symbols = new Set<string>();
  for (const pattern of SYMBOL_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const sym = m[1];
      if (sym && sym.length >= 2) symbols.add(sym);
    }
  }
  return Array.from(symbols);
}

const SS_STOP_WORDS = new Set([
  ...CB_STOP_WORDS,
  "new", "return", "const", "let", "var", "function", "class", "type", "interface", "import", "export",
  "null", "undefined", "true", "false", "if", "else", "while", "switch", "case",
]);

function ssTokenise(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !SS_STOP_WORDS.has(t));
}

interface FileEntry {
  relPath: string;
  tokens: string[];
  symbols: string[];
  mtime: number;
  tokenCount: number;
}
interface SearchIndex {
  version: number;
  projectRoot: string;
  builtAt: number;
  files: FileEntry[];
  invertedIndex: Record<string, number[]>;
  docFreq: Record<string, number>;
  avgDocLength: number;
}

async function ssWalkSourceFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const queue = [root];
  while (queue.length > 0 && results.length < MAX_INDEX_FILES) {
    const dir = queue.shift()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".builderForceAgents") continue;
      if (SS_IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.isFile() && SS_SOURCE_EXTENSIONS.has(path.extname(entry.name).slice(1).toLowerCase())) results.push(full);
    }
  }
  return results;
}

function ssIndexPath(projectRoot: string): string {
  return path.join(projectRoot, ".builderForceAgents", "search-index.json");
}

async function ssBuildIndex(projectRoot: string): Promise<SearchIndex> {
  const files = await ssWalkSourceFiles(projectRoot);
  const entries: FileEntry[] = [];
  const invertedIndex: Record<string, number[]> = {};
  const docFreq: Record<string, number> = {};
  let totalTokens = 0;
  for (const absPath of files) {
    const relPath = relPosix(projectRoot, absPath);
    let text: string;
    let mtime: number;
    try {
      const stat = await fs.stat(absPath);
      mtime = stat.mtimeMs;
      text = await fs.readFile(absPath, "utf-8");
    } catch {
      continue;
    }
    const symbols = ssExtractSymbols(text);
    const pathTokens = ssTokenise(relPath.replace(/[/\\]/g, " ").replace(/\.[^.]+$/, ""));
    const symbolTokens = symbols.flatMap((s) => ssTokenise(s));
    const contentTokens = ssTokenise(text.split("\n").slice(0, 200).join("\n"));
    const allTokens = [...new Set([...pathTokens, ...symbolTokens, ...contentTokens])];
    totalTokens += allTokens.length;
    const idx = entries.length;
    entries.push({ relPath, tokens: allTokens, symbols, mtime, tokenCount: allTokens.length });
    for (const tok of allTokens) {
      if (!invertedIndex[tok]) {
        invertedIndex[tok] = [];
        docFreq[tok] = 0;
      }
      invertedIndex[tok].push(idx);
      docFreq[tok]++;
    }
  }
  const index: SearchIndex = {
    version: INDEX_VERSION,
    projectRoot,
    builtAt: Date.now(),
    files: entries,
    invertedIndex,
    docFreq,
    avgDocLength: entries.length > 0 ? totalTokens / entries.length : 1,
  };
  try {
    const idxPath = ssIndexPath(projectRoot);
    await fs.mkdir(path.dirname(idxPath), { recursive: true });
    await fs.writeFile(idxPath, JSON.stringify(index));
  } catch {
    // not fatal
  }
  return index;
}

async function ssLoadOrBuildIndex(projectRoot: string): Promise<SearchIndex> {
  try {
    const idxPath = ssIndexPath(projectRoot);
    const stat = await fs.stat(idxPath);
    if (Date.now() - stat.mtimeMs < INDEX_STALENESS_MS) {
      const cached = JSON.parse(await fs.readFile(idxPath, "utf-8")) as SearchIndex;
      if (cached.version === INDEX_VERSION && cached.projectRoot === projectRoot) return cached;
    }
  } catch {
    // build fresh
  }
  return ssBuildIndex(projectRoot);
}

function bm25Score(queryTokens: string[], fileEntry: FileEntry, index: SearchIndex): number {
  const N = index.files.length;
  const dl = fileEntry.tokenCount;
  const avgdl = index.avgDocLength;
  let score = 0;
  for (const q of queryTokens) {
    const tf = fileEntry.tokens.filter((t) => t === q || t.startsWith(q + "_")).length;
    if (tf === 0) continue;
    const df = index.docFreq[q] ?? 1;
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl)));
    score += idf * tfNorm;
  }
  return score;
}

function ssExtractSnippet(projectRoot: string, relPath: string, queryTokens: string[]): string {
  if (queryTokens.length === 0) return "";
  const absPath = path.join(projectRoot, relPath);
  const keyword = queryTokens[0];
  try {
    let args: string[];
    let bin: string;
    try {
      execFileSync("rg", ["--version"], { stdio: "ignore" });
      bin = "rg";
      args = ["-i", "-m", "1", "-C", String(SS_CONTEXT_LINES), "--no-heading", "--", keyword, absPath];
    } catch {
      bin = "grep";
      args = ["-i", "-m", "1", `-${SS_CONTEXT_LINES}`, "--", keyword, absPath];
    }
    return execFileSync(bin, args, { maxBuffer: 256 * 1024, timeout: 5_000 }).toString().split("\n").slice(0, 12).join("\n").trim();
  } catch {
    return "";
  }
}

export interface SemanticSearchOpts {
  query: string;
  topK?: number;
  language?: string;
  rebuild?: boolean;
}

export async function runSemanticSearch(projectRoot: string, opts: SemanticSearchOpts): Promise<Record<string, unknown>> {
  const { query, topK = 10, language, rebuild = false } = opts;
  try {
    await fs.access(projectRoot);
  } catch {
    return { error: `Project root does not exist: ${projectRoot}` };
  }
  const index = rebuild ? await ssBuildIndex(projectRoot) : await ssLoadOrBuildIndex(projectRoot);
  if (index.files.length === 0) {
    return { results: [], query, indexedFiles: 0, message: "No source files found in project root." };
  }
  const queryTokens = [
    ...ssTokenise(query),
    ...query.split(/\s+/).filter((t) => /^[A-Z]/.test(t) && t.length >= 3).map((t) => t.toLowerCase()),
  ];
  if (queryTokens.length === 0) return { error: "Query produced no searchable tokens." };

  const candidates = language
    ? index.files.filter((f) => f.relPath.endsWith(`.${language.replace(/^\./, "")}`))
    : index.files;

  const scored = candidates
    .map((f) => {
      let score = bm25Score(queryTokens, f, index);
      const symbolMatches = f.symbols.filter((s) => queryTokens.some((q) => s.toLowerCase().includes(q))).length;
      score += symbolMatches * 4;
      score += queryTokens.filter((q) => f.relPath.toLowerCase().includes(q)).length * 3;
      if ((Date.now() - f.mtime) / (1000 * 60 * 60 * 24) < 7) score += 1;
      return { file: f, score, symbolMatches };
    })
    .filter((r) => r.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, Math.min(topK, SS_MAX_RESULTS));

  return {
    query,
    queryTokens,
    indexedFiles: index.files.length,
    builtAt: new Date(index.builtAt).toISOString(),
    results: scored.map((r) => ({
      filePath: r.file.relPath,
      score: Math.round(r.score * 100) / 100,
      symbols: r.file.symbols.slice(0, 8),
      symbolMatches: r.symbolMatches,
      snippet: ssExtractSnippet(projectRoot, r.file.relPath, queryTokens),
    })),
  };
}

