| G3 | CLOSED | `insideClone` in `container/sandboxCore.mjs` is realpath-based and follows dangling symlinks by hand (hop-limited); the `list` op and job `cwd` use it; `.git` is unreachable; reads re-check the resolved path; writes re-check it and open the final component with `O_NOFOLLOW`; `mkdir`/`rm` failures return `{ok:false}`. The model's shell (foreground and background) runs with a scrubbed environment (`shellEnv`: no `BUILDERFORCE_*`, no Actions OIDC/runtime tokens), and the Actions checkout does not persist its token (`persist-credentials: false`). Tests: `containerSandboxFsGuard.test.ts` (`../`, absolute, symlink, dangling and looping links, symlinked parent and job cwd, `.git`, `..\`, URL-encoded, env scrub). This guard is defence in depth UNDER E2: the shell is unrestricted inside the container, so it only constrains the structured fs/cwd ops. Accepted residuals: a TOCTOU between the check and the open, and hard links to files outside the clone; both sit under the E2 boundary. |
| G2 | PARTIAL | Done: ONE redactor (`packages/secret-redaction`, shared by api and agent-runtime); ONE write path for `tool_audit_events` (`insertToolAudit`, `application/audit/toolAuditWrite.ts`, redacting args/result structurally before the insert) enforced by `check:tool-audit-writes`; redaction BEFORE truncation (`resultCap`, `redactThenCap`); the live stream is scrubbed at the one publish primitive (`notifyExecutionSubscribers`); `executions.result` / `error_message` are scrubbed where `ExecutionRepository` writes them; `llm_traces`, the eval case store and `caughtErrorReporter` (record, log lines and Quality sink get a redacted clone) use `redactDeep`. Tests: `redactSecrets.test.ts`, `toolAuditWrite.test.ts`, `cloudToolEvents.redaction.test.ts`, `hostTelemetryIngest.redaction.test.ts`, `executionEvents.redaction.test.ts`, `caughtErrorReporter.test.ts`. Remaining: the reaper's rows (`staleExecutionReaper.ts`, and `recordRunFailureEvent.ts` which is covered only by a local wrapper) are built by `runFailureEventRow` and must be redacted there; both are the guard's two listed exceptions until then. G2 closes when `runFailureEventRow` redacts and the exceptions are deleted. |
# 09 — PRD: Cloud Agent Validation & Hardening

**Status: Planned (P0 — validation gate).** Re-audited 2026-11-08 against the one-engine architecture
(DONE.md 2026-10-24). This document holds only the work that is still open; closed and superseded
gaps are listed once in §7 with their evidence and move to DONE.md.

This PRD exists so the operator can **validate the cloud agents** end-to-end before they are sold as a
first-class runtime alongside self-hosted agent hosts. It (1) states the architecture being validated,
(2) records the operator decisions that bound the remaining gaps, and (3) lists each remaining gap as a
falsifiable check.

**Personas:** Tenant operator (runs a cloud agent against a ticket, watches it work, steers it); the
platform SRE (verifies isolation, billing attribution, observability); the buyer evaluating "do cloud
agents actually deliver a merged PR without a self-hosted host online?"

---

## 1. Scope

### In scope
- A **validation matrix** (§3) across the task lifecycle (dispatch → clone → work → steer → cancel → finalize/PR → teardown) on the ONE cloud engine.
- The open **gaps** (§4), each with the file that owns the behaviour and an acceptance check.
- A **golden-path E2E** (§5) the operator can run repeatedly to self-validate.

### Out of scope
- Multi-repo / monorepo-aware cloud workspaces (single repo per ticket for now).
- Governance gating of cloud runs — owned by doc 08; cloud runs consume its findings, not re-implement.

---

## 2. Architecture being validated

There is ONE cloud engine. Every cloud run, on every plan, takes the same path:

