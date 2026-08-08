> **PRD** — drafted by Ada (Sr. Product Mgr) · task #648
> _Each agent that updates this PRD signs its change below._
>
> **Section Authorship:**
> - Problem & Goal, Scope, Functional Requirements, Acceptance Criteria: Ada (Sr. Product Mgr)
> - **Requirements: Kai (Business Analyst)** — task #648, 2025-07-10

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
- **In:** Automated labeling of PRs with opener's and last-updater's role based on a configurable user-role mapping. A "stale PM PR" flag (label/status) for PRs opened by a PM with no non-PM commits after a configurable time window. A simple dashboard or query endpoint to list such PRs.
- **Out:** Cross-repo aggregated views, automated PR closure, integration with external project-tracking tools, role inference from activity patterns (only explicit mapping supported), handling of dual-role users (single role per user), organization-wide role defaults beyond the per-repo config.

## Functional Requirements
1. **Role Mapping**
   - A configuration file (`.github/roles.yml`) at the repository root defines a map of GitHub usernames to a single role (`pm`, `engineer`, `designer`, `qa`, `unknown`).
   - If no mapping exists for a user, the role defaults to `unknown`. Mapping is loaded and cached, refreshed on config change.

2. **PR Opener Labeling**
   - On PR creation, add a label `opened-by:<role>` (e.g., `opened-by:pm`).
   - If the opener's role is `pm`, also add an `opened-by-pm` label for convenient filtering.

