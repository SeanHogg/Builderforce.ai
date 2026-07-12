// core types for DiffSummaryResult and tool metadata

export interface DiffSummaryMeta {
  readonly taskId?: string;
  readonly prNumber?: number;
  readonly branch?: string;
  readonly baseBranch: string;
  readonly repoFullName: string;
  readonly resolvedAt: string; // ISO-8601 timestamp (date-time)
  readonly totalFilesChanged: number;
}

export interface FileChange {
  readonly path: string;
  readonly category: FileCategory;
  readonly status: "added" | "modified" | "deleted" | "renamed";
  readonly linesAdded: number;
  readonly linesDeleted: number;
  readonly previousPath?: string; // populated when status is renamed
}

export interface CategoryBreakdown {
  readonly fileCount: number;
  readonly linesAdded: number;
  readonly linesDeleted: number;
}

export interface DiffSummaryResult {
  readonly meta: DiffSummaryMeta;
  readonly summary: {
    readonly codeChanged: boolean; // true if at least one source file present
    readonly hasTests: boolean; // true if at least one test file present
    readonly docsOnly: boolean; // true iff all files are docs, else false
    readonly testsOnly: boolean; // true iff all files are tests, else false
    readonly categories: {
      readonly source: CategoryBreakdown;
      readonly test: CategoryBreakdown;
      readonly docs: CategoryBreakdown;
      readonly config: CategoryBreakdown;
      readonly migration: CategoryBreakdown;
      readonly asset: CategoryBreakdown;
    };
  };
  readonly files: readonly FileChange[];
}

export enum FileCategory {
  Source = "source",
  Test = "test",
  Docs = "docs",
  Config = "config",
  Migration = "migration",
  Asset = "asset",
}

export enum ExecutionStatus {
  Added = "added",
  Modified = "modified",
  Deleted = "deleted",
  Renamed = "renamed",
}

const ALL_CATEGORIES: ReadonlyArray<KeyOf<typeof FileCategory>> = [
  "source",
  "test",
  "docs",
  "config",
  "migration",
  "asset",
] as const;

/** Helper to assert FileCategory is a valid enum value */
export const isValidCategory = (category: string): category is FileCategory =>
  Object.values(FileCategory).includes(category as FileCategory);

export function getAllCategories(): readonly string[] {
  return ALL_CATEGORIES;
}

/** Ensure summary totals match the aggregated files array for each category. */
export function assertCategoryTotals(
  summaries: DiffSummaryResult["summary"]["categories"],
  files: readonly FileChange[]
): void {
  for (const cat of ALL_CATEGORIES) {
    const s = summaries[cat as FileCategory];
    const count = files.filter((f) => f.category === cat as FileCategory).length;
    const linesAdded = files
      .filter((f) => f.category === cat as FileCategory)
      .reduce((acc, f) => acc + f.linesAdded, 0);
    const linesDeleted = files
      .filter((f) => f.category === cat as FileCategory)
      .reduce((acc, f) => acc + f.linesDeleted, 0);
    if (count !== s.fileCount || linesAdded !== s.linesAdded || linesDeleted !== s.linesDeleted) {
      throw new TypeError(
        `Category total mismatch for ${cat}: expected ` +
          `${{ fileCount: count, linesAdded, linesDeleted }}, got ` +
          `${{ fileCount: s.fileCount, linesAdded: s.linesAdded, linesDeleted: s.linesDeleted }}`
      );
    }
  }
}