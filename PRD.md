> **PRD** — drafted by Ada (Sr. Product Mgr) · task #584
> _Each agent that updates this PRD signs its change below._

# Gap-J2 Validation Report PRD

## Problem & Goal
**Problem:** Security and compliance stakeholders need auditable proof that a given codebase, container image, or infrastructure configuration contains zero plaintext secrets (e.g., passwords, API keys, tokens). Without a structured validation report, demonstrating compliance with policies like “no hardcoded secrets” is manual, error-prone, and lacks traceable evidence.

**Goal:** Provide a machine- and human-readable validation report that confirms a Gap-J2 scan completed with **zero plaintext secret findings**, and includes unique evidence IDs for each scanned asset or check. The report serves as a compliance artifact, enabling downstream automation (CI/CD gates, audit trails) and situational awareness.

## Target Users / ICP Roles
- **Security Engineers** – need to verify that no secrets were detected before deployment.
- **Compliance Officers / Auditors** – require signed-off evidence that a scan passed with zero findings.
- **DevOps / Platform Engineers** – integrate the report into CI/CD pipelines for automated blocking/releasing.
- **Incident Responders** – may reference the report to confirm absence of secrets at a point in time.

## Scope
- **In Scope:**
  - Generation of a validation report artifact after a Gap-J2 scan completes.
  - Summary section showing total scanned items, findings count (must be zero), and overall pass/fail status.
  - Detailed listing of each scanned target (file, secret type, rule) with a unique evidence ID that links to the scan’s raw result or log.
  - Report metadata: scan timestamp, scanner version, target identifier (e.g., repo, image tag), and policy context.
  - Output format: JSON (primary) and a human-readable summary (Markdown or HTML) for consumption by tools and people.
  - Zero plaintext findings scenario: “PASSED” status, no secrets table, and a positive confirmation message.
  - Handling of non-zero findings: the report must still be generated but clearly marked as “FAILED” with a summary of findings (though the primary use case is zero findings).

## Functional Requirements
1. **Report Generation Trigger**
   - The report shall be generated automatically upon completion of a Gap-J2 scan, or on-demand via API/CLI with a scan ID.
   - The system shall accept a scan identifier and produce a formatted report.

2. **Report Structure**
   - **Metadata block:** `scan_id`, `scan_start_time`, `scan_end_time`, `scanner_version`, `target` (e.g., `repo:myorg/myrepo@main`), `policy_name`, `report_generated_at`.
   - **Status summary:**
     - `overall_status`: `"PASSED"` if `total_secrets_found == 0`, else `"FAILED"`.
     - `total_targets_scanned`: integer.
     - `total_secrets_found`: integer.
   - **Evidence section:**
     - For each scanned target (e.g., file, line, secret type), a list of objects containing:
       - `evidence_id` (UUID or unique string, matching the scanner’s evidence tracking).
       - `target_path` (relative path, rule ID, etc.).
       - `secret_type` (if applicable, or `"none"`).
       - `status`: `"clear"` (meaning no secret found).
     - In the zero-findings case, the list shall confirm `"clear"` for all targets.
   - **Certification blurb:** A standard statement (e.g., “This report confirms that the scan completed with zero plaintext secrets detected. All evidence IDs are valid and traceable.”)

3. **Evidence ID Traceability**
   - Each `evidence_id` must be a unique identifier that can be used to retrieve the raw scan result entry (e.g., via an API or log query) without ambiguity.
   - Evidence IDs shall be consistent across report regenerations for the same scan.

4. **Output Formats**
   - JSON: machine-readable, schema-defined (provide a JSON Schema or example).
   - Human-readable: a Markdown or HTML file that renders the summary, status, and a table of evidence IDs and targets.

5. **Error Handling**
   - If the scan input is invalid or the scan results are unavailable, the report generation shall fail with a clear error message (no partial report).
   - If the scan produced errors (e.g., scanner crash), the report shall indicate `overall_status: "ERROR"` and include error details.

