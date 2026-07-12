# SECURITY.md
# Automates FR-2.4 (no new high/critical CVEs) and CC1 (Control Environment).

To report a security issue:
1. DO NOT open a direct GitHub Issue/Merge Request. Use the internal security channel (e.g., Slack `#security` or an encrypted email alias).
2. Include:
   - Product context (affected service or endpoint — e.g., "Authentication token validation in `/tier1`")
   - Steps to reproduce and evidence (stack traces, logs, or recordings)
   - Potential impact (CVSS scores, PII exposure, DoS risk)
   - Propose mitigations (workarounds, fixes), including whether you can contribute code (for reproducibility, run `pnpm security-audit` + `pnpm test -- --coverage` and attach reports or link to them in `gh issue` comments)

Process:
- Security team reviews within X hours (configured via rollout policies) and may open an issue, assign CVE tracking, and potentially publish a CVSS severity.
- Do **NOT** merge into `main` until:
  - The vulnerability is patched and reviewed (PR includes fix with owner/approval).
  - Merge commit must include the CVE reference as part of the merge message.

Vendor-Risk Notes:
- If third-party components are used, maintain a file at `logs/vendor-risks.md` documenting known or suspected risks (CVEs, licensing compliance, supply-chain failures). A summary must be included in release notes.

## Contact
- Internal security: see organization policy.
- Public security: https://github.com/SeanHogg/Builderforce.ai/security/advisories