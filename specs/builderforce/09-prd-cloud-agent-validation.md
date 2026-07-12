# 09 — PRD: Cloud Agent Validation & Hardening

**Status: Planned (P0 — validation gate).** Continues doc 04 (Agentic Dev Layer) and the "Cloud Agent Engines V1/V2" + "Cloud Agent Observability" + "Ticket Workspace Flow" passes (2026-06-07).

This PRD exists so the operator can **validate the cloud agents** end-to-end before they are sold as a
first-class runtime alongside self-hosted agent hosts. Today a "cloud agent" is a real, wired path
(dispatch → engine → workspace → telemetry → steering), but it has only been exercised on the happy
path. This doc (1) **summarizes the core capabilities as built**, so there is a single source of truth
to validate against, and (2) **enumerates 50 concrete gaps** — each a falsifiable check that must pass
(or a hole that must be closed) before cloud agents are GA.

**Personas:** Tenant operator (runs a cloud agent against a ticket, watches it work, steers it); the
platform SRE (verifies isolation, billing attribution, observability); the buyer evaluating "do cloud
agents actually deliver a merged PR without a self-hosted host online?"

> **Locked decisions (carried from the engine/observability passes + this PRD):**
> 1. **Three execution paths, one contract.** V1 (`builderforce-v1`, pi loop via gateway `chat.send`),
>    V2 (`builderforce-v2`, Claude Agent SDK with file/bash tools), and the **cloud Worker fallback**
>    (`runCloudExecution`, server-side bounded tool loop, provider-REST commits, no filesystem). All
>    three converge on the same task workspace, file-change attribution, and telemetry ledger.
> 2. **Engine is data, not code.** `ide_agents.engine` (migration 0087, default V1) is read at
>    dispatch (`resolveCloudAgent`); validation must cover all three engines, not just the default.
> 3. **Telemetry is the contract surface.** Migrations 0092/0096 make a cloud run attributable by
>    `cloud_agent_ref` + `execution_id` across `tool_audit_events`, `usage_snapshots`, and
>    `llm_usage_log`. "Validated" means a run is fully reconstructable from those tables.
> 4. **No new untested code ships in this pass.** Every gap below is either a *validation check* (assert
>    existing behaviour) or a *bounded fix* with an acceptance criterion. Anything bigger is logged to
>    the root `README.md` Consolidated Gap Register, not silently widened here.

---

## 1. Scope

### In scope
- A **validation matrix** across the three engines (V1 / V2 / cloud-Worker fallback) × the task
  lifecycle (dispatch → clone → work → steer → cancel → finalize/PR → teardown).
- **50 gaps** (§4), each tagged with engine(s) affected, the file(s) that own the behaviour, severity,
  and an acceptance check.
- A **golden-path E2E** (§5) the operator can run repeatedly to self-validate.

### Out of scope (→ Gap Register)
- New engine types beyond V1/V2/fallback.
- Multi-repo / monorepo-aware cloud workspaces (single repo per ticket for now).
- Governance gating of cloud runs — owned by doc 08; cloud runs consume its findings, not re-implement.

---

## 2. Core capabilities (as built — the thing we are validating)

