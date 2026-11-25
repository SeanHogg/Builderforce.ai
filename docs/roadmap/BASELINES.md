# Baselines

Every figure below is **historical** unless a "Re-measured" date is filled in. None has been re-measured for this roadmap, and none should be quoted as current. REL-01 and AE-01 exist to replace them.

Autonomous completion is measured against a fixed, representative workload, and failed runs are never excluded retrospectively.

| Metric | Historical value | As of | Source | Reproduce | Re-measured |
|---|---|---|---|---|---|
| Fully autonomous ticket completion | 0.78% (6 of 767 tickets) | 2026-07-26 | Previous `ROADMAP.md` | `node api/scripts/measure-autonomy-baseline.mjs --days 30` | — |
| Run failure rate | 69% across 6,195 runs | 2026-07-26 | Previous `ROADMAP.md` | Not yet scripted: same query, failed share of all runs (`AE-01`) | — |
| Autonomous trigger success / error states | 282 `auto_run_error` in 30 days (historical) | 2026-10-25 | Previous `ROADMAP.md` | `node api/scripts/measure-autonomy-baseline.mjs --days 30` (error states are deduplicated per ticket, lane and message, so the success rate is an upper bound) | — |
| Frontend Worker bundle | 10.82 MiB vs 10.00 MiB limit (108.2%) | Release 42525421978 | `GAP-REGISTER.md` `REL-G005` | `cd frontend && pnpm run cf-build` (ends with `scripts/check-worker-size.mjs`) | — |
| Frontend unit tests | 19 failing in 12 files | Previous roadmap | `GAP-REGISTER.md` `REL-G006` | `cd frontend && pnpm exec vitest run` | — |
| Traffic: VS Code runs / Web calls / cloud tickets | 452 / about 230 / 4 in 30 days | 2026-10-25 | Previous `ROADMAP.md` | Production telemetry | — |

## Metrics with no baseline yet

Crash recovery success, verified completion evidence, prompt tokens per equivalent task, cost per successful task, local-AI-eligible task share, critical security fixture pass rate, cross-tenant isolation violations, release gate compliance. Each is "Re-baseline" in the targets table of [ROADMAP.md](../../ROADMAP.md); the baseline phase must record the hardware, workload, concurrency, cache and infrastructure conditions alongside the value.

## Capturing a baseline

A baseline row needs a dated value, its source, the command that reproduces it, and the commit it was taken at. Replace the "Re-measured" cell with the date and commit when it is filled in; do not overwrite the historical value.
