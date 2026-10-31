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
| 4b | Fleet failover | Medium | Medium: can repeat side effects | Approve the allowlist re-dispatch rule |

---

## 1. Gateway Worker split

**Why.** Every `/llm` and `/v1` call boots the whole API: about 21 MB of code (4.7 MB gzipped), 280 `app.route` mounts and every Durable Object class. The `$0 platform` plan also cannot leave Workers Paid with a bundle this size, because Workers Free caps compressed script size well below it.

**What `/v1` is.** LLM completions live under `/llm/v1/...`. The top-level `/v1/*` surface is the seam routes plus the semantic cache, so step 1 below must also decide whether `createSeamRoutes(db)` belongs in the gateway at all. It has not been assessed.

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
| `api/src/gatewayWorker.ts` | Entry, shaped like `sitesWorker.ts`. Must reuse `stripGatewayPrefix` from `index.ts`, moved somewhere both can import, or `/gateway/llm/*` will not match |
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

**Why.** `creation_session_comments` and kernel `annotations` hold the same row: an author, a target, a body, an anchor and a thread. `annotations` was built to be the one store. Canvas comments are also five query statements (32 lines) inside `creationSessionRoutes.ts`, a god route file.

**Field mapping.**

| `creation_session_comments` | `annotations` | Note |
|---|---|---|
| `id` (uuid) | **new** `public_id` (uuid, unique) | Clients hold these ids, so the wire id stays a uuid |
| `session_id` | `object_id` | The session's kernel object, kind `creation_session`, via `registerObject` |
| (from the session) | `tenant_id` | NOT NULL on `annotations`; the comment table has no tenant column, so it comes from the session |
| `object_id` | `anchor.canvasObjectId` | Plus a partial expression index for the object filter. The old FK's ON DELETE SET NULL is lost, so deleting a canvas object must clear the pin in `canvasComments.ts` |
| `parent_comment_id` | `parent_id` | Resolved from `public_id` at backfill |
| `body`, `anchor` | same | The 1–5000 character CHECK from migration 0388 moves to `canvasComments.ts` or a kind-scoped CHECK |
| `mentions` | **new** `mentions` jsonb | |
| `created_by` | `author_ref` | `author_kind = 'user'`. No FK, so a deleted user's comments keep the ref rather than being set to NULL |
| `resolved_by` | **new** `resolved_by` | `resolved_at` already exists |

**End state.** `application/canvas/canvasComments.ts` owns all reads and writes, and the routes become thin. The response shape does not change, so existing route tests run unchanged as the parity oracle.

**Required access change, before any row moves.** Moving comments alone would open private sessions. `objectRelationGate.ts` gates relations, but `registry.annotations` and `addAnnotation` are ungated (`ObjectRegistry.ts:659-661`), and `objectRoutes.ts:137,147` scope only by tenant. Any tenant member could read and post on a private session's comments through `/api/objects/:id/annotations`. Push 1 must gate annotations for `DOMAIN_GATED_RELATION_KINDS` in the registry facade, with a test proving a non-member is refused on both read and write.

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
- Six first-party clients still call `/api/agents`: frontend, brain-embedded, brain-ui, VS Code, agent-runtime and Android (`BrainChatApi.kt:112`).
- Remaining table readers: `AgentRepository`, `SkillRepository`, and one existence check at `RuntimeService.ts:256`.
- Inbound FKs declared in Drizzle: `executions.agent_id`, `skills.agent_id`, `agent_dispatches.agent_id`, `agent_registrations.legacy_agent_id`. No migration creates `executions`, so confirm the live constraints from `pg_constraint` first.
- `skills` has no `agent_registration_id`, while `executions` and `agent_dispatches` do. Its `agent_id` is its only owner link.

**End state.** `/api/agents` is served from `agent_registrations` with `id = legacy_agent_id`, so old clients keep working with no table behind them. `skills` gains a backfilled `agent_registration_id`, and `/api/skills` joins through it. `RuntimeService` validates numeric ids through a new legacy-id lookup, because `resolveAgentRegistration` matches the uuid `id` only (`buildRuntimeService.ts:124-127`).

