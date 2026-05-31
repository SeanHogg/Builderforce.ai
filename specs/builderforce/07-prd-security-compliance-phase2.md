# 07 — PRD (Phase 2): Security, Governance & Compliance + DevSecOps Agents

**Status: Phase 2.** This domain extracts *after* the core Product Management + Agile port
(docs 00–06) is live. It does not block Phase 1 and does not change the Tenant→Segment isolation
model or the embed-back contract — it rides both.

**Persona:** CISO. **Positioning shift:** with this phase BuilderForce becomes a *dev + PM +
**security*** platform — an agentic product that builds software, plans it, **and** keeps it
secure and compliant. Security stops being a passive logging surface and becomes part of the
build loop (DevSecOps agents).

> Decisions locked (2026-05-31): **(1)** the full Governance & Compliance program moves to
> BuilderForce *except identity*; **(2)** DSR queue + suppression list move to BuilderForce,
> re-scoped **per-Segment**; **(3)** add agentic DevSecOps (vuln-scan + security-review on agent
> PRs, auto SOC 2 evidence). RBAC/SSO/multi-tenant accounts **stay in BurnRateOS** (it remains the
> identity provider).

---

## 1. Scope: what moves, what stays

### Moves to BuilderForce (per-Segment system of record)

| Feature | Source model(s) | Source scope today |
|---|---|---|
| SOC 2 Control Tracker | `SocControl`, `SocEvidence` | accountId |
| Vendor / Subprocessor Register | `SecurityVendor` | accountId |
| Security Incident Register | `SecurityIncident` | accountId |
| PII & Data Inventory | `PiiDataAsset` | accountId |
| DPA Management | `SecurityDpa` | accountId |
| Security Training Tracker | `SecurityTraining` | accountId |
| Compliance Calendar | `ComplianceEvent` | accountId |
| Data Subject Requests | `DataSubjectRequest` | **platform-global** |
| Suppression List | `DataSuppressionList` | **platform-global** |
| Access Reviews | *(none — build new)* | — |
| Vulnerability Scan mgmt | *(none — build new)* | — |

### Stays in BurnRateOS (identity core — BuilderForce federates, never owns)

- **RBAC, SSO, multi-tenant Accounts/Companies/Teams/Users** — BurnRateOS is the IdP (doc 05 §2).
- **Platform audit trail of identity/login/billing events** (`AccountAuditLog`) — BurnRateOS keeps
  its own. BuilderForce keeps a **separate** per-Segment security audit of *its* actions (agent
  runs, security changes) — see §3 `SecurityAuditLog`.
- **Platform approval workflows tied to RBAC** (`ApprovalWorkflow`) stay; BuilderForce's *change*
  approvals are the orchestrator merge gates (doc 04 §6) — do not duplicate.

### ⚠️ Re-homing note: DSR + Suppression (read this)

Today `DataSubjectRequest` and `DataSuppressionList` are **platform-global** — they govern
BurnRateOS's *shared business contact graph* (see `project_company_shared_graph` /
`project_contact_dual_scope`): one suppression list checked on every sourcing lookup across all
tenants; one DSR queue that erases shared rows and fans out suppression entries platform-wide.

Moving them to BuilderForce **per-Segment** changes their meaning: in BuilderForce they govern
**only that Segment's data** (its work items, validation evidence, identity-cache, agent inputs).
They do **not** govern BurnRateOS's shared contact graph. Therefore:

- **BurnRateOS must retain its own platform-global DSR/suppression for the shared contact graph.**
  The per-Segment ones in BuilderForce are additive, not a replacement for the shared-graph rail.
- On a BurnRateOS DSR erasure, the existing `DELETE /v1/admin/segments/:id` cascade (doc 05 §3)
  already wipes the matching Segment's BuilderForce data — that is the cross-app erasure path.
- This split (platform-global graph DSR in BurnRateOS + per-Segment DSR in BuilderForce) is logged
  in the gap register; it must be implemented deliberately to avoid a compliance gap.

---

## 2. Net-new vs. ported

- **Ported (re-scoped to Tenant→Segment, full field union):** SOC2, vendor, incident, PII, DPA,
  training, compliance calendar, DSR, suppression.
