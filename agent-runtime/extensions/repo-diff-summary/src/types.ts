// Core types for the repos.pull_request_diff_summary MCP tool.
//
// These mirror the response contract in the PRD (FR-4). They are the single
// source of truth for the DiffSummaryResult shape used by the classifier,
// the tool, and its tests.

/** The closed set of file categories (FR-3). */
export type FileCategory = "source" | "test" | "docs" | "config" | "migration" | "asset";

/** All categories, in a stable order. Used to build zeroed breakdowns. */
export const ALL_CATEGORIES: readonly FileCategory[] = [
  "source",
  "test",
  "docs",
  "config",
  "migration",
  "asset",
] as const;

/** The status of a file in a diff. */
export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffSummaryMeta {
  taskId?: string;
  prNumber?: number;
  branch?: string;
  baseBranch: string;
  repoFullName: string; // e.g. "org/repo"
  resolvedAt: string; // ISO-8601
  totalFilesChanged: number;
}

export interface CategoryBreakdown {
  fileCount: number;
  linesAdded: number;
  linesDeleted: number;
}

export type CategoryTotals = Record<FileCategory, CategoryBreakdown>;

export interface DiffSummaryFile {
  path: string;
  category: FileCategory;
  status: FileStatus;
  linesAdded: number;
  linesDeleted: number;
  previousPath?: string; // populated on rename
}

export interface DiffSummarySummary {
  codeChanged: boolean; // at least one "source" file
  hasTests: boolean; // at least one "test" file
  docsOnly: boolean; // ALL files are "docs"
  testsOnly: boolean; // ALL files are "test"
  categories: CategoryTotals;
}

export interface DiffSummaryResult {
  meta: DiffSummaryMeta;
  summary: DiffSummarySummary;
  files: DiffSummaryFile[];
}

/** A single changed file as returned by a git provider, before classification. */
export interface RawFileChange {
  path: string;
  status: FileStatus;
  linesAdded: number;
  linesDeleted: number;
  previousPath?: string;
  /** true when the provider reports the blob as binary (no textual line counts). */
  binary?: boolean;
}

/** Type guard: is the given string a valid FileCategory. */
export function isValidCategory(category: string): category is FileCategory {
  return (ALL_CATEGORIES as readonly string[]).includes(category);
}

/** Build a fresh, all-zero category totals record. */
export function emptyCategoryTotals(): CategoryTotals {
  const totals = {} as CategoryTotals;
  for (const category of ALL_CATEGORIES) {
    totals[category] = { fileCount: 0, linesAdded: 0, linesDeleted: 0 };
  }
  return totals;
}
