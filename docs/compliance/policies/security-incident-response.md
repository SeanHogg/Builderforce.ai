# Security Incident Response Policy

| Field | Value |
| --- | --- |
| Document ID | POL-IR |
| Version | 1.0 |
| Status | Draft — not in force until Legal/compliance review is recorded |
| Effective date | 2026-11-16 (intended; not effective while status is Draft) |
| Owner | Security Lead |
| Approver | Legal/compliance |
| Review cycle | Annual, or on material change |
| Classification | Internal |
| Related documents | [ISMS](./information-security-isms.md), [Access control](./access-control.md), [Change management](./change-management.md), [Backup, disaster recovery, and recovery testing](./backup-disaster-recovery.md), `docs/compliance/privacy-incident-response.md`, `agent-runtime/docs/SECURITY.md`, `SOC2_TYPE1_COMPLIANCE.md` |

This policy is the security incident program. Personal-data and privacy-breach handling remains `docs/compliance/privacy-incident-response.md`. This document does not restate privacy-breach law and is not a legal opinion.

## 1. Purpose

Security incidents are detected, severity-rated, contained, communicated, and reviewed under one design. Vulnerability reports from outside the company enter through `agent-runtime/docs/SECURITY.md`. They are not a second incident process.

## 2. Severity

Security Lead assigns severity. A higher customer impact wins if two rows could apply.

| Severity | Customer impact | Data exposure | Availability |
| --- | --- | --- | --- |
| SEV1 | Confirmed impact that customers must be told about, or active compromise of production | Confirmed unauthorized access to customer data, or a credible ongoing exposure | Production unavailable for all or most customers, or recovery requires the disaster-recovery path |
| SEV2 | Limited customer impact, or a customer-visible degradation with no full workaround | Exposure limited to a subset of tenants or data types, or a confirmed vulnerability in production that is not yet contained | Material degradation of production, short of full unavailability |
| SEV3 | No confirmed customer impact | No confirmed exposure. A contained vulnerability, a policy violation on one internal system, or a suspected event that investigation does not confirm | Short degradation with a workaround, or an internal-only failure |
| SEV4 | No customer impact | No exposure. Informational finding, failed attempt, or hygiene issue | No availability impact |

Severity is not a detection threshold and not a claim that a particular monitoring rule exists.

## 3. Detection and intake

Designed intake paths:

- External vulnerability reports, as defined in `agent-runtime/docs/SECURITY.md`, including the private reporting channel that document names.
- Internal discovery by personnel, who report to Security Lead without first expanding access to the affected data.
- Signals the product already records: the security-incident record, the activity log, and vulnerability-scan tracking described in `SOC2_TYPE1_COMPLIANCE.md`.

This policy does not claim a SIEM, a paging integration, or numeric detection thresholds. Those are not documented as operating controls. Adding them would be a new technical control and is out of scope for this document.

## 4. Triage

Security Lead triages the report, assigns severity, and opens an incident record for SEV1, SEV2, and any SEV3 that involves personal data or production credentials. SEV4 may be tracked as a vulnerability or defect rather than an incident, unless personal data is involved.

Triage determines: what is affected, whether customer data or personal data is in scope, whether production is still exposed, and who must act. Facts that are not known are marked unknown. They are not filled in.

## 5. Containment roles

| Role | Designed duty |
| --- | --- |
| Security Lead | Owns severity, containment decisions, evidence scope, customer-notice recommendation, and the incident record. |
| Engineering Lead | Executes technical containment: revoke sessions and tokens using the existing revocation mechanism, rotate affected credentials, isolate the affected component, and apply an emergency change if section 6 of the change-management policy applies. |
| Legal/compliance | Owns legal notice analysis and regulator coordination. Engaged for every SEV1, every event involving personal data, and any event where customer notice is under consideration. |
| Personnel | Preserve what they have, do not investigate beyond their access, and do not post details to a public channel. |

Containment aims to stop ongoing exposure. It is not permission to access customer data beyond what is required to contain the event.

## 6. Evidence handling

Security Lead defines what is preserved: the incident record, the decision log, relevant activity-log extracts, and the list of credentials revoked. Evidence is stored where production access is already controlled. Copies are not made to personal email or personal storage.

Chain of custody for an event that involves personal data follows `docs/compliance/privacy-incident-response.md` as well as this section. This policy does not publish collection commands.

## 7. Internal escalation

Security Lead escalates every SEV1 and SEV2 to Engineering Lead and Legal/compliance when the incident is opened, not after containment finishes. SEV3 involving personal data is escalated to Legal/compliance at triage.

This policy does not list personal phone numbers, on-call rotations, or private inboxes. Those are operating details and are not created here. Until an on-call roster exists, escalation is to the role, and the absence of a roster is a deficiency Security Lead tracks. It is not described as a staffed rotation.

## 8. Customer notice

Security Lead owns the decision of whether customers are notified, after Legal/compliance determines the legal thresholds. Notice is required under this policy when either of the following is true:

- Unauthorized access to customer data is confirmed, or Security Lead and Legal/compliance agree it is reasonably likely.
- A SEV1 availability event requires customers to take action, or customers would reasonably be expected to notice a sustained outage and need a status.

Notice states what is known, what is not known, and who at the company the customer can reply to. It is updated if material facts change. It does not include exploit detail, internal host names, or detection logic.

Legal deadlines, regulator content, and individual privacy notices are not defined here. They are handled under section 9 and the privacy incident process.

## 9. Regulator coordination

Regulator and individual privacy-notice analysis is handed to Legal/compliance. Counsel engagement, where the privacy incident process requires it, stays in that process. This policy does not interpret breach statutes and does not claim a notification timeline.

## 10. Personal data

A security incident that involves personal data follows `docs/compliance/privacy-incident-response.md` in addition to this policy. The privacy document remains authoritative for privacy triage, counsel, notification thresholds, and the annual privacy exercise. This policy remains authoritative for severity, security containment, and security evidence. Both owners are engaged. Neither document is read as cancelling the other.

## 11. Recovery and post-incident review

Recovery of the service follows the backup and disaster-recovery policy when the event is a loss of production data or a sustained outage. Ordinary containment that does not require restore does not invent a restore.

After a SEV1 or SEV2, and after any personal-data incident, Security Lead records a post-incident review: what happened, what is still unknown, what contained it, what change is required, and who owns that change. The review is an input to the ISMS management review. This version attaches no completed review.

## 12. Document history

| Version | Date | Author | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| 1.0 | 2026-11-16 | Security | Legal/compliance (required; review not yet recorded) | Initial Type I control-design draft. Status remains Draft. Not Approved. No incident roster or completed review is claimed. |
