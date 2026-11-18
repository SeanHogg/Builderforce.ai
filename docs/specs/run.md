# ⚙️ Run — operate the company

> **Domain PRD — open work only.** Consolidated 2026-11-17 from the per-PRD specs that used to live in
> `docs/specs/NN-*.md`; every section was verified against the code that day. This file holds only
> what is left to build. Finished sections are archived word for word in `DONE.md` ("✅ RESOLVED 2026-11-17 — PRD NN:
> finished sections archived on consolidation"), with their § numbers kept, so a citation such as
> `PRD 38 §4.3` resolves to the `## PRD 38` section here (open) or to DONE.md (shipped).
> A gap in a PRD's numbering is a shipped section. Outstanding work is tracked in `ROADMAP.md` under **⚙️ Run**.

**Holds:** Finance ops, hiring and HR, governance, security and compliance (SOC 2), advisors and board, investor portal.

## Contents

- [PRD 08 — Agentic Security & Governance (Policy Packs + Governance-Auditor Agent)](#prd-08--agentic-security--governance-policy-packs--governance-auditor-agent)
- [PRD 19 — burnrateos.com → Builderforce.ai consolidation](#prd-19--burnrateoscom--builderforceai-consolidation)
- [PRD 26 — Advisor Platform (epic #2522)](#prd-26--advisor-platform-epic-2522)
- [SOC 2 Type I Compliance — checklist & remediation (epic #3062)](#soc-2-type-i-compliance--checklist--remediation-epic-3062)
- [PRD 18 — hired.video → Builderforce.ai port (hiring, résumé, Recruiter and HR agents)](#prd-18--hiredvideo--builderforceai-port-hiring-résumé-recruiter-and-hr-agents)

---

## PRD 08 — Agentic Security & Governance (Policy Packs + Governance-Auditor Agent)

> Consolidated 2026-11-17 from `docs/specs/08-prd-agentic-governance.md`. Verified against code 2026-11-17: Partly built.
> Finished sections are archived in DONE.md ("PRD 08: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

**Locked decisions (still binding).**
1. Policy lives in the DB (`governance_policy_packs` + `governance_rules`, migration 1336), tenant/segment/project-scoped, PM-editable, with optional in-repo overrides at `.builderforce/policies/*.yaml`. The repo wins for repo-specific rules; DB packs are the org baseline.
2. Audit is an agent, not a linter. Deterministic checks are pre-filters that the agent triages.
3. Findings are first-class and gating: a `BLOCKER` gates auto-merge exactly like a BLOCKER security finding.
4. Everything is `(tenantId, segmentId)`-scoped, and every write is audited (`application/governance/mutationAudit.ts`).

### §3 Rule resolution & in-repo override precedence
At audit time the effective ruleset is: (1) the DB baseline (built); (2) **in-repo overrides**. Each `.builderforce/policies/*.yaml` file in the audited repo is a pack, and each entry is a rule keyed by `ruleRef`. A repo rule with an existing `ruleRef` overrides severity, enabled and guidance **only if** the DB rule's `check.locked` is not `true`; a locked org rule cannot be weakened in-repo. A repo rule with a new `ruleRef` adds a repo-local rule. (3) The hash covers the merged set. `packsApplied` records each pack with `source: "db" | "repo"`, and an ignored locked-rule downgrade is noted there.

**Remaining (verified 2026-11-17):**
- No YAML parse or merge exists. `resolveGovernanceRuleset` (`api/src/application/governance/governanceRuleAudits.ts:76`) is DB-only. The runtime walker only walks the dir (`agent-runtime/src/agents/tools/governance-audit/walker.test.ts:27`).
- The tool description at `agent-runtime/src/agents/tools/governance-audit-tool.ts:51` already claims "in-repo .builderforce/policies overrides". Make the claim true. Do not leave it as an overclaim.

### §4.2 Tool — `governance_audit`
Params `{ repoRef?, ref?, projectId?, packIds?[], dryRun? }`. The steps are: resolve, then deterministic pre-filters, then an **LLM triage under `useCase: gov.policy_audit`** for pre-filter hits and LLM-only rules, then POST findings and finalize the run.

**Remaining (verified 2026-11-17):**
- The tool is registered without an `assess` seam (`agent-runtime/src/agents/builderforce-tools.ts:125`), so it falls back to `confirmPrefilterAssessor` (`governance-audit/pipeline.ts:36-50`). Wire the governance-auditor role call as `assess`.
- Register `gov.policy_audit` as an API LLM use case. Today it appears only in runtime types (`governance-audit/types.ts:116`).

### §4.4 Auto-run on agent PRs
When an IMPLEMENT agent opens a PR, run `governance_audit` on the branch (`trigger: "agent_pr"`, `agentRunId` set). A `BLOCKER` finding sets `gateResult: "blocked"` and gates auto-merge through the ONE security gate. A `CRITICAL` finding auto-opens a `SecurityIncident` (detection source `agent`) and back-links `governanceFindings.incidentId`. A passing run writes `SocEvidence` for CC8.1 and CC7.1 with `sourceRef = { kind:"agent_run", agentRunId, runId }`.

**Remaining (verified 2026-11-17):**
- The post-PR step `api/src/application/security/pullRequestSecurityStep.ts` does not run a governance audit.
- `evaluateSecurityGate` (`api/src/application/security/prSecurityGate.ts:66`, `securityMergeGate.ts`) does not read `governance_audit_runs.gate_result`.
- `openIncidentsForCriticalFindings` (`api/src/application/security/criticalFindingIncidents.ts:66`) only reads `vulnerabilityFindings`. It needs a finding-kind seam for `governance_findings`.
- `finalizeGovernanceAudit` (`governanceRuleAudits.ts:180`) writes no `recordAutomatedEvidence` (`application/governance/automatedSocEvidence.ts`).

### §5 API (remaining endpoints)
Segment-scoped. Every write goes through `requireRole(MANAGER)` and the mutation audit.

| Method & path | Role | Purpose |
|---|---|---|
| `GET /api/governance/…packs` (1336 packs) | member | List audit packs for the segment (+ `?projectId`) |
| `POST` create pack · `POST …/seed` · `PATCH …/:id` | manager | Create, seed the baseline pack (OWASP-ASVS-lite + secret hygiene + dependency + license + change-management) once per segment, rename/status/scope |
| `GET /api/governance/rules?packId` · `POST` · `PATCH /:id` · `DELETE /:id` | member / manager | Rule CRUD (severity / check / enabled / guidance / `locked`) |
| `GET /api/governance/audits?projectId&status` · `GET /audits/:id` | member | Run list, and run + findings (read-through cached, version-token keyed) |
| `GET /api/governance/findings?status&severity&projectId` · `PATCH /findings/:id` | member / manager | Triage queue; triage `open → triaged → fixed → accepted_risk → false_positive` (accept-risk requires a reason) |

Caching: `GET /audits` and `GET /findings` go through `getOrSetCached`, keyed per `(tenant, segment, project)` and invalidated on run finalize or triage. `rules/resolve` stays uncached, because its hash is audit evidence (`governanceRuleAudits.ts:69`).

**Remaining (verified 2026-11-17):**
- Nothing writes `governance_policy_packs` or `governance_rules`. They are `readOnly: true` in `api/src/application/domains/governance/entities.ts:44-45`, so the auditor resolves an empty ruleset unless rows are inserted by hand.
- **Path collision:** `/api/governance/policy-packs` (`api/src/presentation/routes/governanceRoutes.ts:275-330`) already serves the migration-0348 wire-gate packs (`policyPackService.ts`). Decide on one pack model, or use distinct paths, before building.
- There is no audits or findings reader. The only `governance_findings` access is the insert at `governanceRuleAudits.ts:235`.

### §6 Portal UI (Governance nav)
- **Policies:** pack list (Card|List `ViewToggle` + `dataTableStyles`), pack detail as a rule table with inline severity/enabled edit, a "Seed baseline" button, and a scope badge. Self-hiding role-gated controls.
- **Audits:** run history with blocker/critical/high counts, a gate result (Pass / Blocked), the trigger and the ruleset hash. Run detail shows findings grouped by severity with the evidence snippet.
- **Findings triage:** a SlideOutPanel to accept risk (with a reason), mark fixed or false-positive, and jump to the linked incident.
- **Project tie-in:** a "Run Governance Audit" action and a red gate badge when `hasOpenBlockerFindings`.

**Remaining (verified 2026-11-17):**
- None of this exists. `frontend/src/components/security/PolicyPacksPanel.tsx` edits the 0348 gate packs. `frontend/src/components/governance/*` has no audit or finding UI.
- (The BurnRateOS embed shells are dropped: BurnRateOS is being deprecated.)

### §7 Acceptance criteria
1. A PM seeds the baseline pack in one click. Rules are segment-scoped, PM-editable and audited.
2. A repo with a hardcoded secret and no `LICENSE` produces a `BLOCKER` secret finding (pre-filter, then agent-confirmed) and a `medium` license finding, with `gateResult = blocked`.
3. An in-repo pack that adds a rule contributes a finding. A downgrade of a non-locked rule to `info` is honored. A downgrade of a locked rule is ignored and noted in `packsApplied`.
4. On an agent PR, a BLOCKER governance finding prevents auto-merge, a CRITICAL opens and back-links an incident, and a clean run writes CC8.1 + CC7.1 evidence with agent-run provenance.
5. Cross-segment reads return 404. `rulesetHash` is reproducible.
6. `GET /audits` and `/findings` are cached and invalidated on write, with no N+1.
7. `governanceRoutes.test.ts` is extended. The auditor tool and workflow are unit-tested in the runtime.

### §9 Deferred
- The auditor does not assert against FACTS (`/api/facts`). There is no `facts` read in the `governance_audit` path.
- The auditor runs only in a connected runtime or self-hosted agentHost.

### §10 Agentic DevSecOps layer — named limits
Built and archived (DONE.md "Security automation (PRD 08 §10)").

**Remaining (verified 2026-11-17):**
- The SAST "engine" is a rule set (`api/src/domain/security/diffScanRules.ts`) until a sandboxed scanner runner is wired. SCA covers only the manifests that changed and the versions it can resolve (`application/security/osvScaScan.ts`).
- DSR erasure covers 2 Segment adapters. `marketing_audience_members` and `candidate_records` are named unadapted at `api/src/application/governance/dsrExecution.ts:87`, so erasure stays `processing`. *Blocker: an operator retention decision (ROADMAP "[governance] DSR erasure skips non-segment stores").*

---

## PRD 19 — burnrateos.com → Builderforce.ai consolidation

> Consolidated 2026-11-17 from `docs/specs/19-prd-burnrateos-consolidation.md`. Verified against code 2026-11-17: Mostly built (behaviour parity closed; shutdown gates open).
> Finished sections are archived in DONE.md ("PRD 19: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

**Directive.** `burnrateos.com` is being deprecated. Every source capability is either built or explicitly retired, because a capability that is neither is lost at shutdown. By operator decision of 2026-09-05, **existing BurnRateOS data is not migrated**: only functionality is consolidated. The Identity, Data and Production-data execution gates and the 7-part user migration manifest are withdrawn.

**Guards (keep green):** `check:model-coverage`, `check:table-adoption`, `check:no-burnrate-runtime`, `check:burnrate-policy`, `check:burnrate-parity`, `audit:burnrate-cutover --validate-only`, `audit:burnrate-tenancy --validate-only` (`api/scripts/checks.manifest.mjs:61-62,109-113`).

### End-of-week shutdown gates (remaining)
All are mandatory before a hard shutdown. "Mapped in TSV", "table exists" and "opens in EntityBrowser" do not satisfy them.
- [ ] **Provider gate:** reauthorize or retire Plaid, SignalWire, payments, Recall, email, Slack, Google/Microsoft/GitHub/LinkedIn and enrichment connections. Switch webhook and callback URLs only after replay and idempotency tests.
- [ ] **Runtime gate:** replace or retire R2 objects, public shares, embeds, crons, DO sessions and queues. Preserve unsubscribe/suppression and legal evidence.
- [ ] **Billing gate:** reconcile active BurnRateOS subscribers and balances against provider reports (refund or move them onto Builderforce plans). No user is double-billed, and no paid user lands on Free.
- [ ] **Cutover gate:** freeze BurnRateOS writes, smoke-test, then redirect web, API and public links.
- [ ] **Rollback gate:** keep the source database, R2 bucket and Worker read-only through an agreed window, with named abort thresholds.

**Remaining (verified 2026-11-17):**
- All five gates are operator actions; none has code in this repo. *Blocker: operator provider actions, identity-cutover comms, redirect verification (ROADMAP Programs).*

### Runtime and integration gaps (remaining rows)
| Source capability | Status |
|---|---|
| `0 3 * * *` daily churn/digest/coach batch | Not ported: no matching sweep in `api/src/cronSweeps*.ts`. Decide whether to build it onto `cronSweeps.ts` or retire it |
| `SupportChatRoom` DO | No decision recorded (grep `SupportChat` in `api/src` is empty). Extract it only if an active tenant uses it; otherwise retire it explicitly |
| `burnrateos-attachments` R2 | No copy manifest or legacy-URL plan. With no data migration, this needs a customer export + retire decision |
| Stripe/Helcim commerce, OAuth/connectors | Re-consent and reconcile under the Provider and Billing gates |

### §2 Capability ownership register (governs PRD 18 and PRD 19)
Keep as a working rule: one owner per capability, and the losers' call sites migrate in the same pass. It is enforced by `api/src/application/migration/burnrateCutoverPolicy.json` + `check:burnrate-policy`.

**Remaining (verified 2026-11-17):**
- Row 4 (affiliates): PRD 18 says port, this register says retire. *Blocker: operator decision (ROADMAP Reach).*
- Row 6 (phone, `retire_port_out`): *blocker: operator confirms (ROADMAP Integrations).*

### §3.5 Auth reconciliation
Merge onto Builderforce auth. BurnRateOS contributes account lockout, login-attempt throttling and bot-block as net-new hardening.

**Remaining (verified 2026-11-17):**
- Only OTP throttling exists (`api/src/presentation/routes/authRoutes.ts:334,550`). There is no password-login account lockout or per-account attempt throttling: grep `lockout|login_attempts|failedLogin` in `api/src` is empty. `source-to-target.tsv` maps `login_attempts → run` and `bot_block_events → event_log` with no feature path.

### §6 Sequencing against PRD 18
Both domains retire together, or the collisions reopen.

**Remaining (verified 2026-11-17):**
- Run the joint cutover with PRD 18's hired.video redirect.

### §9.3 Gap register — remaining `transform` / `retire` rows
`docs/specs/data-model/burnrate-parity.tsv`: **0 build · 7 transform · 4 retire**.

**Remaining (verified 2026-11-17):**
- Transform: `billing_plans`, `plan_features`, `business_pricing_models`, `pricing_simulations`, `system_features` (onto `PlanLimits.ts` / `pricingConfiguration.ts`), `payment_methods` (Stripe reconcile), `ri_sequences` (canvas-object cadence, `sequenceRunner.ts`). With no data migration, each of these resolves under the Billing gate or as a recorded retire.
- Retire: `affiliate_referrals`, `referral_entries`, `ai_voice_agent_calls`, `blog_posts`. These need a customer export.
- Doc fix: §3.2 and the audit cite `api/src/application/migration/burnrateTenantCompanyMapping.ts`, which no longer exists. ROADMAP "Company directory inert" is blocked on "PRD 19 B0", which is now obsolete.

---

## PRD 26 — Advisor Platform (epic #2522)

> Consolidated 2026-11-17 from `docs/specs/26-prd-advisor-platform.md`. Verified against code 2026-11-17: Partly built.
> Finished sections are archived in DONE.md ("PRD 26: finished sections archived on consolidation");
> section numbers are kept, so a gap in numbering is a shipped section.

### §0 Composition contract (still binding)
This file is the only product contract for #2522. Notes may add wiring but no product behaviour. A2-A5 workshops / academy / packs, `/marketplace?family=talent` Book bind and restricted Brain belong to **#2545**. No `/advisors` route, no `advisor` in `MARKETPLACE_LISTING_KINDS`, no `advisory` in `PEOPLE_OBJECT_KINDS` or `TEAM_CEREMONY_KINDS`.

### §4.4 Meeting Notes agent (FR-4)
An agent produces structured minutes for `advisory` meetings, using the standup three-section Markdown contract (Summary / Decisions / Action items). The marketplace listing is optional P1.

**Remaining (verified 2026-11-17):**
- `summarizeMeeting` (`api/src/application/meetings/meetingIntelligence.ts:192`) runs on meeting end (`api/src/presentation/routes/meetingRoutes.ts:470-472`), but only over a captured transcript. There is no default-on notetaker for advisory meetings.

### §4.5 Minutes → board, one pull path (FR-5)
Board sync uses ONE generalised pull that accepts standup **and** advisory minutes. Advisory minutes appear on the board without a standup meeting and without a second pipeline. Open action items are placed idempotently by title.

**Remaining (verified 2026-11-17):**
- `syncMinutesForMeeting` (`api/src/application/ceremony/ceremonyMinutesToCanvas.ts:185-196`) returns `null` when the meeting has no `ceremony_sessions` row. Advisory meetings never have one, so their minutes never reach a board. Generalize `syncCeremonyMinutesToCanvas` / `applyCeremonyMinutesToBoard` to key on the meeting (the visitor's resulting workspace board). The ceremony path stays the same code.
- Add a fixture proving at least one action item lands from an advisory transcript.

### §8 Acceptance (open criteria)
3. A Meeting Notes agent produces structured minutes from an advisory meeting.
4. Those minutes reach the board through the same generalised pull path as standup minutes. Standup still works, and there is no parallel pipeline.

### §10 Follow-ons
- Mirror `advisory` in the frontend kind list: `frontend/src/components/meetings/ScheduleMeetingPanel.tsx:9` omits it (verified 2026-11-17).
- #2545 needs its own spec path. Note: `frontend/src/app/advisory/page.tsx` (noindex, labelled #2545) is a dedicated advisor destination. Confirm it does not violate §9 "no dedicated Advisor destination".
- Stage chips on `?category=advisors` (`freelancer_profiles.stages`, key `stage`) are owned by #2586 / #2637.

### §11 Claim-to-proof
Public copy may say founders can find Advisors, meet them, and land notes on the board. It may not claim a SCORE alternative or SBA partnership, free mentoring unless a live listing is priced 0, or that Book / Academy / packs shipped under this epic.

### §12 Open items
**Composition rules (binding):** see the table in the source §12 (advisor identity = talent profile + opt-in flag; Book = `booking_hosts.host_ref`; notes = `runAgentTurn` + `summarizeMeeting` + `parseMeetingMinutes`; follow-up = **propose**, never book; pro bono = a badge only).

1. Meeting Notes as the silent notetaker, default-on for advisory meetings.
2. On meeting end, parsed open action items land as board tasks on the visitor's workspace, idempotent by title, with a fixture.
3. From minutes + advisor availability, **propose** one follow-up slot (never book it), visible to the visitor and bookable without staff. Email both parties. A visitor with no tenant gets a guest project + claim link.
4. A test that a visitor token cannot list other advisors' meetings.
5. P2: filters on `category=advisors` only (expertise, language, method, stage) without breaking other categories; visitor chat on the public profile through the existing chat primitive; a Resources tab of that advisor's existing listings.
6. P3: location on the profile and as an optional filter; Start / Grow / Exit as listing filters.

**Remaining (verified 2026-11-17):**
- 1-2: see §4.4 / §4.5.
- 3: no follow-up proposer (grep `followUpSlot|proposeFollowUp` in `api/src/application/{commerce,meetings}` is empty).
- 4: no advisory token-isolation test.
- 5-6: `api/src/presentation/routes/freelancerRoutes.ts:550-600` filters only q / discipline / skill / rate / category. (The pro-bono badge shipped: `frontend/src/components/freelance/ProBonoBadge.tsx`.)

---

## SOC 2 Type I Compliance — checklist & remediation (epic #3062)

> Consolidated 2026-11-17 from `docs/specs/SOC2_TYPE1_COMPLIANCE.md` (a compliance checklist, not a PRD). Verified against code 2026-11-17: Partly built.
> Finished items are archived in DONE.md ("SOC 2 Type I checklist — finished items, archived 2026-11-17"); gap IDs are kept.

### §3 Identified gaps (open)
| Gap ID | Control | Issue | Verified 2026-11-17 |
|---|---|---|---|
| G-01 | CC6.1 | Unscoped tenant queries | 198 left: ratchet `api/scripts/check-tenant-scope.mjs`, baseline `api/scripts/.tenant-scope-baseline.txt` (was 271) |
| G-02 | CC6.1 | Inserts missing segmentId | Open (ROADMAP code health, "Segmented mode unusable") |
| G-03 | CC6.1 | No Row-Level Security | Open: no `ROW LEVEL SECURITY` in `api/migrations` |
| G-05 | CC9.2 | Stripe secrets unset | Open, operator (`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`) |
| G-06 | CC7.2 | Cloudflare + Neon Free tier | Open, operator |
| G-07 | CC5.2 | No formal ITGC documented | Open: no doc under `docs/` |
| G-08 | CC8.1 | No formal change management process | Partial: technical enforcement exists (`.github/CODEOWNERS` required review, PRD 08 §10 scan/review gate, automated CC8.1 evidence). The written policy is missing |
| G-09 | CC7.4 | No formal Incident Response Plan | Partial: `docs/compliance/privacy-incident-response.md` covers privacy breaches only |
| G-10 | CC2.3 | No external communication policy | Open |
| G-11 | CC3.3 | No fraud risk assessment | Open |
| G-12 | CC1.2 | No board charter/matrix | Open |
| G-14 | CC5.3 | No company ISMS policies | Open |
| G-15 | CC6.6 | No formal vulnerability management program | Partial: automated PR scanning + `/vuln-scans` tracker. The written program is missing |
| G-16 | CC1 | No CPA engagement letter | Open, operator: attestation blocker |

### §4 Remediation plan (open phases)
- **Phase 1:** G-01 (pay the ratchet down to 0), G-02, G-03 (RLS), G-05, G-06.
- **Phase 2 — documentation:** engage a CPA firm; write the board charter, ITGC, general IRP, change-management process, fraud risk assessment, external communications policy, ISMS and vulnerability-management program. These belong under `docs/compliance/`.
- **Phase 3 — evidence collection:** CC1, CC2, CC6, CC7, CC8 and CC9 evidence. Automated evidence for CC7.1 / CC8.1 already flows (`api/src/application/governance/automatedSocEvidence.ts`). The export is at `GET /api/governance/soc2/export`.
- **Phase 4 — audit execution:** submit to the CPA, answer questions, receive the Type I report.

### §5 Key contacts
Compliance Lead, Security Lead, Infrastructure Lead and Legal/Privacy are all TBD.

---

## PRD 18 — hired.video → Builderforce.ai port (hiring, résumé, Recruiter and HR agents)

> Consolidated 2026-11-17 from `docs/specs/18-prd-hired-video-port.md`. Verified against code 2026-11-17: Mostly built.
> Finished sections are archived in DONE.md ("PRD 18: finished sections archived on consolidation"); section numbers are kept, so a gap in numbering is a shipped section.
> **Split across domains:**
> - **run** (this file): §1.2, §1.4, T1, T2, T3, §5, §8.2 and §8.3 (résumé).
> - **make:** §1.3, T4, §8.1 and §8.4–§8.10.
> - **reach:** T5 and the T6 affiliates row.
> - **platform:** §3 cutover, §6.3 external clients, §6.6 and T6 whitelabel.
>
> §1.1, §1.5, T0 and §5a are shipped.

### §1.2 One tool catalog
The `recruiter.*` / `hr.*` namespaces live in `api/src/application/llm/careerToolCatalog.ts`, spread into `builtinMcpService.ts` `CATALOG`. Every tool is a thin adapter over a service; prompts reference `advertisedName()`, never the catalog id.

**Remaining (verified 2026-11-17):**
- `recruiter.publish_job` does not exist. Bind it to the existing posting distribution (`api/src/application/hiring/distributePosting.ts:75` `distributableAction`), so jobs publish through the one marketplace and connector path.
- `hr.profile_audit` does not exist. git grep `profile_audit` in api/src returns 0. The career analysis services it would wrap are in `api/src/application/career/`.

### §1.4 HRMS integrations = connector manifests
HRMS and ATS are connector manifests validated by `parseConnectorManifest` and reached through `connectorTools.ts`. **Corrected:** the HRMS side is read-only by decision (`connectors/defaults/hrms.ts:12-25`). Requisition publish and applicant import stay in `defaults/hiring.ts`. `create_requisition`/`advance_candidate` writes into an HRMS are not built and should not be.

**Remaining (verified 2026-11-17):**
- `namely` has no manifest (0 hits in `connectors/defaults/`).

### T1 · Résumé spine + the Recruiter agent
The demo that proves the track: upload a résumé and paste a JD → Recruiter returns a tailored résumé as an editable Canvas document → export PDF.

**Corrected:**
- The shared résumé contract is `packages/resume-ai` plus `packages/creation-canvas-contract/src/{resume,resumeDocument,resumeModel}.ts`. There is no `packages/recruiting-contract`.
- The hired.video SDK seam is already deleted: git grep for `hiredVideo|isHiredConfigured|HIRED_API` is empty, and `freelance/provisionForHire.ts:12` is native.

**Remaining (verified 2026-11-17):**
- R-016 and R-047: the Recruiter flow must return a scored derivative with **cited field changes and a post-tailor score delta**. Today `canvasResumeAts.ts` computes matched/missing keywords and the derivative is created, but no delta or citations are produced. Nearest code: `frontend/src/lib/canvasResumeAts.ts`, `api/src/application/career/jobMatch.ts`.

### T2 · Recruiting / ATS
These features are built:
- pipelines, applications, interview kits with scorecard attributes, interview scheduling, offers and decisions (`api/src/application/hiring/*`);
- posting distribution and board applicant import;
- sourcing to `catalog_items` (`sourcing/*`);
- references (`career/references.ts`), the company directory and reviews.

The Recruiter agent gains `source_candidates`, `screen_candidate`, `build_packet` and `publish_job`.

**Remaining (verified 2026-11-17), with no application code found by git grep:**
- Retained search: schema only (`schema/hiring.ts`, migration 0419).
- Sourcing bids: 0 hits.
- Talent pools, placements and splits; recruiter BD.
- Live screening: 0 hits outside blog content.
- Assessments and predictive assessments.
- Take-home invites: a pipeline stage exists in `api/src/domain/hiring/pipelineStages.ts`; there is no invite flow.
- Scorecard SLA reminder and the `recruiter-agent-followup` / `assessment-norms-recompute` crons. Each one goes in `cronSweeps.ts` behind `cronWorkSignal.ts`.
- Apply-button and auto-apply. The Chrome-extension endpoints are partly built (`presentation/routes/publicExtensionApiRoutes.ts`).
- Candidate-packet renderer. `recruiter.build_packet` exists; there is no packet document renderer (`candidatePacket` has 0 hits).
- Merge with ROADMAP "Merged-product behaviour missing: the ATS funnel" (ROADMAP.md:498).

### T3 · HR agent — Career 360, coaching, org design
**Career 360:**
1. Suggest targets.
2. Select a target. This derives the rubric, gap analysis and roadmap, persisted as one document.
3. Score history is read from `activity_log`; it does not come from a ported `tool_runs` table.

**Coaching:** the `/AICoach` surface becomes an HR-agent Brain chat with `origin='hr'`.

**Org design:** `hr.org_review` and `hr.headcount_plan` read the HRMS roster through connectors, the strategic objectives, and the delivery signal (`lib/deliveryVerdict.ts`, member metrics, `portfolioRollup.ts`). They emit a recommendation with evidence, rendered as a Canvas `report` with charts. A reduction recommendation is an approval-gated artifact behind `<RoleGate>`, never an automated action.

**Objectives caution:** `people_strategic_objectives` maps onto `objectives` / `key_results`, not a parallel OKR store, and writes must `invalidateProjectsList`.

**Remaining (verified 2026-11-17):**
- Career 360 has the tools (`api/src/application/career/career360.ts`) but **no UI**: the health wheel, target picker, roadmap and score-history sparkline have 0 hits in frontend/src.
- Score history is not assembled from `activity_log`.
- No `origin='hr'` Brain chat (0 hits).
- `hr.org_review` / `hr.headcount_plan` are pure computations over the roster (`people/orgReview.ts`, `people/headcountPlan.ts:1-27`). They:
  - read neither `objectives` nor the delivery signal;
  - render no Canvas report;
  - have no RoleGate-gated reduction artifact.

  The `people_strategic_objectives` → `objectives` mapping is not built (0 hits).
- Operator decision: `orgReview` deliberately refuses to recommend a reorganisation, which contradicts "recommends where to hire, redeploy, reduce". Decide which stands.

### §5 Standing rules this port must not break
- **No second implementation of anything.**
  - Campaigns → `campaignEngine.ts`.
  - Objectives → `objectives`/`key_results`.
  - Audit → `activity_log`.
  - Exports → `canvasExports.ts`.
  - Board view toggles → `@/components/ViewToggle`.
  - Model selection → `PromptOptionsMenu`.

  If a duplicate is extracted, every call site migrates in the same pass.
- **Localize, theme and make responsive in the same pass** as each ported component.
- **Cache or justify.** Every ported read endpoint goes through `getOrSetCached` with write-invalidation, or says why it cannot.
- **Delete as you go.** Run a zero-reference check across api, frontend and packages first.
- **Neon cost.** Keep the KV work-gate (`cronWorkSignal.ts`) in front of every ported cron.
- **Log then fix.** Every gap found during a slice is registered *and closed* in that slice, or names its single concrete blocker.

### §8.2 Required résumé user journey — release blocker
The status vocabulary is in make §8.1. 45 of 56 rows are PORTED (archived in DONE).

**Remaining (verified 2026-11-17):**
| ID | Behaviour | Status | Done when |
|---|---|---|---|
| R-007 | Validate file type, actionable error | PARTIAL | The résumé object gives localized, format-specific errors. |
| R-016 | Brain/Recruiter "create me a new résumé" | PARTIAL | Recruiter creates a structured derived résumé on the same Canvas (dedicated flow and evals). |
| R-026 | Archive/unarchive | PARTIAL | Archived objects are filtered from libraries. `archivedAt` already persists (`frontend/src/lib/canvasResume.ts`). |
| R-028 | Make active | PARTIAL | The active résumé persists per user/workspace and drives downstream applications. |
| R-029 | Watch/unwatch | PARTIAL | Notification delivery is ported, or removed by product decision. |
| R-030 | Merge one résumé into another | PARTIAL | Field-level (scalar/bullet) choose-source and undo. |
| R-044 | Inline edit and double-click text | PARTIAL | The remaining typed sections and double-click-on-preview edit in place. |
| R-047 | ATS/job-tailor workflow | PARTIAL | JD + source returns a scored, editable derivative with cited changes and a score delta. |
| R-049 | Export DOCX | PARTIAL | Hyperlink and media fidelity in DOCX. |
| R-053 | Review sessions, pins and comments | PARTIAL | Public-token commenters and dedicated pin coordinates. |
| R-054 | Version history dialog | PARTIAL | The dialog filters to the résumé and distinguishes source, AI, import and manual versions. |

### §8.3 Résumé template and renderer inventory
The one canonical renderer is `renderCanvasResumeRevision` (`frontend/src/lib/canvasResumeRenderer.ts`). Renderer parity is independently required; copying IDs is not completion.

**Remaining (verified 2026-11-17):**
| ID | Capability | Status | Acceptance |
|---|---|---|---|
| `hired-default` | Purple hero, split layout | PARTIAL | Split-hero entities render. |
| RR-007 | Continuous and paged/spread view | PARTIAL | True facing-page flow. |
| RR-010 | Drag blocks from the palette and reorder in flow | PARTIAL | Dragging newly added free-form palette blocks. Drop indicator and keyboard alternative are tested. |
| RR-011 | Detach a block to a free position / return to flow | MISSING (`freePosition|detachBlock`: 0 hits) | The round-trip retains content and coordinates. |
| RR-013 | Add text, heading, divider and entity-section blocks | PARTIAL | Free text, heading and divider palette blocks. |
| RR-014 | Empty-section state without fake content | PARTIAL | Empty sections stay editable and omit themselves from export when hidden. |
| RR-024 | Escape/close preview, responsive chrome | PARTIAL | An explicit 360px browser test passes. |
