# Information Security Policy (ISMS)

| Field | Value |
| --- | --- |
| Document ID | POL-ISMS |
| Version | 1.0 |
| Status | Draft — not in force until Legal/compliance review is recorded |
| Effective date | 2026-11-16 (intended; not effective while status is Draft) |
| Owner | Security Lead |
| Approver | Legal/compliance |
| Review cycle | Annual, or on material change |
| Classification | Internal |
| Related documents | [Access control](./access-control.md), [Change management](./change-management.md), [Security incident response](./security-incident-response.md), [Vendor and subprocessor management](./vendor-subprocessor-management.md), [Backup, disaster recovery, and recovery testing](./backup-disaster-recovery.md), [Acceptable use and personnel security](./acceptable-use-personnel-security.md), [Criterion mapping](./tsc-mapping.md), [Customer-shareable summary](./customer-shareable-summary.md), `docs/compliance/README.md`, `docs/compliance/data-processing-addendum.md`, `docs/compliance/dpia-state-admt-assessment.md`, `docs/compliance/privacy-incident-response.md`, `SOC2_TYPE1_COMPLIANCE.md` |

This document is a Type I control-design statement. It is not a Type II operating-effectiveness report, not an auditor's opinion, and not evidence that a named assessment, test, or review has been completed.

## 1. Purpose

BuilderForce maintains an information security program so that customer data and the production service are protected by documented, owned controls. This policy is the top of that program. The other policies in this directory are the control activities it requires. Privacy handling stays in the privacy documents listed above; this policy does not replace them.

## 2. Scope

The program covers:

- The BuilderForce.ai product that stores or processes customer data, including the web application, the API, and the agent runtime.
- Company systems used to build or operate that product: source control, continuous integration, the cloud host, the production database host, and secret storage for production.
- Personnel and contractors who can reach those systems or customer data.
- Vendors and subprocessors whose failure or access could affect customer data or production availability.

It does not cover a customer's own use of the product inside the customer's environment, except where BuilderForce operates the service for them.

## 3. Roles and accountability

| Role | Accountability |
| --- | --- |
| Security Lead | Owns this policy and the access, incident-response, vendor, and acceptable-use policies. Assigns control owners. Prepares the management review. |
| Engineering Lead | Owns change management and backup, disaster recovery, and recovery testing. Executes technical containment and recovery when Security Lead directs it. |
| Legal/compliance | Approves this policy set. Owns privacy-legal alignment, including the DPA, DPIA, and privacy incident process. Required reviewer before any policy in this set moves from Draft to Approved. |
| Personnel with access | Follow the acceptable-use policy. Do not share credentials. Report suspected security events. |

Roles are not personal names. Where one person holds more than one role, the duties stay distinct, and that person does not sole-approve a production change they authored (see the change-management policy).

## 4. Risk assessment

Security Lead runs a risk assessment at least annually and again when a material change occurs. A material change includes a new subprocessor that can see customer data, a new production host, a change to how customer data is stored or deleted, or a SEV1 or SEV2 incident.

The assessment must consider, at minimum:

- Confidentiality and integrity of customer data.
- Availability of the production service, including the recovery targets in the backup policy.
- Vendor and subprocessor risk.
- Fraud risk (misuse of access, billing, or administrative authority).
- Change risk for production software and infrastructure.

This policy requires that assessment. It does not attach a completed assessment, and it does not claim one has been performed. Results, including any fraud-risk conclusions, are recorded by Security Lead and reviewed in the management review. Deficiencies become owned actions, not undocumented notes.

## 5. Policy exception path

An exception is a time-bound, written decision not to apply a control in this policy set.

1. The requester writes the control, the reason, the scope, the expiry, and the compensating control.
2. Security Lead accepts or rejects the request.
3. Legal/compliance must also accept any exception that affects customer data, personal data, or a Trust Services Criterion this set claims to address.
4. The exception is stored with the policy set's review records. It expires on the stated date unless renewed through the same path.
5. Open exceptions are an input to the management review.

Verbal exceptions are not valid. An emergency production change is not an exception; it is handled under the change-management policy and recorded after the fact.

## 6. Control ownership

Each policy in this directory names one owner role. The owner keeps the document accurate, requests review on the cycle below, and is the person an auditor asks how the control is designed. Ownership is not evidence that the control has operated over a period.

The company control register is `SOC2_TYPE1_COMPLIANCE.md`. Controls that this set supports cite the policy path, version, and section as design evidence. The product `socEvidence` table is a customer-tenant product feature. It is not this company's register, and this policy does not claim rows in it.

## 7. Internal communication

The in-force copy of the policy set is this directory. While status is Draft, the set is not communicated as binding.

When Legal/compliance records approval, Security Lead communicates the set, and any later material change, to people who have production access or access to customer data, at or before the effective date. The communication states where the documents live and who to ask. It does not include secrets, customer data, or internal-only procedure detail beyond what those people need to follow the control.

External and customer communication of security events is owned under the security incident-response policy and, for personal data, under `docs/compliance/privacy-incident-response.md`. Customer-facing description of this program is `customer-shareable-summary.md`, and only after that summary is Approved.

## 8. Management review

At least annually, and after a material change or a SEV1 incident, Security Lead prepares a management review for Engineering Lead and Legal/compliance. The review covers:

- Risk-assessment results and open deficiencies.
- Open policy exceptions.
- Access-review design status and any review that was actually performed.
- Vendor changes and whether `/legal/subprocessors` matches the operating inventory.
- Backup and recovery-test status, including an explicit statement if the first restore test has not yet been executed.
- Incidents since the last review and whether customer notice was required.
- Whether any policy is still Draft or past its review date.

No management-review minutes are claimed by this version.

## 9. Relationship to privacy documents

The following remain authoritative for their current scope. This policy set only points at them:

- `docs/compliance/data-processing-addendum.md`
- `docs/compliance/dpia-state-admt-assessment.md`
- `docs/compliance/privacy-incident-response.md`
- `docs/compliance/privacy-data-export.md`
- `docs/compliance/privacy-data-deletion.md`
- `docs/compliance/subprocessor-register.md`
- `agent-runtime/docs/SECURITY.md` (vulnerability intake)

If a privacy document is thinner than the control design here, the design is stated here and the privacy document is not treated as if it already contained the control.

## 10. Document history

| Version | Date | Author | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| 1.0 | 2026-11-16 | Security | Legal/compliance (required; review not yet recorded) | Initial Type I control-design draft. Status remains Draft. Not Approved. |
