# Vendor and Subprocessor Management Policy

| Field | Value |
| --- | --- |
| Document ID | POL-VND |
| Version | 1.0 |
| Status | Draft — not in force until Legal/compliance review is recorded |
| Effective date | 2026-11-16 (intended; not effective while status is Draft) |
| Owner | Security Lead |
| Approver | Legal/compliance |
| Review cycle | Annual, or on material change |
| Classification | Internal |
| Related documents | [ISMS](./information-security-isms.md), [Access control](./access-control.md), [Security incident response](./security-incident-response.md), `docs/compliance/subprocessor-register.md`, `docs/compliance/data-processing-addendum.md`, `docs/compliance/international-data-transfer-assessment.md`, `SOC2_TYPE1_COMPLIANCE.md` |

## 1. Purpose

Vendors that can affect customer data or production are classified, risk-reviewed before use, contracted, monitored, and offboarded. The customer-facing inventory is the public list at `/legal/subprocessors`. This policy is the operating design behind that list. It does not replace the field register in `docs/compliance/subprocessor-register.md`, the DPA, or the transfer assessment.

## 2. Classification

| Class | Meaning | Minimum design |
| --- | --- | --- |
| Subprocessor | Processes customer prompts, chats, code, ideas, or personal data for BuilderForce | Review and contract before any customer data flows. Listed at `/legal/subprocessors`. |
| Production vendor | No customer-data processing, but can affect production availability or holds administrative access | Review before use. MFA and unique access under the access-control policy. Not listed as a subprocessor unless they also process customer data. |
| Other vendor | Neither of the above | No customer data and no production access. Out of the public list. |

A vendor is classified by the data and access they would actually receive, not by the vendor's marketing category. Reclassification happens before the data or access changes, not after.

## 3. Risk review before use

Security Lead completes a review before a subprocessor or production vendor is enabled. The review records: legal name, service, data categories, data-subject types, countries and hosting region, security review, DPA date if personal data is involved, transfer mechanism, whether model training is disabled or requires a separate customer choice, deletion or return terms, incident cooperation, and exit path.

No provider receives customer prompts, chats, code, ideas, or personal data until that review matches the conditions already stated in `docs/compliance/subprocessor-register.md`: use limited to service delivery; no sale; model training disabled or a separate informed customer choice; retention and deletion terms consistent with product promises; confidentiality and security duties flowed down; incident cooperation; and a valid transfer mechanism where one is required.

This policy does not claim that any named vendor has passed that review, and it does not invent certifications.

## 4. Contracting

A subprocessor that processes personal data is covered by the DPA path in `docs/compliance/data-processing-addendum.md` before processing starts. Production vendors who do not process personal data still need a confidentiality commitment before they receive non-public system information.

Contract negotiation, new DPAs, and customer-specific questionnaires are out of scope for this document. The design requirement is that the applicable contract exists before access or data flow. Legal/compliance confirms the privacy terms. Security Lead confirms the security terms.

## 5. Monitoring

Security Lead reviews each subprocessor and production vendor at least annually and when a material change is proposed (new data category, new region, new training use, or a security incident at the vendor). The review uses the same fields as section 3. A vendor incident that involves BuilderForce customer data is also a security incident under the incident-response policy and, if personal data is involved, under `docs/compliance/privacy-incident-response.md`.

Customers are notified before a material addition to the public subprocessor list, and an objection path is operated, as `docs/compliance/subprocessor-register.md` already requires. This policy does not weaken that commitment.

## 6. Offboarding

When a subprocessor or production vendor is exited:

1. Security Lead records the exit decision and the effective date.
2. Access the vendor held to source, cloud, production, or customer data is removed. Tokens issued to the vendor are revoked.
3. Customer data and personal data held by the vendor is returned or deleted on the terms of the DPA and `docs/compliance/privacy-data-deletion.md`. This policy does not invent a deletion timeline those documents do not state.
4. The public list at `/legal/subprocessors` is updated so it no longer presents an exited subprocessor as current.
5. Exit status is recorded in the governance vendor tracker described in `docs/compliance/subprocessor-register.md`.

## 7. Who updates the public list

The public list at `/legal/subprocessors` is the customer-facing inventory.

The Security Lead is the owner who updates that public list when a subprocessor is added, changed, or removed. The update happens before a material addition is relied on, and at exit for a removal.

The privacy owner named in `docs/compliance/subprocessor-register.md` remains responsible for the legal fields in the governance vendor tracker (legal name, data categories, transfer mechanism, DPA date, and related privacy terms). Security Lead does not overwrite that duty. If one person holds both roles, the duties are still both required.

A public-list change that is not reflected in the field register, or a field-register change that is not reflected in the public list, is a deficiency. Security Lead closes it before the next management review.

## 8. Document history

| Version | Date | Author | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| 1.0 | 2026-11-16 | Security | Legal/compliance (required; review not yet recorded) | Initial Type I control-design draft. Status remains Draft. Not Approved. No vendor certification is claimed. |
