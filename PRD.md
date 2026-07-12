> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #294
> _Each agent that updates this PRD signs its change below._

# PRD: Responses Saved as Project Health Baseline

## Problem & Goal

Teams using AI-assisted workflows lack a persistent, referenceable snapshot of the state of a project at a meaningful point in time. Without a "health baseline," there is no structured way to compare future AI responses, metrics, or findings against an established ground truth — making it difficult to detect drift, regression, or improvement over time.

**Goal:** Enable users to designate and persist a set of AI responses as a named project health baseline that can be referenced, compared against, and audited at any future point in the project lifecycle.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Engineering Leads / Tech Leads** | Establish a code-quality or architecture baseline after a major refactor or release |
| **Project Managers** | Capture a status-health snapshot at the start of a sprint or milestone |
| **QA / Test Engineers** | Lock in a test-coverage or risk-assessment baseline to measure regression against |
| **AI Ops / Prompt Engineers** | Version and compare model response quality over time for a given project context |
| **Product Managers** | Record a product-health snapshot before and after feature launches |

---

## Scope

This PRD covers:

- Saving one or more AI responses as a named, versioned project health baseline
- Storing baseline metadata (timestamp, author, project context, tags)
- Surfacing baselines for review and comparison within the product UI
- Basic diff/comparison between a current response and a baseline response

---

## Functional Requirements

### FR-1 — Baseline Creation
- Users can select one or more AI responses within a project and designate them as a health baseline.
- Users must provide a **baseline name** (required) and optional **description** and **tags**.
- The system records: creator identity, creation timestamp, project ID, and the full content of each saved response.
- A baseline is immutable once saved; its content cannot be edited (only annotated or superseded).

### FR-2 — Baseline Versioning
- Each baseline is assigned a monotonically incrementing **version number** scoped to the project (e.g., `v1`, `v2`).
- Users can create a new baseline version without deleting the prior version.
- A project may have multiple named baseline streams (e.g., `performance-baseline`, `security-baseline`).

### FR-3 — Baseline Storage & Retrieval
- Baselines are persisted in durable storage tied to the project.
- Users can list all baselines for a project, filterable by name, tag, date range, and author.
- Individual baselines are retrievable by ID, name, or version.

### FR-4 — Baseline Comparison
- Users can select any two baselines — or a baseline and a current response — to run a **side-by-side diff**.
- The diff highlights additions, deletions, and unchanged sections at the paragraph or structured-block level.
- A **health delta summary** is generated: a short, AI-assisted narrative describing meaningful changes between the two states.

### FR-5 — Baseline Promotion & Status
- A baseline can be marked as **active** (the current reference point) or **archived**.
- Only one baseline per named stream may be active at a time; promoting a new baseline auto-archives the previous active one.
- Active baselines are surfaced prominently in the project dashboard.

### FR-6 — Notifications & Audit Trail
- All baseline create, promote, and archive actions are logged in a tamper-evident audit trail.
- Project members with appropriate permissions receive in-app notifications when a new baseline is promoted.

### FR-7 — Permissions
- Baseline creation and promotion require at minimum **Editor** role on the project.
- Baseline viewing and comparison are available to all project members with **Viewer** role or above.
- Baseline deletion (hard delete) is restricted to **Owner/Admin** role.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | A user with Editor role can save a response as a baseline; the saved record contains the full response content, author, timestamp, project ID, name, and auto-assigned version number. |
| AC-2 | A saved baseline cannot be modified after creation; any attempt to edit content returns an error. |
| AC-3 | Listing baselines for a project returns all baselines sorted by creation date descending, with correct pagination (≤ 50 per page default). |
| AC-4 | Side-by-side diff renders correctly for two baselines with at least one addition, one deletion, and one unchanged block. |
| AC-5 | Promoting a new baseline to active status automatically sets the previously active baseline in the same stream to archived. |
| AC-6 | All baseline lifecycle actions appear in the audit log within 5 seconds of the action completing. |
| AC-7 | A Viewer-role user can view and compare baselines but receives a permission error when attempting to create or promote one. |
| AC-8 | The health delta summary is generated and displayed within 10 seconds of initiating a comparison for responses up to 10,000 tokens. |

---

## Out of Scope

- **Real-time / continuous monitoring:** Automatic health scoring or alerting based on live AI output drift is not included in this release.
- **Cross-project baselines:** Baselines are scoped strictly to a single project; cross-project baseline templates are a future consideration.
- **Branching baseline history:** Git-style branching of baseline streams is not supported; only linear versioning per named stream.
- **External integrations:** Exporting baselines to third-party project management tools (Jira, Linear, Notion, etc.) is out of scope for v1.
- **Automated baseline scheduling:** Programmatic or scheduled auto-creation of baselines (e.g., nightly snapshots) is deferred.
- **Binary / media responses:** Baselines containing non-text artifacts (images, files, code execution outputs) are not supported in v1; text responses only.
- **Baseline merging:** Merging two baseline streams into one is not supported.