3. **Last Updater Exposure**
   - On any PR event (commit push, comment, review, status change), determine the actor's role and update/apply a `last-updated-by:<role>` label (removing any previous `last-updated-by:*` label).
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
   - The PR object includes `opened_by_role` and `last_updated_by_role` in a machine-readable format (e.g., as part of the PR's metadata or via API).
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

_Owned by the business-analyst — authored below._

---

### RQ1 — Roles Configuration File

**RQ1.1 — Schema.** The repository SHALL contain a file `.github/roles.yml` at its root with the following structure:

```yaml
# .github/roles.yml — User-to-role mapping for PR role attribution.
# One role per user. Users not listed default to "unknown".
#
# Valid roles: pm, engineer, designer, qa, unknown
#
# This file is reloaded on push to the default branch (see RQ1.3).

roles:
  alice: pm
  bob:   engineer
  carol: designer
  dave:  qa
  eve:   pm

# Number of days after which a PM-opened PR with no non-PM commits
# is considered "stale" (default: 30).
stale_days: 30
```

**RQ1.2 — Validation.** The config file SHALL be validated on load:
- `roles` MUST be present and be a mapping of GitHub username strings to one of the five allowed role values (`pm`, `engineer`, `designer`, `qa`, `unknown`).
- Duplicate usernames SHALL be rejected (the YAML parser handles this natively — last key wins — but the system SHALL emit a warning on detection of duplicate keys if the parser surfaces them).
- `stale_days` MUST be a positive integer; values below 1 SHALL be clamped to 1; values above 365 SHALL be clamped to 365. If absent, the default of 30 SHALL apply.

**RQ1.3 — Reload.** The roles configuration SHALL be reloaded:
- On any push to the repository's default branch that modifies `.github/roles.yml`.
- The reload SHALL complete within 60 seconds of the push event (satisfying AC4).
- A reload failure (e.g., invalid YAML) SHALL log the error and retain the last known-good in-memory mapping; no PR actions are blocked by a bad config.

**RQ1.4 — Cache.** The mapping SHALL be cached in memory for the lifetime of each workflow/action run. Between runs (separate GitHub Actions invocations), the mapping SHALL be re-read from the file on the checked-out ref.

---

### RQ2 — PR Opener Role Labeling

**RQ2.1 — Trigger.** On the `pull_request` event with `action: opened` (and, for robustness, `action: reopened`), the workflow SHALL:
1. Read the PR opener's GitHub username from the event payload (`github.event.pull_request.user.login`).
2. Look up the username in the roles configuration (RQ1). Users not found SHALL be treated as role `unknown`.
3. Apply the label `opened-by:<role>` to the PR via the GitHub REST API or `actions/github-script`.
4. If the role is `pm`, additionally apply the label `opened-by-pm`.

**RQ2.2 — Label Pre-existence.** Before applying labels, the workflow SHALL check whether `opened-by:<role>` already exists on the PR. If so, it SHALL NOT re-apply it (idempotency). This prevents double-labeling on `reopened` events where the label was already applied on the initial `opened`.

**RQ2.3 — Label Availability.** The six role-specific labels (`opened-by:pm`, `opened-by:engineer`, `opened-by:designer`, `opened-by:qa`, `opened-by:unknown`) plus `opened-by-pm` SHALL be pre-created in the repository's label set. If a label does not exist, the workflow SHALL create it on demand via the GitHub API (labels created on-demand have no description or color; the architect MAY instead recommend static label definitions in a repo settings file).

**RQ2.4 — Bot and Automated PRs.** PRs opened by GitHub Actions bots (usernames ending in `[bot]`, e.g. `dependabot[bot]`, `github-actions[bot]`) SHALL receive the label `opened-by:bot` regardless of whether the bot username appears in `.github/roles.yml`. Bot-opened PRs SHALL NOT receive `opened-by-pm` and are excluded from stale PM PR detection.

---

### RQ3 — Last Updater Role Labeling

**RQ3.1 — Trigger Events.** On the following `pull_request` event action types, the workflow SHALL determine the actor who triggered the event and update the `last-updated-by:<role>` label:
- `synchronize` (new commits pushed to the PR branch)
- `edited` (PR title or body edited)
- `review_requested` / `review_request_removed`
- `labeled` / `unlabeled`
- `assigned` / `unassigned`
- `ready_for_review` / `converted_to_draft`
- `locked` / `unlocked`
- `reopened`

Additionally, on `issue_comment` events for pull requests (comment created/edited) and `pull_request_review` events (review submitted/edited/dismissed), the same logic SHALL apply.

**RQ3.2 — Bot Filtering.** The workflow SHALL ignore events triggered by GitHub Actions bots (usernames ending in `[bot]`), except for the stale-detection bot itself. This prevents the `last-updated-by` label from oscillating to `bot` on every automated workflow run.

**RQ3.3 — Label Rotation.** Before applying the new `last-updated-by:<role>` label, the workflow SHALL:
1. Query the PR's current labels.
2. Remove any existing label matching the pattern `last-updated-by:*`.
3. Add the new `last-updated-by:<role>` label.

**RQ3.4 — Role Resolution.** The actor's role SHALL be resolved from `.github/roles.yml` using the same lookup as RQ2.1. If the actor is not mapped, the role SHALL be `unknown`, and the label SHALL be `last-updated-by:unknown`.

**RQ3.5 — Concurrency.** If multiple events fire in rapid succession (e.g., a push followed immediately by a review), the last writer wins. The system SHALL NOT attempt to serialize or order events beyond what GitHub's own event delivery guarantees.

---

### RQ4 — Stale PM PR Detection

**RQ4.1 — Definition.** A PR SHALL be classified as a "stale PM PR" when ALL of the following are true:
1. The PR is open (state = `open`).
2. The PR was opened by a user whose resolved role is `pm` (per RQ2).
3. No commit on the PR branch is authored by a user whose resolved role is NOT `pm`. Commits authored by bots (username ending in `[bot]`) SHALL be excluded from this check entirely — they neither count as PM nor non-PM commits.
4. The PR creation date (or, if reopened, the most recent `reopened` date) is strictly older than `stale_days` days ago, using the configured value from `.github/roles.yml` (default 30).

**RQ4.2 — Detection Job.** A GitHub Actions workflow SHALL run on a schedule (`schedule:` cron, once daily, e.g. `0 6 * * 1-5` for weekday mornings UTC) and SHALL:
1. Enumerate all open PRs in the repository.
2. For each PR opened by a PM (`opened-by-pm` label present), fetch the list of commits on the PR branch.
3. For each commit, resolve the author's GitHub username and look up their role. If ANY commit author has a role other than `pm` or `bot`, the PR is NOT stale.
4. If the PR has zero non-PM, non-bot commits AND the PR is older than `stale_days`, apply the `stale-pm-pr` label.
5. For PRs that ALREADY have the `stale-pm-pr` label but no longer meet the criteria (a non-PM commit was added, or the PR was closed), remove the `stale-pm-pr` label.

**RQ4.3 — Manual Trigger.** In addition to the schedule, the stale detection job SHALL be triggerable manually via `workflow_dispatch` so that teams can force a re-evaluation without waiting for the daily cron.

**RQ4.4 — API Rate Limits.** The daily job SHALL respect GitHub API rate limits. For repositories with >100 open PRs, the job SHALL paginate through results and MAY include a short delay between pages. The job SHALL use a repository-scoped `GITHUB_TOKEN` with `pull-requests: read` and `issues: write` (for label management) permissions.

---

### RQ5 — PR Check (stale-pm-status)

**RQ5.1 — Check Runs.** For every open PR, a GitHub Check Run named `stale-pm-status` SHALL be created or updated by the stale detection workflow (RQ4). The check SHALL have:
- **Conclusion `failure`** if the PR has the `stale-pm-pr` label.
- **Conclusion `success`** if the PR does not have the `stale-pm-pr` label.
- **Output** containing the detected role of the opener, the last-updater role, the count of non-PM commits (if any), and a link to the dashboard/query endpoint (RQ6).

**RQ5.2 — Check Update.** The check run SHALL be updated on every stale detection run, not just on PR creation. This ensures the check reflects the current state even if a previously non-stale PR became stale (e.g., the `stale_days` threshold was crossed since the last run).

**RQ5.3 — Re-run.** The check SHALL re-run when the stale detection workflow is manually triggered (RQ4.3).

---

### RQ6 — Dashboard / Query Endpoint

**RQ6.1 — Query.** A script or endpoint SHALL exist that lists all open PRs with the `stale-pm-pr` label. The output SHALL include for each PR:
- PR number and title
- PR URL
- Opener's GitHub username
- PR age in days (since creation or most recent reopen)
- Days since last human activity (latest non-bot event: commit, comment, review)
- Link to the PR

**RQ6.2 — Format.** The query SHALL support at minimum:
- **Human-readable output:** a markdown table written to the workflow summary (`$GITHUB_STEP_SUMMARY`).
- **Machine-readable output:** a JSON array written to a file or stdout, suitable for consumption by downstream automation.

**RQ6.3 — Zero-State.** When there are zero stale PM PRs, the output SHALL explicitly state "No stale PM PRs found" (markdown) or return an empty JSON array `[]` (machine), rather than producing no output at all. This satisfies AC5.

**RQ6.4 — Invocation.** The query SHALL be runnable:
- As part of the daily stale detection workflow (RQ4), producing a summary.
- As a standalone `workflow_dispatch`-triggered workflow, so a team member can run it ad-hoc without waiting for the daily cron.
- Via a simple `gh` CLI one-liner documented in the repository README or CONTRIBUTING guide, e.g.:
  ```
  gh pr list --label stale-pm-pr --json number,title,url,createdAt,updatedAt
  ```

---

### RQ7 — Downstream Machine-Readable Contract

**RQ7.1 — PR Metadata.** For every PR, the following machine-readable fields SHALL be derivable from its labels:

| Field                  | Source Label Pattern      | Example Value   |
|------------------------|---------------------------|-----------------|
| `opened_by_role`       | `opened-by:<role>`        | `pm`            |
| `last_updated_by_role` | `last-updated-by:<role>`  | `engineer`      |
| `is_stale_pm_pr`       | `stale-pm-pr` presence    | `true` / `false`|

**RQ7.2 — Detection Contract.** A downstream automation agent SHALL be able to detect the "PRD written by a PM, never implemented" pattern by checking:
```
is_stale_pm_pr == true
  AND opened_by_role == "pm"
  AND last_updated_by_role IN ("pm", "unknown")
```
This contract SHALL remain stable across implementation changes — the label names are the API.

**RQ7.3 — GraphQL.** The fields SHALL be queryable via the GitHub GraphQL API by reading the PR's `labels.nodes[].name` and pattern-matching the label strings described in RQ7.1. No custom API or database is required; GitHub labels are the data store.

---

### RQ8 — Error Handling & Edge Cases

**RQ8.1 — Missing Config.** If `.github/roles.yml` does not exist in the repository, ALL users SHALL resolve to role `unknown`. The system SHALL NOT fail or refuse to run. A warning SHALL be emitted in the workflow log: "`.github/roles.yml` not found — all users default to 'unknown'."

**RQ8.2 — Invalid Config.** If `.github/roles.yml` exists but is invalid YAML or fails schema validation (RQ1.2), the system SHALL retain the last known-good cached mapping. If no cached mapping exists (first run), ALL users SHALL resolve to `unknown`. The error SHALL be logged with enough detail to fix the file (line number, expected vs actual).

**RQ8.3 — Empty PR (No Commits).** A PR opened by a PM with zero commits on the branch (e.g., a PR created immediately after branch creation, before any push) SHALL be treated as having zero non-PM commits. It SHALL become `stale-pm-pr` once the `stale_days` threshold is exceeded.

**RQ8.4 — Reopened PR.** If a PM-opened PR is closed and later reopened, the stale clock SHALL reset to the reopen date for the purpose of RQ4.1 criterion #4. The `opened-by-pm` label SHALL remain (it was applied at original creation — RQ2.1). The stale detection job SHALL NOT re-label a PR that was explicitly un-labeled `stale-pm-pr` by a human unless the criteria are independently satisfied again.

**RQ8.5 — PR Author Not a GitHub User.** If the PR opener's GitHub username cannot be resolved (deleted account, ghost user, etc.), the role SHALL default to `unknown`. The PR SHALL NOT receive `opened-by-pm` and SHALL NOT be eligible for stale PM PR detection.

**RQ8.6 — Label Manipulation.** If a user manually removes the `opened-by-pm` or `opened-by:<role>` labels, the system SHALL NOT re-apply them. The stale detection job SHALL NOT add `stale-pm-pr` to PRs that lack `opened-by-pm`. If a human manually applies `stale-pm-pr`, the next daily run SHALL remove it if the criteria are not met (corrective action). If a human removes `stale-pm-pr`, the next daily run SHALL re-apply it only if the criteria are still satisfied.

**RQ8.7 — Large Repositories.** The stale detection job SHALL handle repositories with up to 500 open PRs without timing out. For repositories exceeding this, the job SHALL process in batches and MAY emit a warning if it cannot complete within GitHub Actions' 6-hour job timeout.

**RQ8.8 — Workflow Permissions.** All workflows SHALL declare minimum required permissions:
```yaml
permissions:
  contents: read       # to read .github/roles.yml and commit data
  pull-requests: write # to add/remove labels
  checks: write        # to create/update check runs
  issues: read         # to list PR labels (GitHub treats PRs as issues for labels)
```

---

### RQ9 — Non-Functional Requirements

**RQ9.1 — Latency.** The PR opener labeling workflow (RQ2) SHALL complete within 30 seconds of the `pull_request` `opened` event (AC1). The last-updater labeling workflow (RQ3) SHALL complete within 30 seconds of the triggering event.

**RQ9.2 — Reliability.** The stale detection job (RQ4) SHALL achieve >99% success rate across scheduled runs. Transient GitHub API failures (5xx responses) SHALL be retried up to 3 times with exponential backoff (1s, 2s, 4s) before the run is marked as failed.

**RQ9.3 — Idempotency.** All labeling operations SHALL be idempotent: applying a label that already exists SHALL be a no-op (not an error). The stale detection job SHALL produce the same label state regardless of how many times it runs consecutively with no intervening PR activity.

**RQ9.4 — Audit Trail.** Every label addition or removal SHALL be visible in the PR's timeline (GitHub's native behavior). No separate audit log is required. The workflow run logs SHALL include the role resolution for every actor evaluated, enabling debugging of incorrect role assignments.

**RQ9.5 — Config Change Propagation.** A change to `.github/roles.yml` merged to the default branch SHALL take effect for:
- New PR events: within 60 seconds (AC4), because the next workflow run checks out the latest commit.
- The next daily stale detection run: at the scheduled time or on manual trigger.
- Ad-hoc queries: immediately on the next invocation.

---

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
