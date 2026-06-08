# 08 — PRD: Agentic Security & Governance (Policy Packs + Governance-Auditor Agent)

**Status: Planned (P1).** Continues docs 04 (Agentic Dev Layer) and 07 (Security/Compliance Phase 2).
This PRD specifies the **differentiating** capability the operator has repeatedly asked for and which
the Consolidated Gap Register (root `README.md`, "Team Intelligence" pass, 2026-05-31) records as
**not built**:

> *"Governance/security/audit AGENTS that check repos against rules are not built. The operator chose
> the 'DB policy packs + in-repo overrides' model."*

doc 07 made BuilderForce a security **tracker** (SOC2 controls, vuln-scan management, incident
register — passive systems of record). doc 08 makes BuilderForce **enforce**: PM/CISO authors rules
once, and an autonomous **governance-auditor** agent audits any connected repo against them,
producing findings that gate merges and auto-collect SOC 2 evidence. This is the "agents enforce the
rules" moat — neither Cursor, Devin, nor Copilot ships it.

**Personas:** CISO / Engineering Manager (authors policy, reviews findings); the dev agents (run
under policy at PR time).

> **Locked decisions (carried from the gap register + this PRD):**
> 1. **Policy lives in the DB** (`governance_policy_packs` + `governance_rules`), tenant/segment/
>    project-scoped, PM-editable in the portal — **with optional in-repo overrides** at
>    `.builderforce/policies/*.yaml` (repo wins for repo-specific rules; DB packs are the org baseline).
> 2. **Audit is an agent, not a linter.** A `governance-auditor` role + `governance_audit` AgentTool
>    in the runtime, extending (not replacing) `createSecurityAuditWorkflow`. It reasons over the repo
>    + the resolved ruleset; deterministic checks (regex/path/secret patterns) run as fast pre-filters
>    the agent then triages.
> 3. **Findings are first-class and gating.** `governance_audit_runs` + `governance_findings` under
>    the existing `/api/governance` route. A `BLOCKER` finding gates auto-merge via the orchestrator
>    policy gate (doc 04 §6 / doc 07 §5), exactly like a BLOCKER security-review finding.
> 4. **Everything is segment-threaded and audited** — same `(tenantId, segmentId)` model as doc 07;
>    every run writes a `SecurityAuditLog` row (doc 07 §3).

---

## 1. Scope

### In scope
- **Policy authoring**: DB-backed policy packs + rules, PM-editable, with a one-click seed of a
  baseline pack (OWASP-ASVS-lite + secret-hygiene + dependency + license + change-management).
- **In-repo overrides**: `.builderforce/policies/*.yaml` discovered at audit time; merged over DB packs
  with deterministic precedence.
- **Governance-auditor agent**: new runtime role + `governance_audit` tool; an
  `createGovernanceAuditWorkflow(repoRef)` that resolves the ruleset, runs deterministic pre-filters,
  then an LLM triage/assessment pass, and writes findings.
- **Findings lifecycle + gating**: store, triage (`open → triaged → fixed → accepted_risk →
  false_positive`), severity rollup, BLOCKER merge-gate, CRITICAL → auto-open `SecurityIncident`
  (reuse doc 07 SEC-3), auto SOC 2 evidence for CC8/CC7 controls.
- **Surfaces**: `/api/governance/policy-packs`, `/api/governance/rules`,
  `/api/governance/audits`, `/api/governance/findings`; portal pages under the existing Governance
  nav; a runtime `/govern` TUI command + `governance_audit` tool.

### Out of scope (explicitly deferred → Gap Register)
- The **FACTS library** (structured fact store) — sibling gap from the same pass; the auditor reads
  prose memory + the ruleset for now. Logged separately.
- The prompt **Analyzer** — unrelated sibling gap.
- Full SAST/SCA engine parity (doc 07 SEC-9 owns deep scanners; doc 08 consumes their findings as one
  input and focuses on *policy* conformance, not CVE discovery). Where SEC-9 scanners exist, the
  auditor links their `VulnerabilityFinding`s rather than re-implementing them.
