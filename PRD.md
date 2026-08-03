> **PRD** — drafted by Ada (Sr. Product Mgr) · task #648
> _Each agent that updates this PRD signs its change below._

# PRD: PR Role Attribution & Stale PM PR Detection

## Problem & Goal
PRs initiated by non-engineering roles (especially PMs drafting spec or placeholder PRDs) often remain open indefinitely without implementation, cluttering the repository and masking true work. Teams lack visibility into which PRs exist solely as documents never picked up for coding.

**Goal:** Expose the role of the PR opener and last updater (PM, engineer, designer, etc.) and provide a mechanism to detect PRs created by PMs that have never been implemented, enabling cleanup or escalation.

## Target Users / ICP Roles
- Engineering managers / tech leads monitoring PR hygiene.
- Product managers tracking their own spec PRs.
- DevOps/platform tooling teams acting on stale PR data.
- Downstream automation agents that react to PR metadata.

## Scope
- **In:** Automated labeling of PRs with opener’s and last-updater’s role based on a configurable user-role mapping. A "stale PM PR" flag (label/status) for PRs opened by a PM with no non-PM commits after a configurable time window. A simple dashboard or query endpoint to list such PRs.
- **Out:** Cross-repo aggregated views, automated PR closure, integration with external project-tracking tools, role inference from activity patterns (only explicit mapping supported), handling of dual-role users (single role per user), organization-wide role defaults beyond the per-repo config.

## Functional Requirements
1. **Role Mapping**  
   - A configuration file (`.github/roles.yml`) at the repository root defines a map of GitHub usernames to a single role (`pm`, `engineer`, `designer`, `qa`, `unknown`).  
   - If no mapping exists for a user, the role defaults to `unknown`. Mapping is loaded and cached, refreshed on config change.

2. **PR Opener Labeling**  
   - On PR creation, add a label `opened-by:<role>` (e.g., `opened-by:pm`).  
   - If the opener’s role is `pm`, also add an `opened-by-pm` label for convenient filtering.

3. **Last Updater Exposure**  
   - On any PR event (commit push, comment, review, status change), determine the actor’s role and update/apply a `last-updated-by:<role>` label (removing any previous `last-updated-by:*` label).  
   - The label reflects the most recent human interaction; bot events are ignored except for the dedicated bot itself (stale detection bot).

4. **Stale PM PR Detection**  
   - A PR is considered a **stale PM PR** if:  
     - It was opened by a user with role `pm`.  
     - There are no commits from users whose role is not `pm` (i.e., only PM-authored commits or zero commits).  
     - The PR has been in this state for more than `N` days (configurable, default = 30).  
   - A background job evaluates all open PRs daily and adds the label `stale-pm-pr` to those meeting the criteria; it removes the label if a non-PM commit is later added or if the PR is closed.

5. **Visibility & Query**  
   - The stale PM PR status is exposed as a PR check (e.g., `stale-pm-status`) with a pass/fail (fail if stale) and details link.  
   - A repository-level dashboard (or a simple endpoint) lists all PRs with the `stale-pm-pr` label, including age and last activity.

6. **Downstream Agent Contract**  
   - The PR object includes `opened_by_role` and `last_updated_by_role` in a machine-readable format (e.g., as part of the PR’s metadata or via API).  
   - Other automation can reliably detect the "PRD written by a PM, never implemented" pattern by checking `opened_by_role == "pm"` and `stale-pm-pr` label presence.

## Acceptance Criteria
- **AC1:** When a user mapped as `pm` opens a PR, the PR automatically receives the labels `opened-by:pm` and `opened-by-pm` within 30 seconds.
- **AC2:** If an `engineer` pushes a commit to that PR, the `last-updated-by:engineer` label is applied (replacing any previous `last-updated-by:*` label). If no prior non-PM commits exist, the `stale-pm-pr` label is removed (once the daily job runs).
- **AC3:** A PR opened by a PM with only PM-authored commits for 30 days (configurable) gets the `stale-pm-pr` label and a failing `stale-pm-status` check.
- **AC4:** The `.github/roles.yml` file is reloaded within 1 minute of a push to the default branch, and new labels reflect updated roles.
- **AC5:** The dashboard/query shows zero stale PM PRs when all such PRs have non-PM commits or are closed; otherwise lists the correct PRs.

## Out of Scope
- Automatic closing or merging of stale PRs.
- Role detection from user behavior; roles must be explicitly declared.
- Inheritance of roles from organization teams or LDAP groups.
- Support for a user having multiple roles (e.g., a PM who also codes) – the mapping assigns exactly one primary role per user.
- Notifications to PR authors or reviewers (only labeling and status provide passive visibility).

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