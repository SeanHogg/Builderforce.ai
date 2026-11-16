# Trust Services Criteria mapping

| Field | Value |
| --- | --- |
| Document ID | POL-MAP |
| Version | 1.0 |
| Status | Draft — not in force until Legal/compliance review is recorded |
| Effective date | 2026-11-16 (intended; not effective while status is Draft) |
| Owner | Security Lead |
| Approver | Legal/compliance |
| Review cycle | Annual, or on material change, and whenever a mapped policy version changes |
| Classification | Internal |
| Related documents | The seven policies and the customer-shareable summary in this directory; `SOC2_TYPE1_COMPLIANCE.md` |

This matrix lists the 2017 Trust Services Criteria for Security (CC1–CC9) and Availability (A1) and cites a policy only where the text addresses that criterion. A row marked **Not addressed** is not claimed. Every citation is control design for Type I. None is a claim of operating effectiveness, a completed test, or a sampled population.

Policy version for every citation below is **1.0**. Paths are relative to the repository root.

## Security (CC1–CC9)

| Criterion | Addressed | Policy | Section | Notes |
| --- | --- | --- | --- | --- |
| CC1.1 Commitment to integrity and ethical values | Yes | `docs/compliance/policies/acceptable-use-personnel-security.md` | §2, §3 | Conduct expectations and confidentiality. Does not claim a signed code-of-conduct file beyond the terms-acceptance mechanism already in the control register. |
| CC1.2 Board independence and oversight | Not addressed | — | — | No board or oversight body is documented. The ISMS management review is management review, not board oversight. Left unmapped on purpose. |
| CC1.3 Structures, reporting lines, and authorities | Yes | `docs/compliance/policies/information-security-isms.md` | §3 | Role accountabilities. Roles are not named individuals. |
| CC1.4 Commitment to competence | Yes | `docs/compliance/policies/acceptable-use-personnel-security.md` | §5 | Access is role-approved and the policy set is shown before use, once in force. No training-completion record is claimed in this set. |
| CC1.5 Accountability for internal control | Yes | `docs/compliance/policies/information-security-isms.md` | §3, §6 | Owners and the company control register. |
| CC2.1 Quality information for internal control | Yes | `docs/compliance/policies/security-incident-response.md` | §6 | Incident record and decision log. Does not claim a data-quality audit. |
| CC2.2 Internal communication of objectives and responsibilities | Yes | `docs/compliance/policies/information-security-isms.md` | §7 | Where policies live and who is told. Not in force while status is Draft. |
| CC2.3 External communication | Yes | `docs/compliance/policies/security-incident-response.md` | §8 | Customer-notice owner and criteria. Vendor material-addition notice is `docs/compliance/policies/vendor-subprocessor-management.md` §5. |
| CC3.1 Specifies objectives | Yes | `docs/compliance/policies/information-security-isms.md` | §1, §2 | Program objectives and scope. |
| CC3.2 Identifies and analyzes risk | Yes | `docs/compliance/policies/information-security-isms.md` | §4 | Assessment cadence and categories. No completed assessment is attached. |
| CC3.3 Considers the potential for fraud | Yes | `docs/compliance/policies/information-security-isms.md` | §4 | Fraud is a required assessment category. No fraud-risk assessment record is claimed. Design only. |
| CC3.4 Identifies and analyzes significant change | Yes | `docs/compliance/policies/change-management.md` | §2, §3 | Production change path. Material-change triggers also in the ISMS §4. |
| CC4.1 Selects, develops, and performs ongoing and separate evaluations | Yes | `docs/compliance/policies/information-security-isms.md` | §8 | Management review. Access review design is `access-control.md` §5. Recovery test design is `backup-disaster-recovery.md` §6. No evaluation record is claimed. |
| CC4.2 Evaluates and communicates deficiencies | Yes | `docs/compliance/policies/information-security-isms.md` | §4, §5 | Deficiencies and exceptions feed the management review. Failed recovery tests are a deficiency in `backup-disaster-recovery.md` §6. |
| CC5.1 Selects and develops control activities | Yes | `docs/compliance/policies/information-security-isms.md` | §6 | This policy set is the selected control activity for the criteria marked Yes. |
| CC5.2 Technology general controls | Yes | `docs/compliance/policies/access-control.md` | §3, §6, §7 | Logical access, MFA for privileged and production access, and session revocation, together with `change-management.md` and `backup-disaster-recovery.md`. Design. The control register's ITGC operating-evidence gap is not closed by this citation. |
| CC5.3 Deploys policies and procedures | Yes | `docs/compliance/policies/information-security-isms.md` | §7 | Publication and communication design. Procedures cited, not replaced: `docs/MERGE_PROCESS.md`, `docs/compliance/privacy-incident-response.md`, `agent-runtime/docs/SECURITY.md`. |
| CC6.1 Logical access security | Yes | `docs/compliance/policies/access-control.md` | §2, §3 | Least privilege, unique accounts, existing product authorization. No IdP or SSO is claimed. |
| CC6.2 Registers and authorizes users before access; removes credentials when unauthorized | Yes | `docs/compliance/policies/access-control.md` | §4, §7 | Joiner and leaver, plus revocation triggers. |
| CC6.3 Authorizes, modifies, and removes access; least privilege and segregation of duties | Yes | `docs/compliance/policies/access-control.md` | §2, §4, §5 | Least privilege, mover, access review design. Segregation of duties for changes is `change-management.md` §4, including the single-owner gap. |
| CC6.4 Restricts physical access | Yes | `docs/compliance/policies/access-control.md` | §8 | Endpoint and remote-work design only. No company data center is claimed. Provider facilities are a vendor-review input, not a company physical control. |
| CC6.5 Discontinues protections over physical assets only after data is no longer recoverable as required | Yes | `docs/compliance/policies/access-control.md` | §8 | Credential revocation and deletion of local copies before device reuse or disposal. No certified destruction vendor is claimed. |
| CC6.6 Protects against threats from outside the system boundary | Yes | `docs/compliance/policies/security-incident-response.md` | §3 | External reports enter through `agent-runtime/docs/SECURITY.md`. No penetration test is claimed. The control register's vulnerability-program gap is not closed by this citation. |
| CC6.7 Restricts transmission, movement, and removal of information | Yes | `docs/compliance/policies/access-control.md` | §8, §9 | No personal-cloud copies; HTTPS/TLS as already recorded in the control register. No new cipher standard is claimed. |
| CC6.8 Prevents or detects unauthorized or malicious software | Not addressed | — | — | Acceptable-use prohibits introducing unreviewed code. That is not an anti-malware control. Left unmapped. |
| CC7.1 Detects configuration changes and vulnerabilities | Yes | `docs/compliance/policies/security-incident-response.md` | §3 | Intake and existing vulnerability-scan tracking. No scan result is attached. |
| CC7.2 Monitors for anomalies | Yes | `docs/compliance/policies/security-incident-response.md` | §3, §4 | Uses activity logging already described in the control register. No SIEM or numeric threshold is claimed. |
| CC7.3 Evaluates security events | Yes | `docs/compliance/policies/security-incident-response.md` | §2, §4 | Severity definitions and triage. |
| CC7.4 Responds to incidents under a defined program | Yes | `docs/compliance/policies/security-incident-response.md` | §5, §6, §8, §11 | Containment, evidence, customer notice, post-incident review. |
| CC7.5 Recovers from identified security incidents | Yes | `docs/compliance/policies/backup-disaster-recovery.md` | §4, §5 | Recovery targets and restore authority, used from `security-incident-response.md` §11. |
| CC8.1 Authorizes, designs, tests, approves, and implements changes | Yes | `docs/compliance/policies/change-management.md` | §3, §5, §6 | Normal path cites `docs/MERGE_PROCESS.md`. Emergency path is in this policy because the merge checklist excludes it. |
| CC9.1 Identifies and develops risk-mitigation activities for business disruption | Yes | `docs/compliance/policies/backup-disaster-recovery.md` | §2, §4, §6 | Recovery design and test design. First test not yet executed. |
| CC9.2 Assesses and manages vendor and business-partner risk | Yes | `docs/compliance/policies/vendor-subprocessor-management.md` | §2, §3, §5, §6, §7 | Classification, review, monitoring, offboarding, and the public-list owner. |

