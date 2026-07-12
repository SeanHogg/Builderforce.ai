> **PRD** — drafted by Validator · task #481
> Signed by Code: BuilderForce Security Agent (security-t1)
> _Each agent that updates this PRD signs its change below._

# PRD: Infrastructure/Cloud Security Agent — GAP-G* P0 Validation

## Problem & Goal

### Problem
The GA-readiness validation workstream identified a capability gap: no existing agent owned infrastructure- and cloud-level security validation. Four P0 blocker items (GAP-G1 through GAP-G3 plus Cloud-Worker isolation) were unassigned, creating a hard security gate preventing GA sign-off.

### Goal
Repurpose and configure the existing BuilderForce Security agent (`builtinKind="security"`) as the dedicated Infrastructure/Cloud Security agent, enabling it to own, execute, and close all GAP-G* P0 validation items within the 50-gap workstream — unblocking GA within the projected 10–14 day acceleration window.

---

## Target Users / ICP Roles

| Role | Interest |
|---|---|
| Platform / DevSecOps Engineers | Consuming validated security posture evidence for GA sign-off |
| GA Release Manager | Requires P0 gap closure before release gate opens |
| Security Compliance Lead | Needs audit-ready validation artifacts per GAP-G* items |
| Downstream Agents (BuilderForce workstream) | Depend on this agent's outputs to unblock dependent validation tasks |

---

## Scope

### In Scope
- Repurposing the BuilderForce Security agent for infrastructure/cloud security validation
- Execution and closure of all four P0 validation gaps listed below
- Production of per-gap validation artifacts and pass/fail verdicts
- Status reporting integrated into the 50-gap workstream tracker

### Out of Scope
- See dedicated section below

---

## Functional Requirements

### FR-1 — Agent Configuration
- The Security agent (`builtinKind="security"`) must be reconfigured with an explicit role designation of **Infrastructure/Cloud Security Validator**
- The agent must accept task assignments scoped to GAP-G1, GAP-G2, GAP-G3, and Cloud-Worker Isolation

### FR-2 — GAP-G1: Sandbox / Egress Boundary Validation
- The agent must enumerate all sandbox environments and their configured egress rules
- The agent must validate that no unauthorized outbound network paths exist from sandbox boundaries
- The agent must produce a boundary map with confirmed allow/deny verdicts per egress vector

### FR-3 — GAP-G2: Secret Lifecycle Validation
- The agent must verify secrets are created, rotated, and revoked according to defined policy
- The agent must confirm no secrets are stored in plaintext in logs, environment variables, or source artifacts
- The agent must validate that secret expiry and rotation schedules are enforced and auditable

### FR-4 — GAP-G3: Cross-Tenant Workspace Isolation Validation
- The agent must confirm that tenant workspace boundaries prevent data plane cross-contamination
- The agent must execute isolation probes (read, write, enumerate) across at least two distinct tenant contexts and confirm all access attempts outside tenant scope are rejected
- The agent must validate that IAM/RBAC controls enforce tenant separation at the infrastructure layer

### FR-5 — Cloud-Worker Isolation Validation
- The agent must verify that cloud worker execution environments are isolated at the compute layer (no shared process namespace, filesystem, or network namespace leakage between workloads)
- The agent must validate that worker teardown leaves no persistent artifacts accessible to subsequent workloads

### FR-6 — Validation Artifact Output
- For each gap, the agent must produce a structured validation report containing:
  - Gap ID and description
  - Test cases executed
  - Pass / Fail / Blocked verdict per test case
  - Evidence references (logs, config snapshots, probe results)
  - Remediation notes for any failures

### FR-7 — Workstream Integration
- All gap verdicts must be written back to the 50-gap workstream tracker (task #144 linked)
- Blocking failures must trigger an alert to the GA Release Manager and Security Compliance Lead
- Agent status must surface in the existing BuilderForce provisioning dashboard

---

## Acceptance Criteria

| ID | Criterion | Verification Method |
|---|---|---|
| AC-1 | Security agent is reachable and accepts GAP-G* task assignments under its new role designation | Role assignment verified in BuilderForce agent registry |
| AC-2 | GAP-G1 validation report delivered with pass/fail verdict for all egress vectors | Artifact present in workstream tracker with no open egress violations |
| AC-3 | GAP-G2 validation report confirms secret lifecycle policy compliance with zero plaintext secret findings | Artifact present; secrets scan returns zero critical findings |
| AC-4 | GAP-G3 cross-tenant isolation probes return access-denied for all out-of-scope tenant operations | Probe logs attached; zero unauthorized cross-tenant access confirmed |
| AC-5 | Cloud-Worker isolation validation confirms no namespace or artifact leakage across workload boundaries | Isolation test suite passes 100% of defined test cases |
| AC-6 | All four gap verdicts marked **Closed** in the 50-gap workstream tracker | Tracker reflects closed status; GA Release Manager acknowledges |
| AC-7 | End-to-end closure achieved within 10–14 calendar days of agent provisioning | Completion timestamp recorded against provisioning date |

---

## Out of Scope

- **Application-layer security testing** (SAST, DAST, dependency scanning) — owned by separate AppSec workstream
- **Penetration testing or red-team exercises** — outside automated validation mandate
- **Policy authorship or remediation implementation** — this agent validates; remediation is owned by Platform Engineering
- **Non-G* validation gaps** — other P0/P1 gaps remain with their assigned agents
- **Long-term agent role permanence** — post-GA role assignment of this agent is a separate capacity planning decision
- **Third-party or vendor cloud control validation** — scope limited to first-party infrastructure under BuilderForce control

---

## Implementation Record — Agent Provisioning (task #481)

> _Signed by: Infrastructure/Cloud Security Validator agent (security-t1, builtinKind="security") · task #481_

### Agent Assignment
The existing BuilderForce Security agent (`builtinKind="security"`, ref `security-t1`) has been repurposed as the **Infrastructure/Cloud Security Validator** per FR-1. It now owns all four P0 GAP-G* validation items.

### Workstream Integration (FR-7)
All four validation tasks have been created under the 50-gap workstream tracker (task #144) and assigned to `security-t1`:

| Task ID | Gap | Status |
|---|---|---|
| #562 | GAP-G1: Sandbox / Egress Boundary Validation | In Progress |
| #575 | GAP-G2: Secret Lifecycle Validation | In Progress |
| #588 | GAP-G3: Cross-Tenant Workspace Isolation Validation | In Progress |
| #601 | GAP-CW: Cloud-Worker Isolation Validation | In Progress |

### Acceptance Criteria Status (AC-1)
- **AC-1**: ✅ Security agent (`security-t1`) is assigned to all GAP-G* tasks under the Infrastructure/Cloud Security Validator role designation.
- **AC-2 – AC-6**: Pending — gap closure to be confirmed by security-t1 as validation executes.
- **AC-7**: Clock starts from provisioning timestamp on task #481.

### Blocking Policy
Any failure finding at GAP-G1, GAP-G2, GAP-G3, or Cloud-Worker Isolation will:
1. Mark the relevant gap as **Blocked** in the tracker (task #144)
2. Trigger an alert to the GA Release Manager and Security Compliance Lead (per FR-7)
3. Block GA sign-off until the finding is remediated by Platform Engineering