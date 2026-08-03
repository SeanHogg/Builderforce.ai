> **PRD** — drafted by Ada (Sr. Product Mgr) · task #577
> _Each agent that updates this PRD signs its change below._
> - **Business Analyst** (2026-08-03): Authored Requirements section following codebase audit of `agent-runtime/` and `.github/`.

# PRD: Secrets Exposure Prevention in Artifacts

## Problem & Goal
Sensitive credentials (API keys, tokens, passwords, certificates) inadvertently stored in plaintext across logs, environment variables, or source artifacts create a critical security risk. Attackers who gain access to these artifacts can escalate privileges, access internal systems, or exfiltrate data. The goal is to automate detection, prevention, and remediation of plaintext secrets in all development and deployment artifacts to eliminate this class of vulnerability.

## Target Users / ICP Roles
- **Developers:** Need clear guidance and guardrails to avoid committing secrets.
- **DevOps/Platform Engineers:** Require automated scanning integrated into CI/CD pipelines and infrastructure.
- **Security Engineers:** Demand comprehensive coverage and alerting with minimal false positives.
- **Compliance Officers:** Seek evidence of controls for audits (e.g., SOC2, ISO 27001).

## Scope
- **Log Streams:** Application logs, build logs, infrastructure logs (e.g., CloudWatch, Stackdriver).
- **Environment Variables:** Runtime configuration passed to containers, serverless functions, or VMs.
- **Source Artifacts:** Code repositories (Git history, current state), configuration files (`.env`, `.yaml`, `.json`), Dockerfiles, IaC templates (Terraform, CloudFormation), and build artifacts (JARs, zip files).
- **Detection Methods:** Pattern matching for known secret formats, entropy analysis, and integration with third-party secret scanners.
- **Prevention:** Pre-commit hooks, CI pipeline gates, and deployment blockers.

## Functional Requirements
1. **Secret Detection Engine**
   - Scan all defined artifact types using a regularly updated rule set (regex for AWS keys, GitHub tokens, JWT, etc.).
   - Support custom patterns via admin-configurable regex.
   - Rank findings by severity (high-confidence match vs. potential false positive).

2. **Pre-Commit/Pre-Push Hooks**
   - Provide lightweight client-side tooling (CLI or IDE plugin) to scan staged files and block commits containing secrets.
   - Display clear remediation instructions (e.g., “Remove the secret from `config.py` and use environment variable injection”).

3. **CI/CD Pipeline Integration**
   - Provide native plugins/actions for major CI platforms (GitHub Actions, GitLab CI, Jenkins, CircleCI).
   - Fail builds on detection of high-confidence secrets; allow pipeline administrators to set flexible policies (e.g., warn on medium, block on high).
   - Generate scan reports as pipeline artifacts for auditability.

4. **Runtime Environment Scanning**
   - Continuously scan live environment variables (e.g., from Kubernetes ConfigMaps, AWS Parameter Store if used incorrectly) to detect plaintext secrets.
   - Alert on detection via configured notification channels.

5. **Log Scanning**
   - Ingest and scan log streams in near real-time for secrets.
   - Mask or redact secrets in log output where possible (agent-level filtering).

6. **Alerting & Incident Response**
   - Send alerts (email, Slack, PagerDuty) with details: artifact location, secret type, commit SHA, author.
   - Create tickets automatically in integrated issue trackers (Jira, GitHub Issues) for tracked remediation.

7. **Dashboard & Reporting**
   - Central dashboard showing historical trends, open findings, MTTR, and compliance status.
   - Exportable reports for auditors, proving no secrets were delivered to production.

8. **Remediation Workflow**
   - Guidance for developers: rotate exposed secret immediately, squash Git history, re-deploy.
   - APIs to integrate with secret management tools (Vault, AWS Secrets Manager) to rotate compromised keys.

