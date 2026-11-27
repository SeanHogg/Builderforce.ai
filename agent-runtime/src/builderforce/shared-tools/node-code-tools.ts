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
    // substitution. `limit` is coerced to a bounded integer.
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

/** Directories never walked by the on-prem code tools (searcher + file lister). Shared
 *  so the disk capability provider's `list_files` uses the SAME ignore set (DRY). */
export const IGNORED_DIRS = [
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage", ".cache", "__pycache__", ".venv", "vendor",
];