The control register also splits change management into CC8.2 (testing) and CC8.3 (approval). Those are not separate 2017 criteria. They are addressed by `docs/compliance/policies/change-management.md` §5 and §4 so the register and this matrix agree. They are not additional criteria.

## Availability (A1)

| Criterion | Addressed | Policy | Section | Notes |
| --- | --- | --- | --- | --- |
| A1.1 Maintains and monitors processing capacity | Not addressed | — | — | No capacity-management design is stated. Left unmapped. |
| A1.2 Authorizes, operates, and maintains backup and recovery infrastructure | Yes | `docs/compliance/policies/backup-disaster-recovery.md` | §2, §3, §5 | Scope, frequency, separation, encryption, retention, restore authority. Current hosting-tier capability is not claimed as confirmed. |
| A1.3 Tests recovery procedures | Yes | `docs/compliance/policies/backup-disaster-recovery.md` | §6, §7 | Test design and owner. Section 7 records the result as not yet executed. This row is design only. |

## Customer-shareable summary

`docs/compliance/policies/customer-shareable-summary.md` version 1.0 restates the same seven areas for customers. It is not a second control design and is not cited above as the internal evidence. Internal evidence is the policy cited in the row.

## Document history

| Version | Date | Author | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| 1.0 | 2026-11-16 | Security | Legal/compliance (required; review not yet recorded) | Initial mapping. Unmapped criteria left unmapped. Status remains Draft. |