## Acceptance Criteria
- **Detection Accuracy:** High-confidence rules produce >95% true positive rate and <5% false positive rate based on benchmark dataset of 10k artifact samples.
- **Blocking:** A commit containing a valid AWS secret key is rejected locally by the pre-commit hook and fails the CI pipeline build gate.
- **Coverage:** The scanner detects secrets in standard log formats (JSON, text), environment variables (K8s secrets placed in plaintext), and source files (`.env`, `config.json`, source code comments).
- **Performance:** Scanning a repository of 10k files completes in under 2 minutes in CI; log scanning delays are under 30 seconds for detection.
- **Alerting:** When a secret is found in any production log stream, an alert is generated in Slack and a ticket created in Jira within 5 minutes.
- **Audit Readiness:** A report shows “zero open critical secrets” across all repositories and environments for the last quarter.

## Out of Scope
- Encryption of secrets at rest or in transit (handled by existing secret management tools).
- Scanning of runtime memory or process heaps.
- Network traffic analysis or DLP for secrets leaked over the wire.
- Secrets management lifecycle (rotation policies, access control) – this is limited to detection and prevention of plaintext exposure.
- Manual code review processes or training programs.

## Requirements

_Authored by the Business Analyst following a codebase audit on 2026-08-03._

### BA-1: Codebase Audit Summary

The following controls and gaps were identified in the current `seanhogg/builderforce.ai` repository (branch `builderforce/task-577`):

**Existing controls (working as designed):**

| Control | Location | Status |
|---|---|---|
| Log redaction | `agent-runtime/src/logging/redact.ts` | Active. Redacts API keys, tokens, passwords, Authorization headers, PEM blocks, and known token prefixes (sk-, ghp_, xox*, gsk_, AIza, pplx-, npm_, Telegram bot tokens) from tool-call detail and configurable text surfaces. Default mode `tools`. |
| Pre-commit secret scanning | `agent-runtime/.pre-commit-config.yaml` (Yelp `detect-secrets` v1.5.0) | Active. Blocks commits containing high-entropy strings and known secret patterns. Baseline at `.secrets.baseline`. Exclusion patterns in `.detect-secrets.cfg`. |
| CI static analysis | `.github/workflows/codeql.yml` (CodeQL) | Active. Semantic analysis for tainted-input dataflows. |
| CI secrets handling | `.github/workflows/*.yml` | All secrets referenced via `${{ secrets.* }}` GitHub Actions context — no hardcoded values. |
| Secret comparison | `agent-runtime/src/security/secret-equal.ts` | Uses `timingSafeEqual` to prevent timing side-channel attacks. |
| Secret normalization | `agent-runtime/src/utils/normalize-secret-input.ts` | Strips whitespace/newlines from pasted credentials. |
| No `.env` files | Repository root + subdirectories | No `.env` or `.env.*` files committed to the repository. |
| SOC 2 audit sweep | `api/src/application/tools/AuditRunner.ts` | Weekly filename/path heuristic scan for secrets (`.pem`, etc.) over GitHub contents API. |
| Security policy | `.github/SECURITY.md` + `agent-runtime/docs/SECURITY.md` | Private vulnerability reporting via GitHub Security Advisories. |

**Gaps identified:**

| ID | Gap | Severity | Location |
|---|---|---|---|
| GAP-1 | **Hardcoded OAuth client secrets (base64-encoded, trivially reversible).** `atob()` is encoding, not encryption. Anyone with read access to the source file can decode these in a browser console. | **Critical** | `agent-runtime/src/agents/oauth/index.ts` lines 28–29 (ANTHROPIC_CLIENT_ID), 96–97 (ANTIGRAVITY_CLIENT_ID + ANTIGRAVITY_CLIENT_SECRET), 99–100 (GEMINI_CLIENT_ID + GEMINI_CLIENT_SECRET) |
| GAP-2 | No automated CI gate that fails the build on new secret detections. The pre-commit hook runs client-side but can be bypassed with `--no-verify`. The CodeQL workflow analyzes for dataflow bugs, not hardcoded secrets. | High | `.github/workflows/ci.yml` + `.github/workflows/codeql.yml` |
| GAP-3 | No runtime environment variable scanning. While no `.env` files are committed, there is no mechanism to detect if a developer injects plaintext secrets into environment variables at deploy time. | Medium | Infrastructure / deployment pipeline |
| GAP-4 | No log-stream scanning. The `redact.ts` module redacts secrets in tool-call detail passed through the agent runtime, but application logs emitted by the API server (`api/`) are not scanned. | Medium | `api/` services |
| GAP-5 | The SOC 2 audit sweep (`AuditRunner.ts`) uses filename heuristics only — it never parses file contents. A secret buried in a `.ts` file with a nondescript filename would not be caught until a human or CI scan hits it. | Medium | `api/src/application/tools/AuditRunner.ts` |
| GAP-6 | No detection for base64-encoded/obfuscated secrets. The `detect-secrets` baseline marks high-entropy base64 strings as false positives (because they look like random tokens), but GAP-1 proves that real secrets DO exist in base64 form in this repository. | High | Detection ruleset |

