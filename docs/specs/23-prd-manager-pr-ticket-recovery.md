# PRD 23 — Manager PR Review, Acceptance Evidence, and Ticket Recovery

> **Status:** ACTIVE · production audit completed 2026-08-10 · first runtime/reconciliation
> corrections implemented locally but not yet committed, deployed, or enabled in production.
> **Depends on:** [PRD 21 — Unified Experience](./21-prd-unified-experience.md) ·
> [Coordinated Role Participation](./PRD-coordinated-role-participation.md) ·
> [ROADMAP](../../ROADMAP.md).
> **Scope:** the Builderforce project Manager, open pull requests, their associated tickets,
> reviewer assignment, acceptance evidence, reconciliation, and safe backlog closure.

---

## 0 · The rule

**A ticket is not complete because an agent stopped, a PR exists, or a narrative says the work is
done. It is complete only when the requested outcome is present, the change is verified, required
reviewers have recorded evidence, and the PR has reached its policy-approved terminal state.**

The Manager is the accountable coordinator. It does not substitute its own confidence for delivery
evidence. It must assign the required producers and reviewers, observe their durable verdicts,
repair or escalate failures, and close the ticket only after the lifecycle is proved.

For IDEA → REAL, this is the final part of “REAL”: an idea that generated a PRD or an open PR but
never passed review and acceptance is not real.

---

## 1 · Why this PRD exists

The Builderforce project accumulated hundreds of open tickets and PRs while the product appeared
to have a Manager capable of assigning and completing them. Production evidence showed that the
visible queue was not an executable control loop:

1. reconciliation classified PRs but mostly wrote queue-shaped strings into an audit journal;
2. reviewer runs were dispatched but could finish without recording a verdict;
3. acceptance reviews and lane sign-offs were stored in separate evidence systems;
4. generated PRDs were counted as delivered files and could open documentation-only PRs;
5. every task wrote the same root `PRD.md`, creating artificial merge conflicts;
6. provider and GitHub failures retried without an effective recovery circuit; and
7. the production Manager was disabled, so no later sweep consumed otherwise actionable work.

The result was activity without convergence: agent executions and PR creation grew much faster
than merged changes or completed tickets.

---

## 2 · Production evidence

### 2.1 Snapshot boundary

Counts in this section are observations from 2026-08-10 and will change as users and automation
continue operating. The diagnostics queries, not these copied values, are the runtime source of
truth.

### 2.2 Pull requests and tickets

| Observation | Evidence |
|---|---:|
| GitHub open PRs | 495 |
| Internally recorded open PR rows | 729 |
| Stale internal-open surplus | 234 |
| Non-Done Builderforce tickets | 664 |
| Tickets with at least one internally open PR | 610 |
| Tickets pointing only to closed, unmerged PRs | 7 |
| Tickets with no internal PR | 47 |
| True `backlog` tickets | 43 |

The audited 495 GitHub PRs classified as:

| Disposition | Count |
|---|---:|
| Merge conflict / repair | 292 |
| Change-specific CI failure / repair | 155 |
| Shared infrastructure failure | 31 |
| Green and ready for review | 15 |
| Human investigation | 2 |

Additional quality signals:

- 318 PRs changed documentation only.
- 448 PRs changed the repository-wide root `PRD.md`.
- 453 PR descriptions said no test or build was run.
- All 495 had no recorded GitHub review decision at the audit boundary.

### 2.3 Manager and review evidence

Production project configuration showed:

- `enabled = false`;
- `allowAutoMerge = true`;
- `prMergePolicy = on_green`; and
- `requireSignoffToComplete = false`.

The system had dispatched 678 Manager sign-off executions: 597 completed and 81 failed. Across
all 678, the tool audit contained **zero** successful `builtin_kanban_signoff` calls. Recent
payloads correctly named the tool, exact `roleKey`, and exact `laneKey`; the runtime nevertheless
allowed the model to end without calling it.

The ledger contained 1,125 role sign-offs, but almost all were producer credits:

