# PRD 39: Platform closeout (design for review)

**Status:** design only, no code started. Each program waits for operator review (see the design-first rule).
**Date:** 2026-10-31
**Closes:** the ROADMAP Infrastructure entries for the API Worker split, the comment store, the `agents` table, and production hardening.

Each program below states the end state, what is deleted, the rollout, how we prove it done, and the one decision it needs.

| # | Program | Size | Risk | Decision needed |
|---|---|---|---|---|
| 1 | Gateway Worker split | Large | High: moves all gateway traffic | Approve a two-push rollout |
| 2 | Canvas comments into `annotations` | Medium | Medium: comment ids and data move | Approve the id and pin mapping |
| 3 | Retire the `agents` table | Medium | Low | Drop before or after the published Sunset |
| 4a | SIEM export | Medium | Low: new feature | Confirm the audit event set |
| 4b | Fleet failover | Medium | Medium: can repeat side effects | Approve the re-dispatch rule |

---

## 1. Gateway Worker split

**Why.** Every `/llm` and `/v1` call boots the whole API: about 21 MB of code, ~229 route mounts and every Durable Object class. The `$0 platform` plan also cannot leave Workers Paid with a bundle this size, because Workers Free caps compressed script size well below it.

**End state.**

```
api.builderforce.ai/llm/*          ┐
api.builderforce.ai/v1/*           ├─► builderforce-gateway  (src/gatewayWorker.ts)
builderforce.ai/gateway/llm/*      │     ├─ /llm, /llm/v1/videos, /v1/*
builderforce.ai/gateway/v1/*       ┘     ├─ rate limit, gateway auth, CORS
                                         └─ API service binding ─► builderforce-api
everything else ───────────────────────► builderforce-api   (src/index.ts, unchanged)
```

**The blocker to remove first.** `application/llm/replayApp.ts` dynamically imports `index.ts`, because a builtin MCP tool call replays an `/api/*` route in-process through the whole app. Any Worker that reaches this import bundles the entire API, so a split without this fix saves nothing.

**Contract.** A port replaces the import:

```ts
// application/llm/routeReplay.ts
export interface RouteReplay {
  (request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}
```

- `builderforce-api` binds it to the in-process app.
- `builderforce-gateway` binds it to `env.API.fetch(request)`.
- `builtinToolContext.ts` depends only on the port.

**Codemap.**

| Add | Purpose |
|---|---|
| `api/src/gatewayWorker.ts` | Entry, shaped like `sitesWorker.ts` |
| `api/src/presentation/gatewayApp.ts` | The gateway's mounts and middleware, shared so both Workers mount identical routes during rollout |
| `api/wrangler.gateway.toml` | Routes, vars, `script_name` Durable Object bindings to `builderforce-api` |
| `api/scripts/check-gateway-worker-graph.mjs` | Fails the build if the graph reaches `src/index.ts`, like `check-sites-worker-graph.mjs` |
| `release.yml` step | Deploys after the API and syncs secrets, as the sites Worker does |

Deleted from `index.ts` in push 2: the `/llm`, `/llm/v1/videos` and `/v1/*` mounts.

**Sequence.**

1. **Measure first.** Build the proposed gateway entry with an esbuild metafile. If the graph is still more than half the API bundle, stop and report which imports hold it there.
2. **Push 1.** Cut the cycle through the port. Deploy the Worker on its `workers.dev` hostname with no production routes. The API keeps serving everything.
3. **Prove it live.** Run real completions, streaming, a builtin tool call, a BYO key and a video job against the `workers.dev` host. Unit tests do not count as validation here.
4. **Push 2.** Add the routes and remove the mounts from `index.ts`. Rollback is removing the routes.

**Done when.** The graph guard passes in CI. Gateway bundle size and cold start are recorded here. The live checks pass on the production routes. `llm_usage_log` and traces match the pre-split shape. No `/llm` requests reach `builderforce-api` except replays.

**Open risk.** The `*.builderforce.ai/*` comment in `frontend/wrangler.toml` records that a Custom Domain does not reliably beat a zone route. `api.builderforce.ai` is a Custom Domain, so the route precedence for `/llm/*` must be proven on the rollout, not assumed.

**Decision:** approve the two-push rollout, with live proof between the pushes.

---

## 2. Canvas comments into `annotations`

**Why.** `creation_session_comments` and kernel `annotations` hold the same row: an author, a target, a body, an anchor and a thread. `annotations` was built to be the one store. Canvas comments are also 32 query sites inside `creationSessionRoutes.ts`, a god route file.

**Field mapping.**

| `creation_session_comments` | `annotations` | Note |
|---|---|---|
| `id` (uuid) | **new** `public_id` (uuid, unique) | Clients hold these ids, so the wire id stays a uuid |
| `session_id` | `object_id` | The session's kernel object, kind `creation_session`, via `registerObject` |
| `object_id` | `anchor.canvasObjectId` | Plus a partial expression index for the object filter |
| `parent_comment_id` | `parent_id` | Resolved from `public_id` at backfill |
| `body`, `anchor` | same | |
| `mentions` | **new** `mentions` jsonb | |
| `created_by` | `author_ref` | `author_kind = 'user'` |
| `resolved_by` | **new** `resolved_by` | `resolved_at` already exists |

