# Merge Process Checklist

This checklist operationalizes the Code Review & Merge Pipeline PRD (FR-4 & FR-5)
for merging a pull request into `main`. Work top-to-bottom; do not merge until
every applicable box is ticked.

## 1. Merge conditions (FR-4.1)

- [ ] All CI status checks are green (lint, unit tests, integration tests, build, security scan) — AC-3, AC-11.
- [ ] Branch is up to date with `main` (rebased or merged; no conflicts) — AC-2.
- [ ] At least one non-author approval from a code owner is recorded (see `.github/CODEOWNERS`) — AC-7.
- [ ] Every review comment is resolved with a code change **or** dismissed with a written, agreed justification — AC-8.

## 2. Review completeness (FR-3.2)

Reviewer confirms:

- [ ] Logical correctness
- [ ] Edge-case handling (covered by tests and/or a manual smoke check)
- [ ] Error handling and logging
- [ ] Security implications — no new high/critical CVEs (AC-6)
- [ ] Performance impact
- [ ] Readability and maintainability
- [ ] Test adequacy and documentation completeness

## 3. Quality gates

- [ ] No new lint violations (AC-4).
- [ ] Test coverage is greater than or equal to the `main` baseline; a decrease blocks the PR (FR-2.3, AC-5).

## 4. Merge execution (FR-4.2 - FR-4.4)

- [ ] Use the repository's configured merge strategy (squash-and-merge, merge commit, or rebase-and-merge).
- [ ] Merge commit message references the PR number and includes a brief description, e.g. `Merge PR #<num>: <short description>` — AC-9.
- [ ] Delete the source branch immediately after the merge — AC-10.

## 5. Post-merge verification (FR-5)

- [ ] CI pipeline runs on `main` after the merge and passes (FR-5.1, AC-11).
- [ ] If `main` fails post-merge, trigger the rollback/hotfix process and notify the team (FR-5.2; see the operational runbook).
- [ ] Link the merged PR to its originating issue/ticket and mark it closed (FR-5.3, AC-12).

## Out of scope

Deployment to staging/production, emergency merge procedures, and the detailed
rollback runbook are governed separately (see the PRD's "Out of Scope").