**Deleted.** `AgentRepository`, `IAgentRepository`, `AgentService`, the domain `Agent`, and the `agents` declaration.

**Sequence.**

1. **Push 1.** Add and backfill `skills.agent_registration_id`. Re-point the routes and the runtime check. Move first-party clients to `/api/agent-registrations`. Remove the FK constraints but keep the columns.
2. **Push 2.** Drop the table, and drop the columns once `agent_registration_id` is confirmed as the only reader on all three tables.
3. **After Sunset.** Remove the alias routes.

**Done when.** No import of `agents` from the schema remains, checked by the export and not only the local `agentsTable` alias. `/api/agents` responses match before and after for a tenant with legacy rows. Dispatch by numeric id still works. Every `skills` row has a registration.

**Decision:** drop the table once the routes are re-pointed (recommended, because the published contract is the route, not the table), or wait until after 31 December.

---

## 4a. SIEM export

**Why.** `otel_exporters` already sends run spans to a tenant's collector, but security and audit events cannot leave the platform.

**End state.** Extend the existing exporter. No new destination table and no second destination model.

- Add `signals` to `otel_exporters`: `traces`, `audit`, or both. It defaults to `traces`, so nothing changes for existing rows.
- Add an export sweep that sends audit events as OTLP logs to the collector's logs path. Derive that path the way `tracesUrl` does (`otelSpans.ts:104-108`), because an endpoint may already carry a signal-specific suffix, and a plain `${endpoint}/v1/logs` would build `/v1/traces/v1/logs`.
- Delivery is at-least-once, with each event's id as the dedup key. Add a per-exporter, per-source cursor; this needs a new column or a small cursor table.
- Reuse the exporter's encrypted headers and health columns.

**Open design point.** There is no single audit store to read. The events are scattered across core and operational tables, and `tool_audit_events` is on the operational database. Answering the event-set decision below also fixes the list of sources, so the sweep must be written against that list, one reader per source through the right database handle.
- Extend the existing settings panel, localized in all five catalogs and working in both themes and at narrow widths.

**Scope line.** Tenant export carries only that tenant's events. `admin_audit_log` is the cross-tenant operator trail and is never exported to a tenant.

**This is a new feature,** so it ships with a `category=new` release note and Idea-to-Real marketing content in the same pass.

**Done when.** A real OTLP collector receives audit logs. A collector outage does not slow any request, and it shows on the exporter row. The cursor survives a failed batch with no loss.

**Decision:** confirm the event set. Proposed: sign-in and session events, role and membership changes, API key changes, exports, integration connections, approval decisions and agent tool calls.

## 4b. Fleet failover

**Facts.** Cloud runs already recover: `staleExecutionReaper` hands eligible runs to `cloudSelfHeal`. A self-hosted host run does not. When its host dies, the run sits until the reaper fails it at the deadline, even if another host in the tenant is online. `dispatchCloudRun` already finds online hosts through `agentHostOnlineCondition`.

**End state.** When the reaper finds a host run stranded and another eligible host is online, it re-dispatches once. Otherwise it fails as it does today.

**The rule that makes this safe.** A half-finished run may already have pushed a branch or called a mutating tool, and re-running it could repeat that. "No mutating call in the audit" cannot be the test, for three reasons:

- Nothing classifies a tool as mutating: `category` is free-form (`schema/agents.ts:1166`).
- Absence proves nothing. Host audit events wait in an in-memory outbox with a 1.5 s batch (`builderforce-relay-outboxes.ts:19`), so a killed host can lose exactly its last call, and `executionId` is optional on the wire.
- `tool_audit_events` is on the operational database, so the reaper needs the sibling handle.

So the rule inverts. Declare an allowlist of tools that are safe to re-run. Re-dispatch only if the run's audit is complete and every recorded call is on that list. Require `executionId` on host audit events, and add a marker the host sends with each batch so completeness can be judged. Anything else fails and asks a human, with the reason recorded.

**Done when.** Killing a host mid-run after only allowlisted calls moves the run to a second host and completes it. Killing one after any other call, or with an incomplete audit, fails it with the reason shown. No run re-dispatches twice.

**Decision:** approve the allowlist rule, under which a run is re-dispatched automatically only when its audit proves every call was safe to repeat.