| # | Capability | Where it lives | One-line behaviour |
|---|-----------|----------------|--------------------|
| C1 | **Execution dispatch + queue** | `api/.../routes/runtimeRoutes.ts` (`dispatchAndQueue`, ~928) | Portal `POST /executions` → resolve engine → dispatch via relay DO → if no online host claims it, queue a background cloud Worker run. |
| C2 | **Engine resolution** | `runtimeRoutes.ts` (`resolveCloudAgent`, ~899) | Reads `ide_agents.engine`; defaults to `builderforce-v1`. |
| C3 | **V1 runner (pi loop)** | `agent-runtime/.../builderforce-relay.ts` (~346) | Runs pi-embedded loop via gateway `chat.send` against the cloned workspace; diffs + attributes changes after the session. |
| C4 | **V2 runner (Claude Agent SDK)** | `agent-runtime/.../claude-agent-sdk-runner.ts` (~42) | `query()` with Read/Write/Edit/Bash/Glob/Grep, `bypassPermissions`, inference routed through gateway to tenant BYO Anthropic key. |
| C5 | **Cloud Worker fallback** | `runtimeRoutes.ts` (`runCloudExecution` ~753, `runCloudToolLoop` ~562) | Server-side bounded loop with `write_file`/`finish` tools; commits land on the ticket branch via provider REST API; no local FS. |
| C6 | **Task workspace** | `agent-runtime/.../task-workspace.ts` | Clone once to `.builderforce/tasks/<taskId>`, checkout `builderforce/task-<taskId>`, `git status --porcelain` diff, change attribution. |
| C7 | **Finalize → PR** | `builderforce-relay.ts` (`finalizeTask` ~488); `api/.../openTaskPullRequest.ts` | On task Done: commit remaining changes, push branch, open/update PR, tear down workspace. |
| C8 | **Cloud telemetry** | `runtimeRoutes.ts` (`recordCloudToolEvent` ~435, `recordCloudUsage` ~478); migrations 0092/0096 | Tool calls → `tool_audit_events`; tokens → `usage_snapshots` + `llm_usage_log`, all tagged `cloud_agent_ref` + `execution_id`. |
| C9 | **Execution steering** | `api/.../relay/AgentHostRelayDO.ts` + `executionMessage.ts`; `agent-runtime/.../relay-steering.ts` | Portal follow-up → `execution.message` frame → relay DO → agent-runtime injects as next `chat.send` turn in the live session. |
| C10 | **Cancellation** | `AgentHostRelayDO.ts` (`execution.cancel`); `builderforce-relay.ts` (~1077) | Portal cancel → frame → abort V2 handle / `chat.abort` for V1. |
| C11 | **BYO key routing** | `api/.../llm/tenantProviderKeyService.ts` | Tenant's encrypted Anthropic key resolved from gateway `x-api-key`; V2 inference billed to tenant. |
| C12 | **Unified observability UI** | `frontend/.../ObservabilityContent.tsx` (KIND_PILL ~109) | One timeline; ON-PREM (gray) vs CLOUD (coral) pills; merged host+cloud agent picker. |

---

## 3. Validation matrix

Each cell must produce a green run AND a reconstructable telemetry trail (§4 GAP-O*).

| Lifecycle stage | V1 (pi) | V2 (SDK) | Cloud Worker fallback |
|-----------------|:---:|:---:|:---:|
| Dispatch + engine resolve | ☐ | ☐ | ☐ |
| Clone + branch | ☐ | ☐ | n/a (provider REST) |
| Produce file changes | ☐ | ☐ | ☐ |
| Live steering mid-run | ☐ | ☐ | ☐ (gap — see GAP-S5) |
| Cancellation | ☐ | ☐ | ☐ (gap — see GAP-S6) |
| Finalize → push → PR | ☐ | ☐ | ☐ |
| Teardown | ☐ | ☐ | n/a |
| Telemetry reconstructable | ☐ | ☐ | ☐ |

---

## 4. The 50 gaps

Severity: **P0** = blocks GA / data-integrity, **P1** = must-fix before broad rollout, **P2** = hardening.
Each gap is phrased as a check that currently fails, is unverified, or is missing. `E:` = engines affected.

### A. Dispatch, engine selection & routing

1. **GAP-D1 (P0, E:all)** — No test asserts `resolveCloudAgent` falls back to V1 when `ide_agents.engine` is NULL/unknown. A typo'd engine value silently runs the wrong loop. *Acceptance:* unit test covering NULL, `builderforce-v2`, and a garbage value.
2. **GAP-D2 (P0, E:fallback)** — The "no online host claims it → queue cloud Worker" handoff (`dispatchAndQueue`) has no timeout assertion; if a host is *flaky* (connects then drops), the run may neither be claimed nor queued. *Acceptance:* claim-window timeout + integration test for the drop-mid-claim race.
3. **GAP-D3 (P1, E:all)** — Engine is resolved once at dispatch; if the agent's engine is changed mid-flight there is no reconciliation. *Acceptance:* document as immutable-per-execution and snapshot `engine` onto the execution row.
4. **GAP-D4 (P1, E:fallback)** — When clone/repo-bind fails the cloud loop tells the model "return deliverable in summary" but there is **no escalation back to a real agent host**. *Acceptance:* on repo-required tasks, fall back to host queue or mark execution `needs_host`.
5. **GAP-D5 (P1, E:all)** — `tasks.assignedAgentRef` self-assignment (~957) is not surfaced on the task card UI, so a buyer can't see *which* cloud agent ran. *Acceptance:* render agent attribution on the task card.
6. **GAP-D6 (P2, E:all)** — No idempotency key on `POST /executions`; a double-click can spawn two concurrent runs on the same ticket branch → conflicting commits. *Acceptance:* idempotency key + dedupe within an in-flight window.
7. **GAP-D7 (P1, E:all)** — Dispatch payload is not schema-validated at the relay boundary the way `executionMessage` frames are. *Acceptance:* zod/validator on the dispatch frame.
8. **GAP-D8 (P2, E:all)** — No concurrency cap per cloud agent or per tenant on simultaneous executions; a tenant can fan out unbounded cloud runs. *Acceptance:* per-tenant concurrent-execution limit.