1. **Dispatch** (`runtimeRoutes.ts` → `dispatchCloudRun.ts`) records the execution and hands it to `CloudRunnerDO`.
2. **`CloudRunnerDO` ticks every run.** It drives the agent loop (`runAgentLoop` via `cloudAgentEngine`), one bounded tick at a time, so the run survives Worker restarts. Between turns `applyPendingSteering` drains steers and `startCancelWatcher` honours cancel (`cloudLoopControl.ts`).
3. **The container is a sandbox.** Per-execution, non-root, with an egress allowlist. It executes tools (shell, filesystem, background jobs) and reports events back through `/internal/container-op`. It has no loop and no model access of its own.
4. **Credentials stay in the Worker.** Provider keys (BYO and platform), git-provider tokens and the LLM call itself never enter the container; the Worker performs authenticated git and provider calls on the sandbox's behalf.
5. **Finalize** (`cloudFinalize.ts`) commits, pushes and opens or updates the PR through the Worker's git provider; the run's telemetry lands in `tool_audit_events`, `usage_snapshots` and `llm_usage_log`, all keyed by `execution_id` (§2.1).

The legacy V1 relay runner, V2 Claude Agent SDK runner, the Worker "fallback" loop and the
host-queue handoff no longer exist as cloud paths. Self-hosted agent hosts are a separate runtime that
is not validated here.

### 2.1 Session-key contract: `exec:<executionId>`

`tool_audit_events.session_key` is `exec:<executionId>` for every row belonging to an execution; a
task-scoped event with no live execution passes its own key (`task:<taskId>`). The default is applied in
ONE place, `recordCloudToolEvent` (`cloudToolEvents.ts`). The key is read or written by:

- `cloudRunUsage.ts` — joins usage rows to the run.
- `cloudOutcomeRow.ts` — the run's outcome row.
- `cloudRunnerStub.ts` — the DO stub's event correlation.
- `ingestRepoCiEvent.ts` — attaches repo CI events to the run that pushed the commit.

Never build the string by hand elsewhere; add a caller to the list above if it must join on it.

### 2.2 Operator decisions (2026-11-08)

| Id | Decision |
|----|----------|
| E3 | **No step cap on cloud runs.** A runaway is bounded by the kernel failure-streak breaker, the stall ladder and the per-run spend cap, not an iteration count. |
| S7 | **A steer to a terminal run starts a follow-up run** (`followUpRun.ts`) instead of returning `409 execution_not_live`. |
| E2 | **The per-execution non-root container plus the egress allowlist is the command boundary.** There is no command allowlist. The `/sandbox/fs` path guard (G3) is defence in depth UNDER this boundary, not a replacement: the shell is unrestricted inside the container, so the guard only constrains the structured fs/cwd ops. |
| D4 | **A run with no bound repository is legitimate** (research and docs deliverables). It ends with `pr_skipped: no_repository`; there is no `needs_host` status. |
| W9 | **Full clone stays** (agents need history). A repo-size ceiling with a clear error is required (GAP-W9). |
| O7 | **`exec:<id>` is the documented session-key contract** (§2.1). |

---

## 3. Validation matrix

Each cell must produce a green run AND a reconstructable telemetry trail.

| Lifecycle stage | Cloud engine |
|-----------------|:---:|
| Dispatch | ☐ |
| Clone + branch | ☐ |
| Produce file changes | ☐ |
| Live steering mid-run | ☐ |
| Cancellation | ☐ |
| Finalize → push → PR (or `pr_skipped: no_repository`) | ☐ |
| Teardown | ☐ |
| Telemetry reconstructable | ☐ |

---

## 4. Open gaps

Severity: **P0** = blocks GA / data-integrity, **P1** = must-fix before broad rollout, **P2** = hardening.

### A. Dispatch & routing
1. **GAP-D2 (P0)** — The dispatch → `CloudRunnerDO` handoff has no assertion for a drop between "recorded" and "first tick" (the run could sit unclaimed). *Acceptance:* a start-timeout plus a test for the dropped-handoff race.
2. **GAP-D5 (P1)** — `tasks.assignedAgentRef` is not surfaced on the task card, so a buyer cannot see which cloud agent ran. *Acceptance:* render agent attribution on the task card.
3. **GAP-D6 (P2)** — No idempotency key on `POST /executions`; a double-click can spawn two concurrent runs on one ticket branch. *Acceptance:* idempotency key plus dedupe within an in-flight window.
4. **GAP-D8 (P2)** — No per-tenant cap on simultaneous cloud executions. *Acceptance:* per-tenant concurrent-execution limit.

