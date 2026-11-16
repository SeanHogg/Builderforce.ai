# Acceptable Use and Personnel Security Policy

| Field | Value |
| --- | --- |
| Document ID | POL-AUP |
| Version | 1.0 |
| Status | Draft — not in force until Legal/compliance review is recorded |
| Effective date | 2026-11-16 (intended; not effective while status is Draft) |
| Owner | Security Lead |
| Approver | Legal/compliance |
| Review cycle | Annual, or on material change |
| Classification | Internal |
| Related documents | [ISMS](./information-security-isms.md), [Access control](./access-control.md), [Security incident response](./security-incident-response.md), [Vendor and subprocessor management](./vendor-subprocessor-management.md), `docs/compliance/README.md`, `SOC2_TYPE1_COMPLIANCE.md` |

## 1. Purpose

People who use company or production systems, or who can reach customer data, use those systems for the company's work, keep credentials to themselves, and protect customer and company information. Access is granted when a role is approved and removed when the role ends.

## 2. Expected use

Company systems, production systems, source control, and customer data are used for BuilderForce work. Personal use that does not store customer data, does not weaken access controls, and does not interfere with production is not a violation by itself. The following are not acceptable:

- Using production access or customer data for a purpose outside the person's role.
- Copying customer data to a personal account, personal device that is not the controlled endpoint in the access-control policy, or an unapproved vendor.
- Disabling, bypassing, or sharing a control in this policy set without an approved exception.
- Introducing unreviewed code or unreviewed infrastructure into production except through the change-management policy, including its emergency path.
- Probing or exploiting production, customer tenants, or a third party's systems outside a scope Security Lead has written down. Vulnerability intake from outside the company stays in `agent-runtime/docs/SECURITY.md`.

## 3. Credentials and confidentiality

- Credentials are not shared. That includes passwords, tokens, session cookies, recovery codes, and MFA factors.
- A person does not ask another person for their credentials, including for "temporary" production access. Access is granted to the requesting person's own account under the access-control policy.
- Customer data, unpublished vulnerability detail, and the contents of Draft or Internal policies are confidential. They are not posted to a public channel, a public repository, or a customer communication except through the incident-response customer-notice path or the Approved customer-shareable summary.
- A suspected compromise, lost endpoint, or exposed credential is reported to Security Lead as a security event. The person does not attempt to confirm the exposure by accessing customer data.

The product's terms-acceptance record, described in the control register, is a product mechanism for customer terms. It is not a substitute for this internal policy.

## 4. Devices

People who hold production credentials or customer data:

- Use an endpoint they control, with a screen lock and disk encryption, as the access-control policy requires.
- Do not leave a production session unlocked and unattended.
- Remove local copies and revoke credentials before the device is reused, transferred, or discarded.

The company does not claim a device-management product, a company-issued-only hardware standard, or a certified wipe service. Those are not adopted controls. They are not implied by this section.

## 5. Onboarding access grant

Access is granted only after the owning lead approves the role and the systems, as the access-control policy's joiner step describes. Grant is least privilege. Production administrative access is not part of a default grant.

The person is shown where this policy set lives before production or customer-data access is used. While this set is Draft, that acknowledgment is not yet required, because the set is not in force.

## 6. Offboarding access removal

When an engagement ends, or when a role no longer needs access:

- Source, cloud, database administration, secret, vendor-console, and product access are removed at or before departure.
- Product sessions are revoked through the existing session-revocation mechanism.
- Tokens the person created are revoked.
- Security Lead confirms privileged access is removed. Engineering Lead performs the technical removal.

A departed person's credential is not kept "in case we need it."

## 7. Personnel screening

No pre-employment background check, credit check, or screening vendor is adopted in this version. This policy does not describe one as if it operates. If the company later adopts a screening step, that step will be added here by a versioned change approved by Legal/compliance, and not before.

What is adopted is the joiner-mover-leaver design in sections 5 and 6, unique accounts, and the confidentiality duties in section 3.

## 8. Exceptions

Exceptions follow the ISMS exception path. An exception does not permit credential sharing.

## 9. Document history

| Version | Date | Author | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| 1.0 | 2026-11-16 | Security | Legal/compliance (required; review not yet recorded) | Initial Type I control-design draft. Status remains Draft. Not Approved. Personnel screening omitted because it is not an adopted control. |
