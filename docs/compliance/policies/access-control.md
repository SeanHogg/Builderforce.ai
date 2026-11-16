# Access Control Policy

| Field | Value |
| --- | --- |
| Document ID | POL-ACC |
| Version | 1.0 |
| Status | Draft — not in force until Legal/compliance review is recorded |
| Effective date | 2026-11-16 (intended; not effective while status is Draft) |
| Owner | Security Lead |
| Approver | Legal/compliance |
| Review cycle | Annual, or on material change |
| Classification | Internal |
| Related documents | [ISMS](./information-security-isms.md), [Acceptable use and personnel security](./acceptable-use-personnel-security.md), [Change management](./change-management.md), [Security incident response](./security-incident-response.md), `SOC2_TYPE1_COMPLIANCE.md` |

This document states how logical and limited physical access controls are designed. It does not claim that an access review, joiner-mover-leaver event, or MFA enrollment has been sampled.

## 1. Purpose

Access to production, source, cloud administration, and customer data is granted to a unique person, limited to what that person's role requires, and removed when the reason for access ends. Privileged and production access requires multi-factor authentication at the provider that issues the credential.

## 2. Least privilege and unique accounts

- Every person has their own account. Shared logins, shared personal access tokens, and shared production passwords are prohibited.
- Access is limited to the duties of the role. A broader grant requires a written exception under the ISMS exception path.
- Production administrative authority is separate from ordinary product use. Holding a product tenant role does not grant access to company source, cloud, or database administration.
- The author of a production change is not the sole approver of that change. See the change-management policy. Separation of duties is a design requirement. The repository currently has one verified code owner, so the platform cannot yet enforce a second person. That gap is stated in the change-management policy and is not closed by this document.

Product authorization that already exists, and that this policy relies on, is role-based permission checks and tenant scoping in the API (`requirePermission`, tenant context, and the tenant roles OWNER, ADMIN, MANAGER, MEMBER, and BILLING). This policy does not describe those mechanisms as a company identity provider.

## 3. Systems in scope

| System | Designed control | What this policy does not claim |
| --- | --- | --- |
| Production application and API | Unique user, role-limited permissions, tenant isolation, server-side session revocation | A company IdP, SSO, or product end-user MFA |
| Source control (GitHub) | Unique account, MFA for privileged and production-write access, code-owner review | A second verified owner, which is not in the repo |
| Cloud host and production database host administration | Unique account, MFA, least privilege, removal on offboarding | A named backup product, private network, or SSO broker |
| Production secret storage and deployment credentials | Unique access, MFA, no secrets in git, revocation on offboarding or suspected compromise | A specific vault product beyond what the control register already describes |
| Customer-data stores | Access only through the application or an approved administrative path, least privilege, revocation on the triggers in section 7 | Row-level security or a completed isolation remediation; those remain gaps in `SOC2_TYPE1_COMPLIANCE.md` until closed in code |

No identity provider, single sign-on, or session-revoke feature is claimed except the session-revocation mechanism already in the product (`api/src/application/auth/sessionRevocation.ts`) and provider-native MFA on the administrative consoles above.

## 4. Joiner, mover, leaver

Designed sequence:

1. **Join.** The owning lead (Security Lead for security-sensitive access, Engineering Lead for production engineering access) approves the role and the systems before credentials are issued. Access starts at the least set that role needs.
2. **Move.** A role change that adds access is a new grant and needs the same approval. A role change that removes access is treated as a leaver for the access that is no longer required, and is completed before the new role is used.
3. **Leave.** Access to source, cloud, database administration, secrets, and the product is removed at or before the end of the engagement. Product sessions for that person are revoked through the existing session-revocation mechanism. Tokens they created are revoked at the provider.

This is the design. This version does not attach a completed joiner, mover, or leaver ticket.

## 5. Access review

Security Lead reviews privileged and production access at least annually and after a SEV1 or SEV2 incident that involved credentials. The review lists each person, the system, the role, and whether the access is still required. Access that is not confirmed is removed. Engineering Lead confirms production and cloud administrative access. Legal/compliance is informed of removals that affect a person with access to personal data.

The product includes an access-review table for tenant governance. That table is not, by itself, the company's operator access review, and this policy does not claim a review has been run.

## 6. Multi-factor authentication

MFA is required for privileged and production access:

- Source-control access that can write production code or administer the repository.
- Cloud-host and production-database administrative access.
- Access to production secrets and deployment credentials.
- Any shared administrative console for a subprocessor that can affect production or customer data, where that console supports MFA. If it does not, the vendor is not used for that purpose until Security Lead records an exception with a compensating control.

MFA is enforced at the provider that issues the credential. This policy does not claim that the BuilderForce product implements end-user MFA or SSO. Product end-user authentication remains the existing JWT bearer and web-session verification described in the control register.

## 7. Sessions: lifetime and revocation

Product sessions are the existing JWT and web-session credentials. Their lifetime is the lifetime configured in that deployed authentication code. Security Lead reviews that configuration at least annually. This policy does not invent a lifetime the repository does not state.

Sessions and tokens are revoked, using the existing session-revocation mechanism and provider token revocation, when any of the following is true:

- The person is offboarding.
- The person's role changes and the old access is no longer required.
- Compromise of the credential or the endpoint is suspected.
- An exception granting the access expires.

Revocation is performed by Engineering Lead when it is a technical control, at Security Lead's direction for a suspected compromise, and is recorded in the incident or access record. A password change alone is not treated as revocation if a session or token would remain valid.

## 8. Remote work, physical access, and endpoints

BuilderForce does not claim a company data center or a staffed office facility as a control boundary. Production infrastructure is at the hosting providers. Physical controls at those facilities are the providers' controls and are reviewed under the vendor policy, not claimed here as company-operated controls.

For remote work:

- Production and customer-data access is used only from an endpoint the authorized person controls.
- The screen locks when unattended. Credentials are not left in a shared or unlocked session.
- Endpoints that hold production credentials or customer data use disk encryption. The company does not claim a mobile-device-management product.
- Customer data and production secrets are not copied to personal cloud storage, personal email, or removable media except under a recorded exception.
- Before a device that stored production credentials or customer data is reused, transferred, or discarded, those credentials are revoked and local copies are deleted. The company does not claim a certified wipe vendor or a media-destruction certificate.

## 9. Transmission

Customer data in transit on the production service uses the HTTPS/TLS control already recorded in `SOC2_TYPE1_COMPLIANCE.md`. This policy does not define a new cipher suite and does not claim a configuration review has been filed.

## 10. Document history

| Version | Date | Author | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| 1.0 | 2026-11-16 | Security | Legal/compliance (required; review not yet recorded) | Initial Type I control-design draft. Status remains Draft. Not Approved. |
