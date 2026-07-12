> **PRD** — drafted by Security · task #562
> _Each agent that updates this PRD signs its change below._

# PRD: GAP-G1 Sandbox / Egress Boundary Validation

## Product Requirements Document — WIP

**Document ID:** PRD-GAP-G1
**Workstream Tracker Task:** #144
**Assigned Agent:** security-t1 (Infrastructure/Cloud Security Validator)
**Status:** Work In Progress
**Functional Reference:** FR-2 (primary), FR-3 – FR-6 (supporting)

---

## 1. Problem & Goal

### Problem

Sandbox environments that leak unauthorized outbound network traffic represent a critical security boundary failure. Without systematic egress validation, sensitive workloads may exfiltrate data, contact command-and-control infrastructure, or bypass tenant isolation controls — all without detection.

GAP-G1 captures the open finding that sandbox egress boundaries have not been formally enumerated, tested, or verdict-recorded against a defined allow/deny policy.

### Goal

Close GAP-G1 by producing a complete, evidence-backed Sandbox Egress Boundary Validation that:

1. Enumerates every sandbox environment and its configured egress rules.
2. Executes test cases against every identified egress vector.
3. Renders a machine-readable boundary map with explicit `ALLOW` / `DENY` / `BLOCKED` verdicts per vector.
4. Surfaces all violations with remediation notes.
5. Records a final `PASS` / `FAIL` conclusion in workstream tracker task #144 and closes GAP-G1 on the Security Provisioning dashboard.

---

## 2. Target Users / ICP Roles

| Role | Responsibility in this workstream |
|---|---|
| **security-t1** (Infrastructure/Cloud Security Validator) | Executing agent — runs enumeration, probes, produces the JSON report |
| **Security Lead / Workstream Owner** | Reviews conclusions, signs off GAP-G1 closure in tracker |
| **Cloud/Infrastructure Engineers** | Owners of sandbox configurations; action remediation notes |
| **Compliance & Audit** | Consumes evidence references for audit trail |
| **Security Provisioning Dashboard** | Automated consumer of closure signal to update GAP-G1 status |

---

## 3. Scope

### In Scope

- All sandbox environments provisioned within the defined cloud boundary (dev, staging, ephemeral CI sandboxes, and any tenant-isolated sandboxes).
- All egress vectors per sandbox: outbound TCP/UDP by port range, DNS resolution paths, HTTP/HTTPS proxy routes, ICMP, and any cloud-native NAT gateway or VPC peering routes.
- Egress rule sources: security group rules, network ACLs, firewall policies, service mesh egress policies, and cloud-native policy engines (e.g., AWS SCP/SG, GCP VPC firewall, Azure NSG).
- Validation report covering FR-2 through FR-6.
- JSON boundary map artifact (`gap-g1-boundary-map.json`).
- Remediation notes for every `FAIL` or `BLOCKED` verdict.
- Tracker update and dashboard closure.

### Boundary

This PRD governs only the **validation** phase of GAP-G1. Remediation execution (applying firewall rule changes, patching misconfigured sandboxes) is owned by Cloud/Infrastructure Engineers and tracked as follow-on work items, not as deliverables here.

---

## 4. Functional Requirements

### FR-2 — Egress Boundary Enumeration *(primary)*

**FR-2.1** The validator must enumerate all sandbox environments from the authoritative infrastructure inventory (IaC state, cloud console API, or CMDB) and record each as a named entry in the boundary map.

**FR-2.2** For each sandbox, the validator must extract all configured egress rules from the applicable policy layer (security groups, NACLs, firewall rules, service mesh policies).

**FR-2.3** Each egress rule must be classified as `EXPLICIT_ALLOW`, `EXPLICIT_DENY`, or `IMPLICIT_DENY`.

**FR-2.4** The validator must identify any egress vector not covered by an `EXPLICIT_DENY` or default-deny posture and flag it as an **open vector requiring probe**.

### FR-3 — Active Egress Probe Execution

