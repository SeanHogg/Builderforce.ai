> **PRD** — drafted by Ada (Sr. Product Mgr) · task #547
> _Each agent that updates this PRD signs its change below._

# Cross-Project Health Dashboard Artifact

## Problem & Goal

**Problem:** A single, consumable cross-project health artifact does not exist. Stakeholders cannot instantly assess the combined health status of all five tracked projects from a unified view. Without this artifact, Acceptance Criteria 1–10 for the “cross-project health dashboard” feature cannot be verified, and downstream reporting/decision-making relies on scattered data.

**Goal:** Produce a committed, version‑controlled artifact (`dashboard.md` or equivalent) that summarizes the health of all five projects in a clear, at‑a‑glance format. This artifact must be automatically generated from the latest project health inputs and stored in a predictable location, enabling verification of all ten acceptance criteria.

## Target Users / ICP Roles

- **Engineering Leads / VPs:** Needing a rapid pulse on multiple project health statuses for executive reviews.
- **Program Managers / TPMs:** Triaging risk, identifying stuck projects, and preparing status reports.
- **Product Owners:** Understanding cross‑team dependencies and flagging blockages.
- **Reliability / Platform Teams:** Monitoring aggregate health trends to prioritize interventions.

## Scope

- A single, static Markdown artifact saved to the repository root (or a defined output path).
- Computation and rendering of **health cards** for each of the five projects.
- Aggregation of health metrics into a dashboard summary: overall status, per‑project status, risk flags, and trend indicators.
- Data sourcing from existing project health data files or APIs that feed the artifacts.
- Automated generation pipeline (script or CI step) that creates/updates the artifact on each relevant code change or on a schedule.
- Artifact conforms to a predefined template for consistency and machine readability (where needed).

## Functional Requirements

**FR‑1:** The artifact must be a single file named `dashboard.md` located in the repository’s root directory.

**FR‑2:** The artifact must contain a **summary header** with:
  - Total number of projects (fixed at 5).
  - High‑level overall health status (e.g., “All Healthy,” “At Risk,” “Degraded”) derived from aggregated indicators.
  - Generation timestamp and data freshness information.

**FR‑3:** For each project, render a **health card** containing:
  - Project name and identifier.
  - Health status indicator (e.g., ✅ Healthy, ⚠️ Warning, ❌ Critical) based on defined rules.
  - Key metric(s) like build pass rate, test coverage, deployment frequency, outstanding critical bugs, or any custom health scores.
  - Most recent change or event that affected health (if available).
  - Link to that project’s detailed health report or dashboard (if one exists).

**FR‑4:** Dashboard overall status is derived from a weighted or rule‑based combination of all project statuses. Status definitions must be documented within the artifact (legend or footnote).

**FR‑5:** The artifact must be **regenerated automatically** whenever any of the five project health sources are updated. This may be implemented as a pre‑commit hook, CI job, or scheduled script; the exact mechanism is an implementation detail but must be documented in the PRD’s implementation notes.

**FR‑6:** The artifact must be **readable and self‑contained** – no external CSS or interactive elements required; pure Markdown that renders correctly on GitHub and similar viewers.

**FR‑7:** Data sourcing must be reproducible. The script/process that generates the artifact must read input files from a well‑known location (e.g., `projects/*/health.json`, or a consolidated `health-data.json`). The PRD must specify the expected input schema.

**FR‑8:** Edge cases: If a project’s health data is missing or malformed, the health card must display a placeholder status (e.g., “Unknown”) and an error indicator, while still producing the artifact for remaining projects. The overall dashboard status must reflect the unknown with a clear label.

**FR‑9:** The artifact must conform to a defined template to maintain visual consistency and enable simple parsing. A static example is provided in the implementation guide.

**FR‑10:** The generation process must log any issues (e.g., missing data, parsing errors) to standard output/error for monitoring.

## Acceptance Criteria

**AC‑1:** The file `dashboard.md` exists in the repository root after the generation process runs (or is committed as part of the build).

**AC‑2:** The artifact contains a dashboard summary with a clear overall health status that matches the aggregated status of all five projects.

**AC‑3:** Five individual health cards are present, one per project, including name, status indicator, key metric(s), and a link.

**AC‑4:** All status indicators use the defined legend (Healthy / Warning / Critical / Unknown) and match the underlying data.

**AC‑5:** When all projects are healthy, the overall dashboard status shows “All Healthy” (or equivalent) and no critical flags.

**AC‑6:** When at least one project is in Critical state, the overall dashboard status changes to “At Risk” (or equivalent) and a summary of critical projects is shown.

**AC‑7:** Missing or invalid data for a project results in an “Unknown” health card and the overall dashboard status reflects that clearly (e.g., “Partial Data” note).

**AC‑8:** The artifact regenerates automatically upon any change to the underlying health data within the repository (verified by making a change and re‑running the generation).

**AC‑9:** The artifact is valid Markdown, renders correctly in a standard viewer, and includes a legend explaining all status icons and terms.

**AC‑10:** The generation process logs errors for missing or malformed data but does not crash; the artifact is always written successfully (even if all data is missing, resulting in five “Unknown” cards).

## Out of Scope

- Real‑time streaming or websocket‑based updates; the artifact is a point‑in‑time snapshot.
- Interactive user interfaces or dynamic filtering; the artifact is a static document.
- Detailed per‑project drill‑down pages – those are handled by project‑specific artifacts.
- External integrations (Slack notifications, emails) based on health changes (to be addressed in a future iteration).
- Customization of health metric formulas beyond the initial rule set; initial rules are fixed but can be adjusted via configuration in the generation script.
- Duplication of the full per‑project health data inside the dashboard; only a summary is required.

## Requirements