### B. Workspace, git & PR lifecycle

9. **GAP-W1 (P0, E:V1,V2)** — `ensureTaskWorkspace` clones once per ticket but there is no validation that a *re-run* on the same ticket reuses vs. re-clones cleanly (stale branch state). *Acceptance:* re-run test asserting branch is reset/fast-forwarded, not duplicated.
10. **GAP-W2 (P0, E:V1,V2)** — Workspace teardown (`finalizeTask` ~504) only runs on the Done path; an **errored/cancelled** run leaks `.builderforce/tasks/<taskId>` on disk. *Acceptance:* teardown in a `finally`/on terminal states.
11. **GAP-W3 (P0, E:fallback)** — Cloud-Worker commits go straight to the ticket branch via provider REST with **no diff preview**; a bad write is already on the branch before review. *Acceptance:* stage to a draft/PR-only branch, never the protected base.
12. **GAP-W4 (P1, E:V1)** — V1 attributes changes by diffing `git status --porcelain` *after* the session; concurrent edits or an interrupted session mis-attribute or drop changes. *Acceptance:* per-turn snapshotting or a clean-tree precondition assertion.
13. **GAP-W5 (P1, E:all)** — No handling for an **empty diff** finalize (agent ran, changed nothing): does it open an empty PR? *Acceptance:* skip PR + mark execution `no_changes`.
14. **GAP-W6 (P1, E:all)** — PR open/update (`openTaskPullRequest`) has no conflict/merge-base check; if base moved, the PR may be unmergeable with no signal. *Acceptance:* surface mergeability state on the execution.
15. **GAP-W7 (P1, E:all)** — Provider token decryption path (`commitFileAsPendingChange`) has no validation for revoked/expired tokens; failure mode is a raw provider error. *Acceptance:* typed `provider_auth_failed` with re-auth prompt.
16. **GAP-W8 (P2, E:V1,V2)** — `buildTaskCloneUrl` routes through the host git-proxy; for a *pure cloud* run with no host, the proxy path is untested. *Acceptance:* cloud-direct clone path test.
17. **GAP-W9 (P2, E:all)** — Large-repo clone has no depth/size guard; a huge repo can blow the Worker/runtime budget. *Acceptance:* shallow clone + size ceiling with a clear error.
18. **GAP-W10 (P1, E:all)** — Branch naming `builderforce/task-<taskId>` has no collision handling if a human created the same branch. *Acceptance:* detect + suffix or refuse with a clear message.
19. **GAP-W11 (P2, E:fallback)** — Binary/large file writes via `write_file` provider REST are unbounded. *Acceptance:* reject binaries/over-size with a tool error.
20. **GAP-W12 (P2, E:all)** — `.builderforce/` workspace path is not gitignored-by-construction; risk of committing the workspace into the repo. *Acceptance:* assert workspace lives outside the checkout.

### C. Engine behaviour & parity

21. **GAP-E1 (P0, E:V1↔V2)** — No parity test that the **same ticket** produces equivalent (committed, attributed) output on V1 vs V2; buyers will A/B engines. *Acceptance:* golden-ticket parity harness.
22. **GAP-E2 (P0, E:V2)** — V2 runs `permissionMode: 'bypassPermissions'` with Bash enabled in cloud — **arbitrary command execution** with no allowlist in the cloud trust boundary. *Acceptance:* command policy/sandbox for cloud V2 (see §G).
23. **GAP-E3 (P1, E:fallback)** — Cloud-Worker tool loop is bounded (`write_file`/`finish`) but the max-iteration cap is unverified; a model that never calls `finish` could spin to the cap silently. *Acceptance:* assert cap + emit `max_iterations` terminal reason.
24. **GAP-E4 (P1, E:fallback)** — Fallback loop has **no Read/Grep tool**, so it writes files without reading existing code → overwrites. *Acceptance:* add read tools or document fallback as "greenfield only" and gate accordingly.
25. **GAP-E5 (P1, E:V2)** — V2 `anthropicBaseUrl = ${builderforce.ai}/llm`; no test that gateway correctly injects the tenant key vs. default key per `x-api-key`. *Acceptance:* BYO-vs-default routing test (ties to GAP-B*).
26. **GAP-E6 (P1, E:all)** — No model-selection validation per engine; if a tenant's plan lacks the model the engine requests, failure mode is unclear. *Acceptance:* pre-flight model-entitlement check.
27. **GAP-E7 (P2, E:V1)** — pi loop "runs to completion, no tools" — there is no guard that it actually wrote to the workspace vs. just emitted prose. *Acceptance:* assert non-empty diff or mark `no_changes`.
28. **GAP-E8 (P2, E:V2)** — V2 abort handle registration (~436) is keyed by `executionId`; no test that a stale handle is cleared after normal completion (memory leak / wrong-run abort). *Acceptance:* handle-lifecycle test.