## Acceptance Criteria
- **Zero-findings scenario:**
  - Given a completed Gap-J2 scan that found zero plaintext secrets.
  - When the validation report is generated.
  - Then the report status is `"PASSED"`, `total_secrets_found` is `0`, and the evidence section lists all scanned targets with `status: "clear"` and valid `evidence_id` values.
  - The human-readable version states “No secrets found” and the evidence table is present.

- **Non-zero findings (safety net):**
  - Given a scan that found one or more secrets.
  - When the report is generated.
  - Then `overall_status` is `"FAILED"`, `total_secrets_found` equals the actual count, and the evidence section includes entries for the found secrets with `status: "found"` and `secret_type`.

- **Evidence ID uniqueness and traceability:**
  - Each evidence ID in the report can be used to retrieve the corresponding scan finding or clearance record via the scanner’s audit API.
  - No duplicate evidence IDs within the same report.

- **Format compliance:**
  - JSON output adheres to the defined schema; markdown output renders correctly with no unescaped characters.

- **Report generation performance:**
  - For a scan of up to 10,000 targets, the report is generated in under 30 seconds.

## Out of Scope
- **Actual secret scanning:** The PRD does not cover the scanning engine, rule definitions, or detection logic; only the report generation from existing scan results.
- **Remediation guidance:** The report will not provide instructions on how to fix detected secrets.
- **Historical trend analysis:** Comparing multiple reports over time is not part of this feature.
- **Real-time dashboards:** The report is a point-in-time artifact, not a live monitoring dashboard.
- **User interface for report viewing:** The deliverable is the file output; a web UI for browsing reports is out of scope.
- **Integration with external compliance systems:** The report can be consumed by such systems, but direct integration (e.g., pushing to Jira) is not included.

## Requirements