- **Build-new (cataloged/marketed but never had a model in BurnRateOS):** **Access Reviews** and
  **Vulnerability Scan Management** — both fit DevSecOps and are specced below.
- **Build-new agentic:** vuln-scan + security-review on agent PRs, auto SOC 2 evidence capture.

---

## 3. Domain model additions (append to doc 01; all `(tenantId, segmentId)`-scoped)

```prisma
// SOC 2 control tracking
model SocControl {
  id String @id @default(uuid())
  tenantId String; segmentId String
  controlRef String              // CC1.1, CC2.1 … (SOC 2 Common Criteria)
  category String                // CC1..CC9 | A | C | PI | P
  name String; requirement String
  status String @default("not_started")   // not_started|in_progress|ready|out_of_scope
  ownerId String?; notes String?
  @@index([tenantId, segmentId, category])
  @@index([tenantId, segmentId, status])
}
model SocEvidence {
  id String @id @default(uuid())
  tenantId String; segmentId String; controlId String
  title String; evidenceType String      // policy|screenshot|log|config|url|note
  url String?; note String?; uploadedBy String?
  // [NEW] auto-evidence provenance when collected from an agent run / repo activity
  sourceRef Json?                          // { kind:"agent_run"|"scm"|"manual", agentRunId?, prUrl? }
  @@index([tenantId, segmentId, controlId])
}

model SecurityVendor {
  id String @id @default(uuid())
  tenantId String; segmentId String
  name String; purpose String; region String?; dataClasses String?
  isSubprocessor Boolean @default(false)
  dpaStatus String @default("pending")     // pending|signed|expired|not_required
  dpaUrl String?; renewalDate DateTime?; contactEmail String?; website String?; notes String?
  @@index([tenantId, segmentId, isSubprocessor])
}

model SecurityIncident {
  id String @id @default(uuid())
  tenantId String; segmentId String
  title String; severity String @default("low")   // critical|high|medium|low
  status String @default("open")                   // open|investigating|contained|resolved
  discoveredAt DateTime @default(now()); resolvedAt DateTime?
  detectionSource String?                          // monitoring|customer_report|audit|pen_test|agent|other
  impact String?; rootCause String?; postmortemUrl String?; reportedBy String?; assignedTo String?
  // [NEW] link to the vuln finding / agent run that raised it
  sourceRef Json?
  @@index([tenantId, segmentId, severity])
  @@index([tenantId, segmentId, status])
}

model PiiDataAsset {
  id String @id @default(uuid())
  tenantId String; segmentId String
  name String; classification String @default("internal")  // public|internal|confidential|restricted
  dataCategories String?; storageLocation String?; retentionDays Int?
  legalBasis String?                       // contract|consent|legitimate_interest|legal_obligation
  ownerTeam String?; lastReviewedAt DateTime?; notes String?
  @@index([tenantId, segmentId, classification])
}

model SecurityDpa {
  id String @id @default(uuid())
  tenantId String; segmentId String
  counterpartyName String; counterpartyType String @default("vendor")  // vendor|customer|subprocessor
  status String @default("draft")          // draft|signed|expired|terminated
  signedAt DateTime?; effectiveDate DateTime?; renewalDate DateTime?
  dpaUrl String?; sccVersion String?; notes String?
  @@index([tenantId, segmentId, status])
}

model SecurityTraining {
  id String @id @default(uuid())
  tenantId String; segmentId String
  userId String?; userName String; userEmail String?
  trainingType String                      // phishing|sec_awareness|soc2_ready|gdpr|custom
  trainingName String; completedAt DateTime?; dueDate DateTime?
  status String @default("not_started")    // not_started|in_progress|completed|overdue
  certificateUrl String?; notes String?
  @@index([tenantId, segmentId, status])
  @@index([tenantId, segmentId, userId])
}

model ComplianceEvent {
  id String @id @default(uuid())
  tenantId String; segmentId String
  title String; framework String           // soc2|gdpr|ccpa|sox|hipaa|custom
  eventType String @default("milestone")   // milestone|evidence_refresh|audit|renewal
  dueDate DateTime; status String @default("upcoming")  // upcoming|in_progress|completed|overdue
  assignedTo String?; isRecurring Boolean @default(false); recurringEvery String?
  notes String?; completedAt DateTime?
  @@index([tenantId, segmentId, dueDate])
  @@index([tenantId, segmentId, framework])
}

// DSR + suppression — re-scoped PER-SEGMENT (governs Segment data only; see §1 ⚠️)
model DataSubjectRequest {
  id String @id @default(uuid())
  tenantId String; segmentId String
  requestType String                       // access|erasure|rectification|portability|objection|opt_out
  subjectEmail String; subjectEmailHash String?; secondaryIdentifiers Json?
  jurisdiction String?; notes String?
  status String @default("verifying_identity")  // verifying_identity|pending|processing|completed|rejected
  verificationToken String?; verificationTokenExpiresAt DateTime?; verifiedAt DateTime?
  processedByUserId String?; processedAt DateTime?; rejectionReason String?
  redactedRecordIds String[] @default([]); exportPayload Json?
  submittedIp String?; submittedUserAgent String?
  @@index([tenantId, segmentId, status])
}
model DataSuppressionList {
  id String @id @default(uuid())
  tenantId String; segmentId String
  identifierType String                    // email|linkedin_url|github_login|phone_e164|domain
  identifierValue String; identifierHash String?
  reason String                            // erasure_request|user_opt_out|hard_bounce|spam_complaint|manual_admin_add
  addedByUserId String?; addedByDsrId String?; notes String?
  @@unique([tenantId, segmentId, identifierType, identifierValue])
}

// [NEW] Access Reviews — periodic attestation of who has access to what
model AccessReview {
  id String @id @default(uuid())
  tenantId String; segmentId String
  scope String                             // repo|segment|integration|board
  scopeRef String?                         // Repo.id, etc.
  period String                            // e.g. "2026-Q2"
  status String @default("open")           // open|in_progress|completed|overdue
  reviewerId String?; dueDate DateTime?; completedAt DateTime?
  findings Json?                           // [{ principalId, currentAccess, decision: keep|revoke|reduce }]
  notes String?
  @@index([tenantId, segmentId, status])
}

// [NEW] Vulnerability scans — DevSecOps (SAST/SCA/secret-scan on connected repos)
model VulnerabilityScan {
  id String @id @default(uuid())
  tenantId String; segmentId String
  repoId String; ref String?               // branch/commit/PR scanned
  scanType String                          // SAST|SCA|SECRET|IAC|CONTAINER
  status String @default("queued")         // queued|running|completed|failed
  triggeredBy String?                      // userId | "AGENT_PR" | "SCHEDULE"
  agentRunId String?                       // when triggered on an agent PR
  startedAt DateTime?; finishedAt DateTime?
  summary Json?                            // { critical, high, medium, low }
  @@index([tenantId, segmentId, repoId, status])
}
model VulnerabilityFinding {
  id String @id @default(uuid())
  tenantId String; segmentId String; scanId String
  severity String                          // CRITICAL|HIGH|MEDIUM|LOW
  ruleId String; title String; filePath String?; line Int?
  packageName String?; vulnerableVersion String?; fixedVersion String?  // for SCA
  cwe String?; cve String?; description String; remediation String?
  status String @default("open")           // open|triaged|fixed|accepted_risk|false_positive
  @@index([tenantId, segmentId, scanId, severity])
}

// [NEW] Per-Segment security audit of BuilderForce's own actions
model SecurityAuditLog {
  id String @id @default(uuid())
  tenantId String; segmentId String
  actorId String?; actorKind String @default("USER")   // USER|AGENT|SYSTEM
  action String                            // e.g. "dpa.signed", "incident.resolved", "agent.merge"
  targetType String?; targetId String?
  before Json?; after Json?; ip String?; userAgent String?
  createdAt DateTime @default(now())
  @@index([tenantId, segmentId, createdAt])
}
```