**FR-3.1** For every open or ambiguous egress vector identified in FR-2.4, the validator must execute an active network probe (TCP connect, UDP probe, DNS lookup, or HTTP/HTTPS request as appropriate) from within the sandbox boundary.

**FR-3.2** Probe targets must include: a known-external public IP, an external DNS resolver, an internal cross-tenant address, and any cloud service endpoint outside the sandbox's trust zone.

**FR-3.3** Each probe must be time-stamped and assigned a unique `probe_id` linked to evidence storage.

**FR-3.4** Probe results must be recorded as `REACHABLE`, `UNREACHABLE`, or `TIMEOUT` with raw response metadata captured.

### FR-4 — Verdict Determination

**FR-4.1** The validator must map each (sandbox, egress vector) pair to a verdict:

| Verdict | Meaning |
|---|---|
| `PASS` | Vector is explicitly denied or unreachable per policy; probe confirms no unauthorized path. |
| `FAIL` | Vector is reachable when it should be denied; policy gap confirmed. |
| `BLOCKED` | Probe could not execute due to infrastructure error or access restriction; verdict deferred. |

**FR-4.2** Any `FAIL` verdict must automatically generate a violation record containing: sandbox ID, vector description, probe result, policy gap reference, and severity rating (`CRITICAL` / `HIGH` / `MEDIUM` / `LOW`).

**FR-4.3** Any `BLOCKED` verdict must capture the reason for blockage and flag it for manual follow-up.

### FR-5 — Structured Validation Report

**FR-5.1** The validator must produce a structured validation report containing all of the following fields for GAP-G1:

```
- gap_id: "GAP-G1"
- gap_description
- test_cases[]: { test_id, description, sandbox_id, egress_vector, verdict, evidence_ids[], timestamp }
- violations[]: { violation_id, sandbox_id, vector, probe_result, severity, remediation_note }
- summary: { total_test_cases, pass_count, fail_count, blocked_count, overall_verdict }
- evidence_registry[]: { evidence_id, type, location, hash }
```

**FR-5.2** The report must be emitted as `gap-g1-validation-report.json` conforming to the schema defined in Appendix A of this PRD.

**FR-5.3** A human-readable summary (markdown) must be co-emitted alongside the JSON artifact for reviewer consumption.

### FR-6 — Boundary Map Artifact

**FR-6.1** The validator must produce `gap-g1-boundary-map.json` as a separate artifact containing the full enumerated boundary topology: sandboxes, vectors, policy sources, and per-vector `ALLOW`/`DENY` verdicts.

**FR-6.2** The boundary map must be linkable from the validation report via `evidence_ids`.

**FR-6.3** The boundary map must be version-stamped with the enumeration timestamp and the IaC/config snapshot reference used as its source of truth.

---

## 5. Acceptance Criteria

| ID | Criterion | Verification Method |
|---|---|---|
| AC-1 | All sandbox environments in the infrastructure inventory appear in the boundary map. | Diff inventory list vs. `gap-g1-boundary-map.json` sandbox entries — zero gaps. |
| AC-2 | Every egress vector for every sandbox has an explicit `ALLOW`/`DENY` verdict or a `BLOCKED` with documented reason. | Automated schema validation of JSON artifact — no null verdict fields. |
| AC-3 | All `FAIL` verdicts have a corresponding violation record with severity and remediation note. | Query `violations[]` array — count matches `fail_count` in summary. |
| AC-4 | All `BLOCKED` verdicts have a documented reason and are flagged for manual follow-up. | Review `blocked_count` entries — each has non-empty `block_reason` field. |
| AC-5 | `gap-g1-validation-report.json` is valid against schema (Appendix A) with no missing required fields. | JSON schema lint passes with zero errors. |
| AC-6 | `gap-g1-boundary-map.json` is version-stamped and linked to at least one evidence ID in the validation report. | Field presence check: `enumeration_timestamp`, `config_snapshot_ref`, linked `evidence_id`. |
| AC-7 | GAP-G1 is marked **Closed** in workstream tracker task #144 with `overall_verdict` recorded. | Tracker API query returns `status: Closed` on task #144. |
| AC-8 | Security Provisioning dashboard reflects GAP-G1 as **Closed**. | Dashboard API or UI confirms GAP-G1 status = Closed post-update. |
| AC-9 | Evidence references (logs, config snapshots, probe results) are accessible at their recorded locations and hashes match. | Evidence integrity check — SHA-256 of stored artifact matches `hash` in `evidence_registry[]`. |
| AC-10 | No unauthorized outbound path (i.e., `REACHABLE` probe result on a should-be-denied vector) exists without a `FAIL` violation record. | Cross-join probe results with violation records — zero unaccounted `REACHABLE` results. |