- Identity/RBAC/SSO — stays in BurnRateOS (doc 05/07 §8).

---

## 2. Domain model additions (append to doc 01; all `(tenantId, segmentId)`-scoped, Drizzle)

Real schema is Drizzle (`api/src/infrastructure/database/schema.ts`), so the PRD specifies it in that
shape (not Prisma) — `tenantId` is `integer → tenants.id`, `segmentId` is nullable `uuid → segments.id`,
matching the existing `socControls`/`securityVendors` tables. New migration: **`0100_agentic_governance.sql`**.

```ts
// A named bundle of rules. Org baseline ("Default Security Baseline") or a custom pack.
export const governancePolicyPacks = pgTable('governance_policy_packs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:   uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }), // null = tenant/segment-wide
  name:        varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  framework:   varchar('framework', { length: 40 }),     // soc2|owasp|gdpr|pci|internal|custom
  status:      varchar('status', { length: 20 }).notNull().default('active'), // active|draft|archived
  isBaseline:  boolean('is_baseline').notNull().default(false),
  createdBy:   varchar('created_by', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

// One enforceable rule. `check` carries the deterministic pre-filter; `guidance` drives the LLM triage.
export const governanceRules = pgTable('governance_rules', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:   uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  packId:      uuid('pack_id').notNull().references(() => governancePolicyPacks.id, { onDelete: 'cascade' }),
  ruleRef:     varchar('rule_ref', { length: 80 }).notNull(),   // e.g. "SEC.SECRET.NO_HARDCODED"
  category:    varchar('category', { length: 40 }).notNull(),   // secrets|authz|injection|deps|license|change_mgmt|pii|custom
  title:       varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),                    // the rule, in plain language (LLM reads this)
  severity:    varchar('severity', { length: 20 }).notNull().default('medium'), // blocker|critical|high|medium|low|info
  // Deterministic pre-filter (optional). kind drives the matcher; absent → LLM-only rule.
  check:       jsonb('check'),  // { kind:"regex"|"path_required"|"path_forbidden"|"dependency"|"glob", pattern, paths?, options? }
  guidance:    text('guidance'),                                // remediation hint surfaced on findings
  enabled:     boolean('enabled').notNull().default(true),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

// One audit execution of a repo/ref against a resolved ruleset.
export const governanceAuditRuns = pgTable('governance_audit_runs', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  projectId:    uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  repoRef:      varchar('repo_ref', { length: 500 }),           // repo url/id
  ref:          varchar('ref', { length: 200 }),                // branch/commit/PR audited
  trigger:      varchar('trigger', { length: 20 }).notNull(),   // manual|agent_pr|schedule
  agentRunId:   varchar('agent_run_id', { length: 64 }),        // execution id when triggered on an agent PR
  status:       varchar('status', { length: 20 }).notNull().default('queued'), // queued|running|completed|failed
  rulesetHash:  varchar('ruleset_hash', { length: 64 }),        // hash of (DB packs + in-repo overrides) used
  packsApplied: jsonb('packs_applied'),                         // [{ packId, name, source:"db"|"repo" }]
  summary:      jsonb('summary'),                               // { blocker, critical, high, medium, low, info, passed }
  gateResult:   varchar('gate_result', { length: 16 }),         // pass|blocked|null(not gating)
  startedAt:    timestamp('started_at'),
  finishedAt:   timestamp('finished_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

// One finding raised by an audit run against one rule.
export const governanceFindings = pgTable('governance_findings', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  segmentId:    uuid('segment_id').references(() => segments.id, { onDelete: 'cascade' }),
  runId:        uuid('run_id').notNull().references(() => governanceAuditRuns.id, { onDelete: 'cascade' }),
  ruleId:       uuid('rule_id').references(() => governanceRules.id, { onDelete: 'set null' }),
  ruleRef:      varchar('rule_ref', { length: 80 }).notNull(),  // denormalized so findings survive rule deletion
  severity:     varchar('severity', { length: 20 }).notNull(),
  title:        varchar('title', { length: 255 }).notNull(),
  detail:       text('detail').notNull(),                       // what was found + why it violates the rule
  filePath:     varchar('file_path', { length: 1000 }),
  line:         integer('line'),
  evidence:     text('evidence'),                               // matched snippet / explanation
  remediation:  text('remediation'),
  source:       varchar('source', { length: 16 }).notNull().default('agent'), // prefilter|agent|vuln_scan
  confidence:   varchar('confidence', { length: 10 }),          // high|medium|low (LLM self-rated)
  status:       varchar('status', { length: 20 }).notNull().default('open'),  // open|triaged|fixed|accepted_risk|false_positive
  incidentId:   uuid('incident_id'),                            // set when CRITICAL auto-opens a SecurityIncident
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});
```