### B. Workspace, git & PR lifecycle
5. **GAP-W5 (P1)** — An empty-diff finalize (agent changed nothing) must not open an empty PR. *Acceptance:* skip the PR and mark the execution `no_changes`.
6. **GAP-W6 (P1)** — PR open/update has no merge-base check; if base moved the PR may be unmergeable with no signal. *Acceptance:* surface mergeability on the execution.
7. **GAP-W7 (P1)** — A revoked or expired provider token surfaces as a raw provider error. *Acceptance:* typed `provider_auth_failed` with a re-auth prompt.
8. **GAP-W9 (P2)** — Full clone stays (decision W9) but a huge repo can exhaust the sandbox. *Acceptance:* a repo-size ceiling checked before the clone, failing with a clear, typed error.
9. **GAP-W10 (P1)** — `builderforce/task-<taskId>` has no collision handling if a human created that branch. *Acceptance:* detect and suffix, or refuse with a clear message.
10. **GAP-W12 (P2)** — Assert the workspace lives outside the checkout so it can never be committed.
11. **GAP-D4 (P1)** — Implement the D4 decision: a run with no bound repository ends `pr_skipped: no_repository` (emitted by `cloudFinalize.ts`), never a failure and never `needs_host`. *Acceptance:* test for the no-repository terminal path.

### C. Engine behaviour
12. **GAP-E6 (P1)** — No model-selection validation up front; if the tenant's plan lacks the requested model the failure mode is unclear. *Acceptance:* pre-flight model-entitlement check.

### D. Steering & cancellation
13. **GAP-S3 (P1)** — No backpressure: a user can spam steers. *Acceptance:* rate limit per execution.
14. **GAP-S4 (P1)** — Cancel must tear down the in-flight provider request and stop usage accrual. *Acceptance:* test asserting the abort and no further usage rows.
15. **GAP-S7 (P1)** — Implement the S7 decision end to end: a steer to a terminal run starts a follow-up run via `followUpRun.ts`; the portal shows the new run. *Acceptance:* test that a terminal-run steer yields a linked follow-up execution, not a 409 and not a silent drop.

### E. Observability & telemetry integrity
16. **GAP-O4 (P1)** — A crashed run can leave an execution "running" forever. *Acceptance:* heartbeat plus reaper marks orphaned executions `failed`.
17. **GAP-O6 (P2)** — No per-execution cost rollup surfaced ("$ for this ticket"). *Acceptance:* execution cost summary from `llm_usage_log`.

### F. Billing, limits & BYO keys
18. **GAP-B1 (P0)** — Cloud execution uses tenant plan limits, not a per-cloud-agent ceiling. *Acceptance:* per-cloud-agent budget ceiling (the per-run spend cap of decision E3 is part of this).
19. **GAP-B3 (P1)** — No pre-flight budget check before dispatch. *Acceptance:* reserve or estimate before dispatch.

### G. Security & isolation
20. **GAP-G1 (P0)** — The isolation model (non-root container, egress allowlist, credentials in the Worker; §2) must be documented as the operator-facing boundary and red-teamed. *Acceptance:* a documented isolation model plus a red-team checklist run against a deployed sandbox.

### H. Validation harness
21. **GAP-V1 (P0, PARTIAL)** — `pnpm qa:cloud-agents` (in `api/`) runs the offline P0 assertion suite (telemetry reconstruction, ledger == snapshot, steering/cancel, BYO fail-closed). The §5 golden path is still OPEN: it needs a live deploy, a sandbox repo and provider credentials, and cannot be asserted offline.

---

## 5. Golden-path E2E (the operator's self-validation button)

A scripted run under `qa-e2e/` that:

1. Creates a throwaway ticket bound to a sandbox repo (and a variant with no repository: expects `pr_skipped: no_repository`).
2. `POST /executions`; asserts dispatch and the tick loop starting (GAP-D2).
3. Asserts the clone and branch.
4. Waits for at least one `file.change`; asserts attribution to the cloud agent (GAP-D5).
5. Sends a steering message mid-run and asserts it lands; then steers after completion and asserts a follow-up run starts (GAP-S7).
6. Lets it finish; asserts PR opened or `no_changes` (GAP-W5).
7. Reconstructs the run from telemetry by `execution_id`; asserts ledger == snapshot.
8. Asserts workspace teardown, including a forced-cancel variant (GAP-S4).

**Acceptance for GA:** every P0 gap closed, the §3 matrix all-green, and `pnpm qa:cloud-agents` passing three consecutive times.