---

## 4. Feature PRDs

> All endpoints under `/v1/governance/*`, Segment-scoped JWT, rate-limited per Segment. Acceptance
> for every feature includes: Segment isolation enforced via `resolveSegment` and a write to
> `SecurityAuditLog`.

### SEC-1 — SOC 2 Control Tracker
Seed a CC1–CC9 baseline (30-control) in one click; per-control status + evidence; readiness %
scoreboard by category; auditor-ready JSON export. **DevSecOps tie-in:** evidence for change-mgmt
controls (CC8) can be **auto-collected** from agent runs + PR/merge activity (§5).
`GET/POST /v1/governance/soc2/controls`, `POST /v1/governance/soc2/seed`,
`POST .../controls/:id/evidence`, `GET /v1/governance/soc2/export`.

### SEC-2 — Vendor / Subprocessor Register
DPA lifecycle (pending/signed/expired/not_required), subprocessor flag for a public trust page,
renewal alerts, data-class tagging. `GET/POST/PUT/DELETE /v1/governance/vendors`.

### SEC-3 — Security Incident Register
Severity + status workflow, MTTR, detection-source (incl. `agent`), postmortem links. Can be
**auto-opened** from a CRITICAL `VulnerabilityFinding`. `GET/POST/PUT /v1/governance/incidents`.

