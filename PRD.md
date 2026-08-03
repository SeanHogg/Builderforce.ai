> **PRD** — drafted by Ada (Sr. Product Mgr) · task #585
> _Each agent that updates this PRD signs its change below._

# Secrets Remediation Tracker

## Problem & Goal
Security scanning tools detect exposed secrets (API keys, tokens, passwords) in code repositories and logs. However, teams lack a systematic way to track remediation of these findings. Open secrets issues pile up without clear ownership, follow-up notes, or confirmation that the secret has been rotated/revoked. The risk of an unaddressed active secret remains high.

**Goal:** Provide a dedicated workspace where security and engineering teams can triage, annotate, and close the loop on every detected secret, turning raw findings into tracked, accountable remediation actions.

## Target users / ICP roles
- **Security Engineers** responsible for triaging and ensuring secrets are remediated.
- **Developers / DevOps Engineers** who own the affected code/infrastructure and must rotate secrets and remove them from exposed locations.
- **Site Reliability Engineers (SRE)** who need visibility into lingering secrets affecting production systems.

## Scope
This PRD covers the initial release of a **Secrets Remediation Tracker** integrated into the existing security scanning platform. The tracker will:

- Display a unified list of all secrets issues flagged by the scanner for which remediation has not been confirmed.
- Allow users to annotate issues with remediation notes.
- Support status transitions (open → in progress → remediated, plus false positive/ignored).
- Enable assignment of an owner to each issue.
- Offer basic filtering and sorting to help prioritize high-risk items.
- Include an activity/audit log per issue.

## Functional requirements
1. **Open Issues Dashboard**
   - List all secrets issues that are not in a terminal closed state (remediated, false positive, ignored).
   - Columns: secret type (e.g., AWS key, private key), location (repo/file/line), detection date, owner, status, severity, and latest note snippet.
   - Filters: status, severity (critical/high/medium/low), secret type, owner, date range, repository.
   - Sort by detection date, severity, or status.
   - Paginated view (50 items per page).

2. **Issue Detail Page**
   - Full details: secret type, hash/fingerprint of the secret (masked), exact location, detected on date, scanner version, severity justification.
   - **Remediation Notes** section: threaded comment-like notes with timestamp and author. Each note can include text and optional file attachments (screenshots, confirmation emails).
   - **Status** selector: `Open` (default), `In Progress`, `Remediated`, `False Positive`, `Ignored` (with required reason for ignored/false positive).
   - **Owner** assignment: user search field to set a single responsible user (from integrated identity provider).
   - **Due Date** (optional): date picker for when remediation should be completed.
   - Activity log: chronological list of status changes, owner changes, note additions, and due date modifications.

3. **Notifications**
   - In-app notification to assigned owner when an issue is assigned or due date approaches (24h before). Email notification if user has email configured.
   - Weekly digest for security leads listing overdue open issues.

4. **Bulk Actions**
   - Multi-select to assign an owner, change status, or set due date across multiple issues.

5. **Export**
   - Export filtered issue list as CSV.

## Acceptance criteria
1. A user navigates to the **Secrets Remediation** tab and sees a list of all open and in-progress secrets issues from the last 90 days (configurable).
2. Clicking an issue displays the detail view with all metadata, existing notes, and an activity log.
3. The user can add a remediation note, and it appears in the thread instantly with their name and timestamp.
4. Changing the status to `Remediated` prompts an optional confirmation note; the issue is removed from the default open-issues list but remains visible in an “all issues” view.
5. Setting a due date and assigning an owner triggers an email to that owner 24 hours before the deadline if the issue is still not `Remediated`.
6. Bulk assigning 5 issues to a single owner succeeds, and the activity log for each reflects the change.
7. The dashboard filters correctly; selecting `severity: critical` shows only critical issues.
8. Export generates a CSV with all filtered columns without secrets values (only hashes).

## Out of scope
- Automated rotation or revocation of secrets (human or external system responsibility).
- Secret scanning itself—this feature consumes already-detected findings.
- Full-fledged incident management integration (paging, on-call schedules).
- Customizable workflows or approval chains for status transitions.
- AI-powered remediation suggestions.
- Audit trail export formats beyond CSV.
- Support for issues from external secret scanners not ingested into this platform (only native scanner findings).

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._