### BA-2: Functional Requirements (Derived)

Each requirement below is traceable to a gap above and a Functional Requirement (FR-*) from the product specification.

#### REQ-1: OAuth Secret Extraction (GAP-1 → FR-1, FR-8)
- **Description:** All hardcoded OAuth client IDs and client secrets currently stored as base64-encoded literals in `agent-runtime/src/agents/oauth/index.ts` SHALL be removed from source code and migrated to environment variables or a secrets manager.
- **Traceability:** GAP-1, FR-1 (Secret Detection Engine), FR-8 (Remediation Workflow)
- **Priority:** Critical
- **Acceptance:**
  - `agent-runtime/src/agents/oauth/index.ts` contains no `decode()` calls with hardcoded OAuth credential strings.
  - The values are loaded at runtime from environment variables (e.g., `ANTHROPIC_CLIENT_ID`, `ANTIGRAVITY_CLIENT_ID`, `ANTIGRAVITY_CLIENT_SECRET`, `GEMINI_CLIENT_ID`, `GEMINI_CLIENT_SECRET`) or a platform secrets manager.
  - A `decode()` wrapper (for the existing base64 transport format) MAY remain, but its input MUST come from a runtime source, not a source-code literal.
  - Existing OAuth refresh flows continue to function after migration.

#### REQ-2: CI Secret Detection Gate (GAP-2 → FR-3)
- **Description:** The CI pipeline (`ci.yml`) SHALL include a dedicated job that runs `detect-secrets` (or equivalent) against the full repository and fails the build on any NEW high-confidence finding not present in the baseline.
- **Traceability:** GAP-2, FR-3 (CI/CD Pipeline Integration)
- **Priority:** High
- **Acceptance:**
  - A CI job named `secret-scan` exists in `.github/workflows/ci.yml` (or a dedicated workflow called from it).
  - The job runs `detect-secrets scan --baseline .secrets.baseline` and exits non-zero when new secrets are detected.
  - The baseline (`.secrets.baseline`) is updated to exclude the existing base64-encoded OAuth secrets AFTER they have been removed per REQ-1; until then, the scan SHALL flag them.
  - The job runs on every push and pull request to `main`.

#### REQ-3: Pre-Commit Hook Hardening (GAP-2 → FR-2)
- **Description:** Document and enforce that the `detect-secrets` pre-commit hook MUST NOT be bypassed. Add a CI check that verifies the pre-commit hook is installed and unmodified in contributor environments (via a commit-signature or attestation mechanism, or at minimum a CONTRIBUTING.md requirement).
- **Traceability:** GAP-2, FR-2 (Pre-Commit/Pre-Push Hooks)
- **Priority:** Medium
- **Acceptance:**
  - `CONTRIBUTING.md` (or equivalent) states that `pre-commit install` is mandatory before contributing.
  - The CI `secret-scan` job (REQ-2) serves as the server-side enforcement should the client-side hook be bypassed.

#### REQ-4: Runtime Environment Variable Scanning (GAP-3 → FR-4)
- **Description:** The deployment pipeline or a scheduled job SHALL scan runtime environment variables (e.g., Cloudflare Workers environment bindings, Kubernetes ConfigMaps if applicable) for secrets matching known patterns and alert on detection.
- **Traceability:** GAP-3, FR-4 (Runtime Environment Scanning)
- **Priority:** Medium
- **Acceptance:**
  - A scheduled job or deployment hook exists that enumerates configured environment variables and runs the same secret-detection regex ruleset against their values.
  - An alert (Slack, email, or PagerDuty) fires when a secret is detected.
  - A runbook exists for responding to a runtime secret detection.

