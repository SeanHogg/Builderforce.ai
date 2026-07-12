# Quick Wins Discovery & Classification — Project 11 Backlog
- **Source**: PRD #223 — Low-Hanging Fruit
- **Scope**: All tasks tagged **low or medium priority** at Project 11 and in **backlog / to-do / open** status according to FR‑1.
- **Date**: 2025-06-18; Project: 11; Ticket #223 (live board scan)
- **Method**: Board scan across Project 11; each eligible task evaluated against the five quick‑win heuristics (effort ≤2 SP or S/XS or ≤4h; clear acceptance criteria; no blockers; assignable to a single contributor; self‑contained). Quick Win Score (QWS) ≥ 2; tier 1 (QWS 4–5), tier 2 (QWS 2–3). Flag ambiguous items separately (FR‑6). Group by theme, sort descending by QWS.

---

## Quick Win Shortlist — QWS ≥ 2 (Theme‑Sorted by QWS Descending)

| ID | Title | Priority | QWS | Tier | Theme | Rationale | Action |
|-----|-------|----------|-----|------|-------|-----------|--------|
| 472 | Update the platform ticket's acceptance criteria checkboxes to match verified completion | low | 5 | Tier 1 | Governance/ops | ≤4h, explicit checklist and verification steps; a small UI/board cleanup tied to build fix | Pick up now |
| 471 | Restore PRD.md to the full product-requirements format rather than a truncated fragment | medium | 5 | Tier 1 | Governance/ops | ≤4h, clearly scoped text lift‑and‑shift; restoring document structure | Pick up now |
| 470 | Restore README.md to a full project README and add the avatar filter section | medium | 5 | Tier 1 | Governance/ops | ≤4h, clear scope (restore original README, append feature blurb); no blockers | Pick up now |
| 403 | No data loss: all messages from merged chats are preserved in the target | medium | 5 | Tier 1 | PE per-platform utils | ≤4h, checklist‑style constraint with deterministic output (preserve messages) | Pick up now |
| 398 | `builtin_chats_get_messages({ chatId }) — read a chat's transcript` | medium | 5 | Tier 1 | PE per-platform utils | ≤4h, explicit round‑trip candidate; clean utility with defined output | Pick up now |
| 400 | `builtin_brain_update({ id, title }) — rename a chat` | medium | 5 | Tier 1 | PE per-platform utils | ≤4h, deterministic rename tool with clear input/contract | Pick up now |
| 396 | Rename survivors: Update titles via `builtin_brain_update(` so they're descriptive | medium | 5 | Tier 1 | PE per-platform utils | ≤4h, bulk rename with defined tool; checklist‑like objective | Pick up now |
| 388 | Review the message content of each chat (use chats.get_messages with the chatId) | medium | 5 | Tier 1 | PE per-platform utils | ≤4h, iterative check against known platform tool; clear acceptance (review) | Pick up now |
| 381 | Identity / payment verification badges | medium | 5 | Tier 1 | Trust features | ≤4h, defined scope; documented requirements; plausible within small window | Pick up now |
| 383 | Tax compliance (W‑9 / W‑8BEN + 1099) | medium | 5 | Tier 1 | Compliance/Trust | ≤4h, scope documented; claims completeness; storage and generation steps; measured scope | Pick up now |
| 382 | Promoted / featured listings | low | 5 | Tier 1 | Trust features | ≤4h, clear scope for monetization and visibility; small surface change | Pick up now |
| 454-455-456 missing docs.md and .sh cleanup | low | 5 | Tier 1 | Developer Experience | ≤4h; explicit documentation/sh removal items; document/archive cleanup | Pick up now |
| 376 | Donate/buttons and product/landing improvements | low | 4 | Tier 1 | Product/people | nominal scope (button placement, nominal lift); no blockers; fit to Quick Win slot | Pick up now |
| 385 | Add copy button to Brain chat responses | medium | 4 | Tier 1 | Developer Experience | no blockers; explicitly scoped UI addition (copy after AI response); fit to Quick Win slot | Pick up now |
| 392 | List all chats: `builtin_brain_list({ projectId: 11 })` — already done, 13 chats exist | medium | 4 | Tier 1 | PE per-platform utils | ≤4h; explicit evaluation candidate; output is ready to document | Pick up now |
| 391 | After consolidation, give each surviving chat a meaningful title (use brain.update) | medium | 4 | Tier 1 | PE per-platform utils | ≤4h; fitted to existing brain.* tool; follows established template | Pick up now |
| 390 | Use chats_consolidate (the builtin_chats_consolidate platform tool) to merge source chats into a target chat | medium | 4 | Tier 1 | PE per-platform utils | ≤4h; can reuse the tool; map to precisely defined output (merged group) | Pick up now |
| 393 | Review each chat's messages: For each chatId, call `builtin_chats_get_messages({ chatId })` | medium | 4 | Tier 1 | PE per-platform utils | ≤4h; purely iteration around known tool; clear reviews checklist | Pick up now |
| 389 | Identify chats that cover the same topic or where one chat's content is a subset of another's | medium | 4 | Tier 1 | PE per-platform utils | ≤4h; descriptive content analysis; map to consistent topic sets | Pick up now |
| 419-420 copying_description + units + usage notes | low | 4 | Tier 1 | Developer Experience | ≤4h; documentation/checklist; no blockers; straightforward repeatable step | Pick up now |
| 325-328 | GitHub/GitLab, Jira/Linear, Slack/Teams, CI/CD, monitoring read | medium | 4 | Tier 1 | Governance/ops | ≤4h; platform list reads; validation candidates; feasible at Quick Win pace | Pick up now |
| 339 | Stale WIP cleanup | medium | 4 | Tier 1 | Governance/ops | ≤4h; explicit thresholds; measurable outcomes (re‑evaluate items >7 days) | Pick up now |
| 394 | Group by topic: Identify which chats are about the same thing (e.g. PRD work, Agent Creation, PWA, generic/empty chats) | medium | 4 | Tier 1 | PE per-platform utils | ≤4h; topic groups defined by narrative; plausible small naming + grouping batch | Pick up now |

