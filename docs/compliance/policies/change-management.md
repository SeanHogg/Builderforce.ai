# Change Management and SDLC Policy

| Field | Value |
| --- | --- |
| Document ID | POL-CHG |
| Version | 1.0 |
| Status | Draft — not in force until Legal/compliance review is recorded |
| Effective date | 2026-11-16 (intended; not effective while status is Draft) |
| Owner | Engineering Lead |
| Approver | Security Lead and Legal/compliance |
| Review cycle | Annual, or on material change |
| Classification | Internal |
| Related documents | [ISMS](./information-security-isms.md), [Access control](./access-control.md), [Security incident response](./security-incident-response.md), `docs/MERGE_PROCESS.md`, `.github/CODEOWNERS`, `SOC2_TYPE1_COMPLIANCE.md` |

## 1. Purpose

Production changes to software, infrastructure-as-code, and this policy set are requested, reviewed, approved by someone other than the author, tested, and deployed through a recorded path. Emergency changes are allowed only as defined in section 6 and are recorded after the fact.

The procedure for a normal merge to `main` is `docs/MERGE_PROCESS.md`. This policy is the control design. It does not copy that checklist, and it does not pretend the checklist already contains the emergency path. `docs/MERGE_PROCESS.md` states that emergency merges are outside its scope. Section 6 is the design for that gap.

## 2. What is a production change

A production change is a change that can affect the production service, customer data, production infrastructure, production secrets, or the control design in `docs/compliance/policies/`. Documentation that cannot change runtime behavior and does not live in this policy directory follows the repository's ordinary review practice and is not by itself a production change.

## 3. Normal path

A normal production change:

1. Is requested as a pull request against `main`, with a description of what changes and why.
2. Is reviewed against `docs/MERGE_PROCESS.md` sections 1 through 3: green CI, branch current with `main`, review completeness, and no coverage decrease against the `main` baseline.
3. Receives at least one approval from a code owner who is not the author, as required by `.github/CODEOWNERS` and section 4 below.
4. Is merged with the repository's configured merge strategy. The merge message references the pull request. The source branch is deleted after the merge.
5. Is checked by the post-merge CI run on `main` described in `docs/MERGE_PROCESS.md` section 5. A failure follows that document's rollback and hotfix direction.

Deployment of a merged change to staging or production, and the detailed rollback runbook, remain the operational documents those procedures live in. This policy requires that a production deploy be of a change that followed this path, or an emergency change recorded under section 6. It does not invent a deploy tool.

## 4. Separation of duties and CODEOWNERS

The author of a production change is not the sole approver. Approval is required from a code owner.

`.github/CODEOWNERS` must cover:

- Production code paths: `/api/`, `/frontend/`, `/agent-runtime/`, `/Builderforce.ai/`, `Dockerfile.api`, `Dockerfile.frontend`, and `/.github/`.
- This policy set: `/docs/compliance/policies/`.

Those paths are listed in `.github/CODEOWNERS`. The repository audit engine accepts `.github/CODEOWNERS` as the ownership file; a second root copy is not required for that check.

### 4.1 Verified owners and the uncovered-duty gap

The only GitHub handle verified in this repository is `@SeanHogg`, already used in `.github/CODEOWNERS` and named in `agent-runtime/docs/SECURITY.md`. No second maintainer or team handle is documented in `docs/MERGE_PROCESS.md`, `CONTRIBUTING.md`, or `.github/CODEOWNERS`.

This policy does not invent a GitHub username or team to fill that gap. Until a second verified handle exists:

- CODEOWNERS cannot force a different person to approve.
- The separation-of-duties requirement still stands. A production change authored by the only code owner is not approved until a second person who holds the Engineering Lead, Security Lead, or Legal/compliance role records approval outside that single-owner rule, and the pull request links that approval.
- Security Lead records this gap in the management review until it is closed by adding a verified owner, not by a fictional CODEOWNERS entry.

## 5. Testing and approval

Testing for a normal change is the CI required by `docs/MERGE_PROCESS.md`: lint, unit tests, integration tests, build, and security scan, plus the coverage gate in that document. This policy does not claim a coverage percentage beyond that gate, and it does not claim a change-advisory board that meets on a calendar.

Approval is the non-author code-owner approval in section 4, plus Security Lead approval when the change alters this policy set, authentication, tenant isolation, or production data handling. Legal/compliance approval is required when the change alters a privacy document, the DPA relationship, or a policy in this directory.

## 6. Emergency changes

An emergency change is allowed only when production is unavailable, customer data is exposed or at immediate risk, or a SEV1 or SEV2 incident cannot wait for the normal path.

Design:

1. Engineering Lead authorizes the change. If Engineering Lead is unavailable, Security Lead authorizes it. The author still does not sole-approve their own emergency change when a second person is available.
2. The change is made through the smallest path that contains the incident, and is described in the incident record.
3. Within one business day, Engineering Lead records: what changed, why it could not wait, who authorized it, how it was tested after the change, and the follow-up pull request if the emergency edit bypassed review.
4. Security Lead confirms the record exists before the incident is closed.

`docs/MERGE_PROCESS.md` does not contain this procedure. Operators follow this section, not an implied reading of that checklist.

## 7. Changes to this policy set

A change to `docs/compliance/policies/` is a production change for control design. It requires code-owner review, Security Lead approval, and Legal/compliance approval before status may move to Approved. Editing a Draft to prepare that review does not make the policy Approved.

## 8. Document history

| Version | Date | Author | Reviewer | Notes |
| --- | --- | --- | --- | --- |
| 1.0 | 2026-11-16 | Security | Legal/compliance (required; review not yet recorded) | Initial Type I control-design draft. Status remains Draft. Not Approved. Single verified CODEOWNERS handle recorded as a gap, not filled. |
