# Backup, Disaster Recovery, and Recovery Testing Policy

| Field | Value |
| --- | --- |
| Document ID | POL-BKP |
| Version | 1.0 |
| Status | Draft — not in force until Legal/compliance review is recorded |
| Effective date | 2026-11-16 (intended; not effective while status is Draft) |
| Owner | Engineering Lead |
| Approver | Security Lead |
| Review cycle | Annual, or on material change |
| Classification | Internal |
| Related documents | [ISMS](./information-security-isms.md), [Change management](./change-management.md), [Security incident response](./security-incident-response.md), `SOC2_TYPE1_COMPLIANCE.md` |

This document states the recovery design. It is not a restore-test result. No completed restore test was found in the repository at the time of this draft. The result is labeled not yet executed in section 7.

## 1. Purpose

Customer data in production and the ability to run the production service are recoverable to stated design targets. Recovery is authorized, tested, and recorded. Type I asks whether this design is documented. It does not ask this document to show that the design operated over a period.

## 2. Scope

In scope:

- The production database that holds customer data.
- The application and infrastructure-as-code required to run the production service, whose recovery source is the source-control history on `main`.
- Production configuration that is not a secret, stored with that infrastructure-as-code.
- The ability to revoke and replace production credentials as part of a restore. Secrets are not stored in git and are not "backed up" by copying them into the repository.

Out of scope:

- A customer's own exports. Customer export and deletion remain `docs/compliance/privacy-data-export.md` and `docs/compliance/privacy-data-deletion.md`.
- Local developer workstations, except that production credentials on a workstation are revoked under the access-control policy if the workstation is lost.
- A second cloud region or a named failover product. None is claimed. The control register records an availability concern for the current hosting tier. This policy does not treat that concern as closed.

Engineering Lead confirms, before the first restore test, which provider backup feature the current hosting tier actually includes. Until that confirmation is recorded, the company does not claim point-in-time recovery, a backup appliance, or a tier upgrade.

## 3. Frequency, separation, encryption, and retention

Design requirements:

| Topic | Design |
| --- | --- |
| Frequency | At least one recoverable backup of the production database every 24 hours. |
| Storage separation | The backup copy is not only the live database volume. Provider-managed backups satisfy this only if Engineering Lead confirms the provider retains a copy that survives loss of the primary volume. |
| Encryption | Backups are encrypted at rest by the provider that stores them. Transmission of the backup or a restore uses TLS. This policy does not publish keys, bucket names, or provider console paths. |
| Retention | Design target is 30 days of recoverable backups, unless a shorter provider limit is confirmed, in which case Engineering Lead records the actual limit as a deficiency against this target rather than silently lowering the target. |
| Code and configuration | Recoverable from `main` and its history. A restore of the service uses a reviewed revision, not an unreviewed workstation copy. |

These are design requirements. They are not a statement that the current hosting tier has been measured against them.

## 4. Recovery objectives

The design targets, not measured results, are:

| Objective | Design target | Meaning |
| --- | --- | --- |
| RPO | 24 hours | The maximum designed loss of production customer-data updates. A restore may lose updates made after the last recoverable backup, up to this window. |
| RTO | 24 hours | The maximum designed time from a declared production-data loss or sustained full outage to a usable production service. |

Security Lead may declare a tighter target after the first successful test. This version does not. Missing the target during a test or a real event is a deficiency, not a quiet revision of the number.

## 5. Restore authority

Engineering Lead authorizes a restore of production. Security Lead is informed before a restore that reads or writes customer data, and is the approver when the restore is part of a SEV1 or SEV2 incident. Legal/compliance is informed when the restore involves personal data.

A restore is a production change. If it cannot wait for the normal merge path, it follows the emergency path in the change-management policy and is recorded after the fact. Restore steps are kept in the operator runbook Engineering Lead maintains. They are not copied into this policy and not into the customer-shareable summary.

## 6. Recovery test design

What is tested: restoration of a production database backup into a non-production environment, confirmation that the restored data is readable and that application access controls still reject an unauthorized tenant, and confirmation that the application revision from `main` starts against that restore. The test does not use customer production as the destination. The test does not include exploit activity.

How often: at least annually, and after a material change to the database host, the backup mechanism, or the RPO or RTO target.

Who records the result: Engineering Lead writes the record. The record states the date, the backup used (by date, not by secret identifier), whether the restore met the RPO and RTO design targets, what failed, and the owner of any fix. Security Lead receives the record and includes it in the management review.

What failure does: a failed test is a deficiency. Engineering Lead owns the fix. Security Lead tracks it until a later test passes or an approved exception records a compensating control. Failure is not documented as a pass.

## 7. Test result

**Not yet executed.** No completed restore-test record was found in the repository when this version was written. This section will cite a record only after one exists. Engineering Lead is obligated to run the first test and record the result. Until that record exists, Availability recovery testing is a documented design, not a performed test.

## 8. Document history

| Version | Date | Author | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| 1.0 | 2026-11-16 | Security | Legal/compliance (required; review not yet recorded) | Initial Type I control-design draft. Status remains Draft. Not Approved. Restore test not yet executed. No test result invented. |
