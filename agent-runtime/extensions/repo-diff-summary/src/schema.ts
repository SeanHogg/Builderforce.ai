// TypeBox schema and tool metadata for repos.pull_request_diff_summary
//
// This mirrors PRD FR-1 (tool signature) and FR-6 (tool discovery).

import { Type } from "@sinclair/typebox";

export const TOOL_NAME = "repos.pull_request_diff_summary";

// One-line description required by FR-6. It must be present and non-empty when
// returned by tools/list; it is validated by AC-6.
export const TOOL_DESCRIPTION =
  "Returns a categorized file-change summary (source/test/docs/config/migration/asset) for a task's PR or branch, with line counts and codeChanged/docsOnly flags.";

// ---------------------------------------------------------------------------
// Input schema (TypeBox)
// ---------------------------------------------------------------------------

export const InputSchema = Type.Object(
  {
    taskId: Type.Optional(
      Type.String({
        description: "Preferred; task identifier whose linked PR and repo context will be resolved.",
      }),
    ),
    prNumber: Type.Optional(
      Type.Number({
        description: "Fallback PR number when taskId is unavailable. Requires projectId to scope the repo lookup.",
      }),
    ),
    projectId: Type.Optional(
      Type.String({
        description: "Required when using prNumber; scopes the repository lookup.",
      }),
    ),
    branch: Type.Optional(
      Type.String({
        description: "Fallback: a branch name to diff against the default branch.",
      }),
    ),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Response shape schema (TypeBox) — human-readable + machine-validated
// ---------------------------------------------------------------------------

const CategoryBreakdownSchema = Type.Object({
  fileCount: Type.Number({ description: "Number of files in this category." }),
  linesAdded: Type.Number({ description: "Total lines added across files in this category." }),
  linesDeleted: Type.Number({ description: "Total lines deleted across files in this category." }),
});

export const CategoryTotalsSchema = Type.Object({
  source: CategoryBreakdownSchema,
  test: CategoryBreakdownSchema,
  docs: CategoryBreakdownSchema,
  config: CategoryBreakdownSchema,
  migration: CategoryBreakdownSchema,
  asset: CategoryBreakdownSchema,
});

export const SummarySchema = Type.Object({
  codeChanged: Type.Boolean({
    description: "True when at least one file has category source.",
  }),
  hasTests: Type.Boolean({
    description: "True when at least one file has category test.",
  }),
  docsOnly: Type.Boolean({
    description: "True when every file in files[] is in category docs.",
  }),
  testsOnly: Type.Boolean({
    description: "True when every file in files[] is in category test.",
  }),
  categories: CategoryTotalsSchema,
});

export const FileSchema = Type.Object({
  path: Type.String({ description: "Repository-relative path to the changed file." }),
  category: Type.String({
    enum: ["source", "test", "docs", "config", "migration", "asset"],
    description: "Canonical file category. Each file is assigned exactly one category.",
  }),
  status: Type.String({
    enum: ["added", "modified", "deleted", "renamed"],
    description: "Change kind as reported by the git provider.",
  }),
  linesAdded: Type.Number({ description: "Lines added in this file." }),
  linesDeleted: Type.Number({ description: "Lines removed from this file." }),
  previousPath: Type.Optional(
    Type.String({ description: "Previous path when status is renamed." }),
  ),
});

export const MetaSchema = Type.Object({
  taskId: Type.Optional(Type.String()),
  prNumber: Type.Optional(Type.Number()),
  branch: Type.Optional(Type.String()),
  baseBranch: Type.String({ description: "Default branch name used as the diff base." }),
  repoFullName: Type.String({ description: 'Repo full name, e.g. "org/repo".' }),
  resolvedAt: Type.String({ format: "date-time", description: "ISO-8601 timestamp when the summary was resolved." }),
  totalFilesChanged: Type.Number({ description: "Total files changed in the diff." }),
});

export const ResultSchema = Type.Object({
  meta: MetaSchema,
  summary: SummarySchema,
  files: Type.Array(FileSchema),
});

export const ErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String({
      enum: [
        "UNRESOLVABLE_REF",
        "PR_NOT_FOUND",
        "TASK_NOT_FOUND",
        "NO_LINKED_PR_OR_BRANCH",
        "DIFF_UNAVAILABLE",
        "REPO_PERMISSION_DENIED",
      ],
    }),
    message: Type.String(),
    hint: Type.String(),
  }),
});