---

## 6. Phasing

- **9a — Telemetry & billing integrity (P0 B\*):** per-agent budget ceiling and the pre-flight check.
- **9b — Isolation (P0 G\*):** document and red-team the boundary.
- **9c — Lifecycle correctness (D\*/W\*/S\*):** start-timeout, no-repository terminal path, follow-up on terminal steer, repo-size ceiling.
- **9d — Harness (V1):** the live golden-path E2E.

---

## 7. Closed, superseded and partial (evidence; closed rows move to DONE.md)

| Gap | Verdict | Evidence |
|-----|---------|----------|
| D1, D3, D7 | SUPERSEDED | The per-agent V1/V2 engine switch (`ide_agents.engine`) no longer selects a cloud loop; there is one engine. |
| W1, W2, W4, W8 | SUPERSEDED | Host-side `task-workspace.ts` clone/teardown is not the cloud path; the sandbox's clone is per execution and discarded with it. Teardown on terminal states was already closed by `releaseTaskWorkspaceOnTerminal`. |
| W3, W11 | SUPERSEDED | The provider-REST fallback writer is gone; edits happen in the sandbox clone and land on the ticket branch through `cloudFinalize.ts`. |
| E1, E5, E7, E8, O3 | SUPERSEDED | V1/V2 parity, the V2 SDK base URL, pi-loop prose check, V2 abort handles and V2 per-tool telemetry have no counterpart: one engine, every tool call recorded by `recordCloudToolEvent`. |
| E2 | DECIDED | Operator decision 2026-11-08 (§2.2): container + egress allowlist is the boundary, no command allowlist. |
| E3 | DECIDED | Operator decision 2026-11-08 (§2.2): no step cap; failure-streak breaker, stall ladder, per-run spend cap. |
| E4 | SUPERSEDED | The fallback's missing read tools; the sandbox exposes the full read/grep/shell catalog. |
| S1, S2 | SUPERSEDED | Steering is the durable steering thread drained by `applyPendingSteering`, per execution; there is no shared live session key. |
| S5, S6 | CLOSED | `applyPendingSteering` / `startCancelWatcher` in `cloudLoopControl.ts`. |
| O1, O2 | CLOSED | `cloudRunReconstruction.test.ts`. |
| O5 | CLOSED | `AGENT_KIND_PILL` (`frontend/src/components/observability/agentKindPill.ts`) with `agentKindPill.test.ts`: each kind owns a localized label (`observability.agentKind.*`, five catalogs) and a CLOUD run never maps to ON-PREM. |
| O7 | CLOSED | Contract documented in §2.1. |
| B2, B4 | CLOSED | `cloudByoPolicy.ts` (`402 byo_key_missing`, `byo_key_error`, `assertCloudRunByo`). |
| G2 | CLOSED | Every `tool_audit_events` inserter runs `redactAuditRow` (`infrastructure/security/redactSecrets.ts`): `recordCloudToolEvent`, the host telemetry ingest (`toolAuditRows`), `cloudOutcomeRow`, `recordRunFailureEvent`, `failStrandedDispatch` and both CI ingest files. Redaction walks string LEAVES (`redactDeep`), so stored args stay valid JSON and quoted/escaped secrets are caught, and runs BEFORE any truncation (`redactThenCap` in `cloudAdapterPorts.ts` / `cloudLlmTurn.ts`); the live assistant-text publish and `caughtErrorReporter` (message, stack, cause, context) use the same redactor. Tests: `redactSecrets.test.ts`, `cloudToolEvents.redaction.test.ts`, `hostTelemetryIngest.redaction.test.ts`. Open follow-up: `staleExecutionReaper.ts` still inserts raw rows (two sites) and must call `redactAuditRow`; G2 is not fully closed until it does. |
| G3 | CLOSED | `insideClone` in `container/sandboxCore.mjs` is realpath-based and follows dangling symlinks by hand (hop-limited); the `list` op and job `cwd` use it; writes open the final component with `O_NOFOLLOW`. Tests: `containerSandboxFsGuard.test.ts` (`../`, absolute, symlink, dangling and looping links, symlinked job cwd, `..\`, URL-encoded). Accepted residuals: a TOCTOU between the check and the open, and hard links to files outside the clone (no containment possible without a mount boundary); both sit under the E2 boundary. |
