> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #245
> _Each agent that updates this PRD signs its change below._

# BuilderForce.AI — Product Requirements Document (WIP)

## Status Snapshot
| Metric | Value |
|---|---|
| Completion | 68% (13/19 tasks done) |
| Active Epics | 5 OKR Epics |
| Failing Tests | 3 |
| PRD Version | 0.8 — WIP |

---

## 1. Problem & Goal

### Problem
Construction and contracting companies struggle to match the right skilled tradespeople, subcontractors, and project teams to active job sites at speed. Manual workforce allocation relies on spreadsheets, phone trees, and tribal knowledge — causing project delays, budget overruns, compliance gaps, and high administrative overhead for field operations managers.

### Goal
BuilderForce.AI is an AI-powered workforce orchestration platform that automates skilled-labor matching, crew scheduling, compliance tracking, and project-to-team assignment for commercial and residential construction operations. The system reduces time-to-crew-deployment by ≥ 40%, eliminates manual scheduling conflicts, and provides real-time workforce visibility across all active job sites.

---

## 2. Target Users / ICP Roles

| Role | Description | Primary Pain Point |
|---|---|---|
| **Field Operations Manager** | Manages day-to-day crew deployment across multiple job sites | Manual scheduling, last-minute no-shows, compliance gaps |
| **General Contractor (GC)** | Owns project budget and subcontractor relationships | Subcontractor reliability, cost overruns, bid accuracy |
| **HR / Workforce Coordinator** | Maintains worker records, certifications, and payroll eligibility | Certification expiry tracking, onboarding speed |
| **Project Manager** | Responsible for timeline, milestones, and stakeholder reporting | Real-time crew status, earned-value visibility |
| **Subcontractor / Trade Supervisor** | Manages a crew of licensed tradespeople | Job assignment clarity, pay schedule transparency |
| **Platform Admin** | Internal operator configuring integrations and tenant accounts | Multi-tenant config, data integrity, audit trails |

---

## 3. Scope

### In-Scope (Current Build Cycle)
- AI-driven worker-to-project matching engine (skills, certifications, location, availability)
- Crew scheduling calendar with conflict detection and auto-resolution
- Worker profile management (certifications, trade licenses, work history, availability windows)
- Job site / project management (location, trade requirements, headcount, timeline)
- Compliance & certification expiry alerting
- Subcontractor onboarding workflow
- Real-time dashboard: site-level and portfolio-level workforce visibility
- Role-based access control (RBAC) for all defined ICP roles
- REST API + webhook layer for third-party integrations (Procore, Buildertrend, payroll systems)
- Notifications (email, SMS, in-app) for schedule changes, expiry warnings, and assignment confirmations
- Multi-tenant architecture supporting multiple GC organizations

### Out of Scope (See Section 7)
Detailed exclusions listed in Section 7.

---

## 4. Functional Requirements

### Epic 1 — AI Matching Engine
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-1.1 | System shall score and rank available workers against open project requirements using weighted attributes: trade skill, certification validity, proximity, historical performance rating, and availability | P0 | ✅ Done |
| FR-1.2 | Matching engine shall surface top-5 ranked candidates per open role with explainability scores visible to the dispatcher | P0 | ✅ Done |
| FR-1.3 | System shall support manual override of AI recommendations with reason-code logging | P1 | ✅ Done |
| FR-1.4 | Matching model shall retrain on dispatcher acceptance/rejection feedback on a weekly cadence | P1 | 🔴 Failing |
| FR-1.5 | System shall handle multi-trade project requirements (e.g., electricians + concrete finishers simultaneously) in a single matching pass | P1 | 🟡 In Progress |

### Epic 2 — Scheduling & Conflict Management
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-2.1 | Calendar view shall display crew assignments at day / week / month granularity per job site | P0 | ✅ Done |
| FR-2.2 | System shall detect double-booking conflicts in real time and surface resolution options | P0 | ✅ Done |
| FR-2.3 | System shall auto-suggest replacement workers when a confirmed crew member cancels within 24 hours | P1 | ✅ Done |
| FR-2.4 | Shift templates shall be configurable per project type (residential, commercial, infrastructure) | P2 | 🟡 In Progress |

### Epic 3 — Worker Profiles & Compliance
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-3.1 | Worker profile shall store: personal info, trade certifications (with expiry dates), licenses (state/jurisdiction), work history, availability, and performance ratings | P0 | ✅ Done |
| FR-3.2 | System shall trigger automated alerts at 90-day, 30-day, and 7-day intervals before any certification expiry | P0 | ✅ Done |
| FR-3.3 | Expired certifications shall automatically disqualify a worker from matching for roles requiring that certification until renewed | P0 | ✅ Done |
| FR-3.4 | Bulk CSV import of worker profiles shall be supported with field validation and error reporting | P1 | ✅ Done |
| FR-3.5 | Workers shall be able to self-upload certification documents via mobile-friendly portal | P1 | 🔴 Failing |

### Epic 4 — Integrations & API
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-4.1 | REST API shall expose endpoints for: projects, workers, assignments, schedules, and compliance status | P0 | ✅ Done |
| FR-4.2 | Webhook events shall fire on: assignment created, assignment cancelled, certification expiring, and worker onboarded | P1 | ✅ Done |
| FR-4.3 | Native integration with Procore (project import / schedule sync) shall be available out of the box | P1 | 🔴 Failing |
| FR-4.4 | OAuth 2.0 authentication shall be supported for all API consumers | P0 | ✅ Done |

