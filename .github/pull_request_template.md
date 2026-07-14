<!--
Pull Request template for the Code Review & Merge Pipeline.
Satisfies FR-1.2 (complete PR description) and AC-1. Fill in every section and
tick the checklist before requesting review.
-->

## Summary
<!-- What changed and why, in a few sentences. -->

## Motivation / Context
<!-- Why this change is necessary. Link the driving problem. -->

## Type of change
- [ ] Feature (new behaviour)
- [ ] Fix (repairs a defect)
- [ ] Refactor (no behaviour change)
- [ ] Docs / chore
- [ ] Security / compliance

## Testing steps
<!-- How a reviewer can verify this. See CONTRIBUTING.md for command details. -->
- [ ] Tests pass (`pnpm test` at the root, or the relevant package script)
- [ ] Worker builds cleanly (`pnpm --filter worker build` / `wrangler dev` does not throw)
- [ ] Frontend builds (`cd frontend && npx next build`) when the frontend changed
- [ ] Migration created and run locally if the schema changed
- [ ] Manual smoke check against `localhost:8787` for touched endpoints

## Review readiness (FR-1)
- [ ] Branch is up to date with `main` (rebased or merged, no conflicts)
- [ ] All CI status checks are green
- [ ] No new lint violations (AC-4)
- [ ] Test coverage is >= the `main` baseline (AC-5)
- [ ] Dependency/security scan shows no new high/critical CVEs (AC-6)

## Related issues / tickets
<!-- Link the GitHub issue or the board ticket this PR closes. Required by FR-5.3 / AC-12. -->
- Closes #

## Reviewer checklist (FR-3.2)
- [ ] Logic correctness and edge-case handling
- [ ] Error handling and logging
- [ ] Security implications
- [ ] Performance impact
- [ ] Readability / maintainability
- [ ] Test adequacy and documentation completeness

## Additional notes
<!-- Anything else reviewers should know. -->
