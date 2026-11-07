# One Agent, One Kernel

Status: **Complete — 2026-11-01** (see DONE.md). This file is retained because it is a
read fixture for conformance tests (`packages/agent-run/test/conformance/referenceScenario.test.ts`,
`brain-embedded/src/referenceScenario.test.ts`, `brain-embedded/src/readCoverageServed.test.ts`).

The full PRD content lives in git history (pre-2026-11-01 revisions of this file) and its
shipped state is recorded in DONE.md. Numbers are never reused.

> **Verification re-confirm — 2026-11-07.** Re-checked live: `runLoop`/engine-switch gone,
> `check:one-execution --enforce` PASS (0 importers), conformance oracle 2/2. PRD 35 has no
> gaps; follow-on work (red-`main` oracle drift, local-first G-tasks epic #5747, code-health
> scale) is on the Roadmap, not a PRD 35 regression. See the DONE.md PRD 35 entry.