#### REQ-5: API Log Stream Scanning (GAP-4 → FR-5)
- **Description:** The API server (`api/`) SHALL integrate the log-redaction patterns from `agent-runtime/src/logging/redact.ts` (or an equivalent) into its own logging pipeline so that secrets are redacted before log output is written. Extend the existing `redact.ts` patterns to cover additional secret formats (see REQ-6).
- **Traceability:** GAP-4, FR-5 (Log Scanning)
- **Priority:** Medium
- **Acceptance:**
  - `api/` logging middleware or formatter applies secret redaction before emitting log lines.
  - A test exists that confirms a log line containing `Authorization: Bearer sk-abc123...` is redacted to `Authorization: Bearer sk-abc…1234`.
  - The redaction patterns are kept in a single source of truth (shared module or copied with a comment referencing the canonical source).

#### REQ-6: Obfuscated Secret Detection (GAP-6 → FR-1)
- **Description:** The secret-detection ruleset SHALL be extended to detect base64-encoded secrets. Specifically, the scanner MUST flag any base64 string that, when decoded, matches a known secret format (e.g., Google OAuth client secrets match the pattern `GOCSPX-*`).
- **Traceability:** GAP-6, FR-1 (Secret Detection Engine)
- **Priority:** High
- **Acceptance:**
  - A custom `detect-secrets` plugin or regex rule identifies `decode("...")` calls in TypeScript/JavaScript source files and flags the decoded value.
  - The `Base64HighEntropyString` detector limit is lowered from 4.5 to 3.5, and new findings are triaged (not blanket-suppressed).
  - False positives from legitimate high-entropy strings (API keys referenced in documentation, test fixtures with dummy keys) are baselined with explicit line-level suppressions.

#### REQ-7: Audit Runner Content Scanning (GAP-5 → FR-1)
- **Description:** The existing SOC 2 audit sweep (`AuditRunner.ts`) SHALL be extended beyond filename heuristics to perform content-based secret detection on a representative sample of repository files, or shall be supplemented by the CI `secret-scan` job (REQ-2) whose report is archived as audit evidence.
- **Traceability:** GAP-5, FR-1 (Secret Detection Engine), FR-7 (Dashboard & Reporting)
- **Priority:** Medium
- **Acceptance:**
  - The weekly audit run either (a) invokes `detect-secrets` against the repository and stores the report, or (b) references the most recent CI `secret-scan` artifact.
  - Audit report includes: date, number of files scanned, findings (if any), and disposition.

### BA-3: Non-Functional Requirements

| ID | Requirement | Metric |
|---|---|---|
| NFR-1 | Secret scan in CI completes within the existing CI time budget (no more than 2 additional minutes). | < 120 s for full repo scan |
| NFR-2 | Log redaction adds negligible latency to request processing. | < 1 ms per log line |
| NFR-3 | Runtime env scan runs without impacting deployment velocity. | Scheduled (not blocking deploy) |
| NFR-4 | All secret-detection patterns are version-controlled and reviewable. | Patterns in `.detect-secrets.cfg`, `redact.ts`, and CI config — all in git |

### BA-4: Dependency & Sequence

```
REQ-1 (OAuth extraction) ─────┐
                               ├──► REQ-2 (CI gate, baseline updated post-REQ-1)
REQ-6 (Obfuscated detection) ─┘
                               │
REQ-5 (API log redaction) ─────┤
REQ-4 (Runtime env scan) ──────┤  (parallelizable)
REQ-3 (Hook hardening) ────────┤
REQ-7 (Audit content scan) ────┘
```

**Critical path:** REQ-1 → REQ-6 → REQ-2. REQ-1 MUST be completed first because the current codebase contains secrets that a properly-configured CI gate would flag and block.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
