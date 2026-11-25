# REL — Reliability and Release Engineering

**Priority: P0.** Verified releases and recoverable runs. Too much work is committed, partially tested, unreviewed, unpackaged or undeployed; that process changes before autonomous execution expands.

Part of the [strategic roadmap](../../ROADMAP.md). Entry fields are defined in [00-STRATEGY.md](./00-STRATEGY.md#entry-format).


## Mandatory release pipeline

Static analysis and type checking → unit and contract tests → integration tests → security and malware scanning → WebContainer golden-path tests → autonomous execution acceptance → performance regression tests → package and deployment verification → **publish verified release**. Every stage is required. No release is classified as shipped merely because the code exists on `main`.

Stage-to-job mapping, and the stages that have no job yet: [ACCEPTANCE-GATES.md](./ACCEPTANCE-GATES.md).


## Entries

### REL-01 — Capture current benchmarks and test results

```yaml roadmap
id: REL-01
program: reliability-release
priority: P0
status: planned
arc: other
source: PRD-45
dependencies: []
objective: Capture current benchmarks and test results.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### REL-02 — Fix failing frontend unit tests

```yaml roadmap
id: REL-02
program: reliability-release
priority: P0
status: planned
arc: other
source: PRD-45
dependencies:
  - REL-01
objective: Fix failing frontend unit tests.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### REL-03 — Run `qa-e2e` in CI

```yaml roadmap
id: REL-03
program: reliability-release
priority: P0
status: in-progress
arc: other
source: PRD-45
dependencies:
  - REL-01
objective: Run `qa-e2e` in CI.
acceptance:
  - `qa-e2e` is a job in `release.yml` that runs after `deploy-frontend`. It reports Playwright failures (red job, job-summary warning, report artifact) without failing the release.
evidence:
  - `.github/workflows/release.yml` job `qa-e2e`
  - Secrets set 2026-11-25; first green `qa-e2e` run on `main` pending
blocker: null
```

### REL-04 — Eliminate swallowed CI failures

```yaml roadmap
id: REL-04
program: reliability-release
priority: P0
status: done
arc: other
source: PRD-45
dependencies:
  - REL-01
objective: Eliminate swallowed CI failures.
acceptance:
  - No step in `release.yml` or `builderforce-agent.yml` turns a failure into success without a stated reason.
  - `qa-e2e`'s `ci` script exits with Playwright's status after reporting.
evidence:
  - `qa-e2e/package.json` `ci` script
  - Audit comments (`fail-open by design`) at each remaining `|| true` / `continue-on-error`
  - `publish-extension` Open VSX step fails on a missing secret or a failed publish; only an already-published version is a no-op (REL-G003)
blocker: null
```

### REL-05 — Fix Worker bundle size

```yaml roadmap
id: REL-05
program: reliability-release
priority: P0
status: in-progress
arc: other
source: PRD-45
dependencies:
  - REL-01
objective: Fix Worker bundle size.
acceptance:
  - `check-worker-size` passes with the frontend Worker at or under 90% of the limit.
evidence:
  - `frontend/scripts/check-worker-size.mjs` already gates `cf-build`
  - The recorded 10.82 MiB overage is still open, tracked as `REL-G005`
  - 2026-11-25: `frontend/next.config.js` marks the memory packages side-effect free in the server/edge compile so unused WGSL kernels tree-shake out. Not yet measured (`cf-build` needs the Linux CI `cf-build` job); `done` only once it prints Worker size OK
blocker: null
```

### REL-06 — Enforce release dependency ordering

```yaml roadmap
id: REL-06
program: reliability-release
priority: P0
status: planned
arc: other
source: PRD-45
dependencies:
  - REL-04
objective: Enforce release dependency ordering.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### REL-07 — Verify VSIX packaging and publishing

```yaml roadmap
id: REL-07
program: reliability-release
priority: P0
status: planned
arc: other
source: PRD-45
dependencies: []
objective: Verify VSIX packaging and publishing.
acceptance:
  - Meets the program definition of done in this file.
  - Open VSX and Marketplace publishes fail the job on any error except an already-published version.
evidence:
  - CI acceptance results
blocker: null
```

### REL-08 — Database migration dry-run

```yaml roadmap
id: REL-08
program: reliability-release
priority: P0
status: planned
arc: other
source: PRD-45
dependencies: []
objective: Database migration dry-run.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### REL-09 — Cross-platform determinism testing

```yaml roadmap
id: REL-09
program: reliability-release
priority: P0
status: planned
arc: other
source: PRD-45
dependencies: []
objective: Cross-platform determinism testing.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### REL-10 — Branch protection and required checks

```yaml roadmap
id: REL-10
program: reliability-release
priority: P0
status: blocked
arc: other
source: PRD-45
dependencies: []
objective: Branch protection and required checks.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: Operator action: branch protection and required checks are GitHub repository settings.
```

### REL-11 — Runtime contract testing

```yaml roadmap
id: REL-11
program: reliability-release
priority: P0
status: planned
arc: other
source: PRD-45
dependencies:
  - REL-03
objective: Runtime contract testing.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### REL-12 — Network-denied acceptance testing

```yaml roadmap
id: REL-12
program: reliability-release
priority: P0
status: planned
arc: other
source: PRD-45
dependencies:
  - REL-03
objective: Network-denied acceptance testing.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### REL-13 — Restore production source maps

```yaml roadmap
id: REL-13
program: reliability-release
priority: P1
status: planned
arc: other
source: PRD-45
dependencies: []
objective: Restore production source maps.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### REL-14 — Coverage and OpenAPI instrumentation

```yaml roadmap
id: REL-14
program: reliability-release
priority: P1
status: planned
arc: other
source: PRD-45
dependencies: []
objective: Coverage and OpenAPI instrumentation.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### REL-15 — Automated crash and fault injection

```yaml roadmap
id: REL-15
program: reliability-release
priority: P0
status: planned
arc: other
source: PRD-45
dependencies: []
objective: Automated crash and fault injection.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```

### REL-16 — Performance regression gates

```yaml roadmap
id: REL-16
program: reliability-release
priority: P0
status: planned
arc: other
source: PRD-45
dependencies:
  - REL-01
objective: Performance regression gates.
acceptance:
  - Meets the program definition of done in this file.
evidence:
  - CI acceptance results
blocker: null
```