**End state.** `application/canvas/canvasComments.ts` owns all reads and writes, and the routes become thin. The session access check stays the gate, and `creation_session` is already domain-gated in `objectRelationGate.ts`. The response shape does not change, so existing route tests run unchanged as the parity oracle.

**Sequence (expand/contract).**

1. **Push 1 (expand).** Add the columns and a fold ledger. Backfill idempotently. Move reads and writes to `canvasComments.ts`. Keep the old table declared `@deprecated`.
2. **Deploy window.** The old Worker still writes to the old table, and the ledger records what was copied.
3. **Push 2 (contract).** Re-run the backfill, reconcile against the ledger, drop the table.

**Done when.** Row counts reconcile per session. Threads, mentions, resolve and object filtering all pass the unchanged tests. `creationSessionRoutes.ts` loses every comment query. The activity feed still shows `comment.created` and `comment.resolved`.

**Decision:** approve `public_id` for wire ids and `anchor.canvasObjectId` for pins. The alternative for pins is registering every canvas object as a kernel object, which adds a row per object and buys nothing today.

---

## 3. Retire the `agents` table

**Facts.**

- Writes have answered 410 since the legacy registry closed.
- Migration 0394 folded rows into `agent_registrations` through `legacy_agent_id`, and `resolveAssignedAgent` already resolves numeric refs that way.
- `/api/agents` and `/api/skills` stamp `Sunset: Wed, 31 Dec 2026`.
- Five first-party clients still call `/api/agents`: frontend, brain-embedded, brain-ui, VS Code and agent-runtime.
- Remaining table readers: `AgentRepository`, `SkillRepository`, and one existence check at `RuntimeService.ts:256`.
- Inbound FKs: `executions.agent_id`, `skills.agent_id`, the ticket stage `agent_id`, `agent_registrations.legacy_agent_id`.

**End state.** `/api/agents` is served from `agent_registrations` with `id = legacy_agent_id`, so old clients keep working with no table behind them. `/api/skills` joins through registrations. `RuntimeService` validates numeric ids through `resolveAgentRegistration`.

**Deleted.** `AgentRepository`, `IAgentRepository`, `AgentService`, the domain `Agent`, and the `agents` declaration.

**Sequence.**

1. **Push 1.** Re-point the routes and the runtime check. Move first-party clients to `/api/agent-registrations`. Remove the FK constraints but keep the columns.
2. **Push 2.** Drop the table, and drop the columns once `agent_registration_id` is confirmed as the only reader.
3. **After Sunset.** Remove the alias routes.

**Done when.** `git grep agentsTable` is empty. `/api/agents` responses match before and after for a tenant with legacy rows. Dispatch by numeric id still works.

**Decision:** drop the table once the routes are re-pointed (recommended, because the published contract is the route, not the table), or wait until after 31 December.

---

## 4a. SIEM export

**Why.** `otel_exporters` already sends run spans to a tenant's collector, but security and audit events cannot leave the platform.

**End state.** Extend the existing exporter. No new table and no second destination model.

- Add `signals` to `otel_exporters`: `traces`, `audit`, or both. It defaults to `traces`, so nothing changes for existing rows.
- Add an export sweep that sends audit events as OTLP logs to `${endpoint}/v1/logs`. Delivery is at-least-once, with a per-exporter cursor and each event's id as the dedup key.
- Reuse the exporter's encrypted headers and health columns.
- Extend the existing settings panel, localized in all five catalogs and working in both themes and at narrow widths.

**Scope line.** Tenant export carries only that tenant's events. `admin_audit_log` is the cross-tenant operator trail and is never exported to a tenant.

**This is a new feature,** so it ships with a `category=new` release note and Idea-to-Real marketing content in the same pass.

**Done when.** A real OTLP collector receives audit logs. A collector outage does not slow any request, and it shows on the exporter row. The cursor survives a failed batch with no loss.

**Decision:** confirm the event set. Proposed: sign-in and session events, role and membership changes, API key changes, exports, integration connections, approval decisions and agent tool calls.

## 4b. Fleet failover

**Facts.** Cloud runs already recover: `staleExecutionReaper` hands eligible runs to `cloudSelfHeal`. A self-hosted host run does not. When its host dies, the run sits until the reaper fails it at the deadline, even if another host in the tenant is online. `dispatchCloudRun` already finds online hosts through `agentHostOnlineCondition`.

**End state.** When the reaper finds a host run stranded and another eligible host is online, it re-dispatches once. Otherwise it fails as it does today.

**The rule that makes this safe.** A half-finished run may already have pushed a branch or called a mutating tool, and re-running it could repeat that. So re-dispatch applies only if `tool_audit_events` shows no mutating call for that execution. A run with mutating calls fails and asks a human, with the reason recorded.

**Done when.** Killing a host mid-run with no mutating calls moves the run to a second host and completes it. Killing one after a mutating call fails it with the reason shown. No run re-dispatches twice.

**Decision:** approve the rule that a run with any mutating call is never re-dispatched automatically.
