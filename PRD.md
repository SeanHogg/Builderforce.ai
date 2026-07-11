> **PRD** — drafted by Ada (Sr. Product Mgr) · task #194
> _Each agent that updates this PRD signs its change below._

# PRD: GitHub PR Review Automation Agent

## Problem & Goal

Engineering teams lose significant time manually triacking the status of open pull requests — identifying stalled reviews, failed CI/CD checks, and reverted changes scattered across repositories. Context-switching between GitHub UI, notification emails, and Slack creates review fatigue and allows critical issues to slip through.

**Goal:** Build an automated agent that continuously monitors GitHub pull requests across one or more repositories, surfaces actionable insights about open issues, failed checks, and reverted changes, and delivers a consolidated, prioritized report to the relevant stakeholders.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Engineering Lead / Tech Lead** | Daily snapshot of PR health across the team; blocked PRs flagged immediately |
| **Software Engineer** | Awareness of their own PRs needing attention; visibility into failing checks before review cycles stall |
| **DevOps / Platform Engineer** | Signal on systemic CI failures, flaky checks, and revert patterns that indicate pipeline instability |
| **Engineering Manager** | High-level throughput metrics; early warning on delivery risks |

---

## Scope

### In Scope

- Monitor pull requests in one or more specified GitHub repositories
- Detect and report on:
  - Open PRs with unresolved review comments or requested changes
  - PRs with one or more failed or errored CI/CD checks
  - PRs that revert a previous commit or PR (identified by title convention, label, or diff analysis)
- Produce a structured summary report (console output and/or file artifact)
- Support authentication via GitHub Personal Access Token (PAT) or GitHub App credentials
- Support filtering by repository, branch, author, label, and date range

### Out of Scope

- Auto-merging or auto-closing pull requests
- Creating or modifying pull requests or issues
- Slack / email notification delivery (future phase)
- Support for GitLab, Bitbucket, or other VCS platforms
- UI dashboard or web frontend

---

## Functional Requirements

### FR-1: Repository Configuration
- The agent must accept one or more target repositories in `owner/repo` format via configuration file or CLI argument.
- The agent must support GitHub.com and GitHub Enterprise Server endpoints.

### FR-2: Authentication
- The agent must authenticate using a GitHub PAT supplied via environment variable (`GITHUB_TOKEN`).
- The agent must fail fast with a clear error message if authentication is invalid or token lacks required scopes (`repo`, `read:checks`).

### FR-3: Open Issue Detection
- The agent must retrieve all open PRs in each target repository.
- For each open PR, the agent must identify:
  - PRs with at least one unresolved review comment.
  - PRs with a review status of `CHANGES_REQUESTED`.
  - PRs that have been open beyond a configurable staleness threshold (default: 7 days).
  - PRs with no assigned reviewer.

### FR-4: Failed Check Detection
- The agent must retrieve all check runs and status contexts associated with each open PR's HEAD commit.
- The agent must flag any PR where at least one check run has a conclusion of `failure`, `cancelled`, `timed_out`, or `action_required`.
- The report must include the name of each failing check and a direct URL to the check run log.

### FR-5: Revert Detection
- The agent must identify PRs that are reversions of prior work using the following signals (in priority order):
  1. PR title matches the pattern `Revert "..."` (GitHub's default revert title format).
  2. PR carries a `revert` label.
  3. PR body contains a reference such as `Reverts #<number>` or `This reverts commit <sha>`.
- Revert PRs must be flagged separately in the report with the original PR/commit reference when resolvable.

### FR-6: Report Generation
- The agent must produce a structured Markdown report containing three sections:
  1. **Open Issues** — PRs with unresolved comments, change requests, staleness, or missing reviewers.
  2. **Failed Checks** — PRs with one or more failing CI checks, including check names and log URLs.
  3. **Reverted Changes** — PRs identified as reverts, with link to original reference.
- Each PR entry must include: PR number, title, author, URL, age (days open), and the specific reason(s) it was flagged.
- The report must include a summary count per section and an overall health score (ratio of clean PRs to total open PRs).

### FR-7: Filtering
- The agent must support the following optional filters:
  - `--author` — restrict to PRs authored by a specific GitHub login.
  - `--label` — restrict to PRs carrying a specific label.
  - `--base-branch` — restrict to PRs targeting a specific base branch.
  - `--since` — restrict to PRs updated within the last N days.

### FR-8: Exit Codes
- The agent must exit with code `0` if no issues are found.
- The agent must exit with code `1` if any flagged PRs are found.
- The agent must exit with code `2` on configuration or authentication errors.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given a valid `GITHUB_TOKEN` and a repository with open PRs, the agent produces a Markdown report without errors. |
| AC-2 | A PR with a failing GitHub Actions check appears in the **Failed Checks** section with the correct check name and log URL. |
| AC-3 | A PR titled `Revert "feat: add payments"` appears in the **Reverted Changes** section. |
| AC-4 | A PR with `CHANGES_REQUESTED` review status appears in the **Open Issues** section. |
| AC-5 | A PR open for more than the configured staleness threshold and with no reviewer assigned appears in the **Open Issues** section. |
| AC-6 | A PR that passes all checks, has no unresolved comments, and is not a revert does **not** appear in any flagged section. |
| AC-7 | Running with an invalid token produces a clear error message and exits with code `2`. |
| AC-8 | Filtering by `--author` returns only PRs matching that GitHub login across all flagged sections. |
| AC-9 | The summary section shows correct counts per section and an accurate overall health score. |
| AC-10 | The agent completes execution for a repository with up to 200 open PRs within 60 seconds under normal network conditions. |

---

## Out of Scope

- **Automated remediation** — The agent reports only; it does not comment on, merge, close, or modify any PR.
- **Notification delivery** — Slack, email, PagerDuty, or webhook integrations are deferred to a future phase.
- **Dashboard / UI** — No web interface; output is CLI and file-based only.
- **Non-GitHub platforms** — GitLab, Bitbucket, Azure DevOps, and self-hosted Gitea are not supported.
- **Historical trend analysis** — The agent evaluates current state only; time-series metrics and trend charts are out of scope.
- **Secrets scanning or security audit** — Detection of exposed secrets or vulnerable dependencies in PR diffs is out of scope.
- **Auto-assignment of reviewers** — The agent flags PRs lacking reviewers but does not assign them.