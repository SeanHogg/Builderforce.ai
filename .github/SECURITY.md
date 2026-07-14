# Security Policy

Supports the Code Review & Merge Pipeline: FR-2.4 (no new high/critical CVEs
before merge) and the repo's SOC2 CC1/CC2 controls (Control Environment &
Security Documentation). The repo audit engine
(`api/src/application/tools/AuditRunner.ts`) credits this file toward those
controls.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems. Instead:

1. Report privately via GitHub Security Advisories:
   https://github.com/SeanHogg/Builderforce.ai/security/advisories/new
   (or the internal security channel defined in your organization policy).
2. Include:
   - **Context** — the affected service or endpoint (e.g. authentication token
     validation in the API).
   - **Reproduction** — steps, stack traces, logs, or recordings.
   - **Impact** — CVSS score where known, PII exposure, DoS risk.
   - **Mitigations** — any workaround or proposed fix; note if you can
     contribute a patch.

## Handling & merge gating

- A maintainer acknowledges the report and, where warranted, assigns CVE
  tracking and a CVSS severity.
- A fix must **not** be merged to `main` until it has an approving code-owner
  review (see `.github/CODEOWNERS`) and the dependency/security scan reports **no
  new high- or critical-severity findings** (FR-2.4, AC-6).
- The merge commit message must reference the advisory/CVE identifier.

## Vendor & supply-chain risk

- Third-party components with known or suspected risks (CVEs, licensing,
  supply-chain) should be tracked in the project's vendor-risk register and
  summarized in release notes.

## Supported versions

Builderforce.ai ships date-based versions (e.g. `2026.3.7`). Only the latest
released version receives security fixes; older builds should upgrade.