---

## 6. Out of Scope

| Item | Rationale |
|---|---|
| **Remediation execution** (applying firewall rule changes, patching egress policies) | Owned by Cloud/Infrastructure Engineers as follow-on work; this PRD covers validation only. |
| **Ingress / inbound boundary validation** | Separate gap item; not part of GAP-G1. |
| **Production environment egress validation** | GAP-G1 is scoped to sandbox environments exclusively. |
| **Application-layer egress controls** (WAF, DLP, CASB) | Network boundary layer only; app-layer controls are a separate domain. |
| **Vulnerability scanning or exploit testing** of sandbox workloads | Out of scope; this is a boundary topology and policy validation, not a penetration test. |
| **Remediation SLA tracking** | Tracked under downstream follow-on work items created from violation records. |
| **Third-party / vendor sandbox environments** | Only sandboxes under direct organizational control are in scope. |
| **Historical drift analysis** | Point-in-time validation only; continuous drift monitoring is a separate capability. |

---

## Appendix A — JSON Schema Reference (Normative)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "GAP-G1 Validation Report",
  "type": "object",
  "required": ["gap_id","gap_description","test_cases","violations","summary","evidence_registry"],
  "properties": {
    "gap_id": { "type": "string", "const": "GAP-G1" },
    "gap_description": { "type": "string" },
    "generated_at": { "type": "string", "format": "date-time" },
    "test_cases": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["test_id","description","sandbox_id","egress_vector","verdict","timestamp"],
        "properties": {
          "test_id": { "type": "string" },
          "description": { "type": "string" },
          "sandbox_id": { "type": "string" },
          "egress_vector": { "type": "string" },
          "verdict": { "type": "string", "enum": ["PASS","FAIL","BLOCKED"] },
          "evidence_ids": { "type": "array", "items": { "type": "string" } },
          "timestamp": { "type": "string", "format": "date-time" },
          "block_reason": { "type": "string" }
        }
      }
    },
    "violations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["violation_id","sandbox_id","vector","probe_result","severity","remediation_note"],
        "properties": {
          "violation_id": { "type": "string" },
          "sandbox_id": { "type": "string" },
          "vector": { "type": "string" },
          "probe_result": { "type": "string", "enum": ["REACHABLE","UNREACHABLE","TIMEOUT"] },
          "severity": { "type": "string", "enum": ["CRITICAL","HIGH","MEDIUM","LOW"] },
          "remediation_note": { "type": "string" }
        }
      }
    },
    "summary": {
      "type": "object",
      "required": ["total_test_cases","pass_count","fail_count","blocked_count","overall_verdict"],
      "properties": {
        "total_test_cases": { "type": "integer" },
        "pass_count": { "type": "integer" },
        "fail_count": { "type": "integer" },
        "blocked_count": { "type": "integer" },
        "overall_verdict": { "type": "string", "enum": ["PASS","FAIL","BLOCKED"] }
      }
    },
    "evidence_registry": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["evidence_id","type","location","hash"],
        "properties": {
          "evidence_id": { "type": "string" },
          "type": { "type": "string" },
          "location": { "type": "string" },
          "hash": { "type": "string" }
        }
      }
    }
  }
}
```

---

*This PRD is the shared source of truth for all agents contributing to GAP-G1 closure. All downstream validation artifacts must conform to the schemas and acceptance criteria defined herein. Amendments require Security Lead approval and a version bump on this document.*