| Role | Sign-offs |
|---|---:|
| Business Analyst | 354 |
| Developer | 287 |
| Architect | 254 |
| Product Manager | 219 |
| QA Tester | 6 |
| Product Owner | 2 |
| Code Reviewer | 1 |
| Team Lead | 1 |
| Validator | 1 |

This distribution is not credible evidence of a functioning review process. It reflects automatic
producer attestation, not considered reviewer verdicts.

Acceptance validation used a second ledger: 59 `task_reviews` records across 37 tasks, with 38
`gaps` and 21 `complete` verdicts. These records do not satisfy `ticket_role_signoffs`, so a valid
Validator review cannot currently release a lane sign-off gate without an explicit bridge.

### 2.4 System errors

The system error log and grouped error tables showed:

- approximately 2,011 `prReconciliation.collection` GitHub GraphQL HTTP 403 errors and another
  approximately 2,010 sweep-level reports of the same failures;
- 10,964 failed executions, dominated by gateway HTTP 429 limits, exhausted cloud allowances,
  and unusable BYO provider credentials;
- historical terminal-transition races attempting to complete already failed/completed runs; and
- transient database and shared-build failures recorded as if the individual ticket were defective.

The PR reconciler retried permanent 403 authorization failures on the frequent cron. This created
error volume without increasing the probability of success.

---

## 3 · Root cause

```text
Manager disabled
    ↓
No project sweep consumes review/repair work
    ↓
Reconciler writes "queue_review" / "queue_repair_pr" journal labels
    ↓
Labels are mistaken for executable jobs
    ↓
Historical reviewer runs finish without mandatory signoff calls
    ↓
No reviewer evidence is published to the PR or matched to the lane slot
    ↓
PR stays open; ticket stays non-Done; another agent pass may create more PRD activity
```

There are five distinct defects:

1. **Configuration defect:** the Manager is disabled and signoff completion is optional.
2. **Dispatch defect:** reconciliation dispositions were not durable executable transitions.
3. **Runtime defect:** neither `finish` nor a no-tool model response required reviewer evidence.
4. **Evidence-model defect:** acceptance reviews and role sign-offs are separate, unbridged ledgers.
5. **Delivery-accounting defect:** a generated PRD could masquerade as an implementation file.

Provider failures amplified these defects but did not cause the missing verdicts: reviewer payloads
were delivered successfully hundreds of times and still produced zero signoff calls.

---

## 4 · Product alignment

### 4.1 PRD 21 and IDEA → REAL

PRD 21 governs the continuous experience: one Canvas, panels instead of destination sprawl, and
the IDEA → MAKE → RUN/REAL arc. This PRD governs the delivery proof beneath that experience.

The Manager contributes to the arc as follows:

| Journey stage | Manager responsibility |
|---|---|
| IDEA | Ensure the ticket and task-scoped PRD describe a real unmet outcome |
| MAKE | Assign a capable producer and require non-document implementation evidence |
| RUN | Reconcile CI, conflicts, infrastructure, review, and merge state |
| REAL | Require acceptance evidence, merge/close the PR under policy, and close the ticket |

A backlog ticket need not be a literal PRD 21 UI item to remain valid. Security, reliability,
tenancy, agent execution, and governance work may be owned by `ROADMAP.md` while still enabling
IDEA → REAL. Conversely, a ticket is not valid merely because some of its words appear in a PRD.

### 4.2 Roadmap relationship

`ROADMAP.md` is the source of truth for open product and engineering capabilities. Tickets are the
executable slices of those capabilities. Multiple gap tickets may reference one Roadmap item, but
they must not become parallel copies of the same missing behavior.

Every non-Done ticket must carry one disposition:

- `roadmap_capability`: the exact Roadmap section or stable capability identifier;
- `prd_alignment`: direct PRD, enabling infrastructure, operational defect, or out of scope;
- `delivery_state`: not started, implemented/unverified, review, repair, blocked, or terminal;
- `evidence`: code/PR/check/review references supporting that state; and
- `duplicate_of` or `superseded_by` when it should not remain independently open.

---

## 5 · Required behavior

### 5.1 Reviewer assignment and completion

