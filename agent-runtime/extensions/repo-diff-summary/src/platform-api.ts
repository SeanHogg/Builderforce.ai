// Types for platform integration — repository APIs for diff fetching and task resolution.
// The real implementation will live in src/plugins/helpers or a separate platform provider.
// This file exists so repo-diff-summary-tool.ts can depend on them at build time.

import { type DiffSummaryErrorClass } from "./errors.js";

// ---------------------------------------------------------------------------
// Module: data
// ---------------------------------------------------------------------------

interface RawFileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  linesAdded: number;
  linesDeleted: number;
  previousPath?: string;
  binary?: boolean; // true when the provider reports the blob as binary
}

interface GitProviderDiffResponse {
  files: readonly RawFileChange[];
  baseBranch: string;
  changedFiles: number;
  repoFullName: string; // "org/repo"
  resolvedAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Module: platform
// ---------------------------------------------------------------------------

interface TaskRecord {
  id: string;
  projectId: string;
  prNumber?: number;
  branch?: string;
  repoFullName?: string;
  // Future: state, assignee, etc.
}

interface PlatformContext {
  // Resolve taskId → task record
  resolveTask(taskId: string): TaskRecord | Promise<TaskRecord>;

  // Resolve projectId → repo URL (for repo API calls)
  resolveProjectId(projectId: string): string | Promise<string>;
}

// ---------------------------------------------------------------------------
// Module: GitHub provider (stub)
// ---------------------------------------------------------------------------

interface PrDiffFetcher {
  // In production: fetch PR diff from GitHub GraphQL or commits API.
  // For MVP, we raise a configured unavailable error so the tool detects the stub stage.
  fetchPrDiff(projectId: string, prNumber: number): GitProviderDiffResponse | Promise<GitProviderDiffResponse>;
}

// ---------------------------------------------------------------------------
// Concrete stubs (for transport of platform APIs)
// ---------------------------------------------------------------------------

export class StubPrDiffFetcher implements PrDiffFetcher {
  fetchPrDiff(projectId: string, prNumber: number): GitProviderDiffResponse {
    // Not implemented in this stub; use GitProvider implementation in REFACTOR.
    // Normalizing to the same error-brand as the real implementation.
    throw new DiffSummaryErrorClass(
      "DIFF_UNAVAILABLE",
      "PR diff fetch is currently in stub stage.",
    );
  }
}

export class StubPlatformResolver implements PlatformContext {
  async resolveTask(taskId: string): Promise<TaskRecord> {
    throw new DiffSummaryErrorClass(
      "TASK_NOT_FOUND",
      `Task not found: ${taskId}`,
    );
  }

  async resolveProjectId(projectId: string): Promise<string> {
    return projectId;
  }
}

// Export for provisioning in tests and later integration.
export { GitProviderDiffResponse, TaskRecord, PlatformContext, PrDiffFetcher, RawFileChange };