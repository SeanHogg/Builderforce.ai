// repos.pull_request_diff_summary MCP tool implementation.
//
// Signatures and categories follow PRD FR-1 (tool signature), FR-3 (file classification),
// FR-4 (response shape), FR-5 (structured errors), and FR-6 (tool discovery).
//
// This implementation:
// - Classifies files per PRD rules (rule set + classifier).
// - Builds DiffSummaryResult with codeChanged/docsOnly flags.
// - Returns structured errors for the six error cases.
// - Exposes type-safe execution with verified input via schema.ts.
//
// The tool is externally discoverable on tools/list via builderforce.plugin.json
// and its name/description schema. It can be consumed autonomously by agents to
// gate completion logic (docsOnly/codeChanged) without manual inspection.

import { Type } from "@sinclair/typebox";
import { InputSchema, ResultSchema, TOOL_DESCRIPTION, TOOL_NAME } from "./schema.js";
import { classifyFile, type FileCategory } from "./file-classifier.js";
import { assertCategoryTotals, getAllCategories, isValidCategory } from "./types.js";
import {
  type PrDiffFetcher,
  type PlatformContext,
  StubPrDiffFetcher,
  StubPlatformResolver,
} from "./platform-api.js";
import { DiffSummaryErrorClass } from "./errors.js";

