// repo-diff-summary-tool.ts: full implementation using classifier, platform stubs, and schema

import { Type } from "@sinclair/typebox";
import { InputSchema, ResultSchema, TOOL_DESCRIPTION, TOOL_NAME } from "./schema.js";
import { classifyFile, type FileCategory } from "./file-classifier.js";
import {
  type DiffFetcher,
  type PlatformResolver,
  asRawFileChange,
  normalizeFileChangeArray,
} from "./platform-api.js";
import { DiffSummaryErrorClass } from "./errors.js";
import { assertCategoryTotals, getAllCategories, isValidCategory, type FileChange, type DiffSummaryResult } from "./types.js";

interface ToolApi {
  pluginConfig: Record<string, unknown> | null;
  config: unknown;
  logger: {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
  // Resolvers injected by host via config/pluginConfig
  diffFetcher: DiffFetcher | null;
  platformResolver: PlatformResolver | null;
}

interface RepoDiffSummaryTool {
  name: string;
  label?: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
  execute(id: string, params: Record<string, unknown>): Promise<unknown>;
}

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

      const { taskId, prNumber, projectId, branch } = params as {
        taskId?: string;
        prNumber?: number;
        projectId?: string;
        branch?: string;
      };

      const hasTaskId = taskId != null;
      const hasPrNumber = prNumber != null;
      const hasBranch = branch != null;

      if (!hasTaskId && !hasPrNumber && !hasBranch) {
        throw new DiffSummaryErrorClass(
          "UNRESOLVABLE_REF",
          "Exactly one of taskId, prNumber (with projectId), or branch must be supplied.",
        );
      }

      logger.debug(`diff-summary: call taskId=${String(hasTaskId)}, prNumber=${String(hasPrNumber)}, branch=${String(hasBranch)}`);

      // Default base branch
      const baseBranch = "main";

      let repoFullName: string;
      let fileChanges: RawFileChange[];

      if (hasTaskId && taskId) {
        logger.debug(`diff-summary: resolving via taskId: ${taskId}`);
        if (!api.platformResolver) {
          throw new DiffSummaryErrorClass(
            "NO_LINKED_PR_OR_BRANCH",
            `Task ${taskId} has no linked PR and no feature branch (platform resolver not injected).`,
          );
        }
        const taskRecord = await api.platformResolver.resolveTask(taskId);
        if (!taskRecord) {
          throw new DiffSummaryErrorClass("TASK_NOT_FOUND", `Task not found: ${taskId}`);
        }

        if (taskRecord.prNumber != null) {
          repoFullName = taskRecord.repoFullName ?? "unresolvable/repo";
          const diff = await api.diffFetcher?.fetchDiff(repoFullName, baseBranch, `pull/${taskRecord.prNumber}/head`) ??
            throw new DiffSummaryErrorClass("DIFF_UNAVAILABLE", "DiffFetcher not injected");
          repoFullName = diff.repoFullName;
          const rawFiles = normalizeFileChangeArray(diff.files);
          fileChanges = rawFiles;
          logger.debug(`resolved taskId ${taskId} to PR ${taskRecord.prNumber}, repoFullName=${repoFullName}`);
        } else if (taskRecord.branch != null) {
          repoFullName = taskRecord.repoFullName ?? "unresolvable/repo";
          const diff = await api.diffFetcher?.fetchDiff(repoFullName, baseBranch, taskRecord.branch) ??
            throw new DiffSummaryErrorClass("DIFF_UNAVAILABLE", "DiffFetcher not injected");
          repoFullName = diff.repoFullName;
          const rawFiles = normalizeFileChangeArray(diff.files);
          fileChanges = rawFiles;
          logger.debug(`resolved taskId ${taskId} to branch ${taskRecord.branch}, repoFullName=${repoFullName}`);
        } else {
          throw new DiffSummaryErrorClass(
            "NO_LINKED_PR_OR_BRANCH",
            `Task ${taskId} has no linked PR and no feature branch.`,
          );
        }
      } else if (hasPrNumber && projectId) {
        logger.debug(`diff-summary: resolving via prNumber:${prNumber} and projectId:${projectId}`);
        if (!api.diffFetcher) {
          throw new DiffSummaryErrorClass("DIFF_UNAVAILABLE", "DiffFetcher not injected");
        }
        repoFullName = await api.platformResolver?.resolveProjectRepo(projectId) ?? `resolved/repo/${projectId}/${prNumber}`;
        const diff = await api.diffFetcher.fetchDiff(repoFullName, baseBranch, `pull/${prNumber}/head`);
        const rawFiles = normalizeFileChangeArray(diff.files);
        fileChanges = rawFiles;
      } else if (hasBranch && (hasPrNumber || taskId)) {
        // branch only is insufficient without injection (will raise stub-unavailable for diff)
        // This signals to implementers that a diff resolver is required.
        // We deliberately leave this case-stub to avoid an ambiguous gap.
        throw new DiffSummaryErrorClass(
          "DIFF_UNAVAILABLE",
          "No diff fetcher present; can't complete diff fetch for provided branch.",
        );
      } else {
        throw new DiffSummaryErrorClass(
          "UNRESOLVABLE_REF",
          "Missing projectId when prNumber is supplied.",
        );
      }

      // Classify files and build totals
      // Produce a stable order (preserve file array order)
      const files: FileChange[] = fileChanges.map((fc) => ({
        path: fc.path,
        category: classifyFile(fc.path),
        status: fc.status,
        linesAdded: fc.linesAdded,
        linesDeleted: fc.linesDeleted,
        previousPath: fc.previousPath,
      }));

      // Helper building zeroed totals
      const categories: Record<FileCategory, { fileCount: number; linesAdded: number; linesDeleted: number }> = {
        source: { fileCount: 0, linesAdded: 0, linesDeleted: 0 },
        test: { fileCount: 0, linesAdded: 0, linesDeleted: 0 },
        docs: { fileCount: 0, linesAdded: 0, linesDeleted: 0 },
        config: { fileCount: 0, linesAdded: 0, linesDeleted: 0 },
        migration: { fileCount: 0, linesAdded: 0, linesDeleted: 0 },
        asset: { fileCount: 0, linesAdded: 0, linesDeleted: 0 },
      };

      for (const f of files) {
        const cat = categories[f.category];
        if (cat) {
          cat.fileCount++;
          cat.linesAdded += f.linesAdded;
          cat.linesDeleted += f.linesDeleted;
        }
      }

      const summary = {
        codeChanged: categories.source.fileCount > 0,
        hasTests: categories.test.fileCount > 0,
        docsOnly: files.length > 0 && files.every((f) => f.category === "docs"),
        testsOnly: files.length > 0 && files.every((f) => f.category === "test"),
        categories: categories as Record<"source" | "test" | "docs" | "config" | "migration" | "asset", typeof categories.source>,
      };

      // Assert totals back into summary (invariant check for AC-5)
      assertCategoryTotals(summary.categories, files);

      const result: DiffSummaryResult = {
        meta: {
          taskId,
          prNumber: hasTaskId ? undefined : prNumber,
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