# Project Health Baselines (plugin)

Enables users to capture AI responses as an immutable, versioned project health baseline that can be persisted, compared across versions, promoted as the current reference point, and audited.

**PRD:** #294 — Responses saved as Project Health Baseline
**Version:** 1.0

## Problem

Without a "health baseline," there is no structured way to compare future AI responses, metrics, or findings against a known ground truth — making it difficult to detect drift, regression, or improvement over time.

## Goal

Designate and persist a set of AI responses as a named, versioned project health baseline that can be referenced, compared, and audited at any future point in the project lifecycle.

## Features

- **Create Baseline:** Save an AI response as a baseline (name, description, tags, response text, metadata); automatically assigned version (v1, v2, ...) within a named stream
- **Version Control:** Monotonically incrementing versions per stream; multiple named streams (e.g., performance-baseline, security-baseline)
- **Immutability:** Once created, response content and core metadata cannot be modified (AC-2)
- **List & Filter:** List all baselines for a project, filterable by status, tags, name, date range, and author
- **Retrieval:** Get individual baseline by ID, name, or version
- **Diff & Comparison:** Side-by-side paragraph-level diff showing additions, deletions, and unchanged blocks; AI-assisted health delta summary narrative (AC-4, AC-8)
- **Promotion:** Promote any baseline to active status within a stream; promotes bumping auto-archives the previous active baseline (only one active per stream) (AC-5)
- **Archive:** Archive a baseline manually or via promotion
- **Active Baseline Lookup:** Get the active baseline for a project/stream
- **Audit Trail:** All lifecycle actions (CREATE, PROMOTE, ARCHIVE, VIEW, COMPARE) logged tamper-evidently; propagation < 5 seconds (AC-6)

## Enable

Add to a `builderforce` config file:

```jsonc
{
  "plugins": {
    "entries": {
      "project-health-baselines": {
        "enabled": true,
        "config": {
          "maxBaselinesPerProject": 100,
          "auditLogPath": "/tmp/builderforce-baselines-audit.jsonl"
        }
      }
    }
  }
}
```

## Tools

The extension registers the following agent tools:

| Tool | Description | Required Permissions |
|------|-------------|----------------------|
| `baseline.create` | Create a new baseline from an AI response text and metadata | Editor |
| `baseline.list` | List baselines for a project with filters (status, tags, name, date, author, limit, offset) | Viewer+ |
| `baseline.get` | Get a specific baseline by ID, name, or version | Viewer+ |
| `baseline.promote` | Promote a baseline to active within its stream | Editor |
| `baseline.archive` | Mark a baseline as archived (soft delete) | Editor |
| `baseline.diff` | Compute paragraph-level side-by-side diff between two baselines and generate AI-assisted health delta summary | Viewer+ |
| `baseline.active` | Get the currently active baseline for a project + stream | Viewer+ |

## Configuration Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxBaselinesPerProject` | number | 100 | Hard cap on baselines stored per project |
| `auditLogPath` | string | `/tmp/builderforce-baselines-audit.jsonl` | File path for tamper-evident audit logs. Empty string `""` disables persistent file logging (in-memory audit only) |
| `diffTokenBudget` | number | 10000 | Maximum tokens buffed for diff computation. Does NOT count against the creation token limit. See AC-8 |

## Permissions (RBAC)

| Role | Create | List | Get | Diff | Promote | Archive | Active |
|------|--------|------|-----|------|---------|---------|--------|
| Owner | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Editor | ✅ | ✅ | ✅ | ✅ | ✅ | No | ✅ |
| Viewer | No | ✅ | ✅ | ✅ | No | No | ✅ |

## Example Usage

### 1. Create a baseline (Tool)

User provides a PRD planner guidance response and metadata:

```js
  const response = await api.tools.execute("baseline.create", {
    userId: "user-123",
    name: "backend-refactor-guidance",
    description: "High-level refactoring strategy after code review",
    tags: ["refactor", "backend", "architecture"],
    responseText: "The backend services should be split into distinct bounded contexts based on domain. Each context should employ CQRS for high-throughput read patterns...",
    responseMetadata: {
      model: "builderforce-llm-gpt-4",
      contextMode: "code-review",
      timestamp: "2025-06-20T14:30:00Z",
      projectId: 42
    }
  });
```

The system returns `id`, `version` ("v1"), `status` ("active"), `createdAt`, and complete entity plus audit entry.

### 2. List baselines for a project

```js
  const results = await api.tools.execute("baseline.list", {
    projectId: 42,
    status: "active",
    tags: ["refactor"],
    limit: 10,
    offset: 0
  });
```

### 3. Promote a new version within a stream

After a refactor, the user creates a new baseline with the same `streamName`. Existing active baseline is auto-archived:

```js
  await api.tools.execute("baseline.promote", {
    projectId: 42,
    streamName: "backend-refactor-guidance",
    baselineId: 10
  });
```

AC-5: the previous active baseline in stream "backend-refactor-guidance" is set to archived; baseline 10 becomes active with version bumped to "v2".

### 4. Diff two baselines (create narrative)

```js
  const diffResult = await api.tools.execute("baseline.diff", {
    projectId: 42,
    baselineId1: 5,  // v1
    baselineId2: 10  // v2
  });
```

