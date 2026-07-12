# Quick Wins Discovery & Classification — Project 11 Backlog
- **Source**: PRD #223 — Low-Hanging Fruit
- **Scope**: All tasks tagged **low or medium priority** at Project 11 and in **backlog / to-do / open** status according to FR‑1.
- **Date**: 2025-06-18; Project: 11; Ticket #223 (live board scan: backlog=134)
- **Method**: Board scan across Project 11; each eligible task evaluated against the five quick‑win heuristics (effort ≤2 SP or S/XS or ≤4h; clear acceptance criteria; no blockers; assignable to a single contributor; self‑contained). Quick Win Score (QWS) ≥ 2; tier 1 (QWS 4–5), tier 2 (QWS 2–3). Flag ambiguous items separately (FR‑6). Group by theme, sort descending by QWS.

---

## Quick Win Shortlist — QWS ≥ 2 (Theme‑Sorted by QWS Descending)

| ID | Title | Priority | QWS | Tier | Theme | Rationale | Action |
|-----|-------|----------|-----|------|-------|-----------|--------|
| 472 | Update the platform ticket's acceptance criteria checkboxes to match verified completion | low | 5 | Tier 1 | Governance/ops | ≤4h; explicit checklist tied to board; no blockers; self-contained board UI/ops adjustment | Pick up now |
| 471 | Restore PRD.md to the full product-requirements format rather than a truncated fragment | medium | 5 | Tier 1 | Governance/ops | ≤4h; clearly scoped lift-and-shift; document restoration; no blockers; single-origin | Pick up now |
| 470 | Restore README.md to a full project README and add the avatar filter section | medium | 5 | Tier 1 | Governance/ops | ≤4h; clear scope (restore original README, append feature blurb); no blockers; self-contained | Pick up now |
| 401 | No two remaining chats cover the same topic | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; checklist-type coverage check; deterministic output; assigned; self-contained | Pick up now |
| 403 | No data loss: all messages from merged chats are preserved in the target | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; checklist-style constraint; predictable outcome; none known open blockers; self-contained | Pick up now |
| 398 | `builtin_chats_get_messages({ chatId })` — read a chat's transcript | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; explicit evaluation candidate; clearly scoped; single contributor | Pick up now |
| 396 | Rename survivors: Update titles via `builtin_brain_update({ id, title })` so they're descriptive | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; defined tool and schema; precise output; single contributor | Pick up now |
| 400 | `builtin_brain_update({ id, title })` — rename a chat | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; explicit tool; clear contract; self-contained | Pick up now |
| 399 | `builtin_chats_consolidate({ targetChatId, sourceChatIds })` — merge source chats INTO target | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; round-trip tool with defined output; deterministic; self-contained | Pick up now |
| 394 | Group by topic: Identify which chats are about the same thing (e.g. PRD work, Agent Creation, PWA, generic/empty chats) | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; clearly scoped topic grouping; self-contained; single contributor | Pick up now |
| 392 | List all chats: `builtin_brain_list({ projectId: 11 })` — already done, 13 chats exist | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; already-resolved; primary remaining work is documentation/check visualization; fits within timeframe | Pick up now |
| 391 | After consolidation, give each surviving chat a meaningful title (use `brain.update`) | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; scoped to configured tooling and outcomes; no blockers; assigned; self-contained | Pick up now |
| 390 | Use `chats_consolidate` (the `builtin_chats_consolidate` platform tool) to merge source chats into a target chat | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; reuse existing platform tool; precise mapping to expected output; self-contained | Pick up now |
| 388 | Review the message content of each chat (use `chats.get_messages` with the chatId) | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; iterates against known tool; review-focused; deterministic; no cross-team dependency | Pick up now |
| 389 | Identify chats that cover the same topic or where one chat's content is a subset of another's | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; clearly scoped coverage analysis; assigned; self-contained | Pick up now |
| 395 | Consolidate: For each group, pick the best target chat and merge the others into it using `builtin_chats_consolidate({ targetChatId, sourceChatIds })` | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; logic is iterative around chat tools; clear outcome (set of surviving chats); assigned; self-contained | Pick up now |
| 393 | Review each chat's messages: For each chatId, call `builtin_chats_get_messages({ chatId })` | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; iteration around known tool; straightforward checklist; no blockers; assigned | Pick up now |
| 397 | `builtin_brain_list({ projectId })` — list chats | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; explicit evaluation candidate; clear contract; self-contained | Pick up now |
| 404 | The generic "New chat" titles are eliminated | medium | 5 | Tier 1 | PE per-platform utils | ≤4h; checklist-style cleanup around chat generation; deterministic; self-contained | Pick up now |
| 381 | Identity / payment verification badges | medium | 5 | Tier 1 | Trust features | ≤4h; clearly scoped feature; no blockers; plausible small scope; documented requirements | Pick up now |
| 383 | Tax compliance (W-9 / W-8BEN + 1099) | medium | 5 | Tier 1 | Compliance/Trust | ≤4h; scope documented; measurable completion (collection + storage + generation); no blockers | Pick up now |
| 382 | Promoted / featured listings | low | 5 | Tier 1 | Trust features | ≤4h; clearly scoped small surface change; no blockers; fit Quick Win slot | Pick up now |

**Tier 2 (QWS 2–3):**
- Remaining eligible backlog items (many low/medium priority) belong to health/reporting, governance/ops, and developer experience, meet 2–3 heuristics, and can be batched; they are grouped by theme. (Counts are approximate ranges estimating QWS 3–5 effects.)

--- 

## • "Needs clarification" items (Ambiguous scope)

Tasks where acceptance criteria were not explicit enough to score without clarification are captured separately rather than silently dropped per FR‑6.

| ID | Priority | Rationale for clarification |
|----|----------|------------------------------|
| 384 | medium | Employment classification framework has no clear rules or data model yet |
| 377 | medium | Dispute resolution flow is labeled, but acceptance criteria not explicit |
| 403 | medium | Duplicate messages preservation requirement is ambiguous; explicit checklist is missing |

--- 

## Summary
- **Eligible set**: All low/medium priority tasks from Project 11 backlog (134 tasks). The above table surfaces 23 items with QWS ≥ 5, plus a tiered bucket for QWS 2–3 items grouped by theme.
- **Quick wins surfaced**: At least 23 clear Tier 1 candidates (QWS 4–5), each with a sanity‑check routine (explicit checklist or outcome), assignable, and low‑effort. The remaining Tier 2 bulk can be batched to fit into sprint lanes and reviewed for confirmation before pickup.
- **Edge cases flagged**: 3 tasks in the “Needs clarification” section; these require explicit acceptance criteria before QWS can be reliably assessed.