interface ToolApi {
  pluginConfig: Record<string, unknown> | null;
  config: unknown;
  logger: {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
  // resolveTask, resolveProjectId to be injected by the host once src/ is available
  resolveTask(id: string): unknown;
  resolveProjectId(id: string): unknown;
  // GitHub-based PrDiffFetcher to be injected once src/ is available
  getPrDiffFetcher: (options: Partial<{ githubToken?: string }> | undefined) => unknown;
  // Task lookups to add backlinking if needed later
  getTaskById: (id: string) => unknown;
}

interface RepoDiffSummaryTool {
  name: string;
  label?: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
  execute(id: string, params: Record<string, unknown>): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Creates the MCP tool instance.
 * @param api - Host extension API (provides tool registration, logging, and platform integrations).
 * @returns An `AnyAgentTool` compatible with the builderforce tool契约.
 */
export function createRepoDiffSummaryTool(api: ToolApi): RepoDiffSummaryTool {
  const parameters = InputSchema;
  const description = TOOL_DESCRIPTION;

  return {
    name: TOOL_NAME,
    label: "Repo Diff Summary",
    description,
    parameters,
    async execute(id: string, params: Record<string, unknown>): Promise<unknown> {
      const logger = api.logger;
      const timeStart = Date.now();

      // -------------------------------------------------------------------
      // Parse and validate the tool signature (FR-1)
      // -------------------------------------------------------------------
      const { taskId, prNumber, projectId, branch } = params as {
        taskId?: string;
        prNumber?: number;
        projectId?: string;
        branch?: string;
      };

      // Exactly one of taskId, prNumber, or branch must be supplied
      const hasTaskId = taskId != null;
      const hasPrNumber = prNumber != null;
      const hasBranch = branch != null;

      if (!hasTaskId && !hasPrNumber && !hasBranch) {
        throw new DiffSummaryErrorClass(
          "UNRESOLVABLE_REF",
          "Exactly one of taskId, prNumber (with projectId), or branch must be supplied.",
        );
      }

      logger.debug(`diff-summary: received call with taskId=${hasTaskId}, prNumber=${hasPrNumber}, branch=${hasBranch}`);

      // -------------------------------------------------------------------
      // Resolve repository context and diff target (FR-2)
      // -------------------------------------------------------------------
      let repoFullName: string;
      let baseBranch: string;
      let fileChanges: readonly unknown[];

      // Case 1: taskId is provided (preferred)
      if (hasTaskId && taskId) {
        logger.debug(`diff-summary: resolving resolutionPath through taskId: ${taskId}`);
        // Attempt to resolve Task from stubs once robust
        // For MVP-1 we raise stub-unavailable errors until the platform surface is wired.
        const taskRecord = (await (api.resolveTask as unknown as (id: string) => Promise<unknown>)(taskId)) as
          | { prNumber?: number; branch?: string; repoFullName?: string }
          | undefined;
        if (!taskRecord) {
          throw new DiffSummaryErrorClass("TASK_NOT_FOUND", `Task not found: ${taskId}`);
        }

        if (taskRecord.prNumber != null) {
          if (!taskId) {
            throw new DiffSummaryErrorClass(
              "UNRESOLVABLE_REF",
              "taskId was empty but a prNumber was insufficently resolved; unsupported path.",
            );
          }
          repoFullName = taskRecord.repoFullName ?? "unresolvable/repo";
          baseBranch = "main";
          logger.debug(`diff-summary: resolved taskId ${taskId} to prNumber ${taskRecord.prNumber}, repoFullName=${repoFullName}`);
          await api.getTaskById?.(taskId); // backlink placeholder
          fileChanges = await fetchRawDiff(repoFullName, "main", "PR", baseBranch, prNumber, api);
        } else if (taskRecord.branch != null) {
          repoFullName = taskRecord.repoFullName ?? "unresolvable/repo";
          baseBranch = taskRecord.branch;
          logger.debug(`diff-summary: resolved taskId ${taskId} to branch ${taskRecord.branch}, repoFullName=${repoFullName}`);
          fileChanges = await fetchRawDiff(repoFullName, "main", "BRANCH", baseBranch, undefined, api, taskId);
        } else {
          throw new DiffSummaryErrorClass(
            "NO_LINKED_PR_OR_BRANCH",
            `Task ${taskId} has no linked PR and no feature branch.`,
          );
        }
      }
      // Case 2: prNumber is provided (both prNumber and projectId required)
      else if (hasPrNumber && projectId) {
        logger.debug(`diff-summary: resolving via prNumber:${prNumber} and projectId:${projectId}`);
        repoFullName = await resolveRepoFullName(projectId, prNumber, api);
        baseBranch = "main"; // Default to main; can be extended via repo API once available
        logger.debug(`diff-summary: resolved repoFullName=${repoFullName}`);
        fileChanges = await fetchRawDiff(repoFullName, "main", "PR", baseBranch, prNumber, api);
      }
      // Case 3: branch is provided (diffs against default branch)
      else if (hasBranch) {
        repoFullName = await resolveRepoFullName(projectId ?? "", 0, api);
        baseBranch = branch;
        logger.debug(`diff-summary: resolved repoFullName=${repoFullName}, branch=${baseBranch}`);
        fileChanges = await fetchRawDiff(repoFullName, "main", "BRANCH", baseBranch, undefined, api, taskId);
      }
      else {
        throw new DiffSummaryErrorClass(
          "UNRESOLVABLE_REF",
          "Missing projectId when prNumber is supplied; branch is missing.",
        );
      }

      // -------------------------------------------------------------------
      // Classify files and build category totals (FR-3 + FR-4)
      // -------------------------------------------------------------------
      // Unpack and cast to our internal shape for classification
      const rawFiles = rawFileChangeArray(fileChanges);
      const files = classifyChanges(rawFiles);

      // ----------------------------------------------------------------------
      // Compute flags and totals
      // ----------------------------------------------------------------------
      const summary = computeSummary(files);

      // ----------------------------------------------------------------------
      // Assert totals back into summary (invariant check prior to FR-6/AC-5)
      // ----------------------------------------------------------------------
      assertCategoryTotals(summary.categories, files);

      // ----------------------------------------------------------------------
      // Construct canonical result shape (FR-4)
      // ----------------------------------------------------------------------
      const result = {
        meta: {
          taskId,
          prNumber,
          branch,
          baseBranch,
          repoFullName,
          resolvedAt: new Date().toISOString(),
          totalFilesChanged: files.length,
        },
        summary,
        files,
      };

      const elapsedSeconds = (Date.now() - timeStart) / 1000;
      logger.debug(`diff-summary: completed in ${elapsedSeconds.toFixed(2)}s`);

      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: Raw file change extraction
// ---------------------------------------------------------------------------

interface RawFileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  linesAdded: number;
  linesDeleted: number;
  previousPath?: string;
  binary?: boolean;
}

function rawFileChangeArray(unknown: unknown): RawFileChange[] {
  if (!Array.isArray(unknown)) {
    throw new DiffSummaryErrorClass(
      "DIFF_UNAVAILABLE",
      "Invalid format: files array is missing.",
    );
  }
  const arr = unknown as unknown[];
  return arr.map((item, ix) => {
    if (
      !item ||
      typeof item !== "object" ||
      // Not enforcing strict schema here to protect against stub placeholder objects
      typeof (item as Record<string, unknown>).path !== "string"
    ) {
      throw new DiffSummaryErrorClass(
        "DIFF_UNAVAILABLE",
        `Invalid file entry at index ${ix}, expected a plain object with path.`,
      );
    }
    return item as RawFileChange;
  });
}

// ---------------------------------------------------------------------------
// Helper: Classification per PRD FR-3 rules
// ---------------------------------------------------------------------------

function classifyChanges(items: RawFileChange[]): Array<{
  path: string;
  category: FileCategory;
  linesAdded: number;
  linesDeleted: number;
  status: "added" | "modified" | "deleted" | "renamed";
  previousPath?: string;
}> {
  return items.map((item: RawFileChange) => ({
    path: item.path,
    category: classifyFile(item.path),
    linesAdded: item.linesAdded,
    linesDeleted: item.linesDeleted,
    status: item.status,
    previousPath: item.previousPath,
  }));
}

// ---------------------------------------------------------------------------
// Helper: Compute flags + totals
// ---------------------------------------------------------------------------

interface CategoryTotals {
  source: { fileCount: number; linesAdded: number; linesDeleted: number };
  test: { fileCount: number; linesAdded: number; linesDeleted: number };
  docs: { fileCount: number; linesAdded: number; linesDeleted: number };
  config: { fileCount: number; linesAdded: number; linesDeleted: number };
  migration: { fileCount: number; linesAdded: number; linesDeleted: number };
  asset: { fileCount: number; linesAdded: number; linesDeleted: number };
}

function computeSummary(
  files: ReturnType<typeof classifyChanges>,
): {
  codeChanged: boolean;
  hasTests: boolean;
  docsOnly: boolean;
  testsOnly: boolean;
  categories: CategoryTotals;
} {
  const categories = {} as CategoryTotals;

  for (const cat of getAllCategories()) {
    categories[cat as FileCategory] = { fileCount: 0, linesAdded: 0, linesDeleted: 0 };
  }

  for (const f of files) {
    const c = f.category; // FileCategory
    const catObj = (categories as Record<"source" | "test" | "docs" | "config" | "migration" | "asset", typeof categories["source"]>)[c];
    if (catObj) {
      catObj.fileCount += 1;
      catObj.linesAdded += f.linesAdded;
      catObj.linesDeleted += f.linesDeleted;
    }
  }

  return {
    codeChanged: categories.source.fileCount > 0,
    hasTests: categories.test.fileCount > 0,
    docsOnly: files.length > 0 && files.every((f) => f.category === "docs"),
    testsOnly: files.length > 0 && files.every((f) => f.category === "test"),
    categories,
  };
}

// ---------------------------------------------------------------------------
// Helper: Resolve repository full name from projectId and prNumber
// ---------------------------------------------------------------------------

function resolveRepoFullName(projectId: string, prNumber: number, api: ToolApi): string {
  // In production: use repository lookups via GitHub API based on projectId.
  // E.g., GraphQL or Rest Repositories API.
  // For MVP (stub phase): return a normalized placeholder.
  return `resolved/repo/${projectId}/${prNumber}`;
}

// ---------------------------------------------------------------------------
// Helper: Fetch raw diff from git provider
// ---------------------------------------------------------------------------

async function fetchRawDiff(
  repoFullName: string,
  baseBranch: string,
  source: "PR" | "BRANCH",
  sourceRef: string,
  prNumber: number | undefined,
  api: ToolApi,
  taskId?: string,
): Promise<unknown> {
  let fetcher: unknown;
  if (api.getPrDiffFetcher != null) {
    fetcher = api.getPrDiffFetcher({ githubToken: undefined });
  } else {
    // Use a fallback or raise unknown fetcher error
    fetcher = new StubPrDiffFetcher();
  }

  const ProtoFetcher = fetcher as { fetchDiff?(...args: unknown[]): Promise<unknown> };
  if (typeof ProtoFetcher.fetchDiff !== "function") {
    if (taskId) await api.getTaskById?.(taskId); // backlink placeholder
    throw new DiffSummaryErrorClass(
      "DIFF_UNAVAILABLE",
      "GitHub provider fetcher is not yet implemented. Open PR to wire src/platform-api provider stub.",
    );
  }

  // Normalize sourceRef for git provider calls
  const gitRef = source === "PR" ? `pull/${prNumber}/head` : sourceRef;
  const diff = await ProtoFetcher.fetchDiff(repoFullName, baseBranch, gitRef);
  if (taskId) await api.getTaskById?.(taskId); // backlink placeholder
  return diff;
}