# 💡 Idea — Read · Prove

> **Domain PRD — open work only.** Consolidated 2026-11-17 from the per-PRD specs that used to live in
> `docs/specs/NN-*.md`; every section was verified against the code that day. This file holds only
> what is left to build. Finished sections are archived word for word in `DONE.md` ("✅ RESOLVED 2026-11-17 — PRD NN:
> finished sections archived on consolidation"), with their § numbers kept, so a citation such as
> `PRD 38 §4.3` resolves to the `## PRD 38` section here (open) or to DONE.md (shipped).
> A gap in a PRD's numbering is a shipped section. Outstanding work is tracked in `ROADMAP.md` under **💡 Idea**.

**Holds:** Ideas, sessions, briefs, creation-canvas sessions, experiments as proof forms, surveys.

## Contents

- [Design — Creation Canvas](#design--creation-canvas)

---

## Design — Creation Canvas

> Consolidated 2026-11-17 from `docs/design/creation-canvas/README.md`, `DELIVERY-ARCHITECTURE.md`, `OPERATIONS.md` and `evidence/README.md`. Verified against code 2026-11-17: Shipped, with two small gaps.
> Finished sections are archived in DONE.md ("Design — Creation Canvas — finished sections, archived 2026-11-17"); headings are kept.
> `OPERATIONS.md` (runbook) and `evidence/` (the release-audit input contract) are operational documents rather than PRD text. `evidence/release-evidence.example.json` is named by `qa-e2e/src/canvas-release-audit.ts:51` and stays as a file.

### Recommendation — legacy entry points

| Existing entry | New behavior |
| --- | --- |
| `/workflows` | List sessions filtered to those containing Workflow objects |

**Remaining (verified 2026-11-17):**
- `/workflows` still renders its own `WorkflowsContent` list (`frontend/src/app/workflows/WorkflowsPageBody.tsx:3`) instead of the Create library filtered to Workflow objects. `/workflows/builder` (`WorkflowBuilderCanvasRedirect.tsx:20-29`), `/brainstorm` (`BrainstormCanvasRedirect.tsx`) and `/ide*` (`frontend/src/middleware.ts:224-234`) already forward into Create.

### Delivery sequence — Phase 4 Route consolidation

- Redirect legacy URLs only after migration telemetry shows saved links and session ownership are reliable.

**Remaining (verified 2026-11-17):**
- The redirects shipped, but the telemetry they were meant to wait for was never emitted: `creation_legacy_route_adapted` has no emitter (rg empty across `frontend/src`, `api/src`, `packages`). Either emit it from the three redirect clients and the middleware branch, or drop the event from the product-event family.

### Operations — Observe (product-event family)

- Track the PRD product-event family (`creation_session_*`, `creation_prompt_submitted`, `creation_object_*`, `creation_connection_added`, `creation_project*`, `creation_ai_evaluation_completed`, `creation_change_set_applied`, `creation_artifact_delivered`, `creation_agent_assigned`, `creation_tutorial_step_completed`, and `creation_legacy_route_adapted`) without recording prompt or object content.

**Remaining (verified 2026-11-17):**
- `creation_tutorial_step_completed` and `creation_legacy_route_adapted` are never emitted. The rest are, for example `creation_agent_assigned` at `frontend/src/components/creation-canvas/hooks/useCanvasProjectActions.ts:267`.
- Rollout gate 3 (`creation_sessions_nav`) is overtaken: no such flag exists, and Create is already the default nav group (`frontend/src/lib/navGroups.ts:142`). The release-environment validation in ROADMAP "Creation-session release gates" (Playwright matrix, capacity, a11y, drills through `pnpm canvas:audit`) is production validation. It is tooling that already exists (`qa-e2e/package.json:13-15`), not open build work.

### Delivery architecture — standing rule (keep)

New operational actions are not complete until they have a real adapter, a terminal deliverable record, an outcome correlation, and a journey test. Adapters live outside the Canvas component in `frontend/src/lib/creationDeliverables.ts`.