> **Authored by:** Business Analyst (task #547, exec 24521+) · **Date:** 2026-08-03

### Stakeholder Needs & Use Cases

| # | Role | Scenario | Need |
|---|------|----------|------|
| R1 | VP Engineering | Prepares for weekly executive review | Scan all five projects' health status in under 30 seconds; see which projects need intervention |
| R2 | TPM / Program Manager | Triages risk across the portfolio | Identify the worst-off project and understand the single most critical blocker for each |
| R3 | Product Owner | Assesses cross-team dependency impact | Know whether a dependent project is healthy before committing to shared milestones |
| R4 | Platform / Reliability Lead | Monitors aggregate engineering health | See build pass rates and test health in one place to prioritise infrastructure investment |
| R5 | CEO / CTO | Monthly board deck preparation | One artefact that answers "how is engineering doing?" without drilling into individual boards |

### Data Model — Input Schema (FR‑7)

The dashboard generator accepts a single consolidated input file at `Builderforce.ai/frontend/src/dashboard/cross-project-health/portfolioHealthData.tsx` exporting two symbols:

```
ProjectHealth {
  id:              string;           // stable machine key (e.g. "builderforce-ai")
  name:            string;           // display name
  status:          "Active" | "On Hold" | "Paused";
  completionPct:   number | null;    // null = no tasks exist (N/A)
  taskSummary:     string;           // e.g. "13/19 done, 40 in backlog"
  keyBlocker:      string;           // single most critical impediment
  riskLevel:        "Low" | "Medium" | "High";
  riskRationale:   string;           // one-sentence justification
  recommendedAction: string;         // concrete, time-bound next step
  extras?: {
    okrEpicsActive?: number;
    failingTests?:   number;
    tasksInBacklog?: number;
    totalTasks?:     number;
    doneTasks?:      number;
  };
  rag?:             "Green" | "Amber" | "Red";  // manual override; else derived
}

PortfolioSummary {
  generatedAt:        string;          // ISO-8601 timestamp
  totalProjects:      number;          // fixed at 5
  greenCount:         number;
  amberCount:         number;
  redCount:           number;
  overall:            "Green" | "Amber" | "Red";
  topPriorityActions: { rank: 1|2|3; label: string }[];
}
```

Data sources (per project, for manual refresh):
- **BuilderForce.AI:** `builtin_tasks_list` (project 11) for completion counts; CI for test failures
- **Hired.Video:** project board task counts + build pipeline status
- **RumbleDating:** project board task counts (40 tasks, all backlog)
- **BurnRateOS:** project board status + task counts (9 in backlog, on hold)
- **pattysnob.com:** project existence check (shell only, no tasks)

### RAG Status Derivation Rules (FR‑4)

| RAG | Criteria | Example |
|-----|----------|---------|
| 🟢 **Green** | Active, >50% complete, no build failures, no stalled tasks | All tests green, >50% done, active sprint |
| 🟡 **Amber** | Active with known blockers; OR on hold with defined plan; OR 25–50% complete with risks present | Test failures but progress continues; intentional hold with review date |
| 🔴 **Red** | Build broken; OR 0% complete with active status; OR no tasks defined; OR stalled with no DRI | Broken CI, empty project shell, zero forward motion |

Overall portfolio status is the **worst-case denominator**: Red if any project is Red, Amber if any is Amber and none is Red, Green only when all five are Green.

### Non-Functional Requirements

| ID | Requirement | Rationale |
|----|-------------|-----------|
| NFR-1 | The artifact must render in a standard GitHub Markdown viewer with no external CSS or JS (FR‑6) | Stakeholders view it directly in the repo; zero setup |
| NFR-2 | The artifact must be scannable in ≤30 seconds by a human reader (FR‑2, FR‑3) | VP/CTO use case — at-a-glance decision support |
| NFR-3 | Regeneration must complete in under 60 seconds (FR‑5) | CI job or pre-commit hook; must not block developer workflow |
| NFR-4 | Missing/malformed data must never prevent artifact generation (FR‑8, AC‑10) | Graceful degradation — five "Unknown" cards are better than a missing file |
| NFR-5 | Status legend must be embedded in the artifact itself (FR‑9, AC‑9) | Self-contained — no cross-reference needed |
| NFR-6 | Artifact file size must not exceed 50 KB | Keeps the file lightweight for quick rendering and diff review |

### Edge Cases (FR‑8)

| Case | Behaviour |
|------|-----------|
| All five projects healthy | Overall status "All Healthy" (Green); no critical flags |
| One project has missing/null data | Card displays "⚠️ Unknown" status; overall status appends "(Partial Data)" |
| All five projects have missing data | Five "Unknown" cards; overall "Unknown — No Data"; artifact still written |
| Data file is valid JSON but a project entry is malformed (missing `name`) | Card displays "⚠️ Unknown — Malformed Entry"; error logged to stderr |
| Input file does not exist | Artifact written with five "Unknown" cards and a banner: "⚠️ Data source unavailable — regenerate after restoring portfolioHealthData" |
| A project transitions from Red→Amber→Green over successive regenerations | Each regeneration captures the snapshot at that point in time; trend is visible in git history |

### Glossary

| Term | Definition |
|------|------------|
| **Health Card** | A per-project Markdown section displaying status indicator, key metric, blocker, and recommended action |
| **RAG** | Red / Amber / Green traffic-light status derived from completion, blockers, and risk |
| **Portfolio Snapshot** | The summary header aggregating RAG counts and overall status across all five projects |
| **DRI** | Directly Responsible Individual — the person accountable for a project's forward motion |
| **Key Blocker** | The single most critical impediment preventing progress (one per project) |
| **Overall Status** | Worst-case RAG across the portfolio: Red if any project is Red |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._