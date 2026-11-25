# Acceptance gates

The mandatory release pipeline from [05-RELIABILITY-RELEASE.md](./05-RELIABILITY-RELEASE.md) set against the jobs in `.github/workflows/release.yml` today. The mapping is by job name and the steps read while writing this file; job contents were not audited end to end.

| # | Stage | Job today | State |
|---|---|---|---|
| 1 | Static analysis and type checking | `verify-frontend` (type-check, lint), `verify-api`, `verify-kernel`, `verify-extension`, per-package jobs in `package-npm` | Present. No CodeQL workflow (`REL-G002`) |
| 2 | Unit and contract tests | `verify-api`, `verify-run-oracles`, `verify-frontend` (guards, oracles, marketing claims), including `check:roadmap-entries` | Partial: frontend unit tests are not run (`REL-G006`) |
| 3 | Integration tests | None identified | **Missing** |
| 4 | Security and malware scanning | None identified | **Missing** (`SEC-05`, `SEC-06`) |
| 5 | WebContainer golden-path tests | None | **Missing** (`WC-01`, `REL-11`) |
| 6 | Autonomous execution acceptance | None | **Missing** (`AE-06`) |
| 7 | Performance regression tests | `scripts/check-worker-size.mjs` inside `cf-build` (bundle size only) | Partial (`REL-16`) |
| 8 | Package and deployment verification | `package-npm`, `package-extension`, `verify-distribution`, MCP registry probe | Partial: no Worker `--dry-run` (`REL-G007`), migration dry-run absent (`REL-08`) |
| 9 | Publish verified release | `deploy-api`, `deploy-frontend`, `publish-*`, then `qa-e2e` | Present. `qa-e2e` added for `REL-03`; a red commit can still reach the CDN (`REL-G008`) |

## Fail-closed audit (REL-04)

Every `continue-on-error` and `|| true` in `release.yml` and `builderforce-agent.yml` either fails closed or says why it does not:

| Where | Disposition |
|---|---|
| `release.yml` LICENSE copy for the Marketplace mirror | Fail-open, reason stated: mirror ships without the file |
| `release.yml` MCP registry probe (`curl … \|\| true`) | Status code is kept and gated by the checks after the loop; reason stated |
| `release.yml` diagnostic `head` / `cat … \|\| true` | Diagnostics only; reason stated |
| `release.yml` `Ensure UPLOADS lifecycle rules` (`continue-on-error`) | Pre-existing stated reason: a loud warning and job-summary line, and a missing rule only keeps blobs longer |
| `builderforce-agent.yml` cleanup step | Best-effort teardown under `if: always()`; reason stated |
| `qa-e2e/package.json` `ci` | **Fixed**: exits with Playwright's status after reporting |

Still open: the VS Code publish step's `|| echo` (`REL-G003`) swallows every publish failure, and it is blocked on the `VSCE_PAT` / `OVSX_PAT` tokens.