> **Author:** Business Analyst (task #584) · 2026-08-03
> _This section defines the business requirements, data contracts, non-functional constraints, and traceability that the implementation must satisfy._

### R1 — System Context & Integration

**R1.1 — Scan Result Source.** The Gap-J2 scan engine produces results in a structured machine-readable format (the "scan results payload"). The report generator consumes this payload as its sole input. The report generator does NOT invoke the scanner, schedule scans, or manage scan configuration.

**R1.2 — Trigger Interfaces.** The report shall be producible via two pathways:
- **Automated trigger:** The scanner invokes the report generator upon scan completion, passing the scan results payload inline or by reference (scan ID).
- **On-demand trigger:** An API endpoint or CLI command accepts a scan identifier and returns the generated report. This enables ad-hoc audits and re-generation of historical reports.

**R1.3 — No Side Effects.** Report generation is a read-only operation with respect to the scan results. It MUST NOT modify scan data, scanner configuration, or any external system state.

**R1.4 — Downstream Consumers.** The report is designed for consumption by:
- CI/CD pipeline gates (parse JSON, block/fail on `overall_status != "PASSED"`)
- Audit log archival systems (store JSON + Markdown artifacts indexed by scan ID)
- Human reviewers (read the Markdown/HTML rendering in a browser or document viewer)

---

### R2 — Data Contract: Scan Results Input

**R2.1 — Required Fields.** The report generator requires the following fields from the scan results payload. If any required field is absent or null, report generation MUST fail with a descriptive error — no partial or best-effort report shall be produced.

| Field | Type | Description |
|-------|------|-------------|
| `scan_id` | string (UUID) | Unique identifier of the scan run |
| `scan_start_time` | ISO-8601 datetime | When the scan began |
| `scan_end_time` | ISO-8601 datetime | When the scan completed |
| `scanner_version` | string | Semantic version of the Gap-J2 engine |
| `target` | string | Scan target identifier (e.g. `repo:owner/name@ref`, `image:tag`, `config:path`) |
| `findings` | array | List of finding objects (may be empty) |

**R2.2 — Finding Object Shape.** Each entry in `findings`:
| Field | Type | Description |
|-------|------|-------------|
| `evidence_id` | string (UUID) | Unique, stable identifier for this finding or clearance record |
| `target_path` | string | File path, resource locator, or rule identifier scanned |
| `secret_type` | string | Detected secret category (e.g. `aws_access_key`, `github_token`) or `"none"` if no secret found |
| `line` | integer or null | Line number where the finding was detected, or null if not line-based |
| `rule_id` | string | Identifier of the detection rule that triggered |

**R2.3 — Required Finding Semantics.** The `findings` array MUST enumerate every target that was scanned. A target with no secret found appears with `secret_type: "none"` and the same `evidence_id`/`target_path`/`rule_id` that would identify it if a secret were present. This ensures the evidence section has complete coverage — every scanned target has a traceable record.

**R2.4 — Scanner Error Contract.** If the scanner itself encountered an error (crash, timeout, partial results), the scan results payload MUST include an `error` block:
| Field | Type | Description |
|-------|------|-------------|
| `error.message` | string | Human-readable error description |
| `error.code` | string | Machine-readable error code |
| `error.partial_results` | boolean | Whether any partial findings are included |

When `error` is present, the generator produces an `"ERROR"` status report per FR-5.

---

### R3 — Data Contract: Report Output (JSON)

**R3.1 — JSON Schema.** The JSON report MUST conform to the structure below. All timestamps are ISO-8601 in UTC.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Gap-J2 Validation Report",
  "type": "object",
  "required": ["report", "metadata", "summary", "evidence", "certification"],
  "properties": {
    "report": {
      "type": "object",
      "required": ["format_version", "generated_at"],
      "properties": {
        "format_version": { "const": "1.0.0" },
        "generated_at": { "type": "string", "format": "date-time" }
      }
    },
    "metadata": {
      "type": "object",
      "required": ["scan_id", "scan_start_time", "scan_end_time", "scanner_version", "target"],
      "properties": {
        "scan_id": { "type": "string", "format": "uuid" },
        "scan_start_time": { "type": "string", "format": "date-time" },
        "scan_end_time": { "type": "string", "format": "date-time" },
        "scanner_version": { "type": "string" },
        "target": { "type": "string" },
        "policy_name": { "type": "string" }
      }
    },
    "summary": {
      "type": "object",
      "required": ["overall_status", "total_targets_scanned", "total_secrets_found"],
      "properties": {
        "overall_status": { "enum": ["PASSED", "FAILED", "ERROR"] },
        "total_targets_scanned": { "type": "integer", "minimum": 0 },
        "total_secrets_found": { "type": "integer", "minimum": 0 },
        "error": {
          "type": "object",
          "required": ["message", "code"],
          "properties": {
            "message": { "type": "string" },
            "code": { "type": "string" }
          }
        }
      }
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["evidence_id", "target_path", "status"],
        "properties": {
          "evidence_id": { "type": "string", "format": "uuid" },
          "target_path": { "type": "string" },
          "rule_id": { "type": "string" },
          "secret_type": { "type": "string" },
          "line": { "type": ["integer", "null"] },
          "status": { "enum": ["clear", "found"] }
        }
      }
    },
    "certification": {
      "type": "object",
      "required": ["statement"],
      "properties": {
        "statement": { "type": "string" },
        "certified_by": { "type": "string" },
        "certified_at": { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

**R3.2 — Evidence ID Uniqueness.** Within a single report, `evidence_id` values MUST be unique (no duplicates). They MUST match the IDs produced by the scanner and remain stable across regenerations for the same `scan_id`.

**R3.3 — Status Derivation.** `overall_status` is derived as follows:
- `"PASSED"` when `total_secrets_found == 0` and no scanner error is present.
- `"FAILED"` when `total_secrets_found > 0` and no scanner error is present.
- `"ERROR"` when the scan results payload contains an `error` block (regardless of findings count).

---

### R4 — Data Contract: Report Output (Human-Readable)

**R4.1 — Markdown Format.** The human-readable output shall be a valid Markdown document containing:

1. **Title and generation timestamp.**
2. **Metadata table** with all fields from the JSON `metadata` block.
3. **Status badge** — a visual indicator: `✅ PASSED`, `❌ FAILED`, or `⚠️ ERROR`.
4. **Summary section** with `total_targets_scanned` and `total_secrets_found`.
5. **Evidence table** with columns: `Evidence ID`, `Target Path`, `Rule ID`, `Secret Type`, `Line`, `Status`. The table MUST be present even in the PASSED case (all rows show `clear`).
6. **Findings summary** — only present when `total_secrets_found > 0`: a sub-table listing each finding with its secret type, target path, and line.
7. **Error details** — only present when `overall_status == "ERROR"`: the error message and code.
8. **Certification statement.**

**R4.2 — HTML Format (Optional).** If HTML output is supported, it shall render the same information as the Markdown format with semantic HTML (`<table>`, `<dl>`, etc.) and no JavaScript dependency. The HTML file shall be self-contained (inline styles, no external resources).

**R4.3 — Character Safety.** All output formats MUST escape or sanitize characters that would break their respective syntax (e.g., `<`, `>`, `&` in HTML; pipe characters in Markdown tables; control characters in JSON strings).

---

### R5 — Non-Functional Requirements

#### R5.1 — Performance

| Metric | Threshold | Measurement |
|--------|-----------|-------------|
| Report generation time (10,000 targets) | ≤ 30 seconds | Wall-clock from input received to output written |
| Report generation time (1,000 targets) | ≤ 3 seconds | Wall-clock |
| Memory ceiling | ≤ 512 MB | Peak RSS during generation |
| Output file size (JSON, 10,000 targets) | ≤ 50 MB | On-disk size |

#### R5.2 — Reliability

- **R5.2.1** — Report generation MUST be deterministic: the same scan results input always produces the identical JSON report (byte-for-byte identical, including `generated_at` sourced from input `scan_end_time`, not wall-clock). Exceptions: `report.generated_at` and `certification.certified_at` reflect generation time and may differ.
- **R5.2.2** — The generator MUST handle empty findings arrays (zero targets scanned) gracefully — output a PASSED report with `total_targets_scanned: 0` and an empty evidence array.
- **R5.2.3** — The generator MUST NOT crash or produce a truncated report on any valid input. Invalid input (missing required fields, malformed JSON) produces a clear error message and no output file.

#### R5.3 — Security

- **R5.3.1** — The report MUST NOT embed or echo raw secret values. Even in a FAILED report, the `evidence` entries reference secret *types* (e.g. `aws_access_key`), not the detected plaintext secret itself.
- **R5.3.2** — Report generation MUST NOT log or persist raw scan findings containing secret plaintext to any log stream, temporary file, or external service.
- **R5.3.3** — The report generator MUST NOT require write access to the scan results store. It reads scan results; it writes reports.

#### R5.4 — Portability

- **R5.4.1** — The JSON report format is versioned (`format_version: "1.0.0"`). Any breaking change to the schema MUST increment the major version.
- **R5.4.2** — The report generator shall be invocable from a Linux, macOS, or Windows environment (CI runner, developer machine) with no platform-specific dependencies beyond a supported runtime (Node.js ≥ 18, or a self-contained binary).

---

### R6 — Business Rules

**R6.1 — Zero-Findings Is the Primary Use Case.** The system is optimised for the zero-findings path. Every design decision shall ensure that a clean scan produces a clear, unambiguous PASSED report suitable for compliance submission without manual editing.

**R6.2 — Failed Report Is Still a Complete Report.** A FAILED report MUST be structurally complete: it contains the same sections as a PASSED report, plus the findings list. Downstream systems that parse the JSON MUST NOT error on a FAILED report — the schema is identical; only field values differ.

**R6.3 — Error Report Takes Precedence.** If the scan results contain both findings and an `error` block, the report `overall_status` is `"ERROR"`, not `"FAILED"`. The error condition is more severe and indicates the findings may be incomplete or unreliable.

**R6.4 — Evidence Completeness.** Every target the scanner examined MUST appear in the evidence array. There is no "sampling" or "summary" mode. This is an audit requirement: a compliance officer must be able to assert "all 4,217 files were scanned" with a countable evidence list.

**R6.5 — Regeneration Consistency.** Regenerating a report for the same `scan_id` at any future time MUST produce:
- Identical `metadata` values
- Identical `evidence` array (same ordering, same fields)
- Identical `summary` (except `overall_status` if the underlying scan data has not changed — the status is derived)
- Same `certification.statement`

The `report.generated_at` and `certification.certified_at` timestamps reflect the regeneration time and may differ.

---

### R7 — Stakeholder Requirements by Role

| Role | Key Need | Satisfied By |
|------|----------|--------------|
| Security Engineer | Verify zero secrets before deploy | FR-2 (`overall_status`), R3.1 (JSON `summary`) |
| Compliance Officer | Signed-off evidence for audit | FR-2 (certification blurb), R6.4 (evidence completeness), R6.5 (regeneration consistency) |
| DevOps / Platform Engineer | CI/CD gate integration | R1.4 (JSON consumption), R3.3 (status derivation), R5.2.1 (determinism) |
| Incident Responder | Point-in-time confirmation of clean state | FR-2 (metadata with scan timestamps), R6.5 (regeneration) |
| Engineering Manager | Understand scan scope at a glance | R4.1 (human-readable summary table) |

---

### R8 — Requirements Traceability Matrix

| Requirement | FRs Covered | ACs Covered |
|-------------|-------------|-------------|
| R1.1 (Scan Result Source) | FR-1 (trigger) | — |
| R1.2 (Trigger Interfaces) | FR-1 (API/CLI) | — |
| R2.1–R2.4 (Input Contract) | FR-5 (error handling) | AC-5 (performance) |
| R3.1 (JSON Schema) | FR-2 (structure), FR-4 (JSON format) | AC-4 (format compliance) |
| R3.2 (Evidence ID Uniqueness) | FR-3 (traceability) | AC-3 (uniqueness) |
| R3.3 (Status Derivation) | FR-2 (status summary) | AC-1 (zero-findings), AC-2 (non-zero findings) |
| R4.1–R4.3 (Human-Readable Output) | FR-4 (Markdown/HTML) | AC-1, AC-4 |
| R5.1 (Performance) | — | AC-5 (≤ 30s for 10k targets) |
| R5.2 (Reliability) | FR-5 (error handling) | — |
| R5.3 (Security) | — | — |
| R6.1–R6.3 (Business Rules) | FR-2, FR-5 | AC-1, AC-2 |
| R6.4–R6.5 (Evidence & Consistency) | FR-3 (traceability) | AC-3 (uniqueness + traceability) |

---

### R9 — Assumptions & Dependencies

**Assumptions:**
1. The Gap-J2 scan engine exists and produces output conforming to the contract defined in R2. This PRD does not mandate or design the scanner itself.
2. Evidence IDs are UUIDs generated by the scanner and are stable per scan target across re-scans.
3. Scan targets are file-system paths, container image layers, or configuration keys — the `target_path` field accommodates all three without format differentiation.
4. A scan of 0 targets (empty repository / empty image) is valid and produces a PASSED report.
5. The `policy_name` is an optional metadata field supplied by the scan configuration; it has no effect on report logic.

**Dependencies:**
- **Gap-J2 scan engine:** Must stabilise its output contract (R2) before report generator development can begin integration testing.
- **CI/CD pipeline integration:** Consumers of the JSON report must implement their own gate logic; the report provides the status signal but does not enforce it.
- **Audit archival system:** Long-term storage and indexing of reports by `scan_id` is the consumer's responsibility.

---

### R10 — Glossary

| Term | Definition |
|------|------------|
| **Gap-J2** | The secret-scanning engine that detects plaintext secrets in code, images, and configuration. |
| **Evidence ID** | A UUID uniquely identifying a single scanned target or finding within a scan run. |
| **Finding** | A single detection result: either a detected secret (`status: "found"`) or a confirmed clear target (`status: "clear"`). |
| **Scan Target** | A single scannable unit: a file, a line within a file, a container image layer, or a configuration key-value pair. |
| **Validation Report** | The output artefact (JSON + Markdown/HTML) that certifies the result of a Gap-J2 scan. |
| **PASSED** | `overall_status` indicating zero secrets found and no scanner errors. |
| **FAILED** | `overall_status` indicating one or more secrets found. |
| **ERROR** | `overall_status` indicating the scanner itself encountered an error. |
| **Certification Blurb** | The human-readable statement in the report attesting to the scan outcome and evidence traceability. |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._