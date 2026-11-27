/**
 * Node-native code-intelligence tool backends (`run*` functions).
 *
 * These are the on-prem tools that read the checked-out working tree directly
 * (`git`, `rg`/`grep`, the project's `.builderForceAgents` knowledge dir, the
 * repo-map code graph). They have NO cloud concretion — a bare Worker/DO cannot shell out — so they
 * use `node:*` directly. The pure logic lives here in the `run*` functions; the live
 * native `create*Tool` `AgentTool`s (`builderforce/tools/*-tool.ts`) delegate to the
 * SAME implementation (DRY). 100% pi-free. (The earlier duplicate `*Tool`
 * `ToolDefinition` wrappers + `NODE_CODE_TOOLS` array were deleted with the
 * `builderforce-local` engine — PRD 11 §5.5(a).)
 */

import { readRecentCommits } from "@builderforce/agent-tools/node-git-history";
import fs from "node:fs/promises";
import path from "node:path";
import {
  loadCustomAgentRoles,
  loadProjectArchitecture,
  loadProjectContext,
  loadProjectGovernance,
  loadProjectRules,
  resolveBuilderForceAgentsDir,
} from "../project-context.js";
import { analyzeWorkspaceCode } from "./workspace-code-graph.js";

// ── git_history ────────────────────────────────────────────────────────────────

export interface GitHistoryOpts {
  path?: string;
  limit?: number;
  author?: string;
}

export async function runGitHistory(projectRoot: string, opts: GitHistoryOpts): Promise<Record<string, unknown>> {
  const { path: targetPath, limit = 50, author } = opts;
  try {
    const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit) || 50)), 1000);
    const history = await readRecentCommits(projectRoot, safeLimit, {
      path: targetPath || null,
      author,
      authorIdentity: true,
      repoRelative: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (!("commits" in history)) throw new Error(history.stderr?.trim() || "Git history is unavailable");
    const { commits } = history;
    const authors = new Set(commits.map((c) => c.author));
    const files = new Set(commits.flatMap((c) => c.paths));
    return {
      totalCommits: commits.length,
      uniqueAuthors: authors.size,
      uniqueFiles: files.size,
      commits: commits.slice(0, 20).map((c) => ({
        sha: c.sha.slice(0, 8),
        author: c.author,
        date: new Date(c.at).toISOString(),
        message: c.title,
        filesChanged: c.paths.length,
      })),
      topAuthors: Array.from(authors)
        .map((a) => ({ author: a, commits: commits.filter((c) => c.author === a).length }))
        .toSorted((a, b) => b.commits - a.commits)
        .slice(0, 10),
      topFiles: Array.from(files)
        .map((file) => ({ file, commits: commits.filter((c) => c.paths.includes(file)).length }))
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
    const code = await analyzeWorkspaceCode(projectRoot, patterns);
    const total = (pick: (f: (typeof code.files)[number]) => number): number =>
      code.files.reduce((s, f) => s + pick(f), 0);

    return {
      summary: {
        fileCount: code.files.length,
        functionCount: total((f) => f.functions),
        classCount: total((f) => f.classes),
        interfaceCount: total((f) => f.interfaces),
        dependencyCount: code.dependencyCount,
        exportCount: code.exports.length,
      },
      files: code.files,
      topLevelExports: code.exports.slice(0, 50),
      dependencyGraph: code.nodes.slice(0, 50),
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