1. A reviewer execution payload must identify `reviewRole` and the exact `laneKey`.
2. The runtime must advertise `builtin_kanban_signoff` with those exact values.
3. A reviewer run must not finish through either `finish` or a no-tool response until a successful
   signoff call records `approved` or `changes_requested` for the exact role/lane.
4. A signoff aimed at another role or lane does not satisfy the run.
5. Exhausting the run step limit without a verdict fails the execution and leaves the participant
   slot open for retry or escalation.
6. Reviewer compliance rate must be measurable by tenant, agent, model, role, and lane.

### 5.2 Acceptance evidence

The platform must define one authoritative completion predicate. Until the ledgers are unified:

- `task_reviews` remains Validator acceptance evidence;
- `ticket_role_signoffs` remains lifecycle accountability evidence; and
- a deterministic, audited bridge must link an applicable Validator review to the corresponding
  Validator participant slot without fabricating other role approvals.

Every accepted verdict must link to its execution, reviewed commit/PR head, comments, and any
reported gaps. A newer PR head invalidates acceptance evidence recorded against an older head.

### 5.3 PRD and implementation accounting

1. Repository PRDs are task-scoped at `specs/tasks/task-<id>.md`.
2. A task PRD may share the implementation branch, but it does not count as a code deliverable.
3. A PR must not open when the run produced only a PRD or documentation unless the ticket is
   explicitly classified as documentation work.
4. Root `PRD.md` is a product-level document and must not be rewritten by every ticket.
5. Completion evidence distinguishes source, test, configuration, migration, and documentation
   changes.

### 5.4 Reconciliation must create work, not labels

| Classification | Required action |
|---|---|
| Ready for review | Move the linked ticket into `in_review`; dispatch required reviewers |
| Merge conflict | Activate one stable repair head; update the existing branch, never create a replacement PR |
| Change-specific CI failure | Dispatch repair against the existing PR and failing check evidence |
| Shared infrastructure failure | Quarantine under one infrastructure incident; do not blame every PR |
| Pending checks / draft | Wait with a bounded next-check time |
| No check evidence / unlinked | Quarantine for human investigation |
| High-confidence stale/duplicate/empty | Close under audited policy |

Queue metrics must report actual lane transitions and execution IDs, not the number of strings
written to a journal.

### 5.5 Error recovery

- HTTP 401/403 credential failures open or update one credential incident and enter a cooldown.
- HTTP 429 honors provider reset/retry metadata and does not spend the entire dispatch ceiling on
  one ticket or model.
- Shared CI failures fan into one infrastructure repair item.
- Transient database failures retry idempotently and do not create product-feature gap tickets.
- A circuit breaker exposes `blocked_reason`, `next_retry_at`, and the operator action required.

### 5.6 Manager enablement

The Manager may be enabled only after:

1. reviewer evidence gating is deployed;
2. reconciliation credentials pass a live read;
3. one green PR completes the full review/signoff path in canary mode;
4. repair dispatch is limited to one stable head per repository;
5. provider budgets and retry ceilings are configured; and
6. automatic ticket closure is dry-run compared against the disposition report.

---

## 6 · Backlog disposition policy

### 6.1 Close

Close a ticket without implementation only when evidence proves it is:

- explicitly retracted or based on nonexistent code;
- a duplicate with a surviving canonical ticket;
- superseded by a newer ticket or completed capability;
- an operational transient with no recurrence through the defined observation window; or
- attached to an intentionally closed PR and the underlying outcome is no longer required.

Known immediate candidates from the audit are:

- **#386** — its own description says the older backlog pass was closed and superseded;
- **#542** and **#543** — explicitly retracted hallucinated security findings.

### 6.2 Consolidate

The following clusters describe shared root capabilities and should not remain as independent
parallel backlog items:

- participant assignment/tool gaps: **#1496–#1503 and #1510–#1523**;
- quality-risk-score tests/property gaps: **#1504–#1508**;
- signoff authentication/evidence failures: **#1531, #1539, #1540, #1541**; and
- terminal execution-transition errors: **#1485 and #1488**.