### D. Steering & cancellation

29. **GAP-S1 (P0, E:V1,V2)** — Steering injects via the **same session key** as the original dispatch; no test that an injected message lands in the *correct* live session (cross-execution bleed). *Acceptance:* multi-concurrent-execution steering isolation test.
30. **GAP-S2 (P1, E:V1,V2)** — `buildSteeringInjection` formats the follow-up as the next user turn, but there's no ordering guarantee if two steers arrive before the agent's turn. *Acceptance:* queue + ordering test.
31. **GAP-S3 (P1, E:all)** — No backpressure: a user can spam `execution.message` frames; relay DO forwards all. *Acceptance:* rate-limit per execution.
32. **GAP-S4 (P1, E:V2)** — Cancel aborts the V2 SDK handle but does **not** verify the in-flight provider request is actually torn down (token spend continues). *Acceptance:* assert request abort + stop usage accrual.
33. **GAP-S5 (P0, E:fallback)** — The cloud-Worker fallback loop has **no steering path** (it's a server-side loop, not a live session). Steering silently no-ops. *Acceptance:* either support mid-loop injection or surface "steering unavailable for cloud-fallback runs" in the UI.
34. **GAP-S6 (P0, E:fallback)** — Same for **cancellation**: a queued/running cloud-Worker run has no `execution.cancel` honoring. *Acceptance:* cooperative cancel check between loop iterations.
35. **GAP-S7 (P2, E:all)** — Steering after a run has terminated returns no clear error to the portal (silent drop). *Acceptance:* `409 execution_not_live`.

### E. Observability & telemetry integrity

36. **GAP-O1 (P0, E:all)** — No test reconstructs a full run from `tool_audit_events` + `usage_snapshots` + `llm_usage_log` by `execution_id`; this is the core "validated" claim. *Acceptance:* reconstruction test asserting every tool call + token row is present and joinable.
37. **GAP-O2 (P0, E:fallback)** — `recordCloudUsage` writes to both `usage_snapshots` and `llm_usage_log`; no assertion the two **agree** (double-count or drift in the billing ledger). *Acceptance:* invariant test: ledger total == snapshot total per execution.
38. **GAP-O3 (P1, E:V2)** — V2 inference flows through the gateway; verify tool-call telemetry is captured for SDK-internal tools (Read/Edit/Bash), not just file changes. *Acceptance:* per-tool emission for V2 (logged today as a known gap).
39. **GAP-O4 (P1, E:all)** — On a crashed run, partial telemetry leaves the execution with no terminal status row → "stuck running" forever in the UI. *Acceptance:* heartbeat + reaper that marks orphaned executions `failed`.
40. **GAP-O5 (P1, E:all)** — CLOUD vs ON-PREM pill derives from `kind`; no test that a cloud run never renders as ON-PREM (mis-attribution in the buyer-facing timeline). *Acceptance:* snapshot test on KIND_PILL mapping.
41. **GAP-O6 (P2, E:all)** — No cost-per-execution rollup surfaced; telemetry exists but the operator can't see "$ for this ticket". *Acceptance:* execution cost summary from `llm_usage_log`.
42. **GAP-O7 (P2, E:all)** — `sessionKey: exec:<executionId>` convention is undocumented; future joins risk drift. *Acceptance:* document the key contract in this spec + a schema comment.

### F. Billing, limits & BYO keys

43. **GAP-B1 (P0, E:fallback)** — Cloud execution uses **global tenant plan limits, not per-host daily caps** (V1/on-prem honors these). A cloud run can exceed a cap the operator believed was enforced. *Acceptance:* apply a per-cloud-agent budget ceiling.
44. **GAP-B2 (P0, E:V2)** — If a tenant BYO Anthropic key is missing/invalid, does V2 silently fall to the **default (platform-billed) key**? That's a billing-leak. *Acceptance:* explicit "BYO required" mode that fails closed.
45. **GAP-B3 (P1, E:all)** — No pre-flight budget check before dispatch; a run starts, burns tokens, then hits the limit mid-loop with a half-done PR. *Acceptance:* reserve/estimate before dispatch.
46. **GAP-B4 (P1, E:V2)** — `tenantProviderKeyService` decrypt failures during a run have an unclear failure mode. *Acceptance:* typed `byo_key_error`, no fallback to platform key.

### G. Security & isolation

> **GAP-CW — Cloud-Worker compute-layer isolation (FR-5): VALIDATED / CLOSED.**
> Process (PID/IPC/UTS), filesystem, and network namespace isolation between concurrent
> workers, plus teardown artifact elimination, were formally validated by security-t1.
> Overall verdict: **Isolated** (no open isolation breaches). Two low-priority hardening
> recommendations remain, owned by Platform Engineering. This closes the compute-layer
> slice of GAP-G1/GAP-W2. Full evidence + test-case verdicts:
> `agent-runtime/docs/security/GAP-CW-Validation-Report.md`.

47. **GAP-G1 (P0, E:V2,fallback)** — Cloud V2 with `bypassPermissions` + Bash runs tenant-authored prompts against a cloned repo on **shared infrastructure** with no documented sandbox/network egress boundary. This is the single biggest GA blocker. *Acceptance:* documented isolation model (container/network egress allowlist) + a red-team check.
48. **GAP-G2 (P0, E:all)** — Decrypted provider tokens live in the runtime process during a run; no assertion they're scrubbed from memory/logs on completion. *Acceptance:* secret-lifecycle audit + log-redaction test.
49. **GAP-G3 (P1, E:all)** — Cross-tenant isolation of the task workspace dir (`.builderforce/tasks/<taskId>`) on a shared runtime is unverified — taskId collision or path traversal could expose another tenant's checkout. *Acceptance:* tenant-namespaced paths + traversal test.

### H. Validation harness itself

50. **GAP-V1 (P0, E:all)** — There is **no repeatable golden-path E2E** (§5) wired into `qa-e2e/` that an operator can run to validate the whole cloud-agent flow on demand. Without it, every validation is manual and non-reproducible. *Acceptance:* a single `pnpm qa:cloud-agents` run that walks the §3 matrix and asserts §4 P0 checks.

---

## 5. Golden-path E2E (the operator's self-validation button)

A scripted run under `qa-e2e/` that, for each engine in {V1, V2, fallback}:

1. Creates a throwaway ticket bound to a sandbox repo.
2. `POST /executions` with that engine; asserts dispatch + engine resolution (GAP-D1).
3. Asserts workspace clone + branch (or provider-REST path for fallback) (GAP-W1).
4. Waits for ≥1 `file.change`; asserts attribution to the cloud agent (GAP-D5).
5. Sends a steering message; asserts it lands in the live session (GAP-S1) — or asserts the documented no-op for fallback (GAP-S5).
6. Lets it finish → asserts PR opened (or `no_changes`) (GAP-W5).
7. Reconstructs the run from telemetry by `execution_id`; asserts ledger==snapshot (GAP-O1, GAP-O2).
8. Asserts workspace teardown, including on a forced-cancel variant (GAP-W2, GAP-S6).

**Acceptance for GA:** every P0 gap closed, the §3 matrix all-green, and `pnpm qa:cloud-agents` passing
three consecutive times.

---

## 6. Phasing

- **9a — Telemetry & billing integrity (P0 O*/B*):** make a run reconstructable and correctly billed. Nothing else can be trusted until this is true.
- **9b — Isolation & secrets (P0 G*):** the GA security gate; cloud V2/Bash must not be a shared-infra footgun.
- **9c — Lifecycle correctness (P0 D*/W*/S*):** teardown-on-error, fallback steering/cancel, idempotency.
- **9d — Parity + harness (E*/V1):** V1↔V2 parity and the repeatable E2E button.

> Sibling gaps surfaced but deferred (per-host cloud token budget detail, multi-repo workspaces,
> V2 per-tool telemetry depth) are logged to the root `README.md` Consolidated Gap Register rather than
> widened here.