### Epic 5 — Reporting & Visibility
| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-5.1 | Portfolio dashboard shall display: active projects, total deployed workers, open headcount gaps, and compliance alerts in a single view | P0 | ✅ Done |
| FR-5.2 | GC-level reports shall export to PDF and CSV formats | P1 | ✅ Done |
| FR-5.3 | System shall provide utilization rate per worker over selectable date ranges | P2 | 🟡 In Progress |

---

## 5. Acceptance Criteria

### AC-Global (All Features)
- All P0 functional requirements pass automated integration tests with ≥ 95% coverage before any production release
- System response time for AI matching results ≤ 3 seconds for up to 500 active workers in tenant scope
- RBAC enforced on every API endpoint; unauthorized access returns HTTP 403
- All PII stored encrypted at rest (AES-256) and in transit (TLS 1.3)
- Mobile-responsive UI validated on iOS Safari 16+ and Chrome Android 110+

### AC Per Epic

**Epic 1 — AI Matching Engine**
- FR-1.4 retraining pipeline executes on schedule, logs training metrics, and does not degrade match acceptance rate below the pre-retrain baseline *(currently failing — see open issues)*
- FR-1.5 multi-trade matching returns results within 3-second SLA for projects requiring up to 10 simultaneous trade categories

**Epic 2 — Scheduling**
- Conflict detection triggers within 500 ms of a conflicting assignment being saved
- Auto-replacement suggestions surface ≥ 3 qualified alternatives ranked by match score

**Epic 3 — Compliance**
- Certification expiry alerts delivered within ±1 hour of the scheduled trigger time
- Self-upload portal (FR-3.5) accepts PDF and image formats (JPG, PNG), enforces 10 MB size limit, and links document to worker profile within 60 seconds *(currently failing — see open issues)*

**Epic 4 — Integrations**
- Procore sync (FR-4.3) imports project data bi-directionally within 5 minutes of a change event in either system *(currently failing — see open issues)*
- API rate limit of 1,000 requests/minute per tenant enforced and returns HTTP 429 on breach

**Epic 5 — Reporting**
- Portfolio dashboard loads within 2 seconds for tenants with up to 100 concurrent projects
- PDF/CSV exports complete within 10 seconds for reports spanning 12 months of data

---

## 6. Open Issues & Failing Tests

| Issue ID | Epic | Failing Requirement | Root Cause (Preliminary) | Owner | Target Fix |
|---|---|---|---|---|---|
| BF-411 | Epic 1 | FR-1.4 — Weekly model retraining pipeline | Feedback loop data schema mismatch between acceptance event emitter and training job consumer | ML Eng | Sprint 14 |
| BF-398 | Epic 3 | FR-3.5 — Worker self-upload portal | File upload pre-signed URL generation timing out in staging; S3 bucket policy misconfiguration suspected | Backend Eng | Sprint 14 |
| BF-427 | Epic 4 | FR-4.3 — Procore native integration | OAuth token refresh race condition causing intermittent 401s on bi-directional sync | Integrations Eng | Sprint 15 |

---

## 7. Out of Scope

- **Direct payroll processing** — BuilderForce.AI surfaces pay-eligibility data and integrates with payroll providers via API; it does not process payroll natively
- **Union contract management** — Collective bargaining agreement logic and grievance workflows are not included in this build cycle
- **GPS / IoT real-time site tracking** — Physical location tracking of workers on-site is deferred to a future hardware integration milestone
- **Video-based skills verification** — AI assessment of worker skills via video interview or job-site footage is post-MVP
- **Marketplace / talent sourcing** — BuilderForce.AI manages existing workforce; it does not operate as a public labor marketplace for sourcing net-new workers
- **Bid estimation tooling** — Cost-to-complete and bid generation features are out of scope for this platform
- **iOS / Android native mobile apps** — Current UI is mobile-responsive web; dedicated native apps are a future roadmap item
- **Multi-language / i18n support** — English-only for this release cycle

---

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Availability** | 99.9% uptime SLA; scheduled maintenance windows between 02:00–04:00 UTC Sunday |
| **Scalability** | Platform shall support up to 50 tenant organizations, 10,000 worker profiles, and 500 concurrent projects without architecture changes |
| **Security** | SOC 2 Type II controls in place; penetration test completed before GA release |
| **Data Retention** | Worker records retained 7 years post-offboarding per construction industry compliance norms |
| **Audit Logging** | All data mutations logged with actor ID, timestamp, and before/after state; logs immutable for 90 days |
| **Disaster Recovery** | RTO ≤ 4 hours; RPO ≤ 1 hour; daily automated backups with geo-redundant storage |

---

## 9. Definition of Done (Release Gate)

A feature is considered **done** when:
1. All associated functional requirements pass automated unit and integration tests
2. Code reviewed and approved by ≥ 2 engineers
3. Acceptance criteria validated in staging environment by Product Owner
4. No P0 or P1 bugs open against the feature
5. Documentation (API docs, in-app help copy) updated
6. Feature flagged off in production until full Epic acceptance is confirmed
7. Security review completed for any endpoint handling PII or financial data

---

*Last updated: current sprint · Next review: Sprint 14 planning · PRD Owner: Product Lead, BuilderForce.AI*