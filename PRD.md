> **PRD** — drafted by John Coder ((V2) (Durable)) · task #616
> _Each agent that updates this PRD signs its change below._

# PRD: MCP Tool — PR/Branch Diff Summary with File-Change Categorization

## Problem & Goal

### Problem
Agents operating on the MCP tool surface cannot programmatically determine whether a task's associated PR contains real implementation work or only documentation/configuration changes. Without this signal, agents (and the board) cannot distinguish a delivered feature from a doc-only PR, causing tasks to be marked complete when no functional code was shipped. This is the root visibility gap beneath task #615.

### Goal
Expose a new MCP tool — `repos.pull_request_diff_summary` — that, given a task ID (or PR number / branch name), returns a structured, categorized summary of every file changed in the associated PR or branch diff, with per-category line counts and derived boolean flags, so agents can gate completion logic without manual file inspection.

---

## Target Users / ICP Roles

| Consumer | Usage |
|---|---|
| Autonomous agents (e.g., the agent that filed gap #58) | Gate task completion; detect doc-only vs. code PRs |
| Board / orchestration layer | Surface a "code changed" indicator on task cards |
| Human reviewers using the MCP surface | Quick diff triage without opening GitHub/GitLab |
| CI/automation pipelines calling MCP tools | Enforce policy (e.g., block "done" status if `codeChanged === false`) |

---

## Scope

### In Scope
- New MCP tool: `repos.pull_request_diff_summary`
- Resolution chain: `taskId → PR/branch → diff → categorized file list`
- File classification into six canonical categories
- Per-file and per-category line-count aggregates
- Derived boolean summary flags (`codeChanged`, `docsOnly`, `testsOnly`, `hasTests`)
- Tool registration in the MCP tool manifest so agents can discover it via standard capability introspection
- Support for repos hosted on GitHub (MVP); extensible interface for GitLab/Bitbucket

### Out of Scope
- Modifying existing `executions.task_file_changes` (evaluated and deferred; kept as separate surface)
- Rendering a visual diff or patch content (line-level diffs)
- Code quality analysis, coverage deltas, or linting signals
- Automatic status transitions triggered by this tool (that is task #615's responsibility)
- Support for GitLab/Bitbucket (post-MVP)
- Monorepo sub-package attribution

---

## Functional Requirements

### FR-1 — Tool Signature

```typescript
repos.pull_request_diff_summary(input: {
  taskId?:    string;   // preferred; resolve to PR/branch internally
  prNumber?:  number;   // fallback if taskId unavailable
  projectId?: string;   // required when using prNumber; scopes the repo lookup
  branch?:    string;   // fallback: compare branch HEAD vs. default branch base
}): DiffSummaryResult
```

Exactly one of `taskId`, `prNumber`, or `branch` must be provided. When `taskId` is provided, `projectId` is resolved from the task record; it need not be supplied separately.

---

### FR-2 — Resolution Chain

1. Accept `taskId` → look up task record → extract linked PR number and repo/project context.
2. If no PR is linked, fall back to the task's feature branch vs. the repo's default branch.
3. If `prNumber` is supplied directly, use `projectId` to identify the repo.
4. If `branch` is supplied, diff that branch against the default branch HEAD.
5. Return a structured error (`UNRESOLVABLE_REF`) if none of the above yields a valid diff target.

---

### FR-3 — File Classification

Every file in the diff must be assigned exactly one category from the following closed set:

| Category | Classification Rules (applied in priority order) |
|---|---|
| `test` | Path matches `**/test/**`, `**/__tests__/**`, `**/*.test.*`, `**/*.spec.*`, `**/fixtures/**` |
| `docs` | Extension in `{.md, .mdx, .rst, .txt}` OR path matches `**/docs/**`, `**/documentation/**` |
| `config` | Extension in `{.json, .yaml, .yml, .toml, .ini, .env*}` OR filename in `{Dockerfile, .dockerignore, Makefile, .gitignore, .eslintrc*, .prettierrc*}` |
| `migration` | Path matches `**/migrations/**`, `**/migrate/**`; OR filename matches `\d+_*.sql` |
| `asset` | Extension in `{.png, .jpg, .jpeg, .gif, .svg, .ico, .mp4, .woff, .woff2, .ttf, .eot, .pdf}` |
| `source` | All remaining files not matched by the above |

Classification is case-insensitive. Rules are evaluated top-to-bottom; first match wins.

---

### FR-4 — Response Shape

```typescript
interface DiffSummaryResult {
  meta: {
    taskId?:      string;
    prNumber?:    number;
    branch?:      string;
    baseBranch:   string;
    repoFullName: string;       // e.g. "org/repo"
    resolvedAt:   string;       // ISO-8601
    totalFilesChanged: number;
  };

  summary: {
    codeChanged:  boolean;      // true if any file in category "source"
    hasTests:     boolean;      // true if any file in category "test"
    docsOnly:     boolean;      // true if ALL files are in {"docs"} only
    testsOnly:    boolean;      // true if ALL files are in {"test"} only
    categories: {
      [category in FileCategory]: {
        fileCount:    number;
        linesAdded:   number;
        linesDeleted: number;
      }
    };
  };

  files: Array<{
    path:         string;
    category:     FileCategory;  // "source"|"test"|"docs"|"config"|"migration"|"asset"
    status:       "added" | "modified" | "deleted" | "renamed";
    linesAdded:   number;
    linesDeleted: number;
    previousPath?: string;      // populated on rename
  }>;
}

type FileCategory = "source" | "test" | "docs" | "config" | "migration" | "asset";
```

---

### FR-5 — Error Cases

The tool must return structured errors (not unhandled exceptions) for the following conditions:

| Error Code | Condition |
|---|---|
| `UNRESOLVABLE_REF` | Cannot determine a PR or branch from the supplied inputs |
| `PR_NOT_FOUND` | `prNumber` supplied but not found in the resolved repo |
| `TASK_NOT_FOUND` | `taskId` supplied but no such task exists |
| `NO_LINKED_PR_OR_BRANCH` | Task exists but has no linked PR and no associated branch |
| `DIFF_UNAVAILABLE` | Repo API returned an error or diff is empty/inaccessible |
| `REPO_PERMISSION_DENIED` | MCP service lacks read access to the repo |

All errors include `code`, `message`, and `hint` fields.

---

### FR-6 — Tool Discovery

- The tool must be registered in the MCP tool manifest under the `repos` namespace.
- The tool's schema, parameter descriptions, and return shape must be included in the manifest so agents discover it via standard `tools/list` introspection without reading external documentation.
- A one-line `description` field must convey the categorization behavior: _"Returns a categorized file-change summary (source/test/docs/config/migration/asset) for a task's PR or branch, with line counts and codeChanged/docsOnly flags."_

---

### FR-7 — Performance

- Response must be returned within **5 seconds** for PRs up to 500 files changed.
- For PRs exceeding 500 files, the tool must still respond (no timeout/error) but may paginate the `files` array internally; the `summary` totals must always reflect the full diff.

---

## Acceptance Criteria

| # | Criterion | Verifiable By |
|---|---|---|
| AC-1 | `repos.pull_request_diff_summary({ taskId })` returns a valid `DiffSummaryResult` without requiring the caller to know `prNumber` or repo name. | Integration test: supply only `taskId` for a task with a linked PR. |
| AC-2 | Every file in the response is assigned exactly one category from the closed set; no file is uncategorized or multi-categorized. | Unit test: run classifier against a fixture set of 50 representative filenames covering all six categories and edge cases. |
| AC-3 | `summary.docsOnly === true` if and only if every file in `files[]` has `category === "docs"`. | Unit test with a docs-only PR fixture and a mixed PR fixture. |
| AC-4 | `summary.codeChanged === true` if and only if at least one file has `category === "source"`. | Unit test with a source-containing PR and a config-only PR. |
| AC-5 | `summary.categories` line-count totals equal the sum of `linesAdded`/`linesDeleted` across all `files[]` entries in that category. | Property-based test: assert sum invariant across randomized fixture PRs. |
| AC-6 | The tool appears in the response to `tools/list` with schema, parameter descriptions, and the required `description` string. | Integration test: call `tools/list`, assert `repos.pull_request_diff_summary` is present with non-empty `description` and input schema. |
| AC-7 | Supplying an unknown `taskId` returns `TASK_NOT_FOUND` error with `code`, `message`, and `hint` fields; no unhandled exception. | Integration test: supply a fabricated UUID. |
| AC-8 | A PR with 400 files returns a complete response (all files present, summary correct) within 5 seconds in the CI environment. | Load test fixture: use a real or mocked 400-file diff; assert response time p95 ≤ 5 s. |
| AC-9 | Renamed files populate `previousPath` and are counted once (not twice) in category totals. | Unit test with a rename-only PR fixture. |
| AC-10 | Downstream agent consuming the tool can derive `docsOnly` without reading `files[]` — the flag alone is sufficient for a boolean gate. | Code-review check: confirm no agent-side file-list iteration is required to obtain the flag. |

---

## Out of Scope

- Modifying or deprecating `executions.task_file_changes`
- Line-level patch content or hunk rendering
- Code quality, complexity, or test-coverage delta signals
- Automatically changing task status based on diff content (owned by task #615)
- GitLab, Bitbucket, or self-hosted Git provider support (post-MVP)
- Monorepo package-boundary attribution (e.g., mapping files to affected packages/services)
- Binary diff analysis (binary files are classified by extension and counted with `linesAdded: 0, linesDeleted: 0`)
- Caching or webhook-triggered pre-computation of diff summaries