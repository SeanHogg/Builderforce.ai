> **PRD** — drafted by Validator · task #619
> _Each agent that updates this PRD signs its change below._

# PRD — Validator Sweep: Confirm Real Code Delivery on 100%/Done Tickets (Chat #58 Remediation)

---

## Problem & Goal

**Problem:** Several tickets in the active backlog are marked `100%` or `done` but may have reached that status on the back of documentation-only or PRD-only pull requests, with no functional implementation code merged. This creates false confidence in delivery progress, hides real engineering debt, and risks downstream agents building on absent foundations.

**Goal:** Execute a single, authoritative validation sweep across seven identified tickets (and their subtasks). For each ticket, determine whether real implementation code was delivered. Tickets that pass remain closed; tickets that fail are immediately reopened, recorded as gaps, and rescheduled with coder + tester assignments. A concise summary is posted to chat #58.

---

## Target Users / ICP Roles

| Role | Interest |
|---|---|
| Engineering Lead / Tech PM | Needs accurate delivery status before sprint commitments |
| Downstream Feature Agents | Must not build on missing service/component foundations |
| QA / Tester Agents | Need to know which tickets require test coverage from scratch |
| Stakeholder / Product Owner | Requires honest progress reporting |

---

## Scope

**In scope:**

- Tickets: **#157, #322, #329, #336, #481, #503 (+ subtasks #504–508), #146**
- Inspection method: branch/PR diff review, confirming presence and non-triviality of named source files
- Output actions: `reviews.record` verdict per ticket, gap filing for failures, chat #58 summary post

**Out of scope:**

- Code quality review, performance benchmarking, or security audit of delivered files
- Any ticket not listed above
- Refactoring decisions or architecture changes
- Sprint re-planning beyond rescheduling gap tickets

---

## Functional Requirements

### FR-1 — Per-Ticket Review Record

For **each** of the seven ticket targets, the validator agent **must** call `reviews.record` with:

| Field | Required value |
|---|---|
| `ticket_id` | The canonical ticket number |
| `verdict` | `complete` or `gaps` |
| `checked_artifacts` | List of file paths or PR numbers inspected |
| `summary` | One paragraph describing what was found |
| `action` | `close` (complete) or `reopen + schedule` (gaps) |

---

### FR-2 — Ticket-Specific Acceptance Criteria for `complete` Verdict

**#157 — Diagnostic Report epic**

- `diagnosticReport.ts` exists, is non-trivial (> boilerplate; contains real diagnostic logic), and is present in a merged or in-review PR
- `ReportDashboard.tsx` exists with real render logic (not a stub or placeholder)
- If either file is absent or is a stub, verdict = `gaps`
- Note: `0/0 subtasks` with `100%` is a red-flag signal; reviewer must explicitly confirm file presence

**#322 — Recommendations: specific, actionable, data-linked**

- At least one source file (service, hook, or component) contains logic that generates recommendations linked to real data sources
- Pure documentation (markdown, PRD) does **not** satisfy this requirement
- If the PR diff contains only `.md` or config files, verdict = `gaps`

**#329 — Monitoring connected?**

- This ticket's stated deliverable is an **analysis/decision document** confirming monitoring connectivity
- A well-formed analysis artifact (even non-code) satisfies `complete` for this ticket only
- Reviewer must confirm the artifact is substantive (not a one-liner or placeholder)

**#336 — Recommendations for missing integrations**

- Same bar as #322: implementation code generating or surfacing integration recommendations must exist
- Doc-only PR → `gaps`

**#481 — Provision infra/cloud-security agent**

- Deliverable is a **provisioning decision record** (infrastructure config, IaC file, or documented provisioning decision)
- A substantive decision artifact satisfies `complete`; an empty or placeholder doc does not

**#503 + subtasks #504–508 — Stakeholder Alignment Diagnostic**

- `StakeholderMapService.ts` must exist and contain non-trivial service logic
- Stakeholder schema definition file must exist (TypeScript interface, Zod schema, or equivalent)
- Migration file `0340_stakeholder_maps.sql` must exist with valid DDL
- **All three** artifacts must be present; missing any one → verdict = `gaps` for the affected subtask(s) and the epic
- Each subtask (#504–508) receives its own `reviews.record` entry

**#146 — Cross-project health dashboard epic (PR #303)**

- `CrossProjectHealthDashboard.tsx` must exist in PR #303 diff
- Component must contain real render/data-fetch logic, not a stub
- If file is absent from the PR diff or is a stub/placeholder, verdict = `gaps`

---

### FR-3 — Gap Filing

For every ticket with verdict = `gaps`:

- File a gap record linking back to the original ticket
- Tag: `needs-coder`, `needs-tester`
- Set status: `reopened`
- Flag for sprint scheduling in the next available slot
- Do **not** allow the original `100%`/`done` status to persist

---

### FR-4 — Chat #58 Summary Post

After all `reviews.record` calls are complete, post a single summary message to **chat #58** containing:

- Sweep date and operator
- One-line verdict per ticket (`✅ complete` or `🔴 gaps — reopened`)
- Total count: X of Y tickets confirmed complete, Z reopened
- Next-step note for any reopened tickets

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | `reviews.record` has been called once per ticket scope item (minimum 11 records: #157, #322, #329, #336, #481, #503, #504, #505, #506, #507, #508, #146 = 12 records) |
| AC-2 | Every `complete` verdict is backed by at least one non-trivial source code file citation in `checked_artifacts` (except #329 and #481, which accept substantive analysis artifacts) |
| AC-3 | Every `gaps` verdict has a corresponding gap record filed with `needs-coder` and `needs-tester` tags and `reopened` status |
| AC-4 | No ticket originally marked `100%`/`done` off a doc-only PR retains `complete` status after the sweep |
| AC-5 | Chat #58 summary post is present, timestamped, and lists all verdicts |
| AC-6 | The sweep completes in a single pass with no tickets left in an ambiguous/uninspected state |

---

## Out of Scope

- Fixing or writing any missing implementation code (that is a coder agent responsibility, post-sweep)
- Writing tests for any ticket (tester agent responsibility, post-gap-filing)
- Reviewing tickets outside the seven listed targets
- Changing sprint capacity, roadmap priorities, or OKRs
- Aesthetic or UX review of any delivered components
- Security or dependency audits of merged code

---

*Document owner: Validator Agent · Sweep target: Chat #58 remediation · Version: 1.0 · Status: WIP/Active*