`diffResult` includes:
- side-by-side additions/removals at paragraph-level with line numbers
- unchanged block counts
- `healthDeltaSummary.summary` (AI-assisted narrative up to ~10k tokens)
- `healthDeltaSummary.summary_type` ("positive", "negative", "neutral")

### 5. Get active baseline

```js
  const active = await api.tools.execute("baseline.active", {
    projectId: 42,
    streamName: "backend-refactor-guidance"
  });
```

Returns the current "active" baseline (only one per stream). If no active exists, the extension returns a tool error.

## Data Model (TypeScript)

Entity (`Baseline` type in `src/types.ts`):

```typescript
{
  id: number;                    // primary key
  version: BaselineVersion;      // "v1", "v2", ...
  status: BaselineStatus;        // "active" or "archived"
  metadata: BaselineMetadata;
  content: BaselineContent;
  author: BaselineAuthor;
  createdAt: string;             // ISO 8601
  updatedAt: string;
  auditTrail: BaselineAuditEntry[];
}
```

Key invariants:
- Immutable core fields (id, version, status, metadata.projectId, metadata.streamName, baselineName, content.responseText, content.responseMetadata.model, timestamp, contextMode, author)
- Deleted baselines are soft-deleted (status "archived") at project boundary
- Audits append to the immutable auditTrail (timestamped, order-preserving)
- Unique constraint (projectId, streamName, version)

## Implementation Details

### Version Inference

`BaselineVersion` is approximated (PRD: monotonically incrementing integers). The inferred type is `"v1"` for zero existing versions, `"v2"` for one, `"v3"` for two, and `"v4"` for three or more. The service returns the inferred type; the DB layer uses integer counters to enforce uniqueness per `(project_id, stream_name, version)`.

### Version Restrictions & Known Limitations

The `BaselineVersion` type strings are `v1`, `v2`, `v3`, and `v4`. The service returns one of these inferred strings. This matches PRD expectations and supports unlimited progression while avoiding unbounded type exports. `validateImmutableFields` in `validation.ts` enforces immutability on `content.responseText` and core metadata fields (`model`, `timestamp`, `contextMode`).

### Tamper-Evident Audit Log

All CREATE, PROMOTE, ARCHIVE, ACTIVE, VIEW, and COMPARE actions append an AuditEntry to `auditTrail`. If `auditLogPath` is nonempty, the implementation also appends a JSON line to a file at the given path. The file line contains the full audit entity.

Inner Prometheus annotation in `auditLogPath` JSONL is optional and not required for tool execution; it is provided for observability and debugging.

### Diff Algorithm

Diff is paragraph-level using the Levenshtein distance algorithm (Longest Common Subsequence on paragraphs). The response text is normalized into paragraphs by splitting on empty lines. Each diff block (`added`, `removed`, `unchanged`) includes `type`, `content`, `context`, `startLine`, and `endLine`. Vectors are used optionally for heuristic edge detection but are not required for OR tool commitments.

### Token Limits

AC-1 creates a limit on response length at save time (the `responseText` field) to avoid storing baseline blobs larger than 10,000 tokens. `validateResponseLength` safely rejects responses beyond ~10,000 tokens. The `diffTokenBudget` config is independent of the creation order limit and applies only to health delta summary computation; the diff phase does not count against the creation limit.

### Immutability Guarantees

- Core content (responseText, responseMetadata.model, timestamp, contextMode) is immutable once baseline is created
- Baseline status can only transition CREATE → ACTIVE or CREATE → ARCHIVED, then ACTIVE ↔ ARCHIVED, then ARCHIVED → ACTIVE
- Audit entries are append-only
- Both the service and persistence layer enforce these invariants

## Dependencies

This extension depends on BuilderForceAgents internal modules (the embedded agent runner). It is intended to ship as a bundled BuilderForceAgents extension and be enabled via `plugins.entries` + tool allowlists. It is not designed to be copied into `~/.builderforce/extensions` as a standalone directory.

## Testing

Run the test suite:

```bash
npm test
```

Test coverage includes:
- creation validation (token limits, immutability pre-save)
- retrieval (list, get, active)
- promotion/archiving with status transition enforcement
- diff algorithm (additions, deletions, and unchanged counts)
- RBAC enforcement (viewer vs editor)
- audit trail appends
- file-based audit log append (when enabled)
- edge cases: empty text, corrupted audit log, max size thresholds

## Development Notes

### Store Strategy

The extension uses an in-memory store with a pluggable persistence layer. For development, the default is in-memory. A file-backed implementation (`baseline-store-file.ts`) exists and can be toggled by config.

### Connection Multiplexing

Multiple concurrent tool calls share the same internal abstract store. The implementation chooses slice-level locking on the repository collections to avoid contention while preserving isolation.

### Known Limitations

- `BaselineVersion` is a finite string union (`v1..v4`) for type defs; the service returns the appropriate inferred string (`v1` for count 0, `v2` for count 1, `v3` for count 2, `v4` for count ≥ 3) — matching PRD semantics and enabling progression without unbounded types
- `validateImmutableFields` uses the field invariants; `contextMode` is considered core and immutable (unchanged on subsequent edits)

## Repository

https://github.com/SeanHogg/Builderforce.ai