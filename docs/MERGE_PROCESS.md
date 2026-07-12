# Merge Process Checklist

This checklist enforces the Code Review & Merge Pipeline (FR-4 & FR-5) before merging into `main`.

## Pre-Merge (PR #<num>)

- [ ] **FR-4.1 — Merge conditions**
  - All CI status checks are green (lint, unit tests, integration tests, build, security scan).
  - Branch is up-to-date with `main` (no merge conflicts; if conflicts, rebase or update base).
  - At least one non-author approval exists in PR history (AC-7).
  - All review comments are resolved (checkbox) or dismissed with an agreed justification (AC-8).

- [ ] **FR-3.2 — Review completeness checklist**
  Reviewer verifies:
  - [ ] Logical correctness
  - [ ] Edge cases — full test harness coverage + manual smoke interaction
  - [ ] Error handling & logging (review logs on failure)
  - [ ] Security implications (no new CRITICAL/HIGH CVEs per AC-6)
  - [ ] Performance impact; benchmarks or observed slowdown if significant
  - [ ] Readability and maintainability
  - [ ] Test adequacy (unit, integration, edge cases) and documentation completeness

- [ ] **FR-2.2 — Linting** — No new violations introduced (AC-4). Verify via CI lint report or `pnpm lint`.

- [ ] **FR-2.3 — Coverage** — Test coverage is greater than or equal to `main` baseline (No regression). Verify via coverage diff (e.g., `sonarqube` diff report).

## On Merge

- [ ] **FR-4.2 — Merge strategy**
  - Confirm merge strategy as configured in repository settings (squash-and-merge, merge commit, or rebase-and-merge).
  - In GitHub, select "Squash and merge" unless strategy is otherwise defined.

- [ ] **FR-4.3 — Merge commit message**
  - MUST reference PR number: `Merge PR #<num>: <short description>`
  - Include concise description (same as summary in PR description).

- [ ] **FR-4.4 — Source branch cleanup**
  - Source branch is deleted immediately after successful merge.
  - Verified on repository branch list.

## Post-Merge Verification

- [ ] **FR-5.1 — CI on main**
  - CI pipeline runs against `main` after merge.
  - All checks pass (no tail-end regressions).

- [ ] **FR-5.2 — Rollback plan**
  - If `main` fails post-merge, an immediate hotfix/shoot-to-kill process is initiated (reference operational runbook).

- [ ] **FR-5.3 — Link/Close**
  - Originating issue/ticket is linked to PR in GitHub/Board.
  - Ticket is marked as closed.

- [ ] **FR-5.4 — Documentation & communication**
  - UT:
    - This PR title and description are reflected in the `main` CHANGELOG entry (generated at release prep).
    - The merge commit (pattern: Merge PR #<num>: <title>) is spooled within `logs/releases/YYYY.M.D.md`.
  - Post-merge:
    - Author notifies board maintainers (e.g., via Slack/Board comment mentioning the branch is merged).

## Audit Tracking

- Final "Merge executed" confirmation entry added to `logs/audit/pr-closed-#<num>.md` to complete the lifecycle (adds to SOC2 change-management adherence).