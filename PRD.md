> **PRD** — drafted by John Coder ((V2) (Durable)) · task #616
> _Each agent that updates this PRD signs its change below._

# PRD: MCP Tool — PR/Branch Diff Summary by Change Category

## Problem & Goal

### Problem

Agents operating on the MCP platform cannot programmatically distinguish a PR that delivers working implementation code from one that contains only documentation, configuration, or other non-code artifacts. When an agent evaluates task completion, it must manually enumerate and read individual files from the diff — a fragile, expensive, and unreliable heuristic. This gap caused task #615 to be marked 100% complete based on a doc-only PR.

### Goal

Expose a first-class MCP tool — `repos.pull_request_diff_summary` — that accepts a task identifier (or PR/branch reference) and returns a structured, categorized summary of every changed file, with line-count metrics and derived boolean signals. Agents and the board UI can consume this signal to gate completion status, enforce review policies, and surface accurate delivery visibility without hand-inspection.

---

## Target Users / ICP Roles

| Consumer | Usage |
|---|---|
| **Autonomous agents** (primary) | Gate task completion; detect doc-only vs. code PRs automatically |
| **Orchestrator / board logic** | Flag tasks where `docsOnly === true` despite a "Done" status |
| **Human reviewers / tech leads** | Quick diff triage during code review without opening GitHub |
| **CI/policy enforcement hooks** | Assert that a feature task includes at least one `source-code` file change before merge |

---

## Scope

### In Scope

- New MCP tool: `repos.pull_request_diff_summary`
- Resolution of a `taskId` → PR/branch automatically (agents need not know the PR number)
- Per-file classification into a fixed category taxonomy
- Per-category aggregated line-count metrics (additions, deletions, net)
- Top-level derived boolean signals (`codeChanged`, `docsOnly`, `testsChanged`, `configOnly`)
- Support for both open and merged PRs; fall back to branch-vs-default-base diff when no PR exists
- MCP tool-surface documentation so agents discover the tool via capability introspection

### Out of Scope

