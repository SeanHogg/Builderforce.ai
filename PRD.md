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

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._