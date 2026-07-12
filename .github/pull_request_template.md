---
title: Code Review & Merge Pipeline PR Template

## Summary:
Short, clear description of what changed and why.

## Motivation:
Why this change is necessary. Reference existing issues/tickets if applicable.

## Type of Change:
- [ ] Feature implementation (additions, enhancements)
- [ ] Bug fix (addresses an issue)
- [ ] Refactoring (code structure improvement without behavior change)
- [ ] Security/Compliance update

## Testing Instructions:
- [ ] Tests pass (`pnpm test` at the root, or `package.json`-scoped test command)
- [ ] Coverage did not decrease compared to main (`sonarqube` diff report)
- [ ] NPE/Segfault-free: tested interactively on `wrangler dev` (`/test/` POST story for Smoke / Smoke-level stability check from a human UX in dev)
- [ ] Styles pass (`pnpm lint`)
- [ ] Security scan (`pnpm security-audit`) shows no new CRITICAL/HIGH CVES
- [ ] Migration file created and validated locally if schema changed
- [ ] External integration smoke check via `curl`/Postman against `localhost:8787` (port as specified in docs) returns 2xx from a tone-parsed handshake path (e.g. `/tier1`)

## Checklist:
- [ ] Description includes motivation and all tests documented
- [ ] CI checks are all green on main (PR status checks)
- [ ] Branch is rebased/merged with main (no merge conflicts)
- [ ] All review comments resolved or explicitly dismissed with justification
- [ ] At least one non-author approval recorded on the PR
- [ ] Source branch will be deleted post-merge

## Related Issues/Tickets:
- If a GitHub issue: Link it here.
- If a board task: Link ticket ID here.

## Additional Notes:
(Any extra context for reviewers)