### SEC-4 — PII & Data Inventory (GDPR Art. 30)
Classification, retention days, Art. 6 legal basis, owner team, review cadence.
`GET/POST/PUT/DELETE /v1/governance/data-inventory`.

### SEC-5 — DPA Management
Draft→signed→expired lifecycle, counterparty type, SCC version, renewal alerts.
`GET/POST/PUT /v1/governance/dpa`.

### SEC-6 — Security Training Tracker
Per-user completion, due-date/overdue detection, completion-rate reporting, certificate URLs.
Roster resolves through `IdentityCache`. `GET/POST/PUT /v1/governance/training`.

### SEC-7 — Compliance Calendar
Framework-tagged events (SOC2/GDPR/CCPA/SOX/HIPAA/custom), recurring cadences, auto-overdue,
per-event assignment. **Seam:** events can be pushed to BurnRateOS Operational Cadence / calendar
via webhook. `GET/POST/PUT /v1/governance/compliance-calendar`.

### SEC-8 — Access Reviews **[new]**
Periodic attestation of who can access each repo/segment/integration. Generate a review per
period, reviewer decides keep/revoke/reduce per principal; overdue detection; completion feeds
SOC 2 evidence (CC6 logical access). `GET/POST /v1/governance/access-reviews`,
`POST .../:id/complete`.

### SEC-9 — Vulnerability Scan Management **[new, DevSecOps]**
SAST / SCA / secret-scan / IaC scans on connected `Repo`s. Manual, scheduled, or **auto on every
agent PR** (§5). Findings triage workflow; CRITICAL auto-raises a `SecurityIncident`.
`POST /v1/governance/scans { repoId, ref, scanType }`, `GET /v1/governance/scans/:id`,
`GET /v1/governance/findings`, `PATCH /v1/governance/findings/:id`.

### SEC-10 — Data Subject Requests (per-Segment)
Public submission + magic-link verification; erasure redacts + cascade-deletes the **Segment's**
matching records and auto-populates the Segment suppression list; statutory window tracking
(30d EU/UK · 45d CA). **Governs Segment data only** (see §1 ⚠️). `POST /v1/governance/dsr` (public),
`GET /v1/governance/dsr`, `POST .../:id/process`.

### SEC-11 — Suppression List (per-Segment)
Identifiers that must never be re-used within the Segment; auto-populated by erasure DSRs;
manually editable; checked on Segment-scoped lookups (e.g. CRM-ingest candidates from doc 05 §4.2).
`GET/POST/DELETE /v1/governance/suppression`.

---

## 5. Agentic DevSecOps layer (build-new, extends doc 04)

New agent kinds added to `AgentKind`: **SECURITY_SCAN**, **SECURITY_REVIEW**.

- **Auto-scan agent PRs.** When an IMPLEMENT agent opens a PR (doc 04 §4), the orchestrator
  automatically runs a `VulnerabilityScan` (SAST + SCA + secret-scan) against the branch. Findings
  land as `VulnerabilityFinding`s linked to the `AgentRun`.
