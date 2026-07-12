# PRD — Coordinated Role Participation & Execution Verification for Tickets

> Status: **Draft (P1)** · Author: platform · Date: 2026-07-12
> Supersedes nothing; **extends** the "Agentic Workforce Kanban" (migration 0274). Aligns with specs `03` (Kanban), `04` (Agentic Dev Layer), `08` (Governance — reuse its "BLOCKER gates merge" pattern), `11` (engine seam). Reuses the Compile/PolicyGate primitive only where noted.

---

## 1. Problem & Goal

### The incident
A trivial one-line bug ticket (#467, "fix duplicate `padding` property") was **owned by a Sr. Product Manager agent (Ada)** and auto-dispatched to *write code* — 30+ times, every run failing. A Product Manager should never have been the one implementing a coding ticket. Root-causing this surfaced a **systemic** gap, not a one-off:

1. **Assignment is role-blind.** `recommendTopAssignee` (`api/src/application/metrics/assigneeRecommender.ts`) scores only availability + WIP + optional skill-match, and both callers (`ManagerService.ts` assign step, the Epic fan-out in `index.ts`) pass **empty `requiredSkills`**. So the *most-available* teammate wins regardless of role — a free PM outranks a busy developer on a coding ticket. There is no first-class "this agent can act as role X" capability on `ide_agents`.
2. **Producer participation is never enforced.** The lane gate (`enforceLaneRequirements`, `api/src/application/swimlane/laneRequirementGate.ts`) only enforces **reviewer** requirements (`kind==='review'` or `responsibility==='reviewer'`). Requirements with `responsibility` `owner`/`contributor` (the *producers* — the BA who writes requirements, the Developer who implements) are audited for coverage but **never gate advancement and never get the right role dispatched**.
3. **There is no per-ticket coordinator.** The Manager is a *per-project* pass (score → rank → assign one owner → PR → audit). Nothing walks a *single ticket* through BA → Design → Implement → Review → Test → Validate, ensuring each required role actually participates and hands off.
4. **Verification is weak.** "Owner performed work" is satisfied merely by the existence of a sign-off row; there is no automatic link from "an agent ran as role Y" to "role Y participated," no evidence check (PR opened? tests ran and passed? diagnostic threshold met?), the HTTP sign-off route doesn't even emit to the unified `activity_log`, and human `ask_human` approvals don't count as role sign-offs.

### Goal
**The primary goal is accountability and auditability.** An operator (or an incident investigator) must be able to open any ticket and see, at a glance, that the standard was met: **every required workforce resource has signed off**, and for each sign-off — **Who** (the human or agent, by identity + the role they acted as), **When** (timestamp), **Verdict**, **Comments**, and a link to their **actual contribution/interaction** (the execution, the PRD section they authored, the diff they wrote, the review they left). This record is **append-only and immutable**, so that when something goes wrong — surfaced through **incident management** — the ticket's audit history is a first-class input to root-cause analysis and continuous process improvement (e.g. "a required reviewer was waived", or "QA signed off with no test run").

To make that accountability record trustworthy, every ticket moves through a **defined lifecycle of required role participation**, where:
- specific **roles** must each participate at the right stage (BA, Architect, Developer, Team Lead, Validator, QA, Product Owner);
- exactly **one accountable owner — the Coordinator, who IS the ticket's Assignee** (a human workforce member or an assigned "Agent Manager") — drives the ticket, owns all internal and **exterior communication/collaboration**, and guarantees every required participant executes and hands off (the Coordinator coordinates; it does **not** produce the work);
- **one PRD artifact per ticket** is the shared, signed hand-off contract updated by each role;
- advancement is **gated** on each required participant completing *and being verified* (evidence, not just a checkbox); and
- the whole thing is **fully audited** — who did what, when, as which role, with what evidence — and that audit is **queryable per ticket** and **consumable by incident management**.

This is an **extension of the Agentic Workforce Kanban**, not a rewrite. We add: (a) role-aware assignment, (b) a per-ticket **Participation Manifest**, (c) producer gating, (d) a **Coordinator** that sequences roles, (e) an **execution-verification** layer, (f) ticket-type-scoped process templates, and (g) a **Ticket Accountability Report** that feeds incident RCA.

---

## 2. What already exists (build-on inventory)

| Capability | Where | Reuse |
|---|---|---|
| Role catalog (10 built-ins + tenant `job_roles`) | `kanban/roleCatalog.ts`, `jobRoleService.ts` | Extend with `team-lead`, `validator`, `product-owner` |
| Process templates binding roles→lanes | `kanban/templateCatalog.ts` (`STANDARD_SWE`), `kanban_templates*` tables | Extend with ticket-type scope + producer gates |
| Per-lane requirements (role/review/diagnostic + owner/reviewer/contributor + isRequired + `off/soft/hard` gate) | `swimlane_requirements`, `swimlanes.requirement_gate` | The requirement primitive — extend, don't replace |
| Sign-off ledger (`approved`/`changes_requested`) | `ticket_role_signoffs`, `ticketAuditService.recordSignoff`, `POST /api/kanban/tasks/:id/signoff`, MCP `kanban.signoff` | Add states + evidence + RBAC |
| Cumulative coverage audit + flag | `ticketAuditService.computeAudit`, `auditRules.ts`, `ticket_audits`, `tasks.auditStatus/auditFlagCount` | The audit engine — extend rules |
| Lane gate + reviewer round-trip | `laneRequirementGate.ts` (via `maybeAutoRunOnLaneEntry`) | Extend to gate producers |
| Role→assignee resolution | `project_role_assignments`, `RoleAssignmentService`, `RosterService.compute`, `resolveRoleAgent` | Make authoritative + role-aware |
| One PRD artifact per ticket (3 synced copies, per-run signing) | `prd/taskPrd.ts`, `task_specs` primary link, `commitPrdToRepo.ts`, `DrizzlePrdEnsurer` | Add structured per-role sign-off sections |
| Per-ticket lifecycle state machine (opt-in) | `ticket_runs`, `SwimlaneCoordinator`, `swimlane_transitions` | Converge toward; manifest is the bridge |
| Manager coordinator (per-project) | `manager/ManagerService.ts` | Host the per-ticket Coordinator here |
| Unified audit stream | `activity_log`, `recordActivity`, `AuditTrailPanel` | Emit structured participation/hand-off events |
| Human-in-the-loop | `approvals`, `ask_human`, `resumePausedExecution` | Bridge approvals ↔ role sign-offs |
| Broadcast (chat milestones, tool_audit_events, WS stream) | `RuntimeService.onRunMilestone`, `ChatTicketService.postRunMilestone`, `recordCloudToolEvent` | Emit the "role completed step / handing off" signal |
| Round-table participation pattern | `ceremony_sessions`/`ceremony_participants` | Pattern to mirror for ticket participants |
| Circuit-breaker on repeated failure | `evaluateAutoRun.ts` `run_cap_exhausted` | Already stops the 30×-burn; keep |

**Net:** ~70% of the machinery exists. This PRD wires the missing 30% and closes the four holes.

---

## 3. Roles

Map the operator's lifecycle to catalog role keys; **add three** missing built-ins (aligning to existing runtime personas so dispatch resolves cleanly):

| Lifecycle actor | Role key | Status |
|---|---|---|
| Business Analyst | `business-analyst` | exists |
| Architect | `architect` | exists |
| Coder / Developer | `developer` | exists (runtime persona `code-creator`) |
| Code Reviewer | `code-reviewer` | exists |
| QA / Tester | `qa-tester` | exists (runtime persona `test-generator`) |
| Team Lead | `team-lead` | **NEW** (runtime persona: `validator-agent`, "senior team-lead") |
| Validator | `validator` | **NEW** (runtime persona `validator-agent`) |
| Product Owner | `product-owner` | **NEW** (or alias to `product-manager` — see Open Questions) |
| Coordinator / Delivery Manager | `manager` | exists (owns the roster + coverage) |

> Reconcile the `roleCatalog.ts` keys with the `agent-runtime/agent-roles.ts` taxonomy (`developer`↔`code-creator`, `qa-tester`↔`test-generator`, `architect`↔`architecture-advisor`) with an explicit alias map so role→persona→agent resolution is deterministic (today it's convention-only).

---

## 4. The canonical lifecycle

A **Process Template** binds, per ticket type, an ordered set of **stages**, each with required **participants** (role + responsibility) and a **gate**:

| # | Stage | Required participants (responsibility) | Gate | Verified by (evidence) |
|---|---|---|---|---|
| 1 | **Requirements Review** | `business-analyst` (owner), `product-owner` (reviewer) | soft | PRD "Requirements" section present + BA sign-off |
| 2 | **Design Review** | `architect` (owner), `developer` (contributor) | soft | PRD "Design" section + architect sign-off |
| 3 | **Implementation** | `developer` (owner), `architect` (contributor) | **hard** | PR opened + non-empty diff on branch |
| 4 | **Implementation Review** | `code-reviewer` (reviewer), `architect` (reviewer), `team-lead` (reviewer) | **hard** | reviewer `approved` sign-offs (quorum) |
| 5 | **Test** | `qa-tester` (owner) | **hard** | test run recorded + CI green (or QA sign-off) |
| 6 | **Business Validation** | `validator` (reviewer), `business-analyst` (reviewer), `product-owner` (reviewer) | **hard** | acceptance-criteria check + validator sign-off |
| — | **Done** | (Coordinator confirms all stages verified) | terminal | manifest 100% satisfied |

The **Coordinator** (`manager` role, the ticket's accountable owner) is present across all stages: it resolves the concrete agent/person for each required role, sequences dispatch, chases stalled participants, and blocks Done until the manifest is fully verified.

This maps 1:1 onto the existing `STANDARD_SWE` template shape (which already gates Ready/Review/Done on architect + code-reviewer + qa-tester reviews); we generalize it to include producer stages and business validation.

---

## 5. Core concepts / new primitives

### 5.1 Process Template, scoped by ticket type
Extend `kanban_template_lane_requirements` and `swimlane_requirements` with an optional **`ticket_type`** discriminator (`null` = applies to all). Extend the requirement row with:
- **`quorum`** (int, default = count of required rows of that kind at the stage; supports "2 of 3 reviewers");
- **`condition`** (nullable predicate, e.g. `taskType==='security'` → require `security` role) — start with a small enum of conditions, not a DSL;
- keep `responsibility` (`owner|reviewer|contributor`) — now **all three are enforceable** (see 5.4).

A **built-in default lifecycle template** (`STANDARD_SWE_V2`) ships in `templateCatalog.ts` encoding §4. `KanbanTemplateService.applyToProject` materializes it (already does lanes→`swimlane_requirements`).

### 5.2 Ticket Participation Manifest (the new heart)
New table **`ticket_participants`** — the per-ticket, forward-looking roster (mirrors `ceremony_participants`, but ticket-scoped and stateful):

```
ticket_participants(
  id, tenant_id, task_id,
  stage_key,            -- lane/stage this participation belongs to
  role_key,             -- required role
  responsibility,       -- owner | reviewer | contributor
  assignee_kind,        -- agent | human | hire | null (unresolved)
  assignee_ref,         -- resolved concrete participant (or null)
  state,                -- pending | assigned | in_progress | completed | changes_requested | waived | skipped
  signoff_id,           -- FK ticket_role_signoffs (the verdict that satisfied it)
  evidence,             -- JSON: { prUrl?, diffFiles?, testRunId?, diagnosticToolId?, executionId? }
  required boolean,
  quorum_group,         -- rows sharing this key form a quorum set
  created_at, updated_at
)
```

The manifest is **derived on ticket creation / template apply** from the applicable process template (the required rows across all stages), and **kept live** by the audit engine. It is the single queryable answer to *"who must participate, who has, and with what evidence."* State is now **explicit** (no more deriving from the latest verdict).

### 5.3 Role-aware assignment (fixes the root cause)
- Add a first-class **agent↔role capability**: a `ide_agents.role_keys` (JSON) column *and/or* an `agent_role_capabilities` join, populated from `builtin_kind`, assigned personas/skills (`resolveArtifacts`), and explicit config. One resolver `resolveRoleCapableAgents(tenant, projectId, roleKey)` with precedence: **explicit `project_role_assignments` pin → roster fill (`RosterService`) → ranked role-fit**.
- Make `recommendTopAssignee` **role-aware**: add a `roleKey`/`requiredRoles` parameter; when set, filter/boost candidates by role capability. Derive `requiredSkills`/`roleKey` from the ticket's **stage requirement** and **`action_type`** at both call sites (`ManagerService` assign, Epic fan-out) instead of passing `[]`.
- **Owner-fallback guardrail:** in `evaluateAutoRun.ts` / `withOwnerAgentFallback`, the capability-unconstrained owner fallback must respect the **stage's producer role** — a ticket in an Implementation stage must not auto-run as a non-`developer` owner. (This directly prevents the Ada incident.)

### 5.4 Enforced producer gates (close the enforcement hole)
Generalize `enforceLaneRequirements` so **all responsibilities gate**, not just reviewers:
- **owner/contributor (producer)**: on stage entry, if the required producer role has not *completed* (evidence-verified, see 5.6), resolve the role-capable agent (5.3) and **dispatch it as that role** (not the ticket's generic owner); block the lane's generic auto-run until the producer step completes. This is the same round-trip machinery, extended past reviewers.
- **reviewer**: unchanged (round-trip + sign-off), plus **quorum** support.
- Gate strictness stays per-stage (`off|soft|hard`); `hard` blocks advance until the manifest's required participants for that stage are `completed`.
- Serial → **bounded parallel**: dispatch all currently-unblocked required participants for a stage (respecting the stage's `executionMode`), not strictly one-per-hop, with the existing live-run guard + `run_cap_exhausted` circuit-breaker.

### 5.5 The Coordinator = the ticket's Assignee (one accountable owner per ticket)
**The Assignee of the ticket IS the Coordinator** — a **human workforce member** *or* an **assigned "Agent Manager"** (a cloud/host agent designated as the manager). This is the decisive design rule and the cleanest fix for the incident: the assignee **coordinates**; it does **not** produce the work. Ada-the-PM should have been the *assignee/coordinator* who dispatches a `developer` to implement — never the implementer.

- **Assignee ≠ executor (the key decoupling).** Today the run resolves its executor as `parseCloudAgentRef(payload) ?? tasks.assigned_agent_ref` (`cloudAgentEngine.ts`), and the owner-fallback (`withOwnerAgentFallback`) auto-runs the ticket *as its assignee* — so the assignee is the default executor. That is exactly how a PM assignee ran code. Under this PRD the **assignee (Coordinator) is never the default executor**: the per-stage **producer** is resolved from the manifest by role capability (§5.3) and the run is attributed to that producer (`executions.cloud_agent_ref` already records the actual runner). Remove the assignee→executor fallback for lifecycle-managed tickets.
- **The Coordinator is set as the Assignee.** `resolveManagerAssignee(managerRef)` already decodes a manager (human `u:` / agent `c:`/`h:`) into the `assigned_user_id` / `assigned_agent_ref` / `assigned_agent_host_id` columns — reuse it so designating the ticket's manager *is* setting its assignee. Default = the project's Delivery Manager (human or Agent Manager); configurable per template/ticket type.
- **The Coordinator owns communication & collaboration — internal AND exterior.** At each stage/swimlane gate and every outward interaction, the Coordinator is the single point of contact and the broadcaster:
  - *internal* — sequences roles, records hand-offs (§5.8), keeps the PRD artifact and the Accountability Report current;
  - *exterior* — owns the ticket's outward communication: the linked Brain chat (`ChatTicketService`), stakeholder updates/notifications, `ask_human` escalations, human approvals at `human`-gated lanes, external board sync comments, and — for incident tickets — the war-room chat. Outbound ticket communications are attributed to and routed through the Coordinator, so there is one accountable voice per ticket.
- **Per-ticket coordination tick** `coordinateTicket(taskId)` (new, hosted in `manager/`, invoked from `maybeAutoRunOnLaneEntry` + a light sweep): reads the manifest, finds the next unsatisfied required participant for the current stage, resolves + dispatches the role-capable **producer** (never itself), records the hand-off + broadcasts the update, and — when the stage manifest is satisfied — advances the lane. Replaces the "role-blind assign one owner then hope" behavior for lifecycle-managed tickets.
- The Coordinator is the **single writer** of stage advancement for managed tickets, reconciling the two engines (task-status flow ↔ `ticket_runs`) by treating the manifest as the shared source of truth.

### 5.6 Execution verification (auditing is key)
Each participation step is `completed` only when its **evidence** predicate passes — not merely a sign-off row:
- **producer (Implementation)**: a PR row exists for the ticket AND the branch diff is non-empty (`resolveTaskPrSignal`, `listBranchDiff`).
- **producer (Requirements/Design)**: the PRD artifact has the corresponding structured section authored by that role (see 5.7).
- **reviewer**: an `approved` sign-off by a role-capable member (RBAC, 5.8), meeting quorum.
- **QA/Test**: a `tool_run` of the test diagnostic exists **and passes a threshold** (extend diagnostics from existence-only to pass/fail), or CI is green on the PR, or an explicit QA sign-off.
- **Validation**: acceptance-criteria check (reuse `semanticEval`/`lexicalEval` from `scoreRunOutcome` as a first-pass, plus validator sign-off).

`auditRules.ts` `requirementUnmetReason` is extended to consult **evidence**, and `computeAudit` writes the evidence into the manifest + `ticket_audits.missing[]`. Auto-link participation: when an execution finalizes, attribute it to the **role it ran as** (from the dispatch payload `reviewRole`/new `actAsRole`) and mark that manifest step `in_progress`/`completed` with the `executionId` as evidence — closing the "ran as role Y but nothing recorded role Y participated" gap.

### 5.7 The single PRD artifact as the hand-off contract
- Keep the existing one-logical-PRD invariant (`task_specs` primary, `PRD.md` on branch, `specs.prd`). **Harden the 3-copy sync** (currently best-effort/silent) so a failed commit surfaces a reconcile task instead of silent divergence (log to gap register).
- Replace free-text "signing" with **structured per-role sections**: the PRD template gains anchored sections (`## Requirements` (BA), `## Design` (Architect), `## Implementation Notes` (Developer), `## Review` (reviewers), `## Test Evidence` (QA), `## Acceptance` (Validator/PO)). A role's participation is partly verified by its section being authored + its sign-off referencing the PRD revision. `appendPrdRevision` continues to append the audit trail of edits.

### 5.8 RBAC on sign-off + hand-off events
- **Who may sign off as role X:** enforce at `POST /api/kanban/tasks/:id/signoff` (today any caller can post any `roleKey`) — the actor must be role-capable for `roleKey` (explicit pin, roster fill, or the dispatched reviewer for this hop). Reuse the `SecurityTicketAccessService` **default-deny** pattern.
- **Structured events:** emit `activity_log` verbs `ticket.role.dispatched`, `ticket.role.completed`, `ticket.handoff` (from → to role), `ticket.signed_off` on **both** the HTTP and MCP paths (today only MCP emits). Bridge **approvals → sign-offs**: resolving an `ask_human` approval tied to a role step records the corresponding `ticket_role_signoffs` row.

### 5.9 The Accountability Record — Who / When / Comments / Contribution (the operator's core ask)
The sign-off ledger is the **accountability record of truth**. Every required-role sign-off (human OR agent) captures, immutably:
- **Who** — `member_kind` (`human|agent|hire`) + `member_ref` + a resolved display identity (name), and the **role acted as** (`role_key`). Never anonymous "system".
- **When** — the sign-off timestamp (already `created_at`); the ledger is **append-only** (no updates/deletes), so the history — including a *superseded* `changes_requested` before a later `approved` — is preserved for audit.
- **Verdict** — `approved | changes_requested | waived | delegated` (see §5.2 states; `waived`/`delegated` require a reason + are role-capability-gated).
- **Comments** — free-text rationale the signer provides (required for `changes_requested`/`waived`).
- **Contribution / interaction** — a `contribution` JSON linking to the *actual work* backing the sign-off: the `execution_id` the role ran, the PRD `revision` it authored, the PR/diff files, the review thread (chat/`execution_messages`), the diagnostic `tool_run`. This is what makes a sign-off **verifiable, not a rubber stamp** — a reviewer "approve" with no linked review interaction is itself an audit finding.

**Ticket Accountability Report** — one read model, `GET /api/kanban/tasks/:id/accountability` (cached, version-token invalidated on any sign-off/manifest write), assembling per required role: the role, the resolved participant, state, verdict, when, comments, and contribution links — plus **gaps** (required roles with no sign-off, sign-offs with no linked contribution, waived-with-reason). Rendered on the ticket as a plain, human-readable **"Sign-off & Accountability"** table (localized, dark/light, responsive). This is the "open a ticket and see the standard was met" surface.

### 5.10 Incident-management linkage (audit history → RCA → process improvement)
Incident management already exists — `prod_incidents` (`root_cause`, `postmortem_url`, `board_task_id` → the incident kanban ticket), the incident timeline (mig 0325), postmortem docs, `error_groups`. Wire the accountability record into it:
- **Implicated-change linkage:** an incident references not just its own incident ticket but the **delivery ticket(s) whose change caused it** (via the PR/commit that shipped the regression, or a manual "implicated ticket" link on `prod_incidents`). Add a light join so RCA can pull those tickets' Accountability Reports.
- **RCA input:** the postmortem/RCA view surfaces the implicated ticket's Accountability Report inline — *which roles signed off, with what evidence, and where the process was skipped/waived*. A common finding ("the required reviewer approved with no linked review", "QA was waived", "no Architect design sign-off") becomes concrete and actionable.
- **Process improvement loop:** aggregate accountability gaps across incidents (e.g. via the existing quality/DORA lenses) to answer "which stage's sign-offs correlate with incidents?" — closing the learn loop the operator described. Feed durable findings into project memory / Evermind lessons (already consumed at run prep) so future runs of that ticket type tighten the gate.
- No new incident engine — this is a **read linkage + one implicated-ticket edge**, reusing `prod_incidents`, postmortem docs, and the Accountability Report.

---

## 6. Functional requirements

- **FR-1 Role-aware assignment.** No ticket is auto-assigned or auto-run as an owner whose role is incapable of the current stage's producer responsibility. `recommendTopAssignee` accepts and honors a role/skill constraint derived from the stage + `action_type`.
- **FR-2 Participation manifest.** Every lifecycle-managed ticket has a `ticket_participants` manifest derived from its type's process template, with explicit per-participant state + evidence.
- **FR-3 Producer gating.** A `hard` producer stage does not advance until the producer role has *completed with verified evidence*; the correct role-capable agent is dispatched to do it.
- **FR-4 Reviewer gating + quorum.** Reviewer stages require N-of-M `approved` sign-offs by role-capable members; `changes_requested` returns the ticket to the producer without re-summoning the reviewer every hop (keep current loop-safety).
- **FR-5 Coordinator = Assignee.** The ticket's **Assignee** is the Coordinator — a human workforce member or an assigned Agent Manager. It sequences the manifest, dispatches each required **producer** role in order (never runs the work itself), records hand-offs, owns all internal + **exterior** communication/collaboration (linked chat, stakeholder updates, `ask_human`, approvals, external sync, incident war-room), and is the single writer of stage advancement. The assignee is **never** the default per-stage executor (that fallback is removed for lifecycle-managed tickets).
- **FR-6 One PRD artifact.** One primary PRD per ticket, threaded through every role via structured sections + signed revisions; the 3 physical copies stay coherent or raise a reconcile.
- **FR-7 Verification.** Each step's completion is evidence-backed (PR/diff, test-pass/CI, diagnostic threshold, reviewer approval, acceptance check), not sign-off-existence alone.
- **FR-8 Audit.** Every dispatch, completion, hand-off, and sign-off is on the unified `activity_log` (HTTP + MCP), queryable per ticket and per actor; per-ticket coverage + evidence is visible.
- **FR-9 RBAC.** Only role-capable members may sign off as a role; enforced default-deny.
- **FR-10 Ticket-type templates.** Required roles/stages are scoped by ticket type (a Security ticket requires the Security role; a docs ticket does not require QA).
- **FR-11 No regression to the circuit-breaker.** Repeated-failure halting (`run_cap_exhausted`) and the manager backlog pass continue to work; the Coordinator respects them.
- **FR-12 Accountability record.** Every required-role sign-off captures Who + role, When, Verdict, Comments, and a Contribution link to the actual work; the ledger is append-only/immutable. A ticket exposes a human-readable **Accountability Report** (`GET .../accountability`) showing all required roles, their sign-off status, and gaps.
- **FR-13 Incident RCA linkage.** An incident can reference the delivery ticket(s) that caused it; the RCA/postmortem view surfaces those tickets' Accountability Reports so process gaps (skipped/waived/evidence-less sign-offs) are visible and feed process improvement.

---

## 7. Data model changes

- `ide_agents.role_keys` JSON (or `agent_role_capabilities` join) — first-class role capability.
- `swimlane_requirements` + `kanban_template_lane_requirements`: add `ticket_type` (nullable), `quorum` (int), `condition` (nullable enum).
- **New** `ticket_participants` (§5.2).
- `ticket_role_signoffs` (the **accountability record** — append-only, never updated/deleted): ensure it captures **Who** (`member_kind`+`member_ref`+denormalized `member_name`, `role_key`), **When** (`created_at`), **Verdict** (widen to `approved|changes_requested|waived|delegated`), **Comments** (`summary`/`comment`, required for `changes_requested`/`waived`), and **Contribution** (`contribution` JSON: `{ executionId?, prdRevision?, prUrl?, diffFiles?, reviewThreadRef?, toolRunId? }`). Add `waive_reason`. Enforce immutability at the write layer.
- `prod_incidents`: add an **implicated-ticket** edge (a `prod_incident_implicated_tasks(incident_id, task_id, relation)` join, or reuse an existing link) so RCA can pull the delivery ticket's Accountability Report; no other incident-schema change.
- `ticket_audits.missing[]` already JSON — include evidence gaps.
- `tool_runs`: add a `passed boolean` / `score` so a `diagnostic` requirement can gate on pass, not existence.
- **Assignee/executor decoupling (semantic, not additive):** `tasks.assigned_agent_ref`/`assigned_user_id` now mean **Coordinator**, not executor. The executor is per-run (`executions.cloud_agent_ref`, already exists) resolved from the manifest producer. Remove the `?? tasks.assigned_agent_ref` executor fallback (`cloudAgentEngine.ts`) and the capability-unconstrained owner-fallback auto-run (`withOwnerAgentFallback`/`evaluateAutoRun.ts`) **for lifecycle-managed tickets**; keep legacy behavior for un-managed boards behind the template flag to avoid a big-bang change.
- Migrations are additive; `applyToProject` materializes the new fields. Follow the DRY/caching rules (roster + audit reads are already cached; invalidate on manifest write).

---

## 8. API + MCP surface

- `GET /api/kanban/tasks/:id/participants` — the manifest (cached, version-token invalidated on write).
- `GET /api/kanban/tasks/:id/accountability` — the **Accountability Report** (per-role Who/When/Verdict/Comments/Contribution + gaps), cached with the same version token. Also embeddable in the incident RCA view for an implicated ticket.
- `POST /api/kanban/tasks/:id/signoff` — add RBAC + evidence; emit `activity_log`.
- `POST /api/kanban/tasks/:id/coordinate` — force a Coordinator tick (manual "drive this ticket").
- MCP: extend `kanban.signoff`; add `kanban.participants` (read), `kanban.handoff` (record a hand-off); agents dispatched with `actAsRole` mark their own step.
- Reuse `/api/kanban/projects/:id/apply` for template application; extend the template editor payload with ticket-type/quorum/condition.

## 9. UI surface (localized, dark/light, responsive)

- **Ticket Participation panel** (SlideOutPanel, not modal): the manifest as a stage-ordered checklist — each participant's role, resolved assignee, state chip, evidence link, and a "Run role now" / "Sign off" action gated by RBAC. Mirrors the existing Triage control pattern.
- **Sign-off & Accountability table** (on the ticket, §5.9): a plain, scannable table — one row per required role with **Who · Role · When · Verdict · Comments · Contribution**, plus a clear "N of M signed off" header and flagged gaps (unsigned roles, evidence-less/waived sign-offs). This is the "open a ticket and see the standard was met" surface; it appears in the RCA/postmortem view for an implicated ticket too.
- **Board card**: extend the existing audit flag chip to show `X/Y participants complete`.
- **Audit trail**: `AuditTrailPanel` already renders `activity_log`; the new verbs appear automatically.
- All new strings through `next-intl` across the 5 catalogs; theme tokens only; fluid layout.

---

## 10. Auditing & verification (the operator's core requirement)

- **The Accountability Record (per ticket):** for every required role — **Who** signed (identity + role, human or agent), **When**, **Verdict**, **Comments**, and a link to the **contribution/interaction** that backs it. Append-only and immutable, so the full history (including superseded `changes_requested` → later `approved`) survives for audit. Surfaced as the plain **"Sign-off & Accountability"** table on the ticket.
- **Forward audit:** the manifest shows, at any moment, exactly which required roles are outstanding and why (missing evidence vs missing sign-off vs unresolved assignee).
- **Backward audit:** `activity_log` gives the immutable "who did what as which role, when, with what evidence" timeline per ticket; `ticket_role_signoffs` (the accountability ledger) + `swimlane_transitions` + `ticket_audits` are the durable stores.
- **Evidence-based completion** (5.6) means a green manifest *means the work actually happened* — a reviewer can't "approve" a stage with no linked review, QA can't pass with no test run. An evidence-less or waived sign-off is itself a visible audit finding.
- **Coverage metric:** `ticket_audits.coverage` becomes participation-weighted; a Done ticket with < 100% verified participation is flagged and blocked from terminal.
- **Incident feedback loop (§5.10):** when an incident occurs, its RCA pulls the implicated delivery ticket's Accountability Report — turning "was the process followed?" into a concrete, evidenced answer, and aggregating accountability gaps across incidents into process-improvement signal.

---

## 11. Enforcement / gating semantics (summary)

- **owner/contributor (producer)** on `hard` stage → block generic auto-run, dispatch the role-capable producer, require evidence.
- **reviewer** on `hard` stage → require quorum of `approved` sign-offs by role-capable members.
- **`soft`** → flag + dispatch, don't hard-block (advisory round-trip).
- **`off`** → audit only.
- Done is terminal only when the manifest is 100% verified.

---

## 12. Acceptance criteria

- **AC-1** A coding ticket entering Implementation is auto-run as a `developer`-capable agent; a PM-only agent is never dispatched to produce code (regression test on the #467 scenario).
- **AC-1b** The ticket's Assignee (Coordinator — human or Agent Manager) is never auto-dispatched as the executor of a stage; the run is attributed to the resolved per-stage producer, not the assignee. Removing the assignee→executor fallback does not break a normally-staffed lane.
- **AC-2** A ticket cannot reach Done with any required participant not `completed`-with-evidence; the board shows the outstanding roles.
- **AC-3** The manifest for a `STANDARD_SWE_V2` feature ticket lists all six stages' required participants with live state.
- **AC-4** A reviewer stage with quorum 2-of-3 advances on the 2nd `approved` sign-off, not the 1st.
- **AC-5** A human `ask_human` approval tied to a role step records a `ticket_role_signoffs` row and clears that manifest step.
- **AC-6** `POST /signoff` as a role the caller is not capable of is rejected (403), default-deny.
- **AC-7** Every dispatch/completion/hand-off/sign-off appears in `activity_log` (HTTP and MCP paths).
- **AC-8** A Security-type ticket's manifest includes the `security` role; a docs-type ticket's does not.
- **AC-9** All new UI localized in 5 catalogs, verified in dark + light + 360px.
- **AC-10** `tsgo` clean, migrations + drift green, `vitest` green for the audit-rules/manifest/assignment units.
- **AC-11** Opening any ticket shows a **Sign-off & Accountability** table: for each required role — Who (identity + role), When, Verdict, Comments, and a link to the contribution; roles with no sign-off, and sign-offs with no linked contribution, are flagged. The ledger cannot be edited or deleted (append-only).
- **AC-12** From a resolved incident, the RCA view links to the implicated delivery ticket(s) and displays their Accountability Reports; a ticket where a required reviewer was waived or approved with no linked review interaction is visibly flagged in that view.

---

## 13. Rollout / phases

- **Phase 1 — Stop the bleeding (role-aware assignment).** `ide_agents.role_keys` + `resolveRoleCapableAgents`; make `recommendTopAssignee` role-aware; constrain the owner-fallback by stage producer role. Closes the #467 root cause. *(Small, high-value, mostly `assigneeRecommender.ts` + `evaluateAutoRun.ts`.)*
- **Phase 2 — Manifest + accountability record.** `ticket_participants`; derive on template apply; extend `computeAudit`/`auditRules` to write manifest + evidence; enrich `ticket_role_signoffs` (Who/When/Verdict/Comments/Contribution, immutable); participants + **Accountability Report** API; the **Sign-off & Accountability** ticket panel. *(This is the operator's headline deliverable — visible accountability on every ticket — and can ship before full producer gating.)*
- **Phase 3 — Producer gating + Coordinator.** Extend `enforceLaneRequirements` to producers; `coordinateTicket` tick; structured hand-off + `activity_log` verbs; RBAC on sign-off; approvals↔sign-offs bridge.
- **Phase 4 — Verification + templates.** Evidence predicates (PR/diff, test-pass/CI, diagnostic threshold, acceptance eval); ticket-type-scoped requirements + quorum/condition; structured PRD sections; `STANDARD_SWE_V2` default.
- **Phase 5 — Incident linkage + convergence.** Wire the Accountability Report into incident RCA (`prod_incidents` implicated-ticket edge + postmortem view + aggregate accountability-gap findings for process improvement); reconcile the task-status flow and `SwimlaneCoordinator`/`ticket_runs` around the manifest as the single source of truth; optional spec-08 policy-pack tenant-baseline layer above per-board requirements.

Each phase ships a working vertical slice; nothing is left half-wired.

---

## 14. Out of scope

- Rebuilding the compile/PolicyGate primitive to express role sign-off (it is tool-scoped; we bridge, not replace).
- Building the full spec-08 governance policy-pack store (optional Phase 5 tenant-baseline layer only).
- A general condition/quorum DSL (start with a small enum).
- Cross-project portfolio-level role orchestration (planning spine stays a rollup).

## 15. Open questions (decisions needed)

1. **`product-owner` vs `product-manager`:** add a distinct role, or alias? (Recommend: distinct built-in, aliased to `product-manager` for resolution until staffed separately.)
2. **Coordinator identity:** always the `manager` role, or per-template configurable (e.g. Team Lead coordinates engineering-heavy templates)?
3. **Which engine is canonical** for managed tickets in Phase 3 — extend the live task-status flow, or promote `ticket_runs` to always-on? (Recommend: task-status flow + manifest now; converge in Phase 5.)
4. **Test evidence source of truth:** CI-green vs an in-agent test run vs QA sign-off — precedence order?

## 16. Risks

- **Two-engine drift** (task-status vs `ticket_runs`) — mitigated by making the manifest the shared source of truth and one Coordinator writer.
- **Over-gating stalls tickets** — mitigate with `soft` defaults for non-critical stages, the `run_cap_exhausted` breaker, and a Coordinator "waive with reason" path (audited).
- **Role-capability accuracy** — fuzzy `agentMatchesRole` must be superseded by explicit `role_keys`; seed built-ins deterministically.
- **PRD 3-copy divergence** under load — harden sync + reconcile task.

## 17. Gap-register items surfaced (to log regardless of PRD adoption)

- `recommendTopAssignee` is role-blind and both callers pass `[]` skills → non-role-fit assignment (the #467 root cause).
- `enforceLaneRequirements` gates only reviewers; `owner`/`contributor` requirements are audit-only.
- HTTP `POST /signoff` doesn't emit `activity_log`; approvals don't record role sign-offs.
- No RBAC on `/signoff` — any caller can sign off as any role.
- Diagnostic requirements are existence-only (no pass/fail threshold).
- PRD 3-copy sync is best-effort/silent (can diverge on failed commit).
- Two swimlane engines (`tasks.status` flow vs `ticket_runs`) are only loosely connected.