Consolidation retains one canonical ticket with every distinct acceptance criterion and links the
closed duplicates to it. It must not discard a unique requirement.

### 6.3 Keep open

Keep a ticket open when repository and production evidence show a real unmet capability. Examples
from the audited backlog include marketplace escrow/milestone payments, tenant isolation proof,
duplicate-board remediation, delivery-health persistence, required verification filters, and
missing production surfaces.

### 6.4 Quarantine

Do not automatically complete or close:

- the seven tickets whose only PRs are closed and unmerged;
- vague feature requests without acceptance criteria;
- tickets whose PR cannot be correlated to the requested outcome; or
- PRs with no check evidence or no trustworthy ticket reference.

Quarantine means a bounded human decision queue, not an indefinite open state.

---

## 7 · Rollout sequence

1. Commit and deploy the runtime evidence gate and task-scoped PRD change.
2. Repair GitHub credentials and verify reconciliation collection without 403s.
3. Run reconciliation in read-only mode and compare all provider/ticket decisions.
4. Enable one canary Manager sweep with auto-merge and auto-close disabled.
5. Prove one green PR: reviewer dispatch → exact signoff → acceptance → merge → ticket close.
6. Process the 15 green PRs.
7. Repair conflicted/failed PRs one stable head at a time.
8. Consolidate and close the high-confidence backlog candidates.
9. Resolve shared infrastructure failures once, then re-evaluate affected PRs.
10. Enable policy-approved merge/closure only after the dry-run and canary agree.

At every step, record before/after counts and retain the decision evidence. “Close all” is not a
valid recovery algorithm; convergence requires proving which outcomes exist and which were
abandoned.

---

## 8 · Acceptance criteria

- [ ] A reviewer cannot complete without an exact successful role/lane signoff.
- [ ] A no-tool response cannot bypass the evidence gate.
- [ ] Step-cap exhaustion without a verdict fails rather than accepts the run.
- [ ] Validator acceptance evidence is linked or bridged to its lifecycle slot.
- [ ] A PRD-only implementation run opens no PR.
- [ ] Concurrent tickets never contend on root `PRD.md`.
- [ ] Every ready-for-review reconciliation item creates an `in_review` transition and reviewer dispatch.
- [ ] Repair items update the existing PR branch and do not create replacement PRs.
- [ ] GitHub 403 and provider 429 failures enter visible bounded cooldowns.
- [ ] Internal PR state reconciles to GitHub with no stale-open surplus.
- [ ] Every non-Done ticket has a keep, close, consolidate, or quarantine disposition with evidence.
- [ ] Ticket completion requires implementation, checks, required review, acceptance, and terminal PR evidence.
- [ ] Manager canary completes one end-to-end PR/ticket lifecycle before project-wide enablement.

---

## 9 · Out of scope

- Rewriting PRD 21's shell, navigation, Canvas, or visual design decisions.
- Treating every Roadmap bullet as one ticket or every ticket as a new Roadmap capability.
- Merging red, conflicted, or unreviewed PRs merely to reduce the count.
- Marking abandoned work “Done” to improve completion metrics.
- Closing unlinked tickets because they are old.
- Replacing GitHub, the existing Manager, or the coordinated-role manifest with a second system.

---

## 10 · Implementation state on 2026-08-10

The local workspace contains an uncommitted first slice:

- reviewer verdicts are mandatory at both `finish` and no-tool termination;
- exact role/lane matching is persisted across durable ticks;
- step-cap exhaustion cannot bypass review evidence;
- task PRDs use `specs/tasks/task-<id>.md`;
- task PRDs no longer seed the run's implementation file set;
- ready-for-review reconciliation moves tickets into `in_review`; and
- repeated GitHub GraphQL 403 failures back off for six hours.

Focused verification passed 32 tests, both TypeScript checkers, and the layering, tenant-scope,
prompt-tool-name, and searchable-source guards. This is implementation evidence, not production
evidence: the slice must still be committed, reviewed, deployed, and canary-verified before the
Manager is enabled or backlog closure is automated.