- **Security-review gate.** A SECURITY_REVIEW agent (`useCase: dev.security_review`) assesses the
  diff for injection, authz, secret-leak, and unsafe-dependency risks → `CodeReviewFinding`s with
  `category=SECURITY`. **BLOCKER security findings gate auto-merge** via the orchestrator policy
  (`policy.blockerGate`, doc 04 §6). Human-authored PRs can be scanned too.
- **Auto SOC 2 evidence.** Agent runs + PR/merge records auto-create `SocEvidence` for change-mgmt
  controls (CC8): "every code change went through review + scan." `sourceRef` records provenance.
- **CRITICAL → incident.** A CRITICAL finding auto-opens a `SecurityIncident` (detection-source
  `agent`) so the response clock starts.

**Acceptance:** no agent PR auto-merges with an open BLOCKER security finding; every scan/finding
is Segment-scoped and audited; scanners run in the same sandboxed runner as the dev agents (doc 04
§8); scanner config is least-privilege over the Segment's connected repos only.

---

## 6. New AI use cases (append to doc 01 §8)

| Use case | Purpose |
|---|---|
| `dev.security_review` | security-focused diff/PR review → SECURITY findings + verdict |
| `gov.soc2.suggest_evidence` | suggest which artifacts satisfy a given SOC 2 control |
| `gov.dsr.classify` | classify an inbound DSR + locate the Segment records to redact |
| `gov.vuln.triage` | triage/dedupe scan findings, propose remediation + severity |

---

## 7. Embed-back & thin shells (reuse the rail — doc 05 §5)

The `/governance/*` BurnRateOS pages become thin embed shells like the PM/Agile ones:

```
/governance/soc2                 → <BuilderForceEmbed view="soc2" />
/governance/vendors              → <BuilderForceEmbed view="vendors" />
/governance/incidents            → <BuilderForceEmbed view="incidents" />
/governance/data-inventory       → <BuilderForceEmbed view="data-inventory" />
/governance/dpa                  → <BuilderForceEmbed view="dpa" />
/governance/training             → <BuilderForceEmbed view="training" />
/governance/compliance-calendar  → <BuilderForceEmbed view="compliance-calendar" />
/governance/access-reviews       → <BuilderForceEmbed view="access-reviews" />   (new)
/governance/scans                → <BuilderForceEmbed view="vuln-scans" />        (new)
/governance/dsr                  → <BuilderForceEmbed view="dsr" />               (per-Segment)
/governance/suppression          → <BuilderForceEmbed view="suppression" />       (per-Segment)
```

- **Do NOT move:** `/governance/overview` access-control/RBAC/SSO admin and the platform audit
  trail — those stay native BurnRateOS (identity core). The Governance nav category keeps both
  native (RBAC/audit) and embedded (compliance) entries.
- One shared `<BuilderForceEmbed view=…>` component (same as doc 05) — no per-view bespoke embeds.

---

## 8. Identity boundary (unchanged from doc 05 §2)

BurnRateOS stays the IdP. The JWT already carries `role`/`persona`; BuilderForce gates the CISO
surfaces on persona/role from claims (`<…>` self-hiding components, no prop-drilled `canX`). RBAC
definitions, SSO config, and the identity/login audit are **never** owned by BuilderForce.

---

## 9. Phasing & dependencies

- **Prereq:** Phase 1 (core PM/Agile port + Tenant/Segment + embed-back) must be live.
- **2a — Ported trackers:** SOC2, vendor, incident, PII, DPA, training, compliance calendar
  (straight re-scope + UI). Lowest risk.
- **2b — Access Reviews + Vulnerability Scans** (build-new) — needs `Repo` connection (doc 04 §3).
- **2c — DevSecOps agents** — needs the agent runtime (doc 04) + 2b scanners.
- **2d — Per-Segment DSR + Suppression** — implement alongside the explicit retention of
  BurnRateOS's platform-global shared-graph DSR (see §1 ⚠️ and the gap register).
- None of 2a–2d alter the Tenant→Segment isolation model or the embed/SSO contract.