Indexes: every table on `(tenant_id, segment_id)`; `governance_rules` on `(pack_id)`; runs on
`(tenant_id, segment_id, project_id, status)`; findings on `(run_id, severity)` and
`(tenant_id, segment_id, status)`.

**Migration note:** `0100` creates the four tables only — additive, no edits to existing governance
tables. The `check` matcher kinds are an enum-in-JSON (not a DB enum) so packs can grow matchers
without a migration.

---

## 3. Rule resolution & in-repo override precedence

At audit time the auditor builds the **effective ruleset** deterministically:

1. **DB baseline** — all `active` `governancePolicyPacks` where
   `projectId IS NULL OR projectId = :project` for the run's `(tenant, segment)`, plus their `enabled`
   rules. This is the org/PM-authored layer.
2. **In-repo overrides** — `.builderforce/policies/*.yaml` in the audited repo. Each file is a pack;
   each entry is a rule keyed by `ruleRef`.
   - A repo rule with an existing `ruleRef` **overrides** the DB rule (severity/enabled/guidance) —
     lets a repo opt a baseline rule down to `info` or off **only if** the DB rule is not marked
     `locked` (a `governanceRules.check.locked = true` flag; locked org rules cannot be weakened in-repo).
   - A repo rule with a new `ruleRef` **adds** a repo-local rule.
3. **Hash** the resolved set → `governanceAuditRuns.rulesetHash` for reproducibility/audit.

`packsApplied` records each contributing pack with `source: "db" | "repo"` so a reviewer can see
exactly what governed the run. This mirrors BuilderForce Agents' existing config-precedence model
(builtin < user-global < project-local < clawhub) used for personas.

---

## 4. The governance-auditor agent (runtime)

