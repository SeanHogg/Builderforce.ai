# Security program summary

| Field | Value |
| --- | --- |
| Document ID | POL-SUM |
| Version | 1.0 |
| Status | Draft — do not send to a customer until Legal/compliance records approval. The text is written so that no further redaction is required once approved. |
| Effective date | 2026-11-16 (intended; not effective while status is Draft) |
| Owner | Security Lead |
| Approver | Legal/compliance |
| Review cycle | Annual, or on material change |
| Classification | Customer-shareable |
| Related documents | Internal control design lives in the same directory and is not required to read this summary. |

This summary describes how BuilderForce designs its security controls. It is a point-in-time design statement for a SOC 2 Type I examination. It is not a statement that those controls operated effectively over a period, and it is not an audit report.

## Information security

BuilderForce keeps a written security program covering the product, the systems used to run it, the people who can reach customer data, and the vendors that can affect that data or the service. A Security Lead owns the program. Legal/compliance approves the policies. Risks are reviewed on a schedule and when something material changes. Exceptions are written, time-limited, and approved. They are not informal.

## Access control

People receive their own accounts, limited to what their role needs. Shared credentials are not allowed. Access is granted when a role is approved, changed when the role changes, and removed when the person leaves or no longer needs it. Privileged and production access is designed to require multi-factor authentication. Sessions can be revoked when someone leaves, changes role, or is suspected of compromise. Production customer data is separated by tenant in the product.

## Change management

Changes to production software follow a written merge process: request, review, approval by someone other than the author, automated checks, and a recorded merge. The same expectation applies to changes to the security policies. Emergency changes, when production or customer data cannot wait, are allowed only with a record of what changed and who authorized it.

## Security incidents

Incidents are classified by customer impact, whether customer data was exposed, and whether the service is available. The Security Lead owns the response and the decision to notify customers. Customers are notified when unauthorized access to their data is confirmed or reasonably likely, or when a serious outage means they need to act. Events that involve personal data also follow the company's privacy incident process. External vulnerability reports are accepted through the published security contact. This summary does not describe internal tools or detection methods.

## Vendors and subprocessors

Vendors that can see customer data or affect production are reviewed before they are used, bound by contract, and reviewed again on a schedule. When the relationship ends, their access is removed and customer data is returned or deleted under the contract. The list customers can rely on is the public subprocessor page at `/legal/subprocessors`. The Security Lead is responsible for updating that page when a subprocessor changes. Customers are told before a material addition.

## Backup and recovery

Production customer data is designed to be backed up at least daily, stored separately from the live copy, encrypted, and kept for a designed retention period. The designed recovery point is 24 hours. The designed recovery time is 24 hours. Restores are authorized by the Engineering Lead. Recovery is designed to be tested at least annually, with the result recorded. As of this version, that test has not yet been executed. This summary does not include restore procedures.

## People and acceptable use

People who can reach production or customer data use that access for company work, keep credentials to themselves, and protect customer information. Access starts only after the role is approved and ends when the role ends. BuilderForce does not claim a background-screening program in this version. None is described here as if it were operating.

## What this document is not

It is not a penetration-test report, a list of certifications, or a promise that a Type II examination has been completed. Questions about this summary go to the Security Lead through the company's ordinary customer-security channel. Internal escalation details are intentionally not in this document.
