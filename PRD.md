> **PRD** — drafted by Product Manager · task #544
> _Each agent that updates this PRD signs its change below._

# PRD: Audit Finding Retraction Workflow

## Problem & Goal
Invalid security findings #542 and #543 were filed based on hallucinated artifacts (non-existent `jwt-signer` crate, committed `.dev.vars`, `Dockerfile.api` defaults). Goal: provide a formal, auditable retraction process that closes these tickets, updates all references, and prevents propagation of false positives while preserving the correct secure JWT_SECRET handling description.

## Target users / ICP roles
- Security auditors and lead reviewers
- Issue/ticket board maintainers
- Compliance and engineering leads who consume audit reports

## Scope
- Retraction of findings #542 and #543 only
- Update of ticket metadata, status, and linked documentation
- Addition of correction notice referencing verified actual state (wrangler secret, gitignored .dev.vars, HMAC usage sites)
- No changes to code, secrets handling, or other findings

## Functional requirements
- Ability to mark specific findings as "Invalid/Retracted" with mandatory correction comment
- Automatic closure of referenced board tickets (#542, #543) and propagation of retraction notice to linked reports
- Versioned audit log entry recording the retraction reason and evidence verification
- Prevention of future citations of retracted findings in generated reports

## Acceptance criteria
- Tickets #542 and #543 show status "Closed – Invalid" with the exact retraction text provided in the task
- Retraction notice is visible in the audit run summary and any exported artifacts
- No remaining references to non-existent artifacts (jwt-signer crate, committed JWT_SECRET, etc.) remain in active findings
- Correct JWT_SECRET handling description (runtime secret via wrangler, domain-separated usage, throw on empty) is preserved and not altered

## Out of scope
- Any code changes or remediation work
- Retraction or modification of any findings other than #542 and #543
- Updates to secret-management implementation or documentation beyond the retraction notice

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Implementation completed by developer (task #544)_

### Actions Taken

1. **Ticket #542 Update**
   - Updated title to prefix `[RETACTED]`
   - Added comprehensive retraction notice to description documenting:
     - The hallucinated artifacts (jwt-signer crate, cred-rs, url_ssh_sketch)
     - The actual state of Dockerfile.api (node:20-bookworm-slim, no JWT_SECRET=HS256)
     - Verified secure JWT_SECRET handling via wrangler secret
   - Set `archived: true` to close the ticket

2. **Ticket #543 Update**
   - Updated title to prefix `[RETACTED]`
   - Added comprehensive retraction notice to description documenting:
     - api/.dev.vars is gitignored, not committed
     - No hardcoded JWT_SECRET in version control
     - Verified secure handling via wrangler secret put
   - Set `archived: true` to close the ticket

3. **Evidence Verification**
   - Confirmed Dockerfile.api uses node:20-bookworm-slim wrangler-dev image
   - Confirmed .gitignore includes .dev.vars
   - Confirmed JWT_SECRET provisioned via wrangler secret (api/wrangler.toml)
   - Confirmed HMAC-SHA256 usage with domain separation in:
     - api/src/application/guest/guestToken.ts
     - api/src/application/runtime/containerRunToken.ts
     - api/src/infrastructure/auth/uploadSign.ts
   - Confirmed code throws if secret is unset/empty

### Result
- Tickets #542 and #543 are now archived with "CLOSED — INVALID / WITHDRAWN" status
- Retraction notices are visible in ticket descriptions
- No remediation required — JWT_SECRET handling is secure

---

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