### 4.1 New role — `governance-auditor`
Add to [agent-roles.ts](../../agent-runtime/src/builderforce/agent-roles.ts) alongside `code-reviewer`/
`bug-analyzer`. System prompt: *"You are a Governance Auditor. You are given a repository diff/tree and
a resolved policy ruleset (rules with refs, descriptions, severities, and any deterministic
pre-filter hits). For each rule, determine conformance. Emit one structured finding per genuine
violation with file/line, the matched evidence, why it violates the named rule, a severity (never
exceed the rule's severity unless you downgrade with justification), a remediation, and a confidence.
Do not invent violations; a rule with no violation passes silently. Prefer precision — a false BLOCKER
stops a merge."*

### 4.2 New tool — `governance_audit`
Add `agent-runtime/src/agents/tools/governance-audit-tool.ts` (AgentTool shape, like
`memory-tool.ts`). Params: `{ repoRef?, ref?, projectId?, packIds?[], dryRun? }`. Behavior:
1. Resolve ruleset (§3) — calls the API `GET /api/governance/rules/resolve?projectId&repoRef`.
2. Run **deterministic pre-filters** over the working tree (regex/secret/path/dependency/glob matchers)
   — fast, cheap, produces candidate hits with `source: "prefilter"`.
3. Build the LLM context: changed-files tree + pre-filter hits + rule descriptions. Call the auditor
   role (`useCase: gov.policy_audit`) for triage + LLM-only rules.
4. POST findings + summary to `/api/governance/audits/:id/findings`; finalize the run.
   Returns `{ runId, summary, gateResult }`.

### 4.3 Workflow — `createGovernanceAuditWorkflow(repoRef)`
Add to [orchestrator.ts](../../agent-runtime/src/builderforce/orchestrator.ts) next to
`createSecurityAuditWorkflow` (which stays — it's the generic OWASP self-audit). Phases:
`resolve-ruleset (deterministic) → governance-auditor assess → code-reviewer verify gate`. Registered
as the `SecurityAudit` workflow template's policy-aware sibling and selectable from `orchestrate`.

### 4.4 Auto-run on agent PRs (extends doc 07 §5)
When an IMPLEMENT agent opens a PR, the orchestrator runs `governance_audit` on the branch
(`trigger: "agent_pr"`, `agentRunId` set) in the same sandboxed runner as the dev agents. A `BLOCKER`
finding sets `gateResult: "blocked"` and **gates auto-merge** via the existing
`policy.blockerGate` (doc 04 §6). A `CRITICAL` finding auto-opens a `SecurityIncident`
(detection-source `agent`, doc 07 SEC-3) and back-links `governanceFindings.incidentId`. Passing runs
auto-create `SocEvidence` for CC8.1 (change mgmt) and CC7.1 (vuln detection) with
`sourceRef = { kind:"agent_run", agentRunId, runId }`.

---

## 5. API (extends `/api/governance/*`, segment-scoped JWT, `SecurityAuditLog` on every write)

Mounts in [governanceRoutes.ts](../../api/src/presentation/routes/governanceRoutes.ts) — reuse
`scope(c)` for `(tenantId, segmentId)` and `requireRole(MANAGER)` for writes.

| Method & path | Role | Purpose |
|---|---|---|
| `GET /api/governance/policy-packs` | member | List packs for segment (+ optional `?projectId`) |
| `POST /api/governance/policy-packs` | manager | Create pack |
| `POST /api/governance/policy-packs/seed` | manager | Seed the baseline pack + rules once per segment |
| `PATCH /api/governance/policy-packs/:id` | manager | Rename / status / scope |
| `GET /api/governance/rules?packId` | member | List rules in a pack |
| `POST /api/governance/rules` | manager | Add a rule to a pack |
| `PATCH /api/governance/rules/:id` | manager | Edit rule (severity/check/enabled/guidance) |
| `DELETE /api/governance/rules/:id` | manager | Remove rule |
| `GET /api/governance/rules/resolve?projectId&repoRef` | agent/member | **Resolved effective ruleset** (DB + in-repo merge, hashed) — consumed by the auditor tool |
| `POST /api/governance/audits` | member/agent | Start an audit run `{ projectId, repoRef, ref, trigger }` → `{ runId }` |
| `GET /api/governance/audits?projectId&status` | member | List runs (read-through cached, version-token keyed) |
| `GET /api/governance/audits/:id` | member | Run + findings |
| `POST /api/governance/audits/:id/findings` | agent | Bulk-write findings + finalize summary/gate |
| `GET /api/governance/findings?status&severity&projectId` | member | Triage queue |
| `PATCH /api/governance/findings/:id` | manager | Triage (`status`, `acceptedRiskReason`) |

**Caching:** `GET /audits` and `GET /findings` are read-heavy list endpoints → serve through
`getOrSetCached` (L1 Map + L2 KV), version-token key per `(tenant, segment, project)`, invalidated on
any run finalize or finding triage. `rules/resolve` is cached per `rulesetHash` input (packs change
rarely; invalidate on pack/rule write).

### New AI use case (append to doc 01 §8 / doc 07 §6)
| Use case | Purpose |
|---|---|
| `gov.policy_audit` | assess a repo/diff against a resolved policy ruleset → structured findings + gate verdict |

---

## 6. Portal UI (Governance nav — extends doc 07 §7)

Under the existing Governance category (sibling to SOC2 / Vendors / Incidents):

- **`/governance/policies`** — pack list (Card|List via shared `ViewToggle` + `dataTableStyles`),
  pack detail = rule table with inline severity/enabled edit; "Seed baseline" button; per-pack scope
  badge (tenant / segment / project). PM-editable, role-gated by self-hiding components (no
  prop-drilled `canEdit`).
- **`/governance/audits`** — run history with summary chips (blocker/critical/high counts), gate
  result pill (Pass / Blocked), trigger source, ruleset hash; run detail = findings table grouped by
  severity with triage actions and the matched evidence snippet.
- **Findings triage drawer** — accept-risk (requires reason → audit-logged), mark fixed/false-positive,
  jump to the linked `SecurityIncident` for CRITICALs.
- **Project surface tie-in** — a project card/table action "Run Governance Audit" creates a run
  (mirrors the Architect "Run Architecture Analysis" pattern); a `hasOpenBlockerFindings` flag toggles
  a red gate badge on the project.

Reuse the embed rail: BurnRateOS `/governance/policies` + `/governance/audits` become
`<BuilderForceEmbed view="policies" />` / `view="audits"` thin shells.

---

## 7. Acceptance criteria

1. PM seeds the baseline pack in one click; rules are segment-scoped and PM-editable; edits are
   `SecurityAuditLog`-recorded.
2. An audit run on a repo with a hardcoded secret + a missing `LICENSE` produces a `BLOCKER` secret
   finding (deterministic pre-filter → agent-confirmed) and a `medium` license finding; `gateResult`
   = `blocked`.
3. An in-repo `.builderforce/policies/foo.yaml` that **adds** a rule contributes a finding; one that
   **downgrades a non-locked** baseline rule to `info` is honored; one that tries to downgrade a
   **locked** rule is ignored and noted in `packsApplied`.
4. On an agent PR, a `BLOCKER` governance finding prevents auto-merge via `policy.blockerGate`; a
   `CRITICAL` opens a `SecurityIncident` and back-links it; a clean run writes CC8.1 + CC7.1
   `SocEvidence` with agent-run provenance.
5. Every run is `(tenantId, segmentId)`-isolated (cross-segment read returns 404); `rulesetHash` is
   reproducible for the same inputs.
6. `GET /audits` and `GET /findings` are served through the shared read-through cache and invalidated
   on write (no per-request recomputation, no N+1 over findings).
7. `pnpm check` (api + frontend) and schema-drift pass; `governanceRoutes.test.ts` extended;
   auditor-tool + workflow unit-tested in the runtime.

---

## 8. Phasing & dependencies

- **Prereq:** doc 07 §3 governance tables live (they are — `socControls` etc. exist) and the agent
  runtime with `orchestrate`/role registry (live).
- **8a — Policy store + API + portal authoring** (tables `0100`, routes, `/governance/policies` UI).
  No runtime dependency; ship first, immediately useful as a policy register.
- **8b — Auditor agent** (`governance-auditor` role, `governance_audit` tool,
  `createGovernanceAuditWorkflow`, `gov.policy_audit` use case) + `/governance/audits` UI + manual
  "Run Governance Audit" from a project.
- **8c — PR gating + auto-evidence** (orchestrator auto-run on agent PRs, `policy.blockerGate`
  integration, CRITICAL→incident, CC8/CC7 `SocEvidence`). Needs 8b + doc 07 SEC-3.
- **8d — In-repo override merge + locked-rule enforcement** (the `.builderforce/policies/*.yaml`
  discovery + precedence + hash). Can land with 8b but specced separately to keep 8b shippable.

None of 8a–8d alter the Tenant→Segment isolation model or the embed/SSO contract.

---

## 9. Deferred (Consolidated Gap Register entries this PRD creates)

- **FACTS library** still not built — the auditor reads the ruleset + prose memory, not a structured
  fact store. Building it (a `facts` table + `facts` AgentTool, synced via the knowledge loop) would
  let the auditor assert against durable structured truth. (Pre-existing sibling gap; doc 08 does not
  close it.)
- **Deep SAST/SCA parity (doc 07 SEC-9)** remains separate; doc 08 links existing
  `VulnerabilityFinding`s as a finding `source` but does not discover CVEs itself.
- **Auditor runs in the connected runtime only** — like the rest of the repo-aware flow, a cloud-only
  run with no FS/subprocess cannot check out the repo; the audit requires a connected agent-runtime or
  self-hosted agentHost (same constraint as the Architect/PRD-first flow).