- Semantic analysis of file content (classification is path/extension-based only; see classification rules below)
- Inline diff rendering or patch content
- Comment or review thread summarization
- Triggering any side-effects (read-only tool)
- Changes to existing `executions.task_file_changes` schema (additive, not mutating)
- UI surface changes beyond surfacing the signal that already exists in task cards (owned by #615)

---

## Functional Requirements

### FR-1 Tool Identity & Invocation

| ID | Requirement |
|---|---|
| FR-1.1 | The tool MUST be registered under the namespace `repos` with the name `pull_request_diff_summary`. |
| FR-1.2 | The tool MUST accept the following mutually-exclusive primary inputs (resolved in priority order): `taskId` (string), `prNumber` + `projectId` (integers), `branchName` + `projectId` (strings). |
| FR-1.3 | When `taskId` is supplied, the tool MUST resolve the associated PR or branch automatically using the existing task→VCS linkage; it MUST NOT require the caller to supply `prNumber` or `projectId`. |
| FR-1.4 | The tool MUST be listed in the MCP capability manifest with a human-readable description and parameter schema so agents discover it via `mcp.list_tools()` or equivalent introspection. |

### FR-2 File Classification

| ID | Requirement |
|---|---|
| FR-2.1 | Every changed file MUST be assigned exactly one category from the following closed taxonomy: `source-code`, `test`, `docs`, `config`, `migration`, `asset`. |
| FR-2.2 | Classification MUST be path/extension-based and follow the default rules in the table below. |
| FR-2.3 | Classification rules MUST be overridable per-repository via an optional `.mcp-diff-categories.yml` config file at the repo root (same pattern as `.gitattributes`). |
| FR-2.4 | When a file matches multiple rules, the most specific rule (longest path glob match) wins; ties resolve by taxonomy order as listed in FR-2.1 (test > source-code, etc.). |

**Default Classification Rules**

| Category | Path / Extension Patterns |
|---|---|
| `test` | `**/*.test.*`, `**/*.spec.*`, `**/test/**`, `**/tests/**`, `**/__tests__/**`, `**/_test.*` |
| `docs` | `**/*.md`, `**/*.mdx`, `**/*.rst`, `**/*.txt`, `**/docs/**`, `**/documentation/**`, `LICENSE*`, `CHANGELOG*` |
| `migration` | `**/migrations/**`, `**/migrate/**`, `**/*.migration.*`, `**/*.sql` |
| `config` | `**/*.json`, `**/*.yaml`, `**/*.yml`, `**/*.toml`, `**/*.ini`, `**/*.env*`, `**/.*rc`, `**/Makefile`, `**/Dockerfile*`, `**/*.config.*` |
| `asset` | `**/*.png`, `**/*.jpg`, `**/*.svg`, `**/*.gif`, `**/*.ico`, `**/*.woff*`, `**/*.ttf` |
| `source-code` | Everything else not matched above |

### FR-3 Response Payload

The tool MUST return a JSON object conforming to the following structure:

```jsonc
{
  // Resolution metadata
  "taskId": "string | null",
  "prNumber": "integer | null",
  "projectId": "integer",
  "branchName": "string",
  "baseBranch": "string",
  "prState": "open | merged | closed | branch-only",

  // Derived boolean signals — top-level for fast agent consumption
  "codeChanged": "boolean",       // true if any source-code file has additions > 0
  "testsChanged": "boolean",      // true if any test file changed
  "docsOnly": "boolean",          // true iff codeChanged === false && at least one docs file changed
  "configOnly": "boolean",        // true iff only config/asset files changed, no source-code or tests

  // Per-category rollup
  "summary": {
    "<category>": {
      "fileCount": "integer",
      "additions": "integer",
      "deletions": "integer",
      "net": "integer"            // additions - deletions
    }
    // one entry per category that has at least one file; absent categories omitted
  },

  // Totals across all categories
  "totals": {
    "fileCount": "integer",
    "additions": "integer",
    "deletions": "integer",
    "net": "integer"
  },

  // Per-file detail
  "files": [
    {
      "path": "string",
      "category": "source-code | test | docs | config | migration | asset",
      "status": "added | modified | deleted | renamed | copied",
      "additions": "integer",
      "deletions": "integer",
      "previousPath": "string | null"   // populated for renamed/copied files only
    }
  ]
}
```

### FR-4 Error Handling

| ID | Requirement |
|---|---|
| FR-4.1 | If `taskId` cannot be resolved to a PR or branch, the tool MUST return a structured error with code `TASK_NOT_LINKED` and a human-readable message. |
| FR-4.2 | If the PR/branch does not exist or the agent lacks read permission, return error code `NOT_FOUND` or `FORBIDDEN` respectively. |
| FR-4.3 | Binary files (images, compiled artifacts) with indeterminate line counts MUST be included in `files[]` with `additions: 0, deletions: 0` and classified normally. |
| FR-4.4 | The tool MUST NOT throw unhandled exceptions; all error states MUST return the MCP standard error envelope. |

### FR-5 Performance

| ID | Requirement |
|---|---|
| FR-5.1 | Response MUST be returned within 5 seconds (p95) for PRs with fewer than 500 changed files. |
| FR-5.2 | For PRs exceeding 500 files, the tool MAY truncate `files[]` at 500 entries (sorted by additions desc) and MUST set a top-level `"truncated": true` flag with `"totalFileCount"` reflecting the true count. |
| FR-5.3 | Results MUST be cached per `(prNumber, headSha)` tuple with a TTL of 60 seconds to avoid redundant VCS API calls when multiple agents query the same PR. |

---

## Acceptance Criteria

| # | Criterion | Verified By |
|---|---|---|
| AC-1 | Calling `repos.pull_request_diff_summary({ taskId: "<id>" })` returns a valid response without requiring `prNumber` or `projectId` from the caller. | Integration test with a linked task |
| AC-2 | Response includes `summary` keyed by category, with correct `fileCount`, `additions`, `deletions`, `net` for each category present in the diff. | Unit test against a fixture diff with known file types |
| AC-3 | `docsOnly` is `true` when every changed file is classified as `docs` or `asset`, and `false` when any `source-code` file is present. | Unit test with doc-only and mixed fixture diffs |
| AC-4 | `codeChanged` is `true` when at least one `source-code` file has `additions > 0`. Deletions alone do not set `codeChanged`. | Unit test with delete-only source-code diff |
| AC-5 | The tool appears in `mcp.list_tools()` output with a description, parameter schema, and example call. | Snapshot test of capability manifest |
| AC-6 | Supplying an unlinked `taskId` returns error code `TASK_NOT_LINKED` with HTTP-equivalent status 422. | Integration test with an unlinked task fixture |
| AC-7 | A renamed file appears once in `files[]` with `status: "renamed"` and `previousPath` populated, classified by its new path. | Unit test with a rename fixture |
| AC-8 | A PR with 600 changed files returns `truncated: true`, `totalFileCount: 600`, and exactly 500 entries in `files[]`. | Unit test with a generated 600-file fixture |
| AC-9 | Response time is under 5 seconds (p95) for a 499-file PR against the staging VCS backend. | Load test in CI |
| AC-10 | A repository with a `.mcp-diff-categories.yml` override correctly reclassifies files per the custom rules. | Integration test with an override fixture repo |

---

## Out of Scope

- **Patch / hunk content**: The tool returns metadata only; no raw diff text or inline code is returned.
- **Semantic classification**: File purpose is not inferred from AST, imports, or content — only from path and extension.
- **Mutations**: The tool is strictly read-only; it triggers no labels, comments, or status checks.
- **`executions.task_file_changes` schema changes**: That endpoint is not modified; this is a net-new tool.
- **UI rendering**: Board/card display of the signal is owned by task #615, not this PRD.
- **Non-Git VCS**: Only Git-backed repositories are in scope for this iteration.
- **Diff between arbitrary commits**: The tool only resolves via PR or branch-vs-base; freeform SHA-to-SHA diffing is a future extension.
- **Notification or webhook delivery**: Signal is pull-only; no push/event integration in this iteration.