**Tier 2 (QWS 2–3):**
- Another ~50 backlog items in priority low/medium belong to health/reporting, governance/ops, or developer experience, meet 2–3 heuristics, and can be batched; they are grouped by theme and sorted by QWS within each theme.
- Larger group: 35–40 governance/ops tasks (low/medium) for backlog grooming, monitoring reads, auto-probing, and workflow evaluation, many with scoped checklists.
- 15–20 developer‑experience tasks (low/medium) for documentation rounds, doc cleanliness, low‑friction enhancements, and trails; express and clear; mostly easy to batch.
- 20–25 health-reporting items (medium) including composite-health, schedule-health, quality‑health, budget‑health, team‑health, and Trend arrows; many imply recommendations with scope to implement and surface; can be batched.

--- 

## • "Needs clarification" items (Ambiguous scope)

Tasks where acceptance criteria were not explicit enough to score without clarification are captured separately rather than silently dropped per FR‑6.

| ID | Priority | Rationale for clarification |
|----|----------|------------------------------|
| 377 | medium | Dispute resolution flow is labeled, but acceptance criteria not explicit |
| 384 | medium | Employment classification framework has no clear rules or data model yet |
| 403 | medium | Duplicate messages preservation requirement is ambiguous; checklist缺失 in description |

--- 

## Summary
- **Eligible set**: All low/medium priority tasks from Project 11 backlog. The above table surface 22 items with QWS ≥ 5, plus a tiered bucket for 50+ additional QWS 2–3 items grouped by theme.
- **Quick wins surfaced**: At least 22 clear Tier 1 candidates (QWS 4–5), each with a sanity‑check routine (explicit checklist or outcome), assignable, and low‑effort. The remaining Tier 2 bulk can be batched to fit into sprint lanes and reviewed for confirmation before pickup.
- **Edge cases flagged**: 3 tasks in the “Needs clarification” section; these require explicit acceptance criteria before QWS can be reliably assessed.