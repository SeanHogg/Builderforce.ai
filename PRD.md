> **PRD** — drafted by John Coder ((V2) (Durable)) · task #656
> _Each agent that updates this PRD signs its change below._

# PRD: Agent Execution Auth Token Lifecycle Fix

## Problem & Goal

### Problem
Long-running agent executions fail mid-run with `401 Token revoked or expired` when the bearer token obtained at execution start expires before the run completes. This abort corrupts in-flight tool-call responses: state reads/writes (e.g. `tasks.update`) return stale or null values to the agent, creating a false appearance of persistence failure. The underlying DB write path is correct — the failure is entirely in the auth layer.

### Goal
Make the agent execution runtime resilient to token expiry: proactively refresh tokens before they expire, or transparently retry once on 401 with a fresh token. Ensure auth failures are loud (thrown errors), never silent data degradation.

---

## Target Users / ICP Roles

| Role | Impact |
|------|--------|
| **Agent runtime engineers** | Own the token-acquisition and HTTP-client layers being changed |
| **API / platform engineers** | Own the token-issuance, revocation, and refresh endpoints |
| **QA / reliability engineers** | Validate long-running execution scenarios and regression coverage |
| **End users running long agent tasks** | Experience silent mid-run failures and corrupted tool responses today |

---

## Scope

### In Scope
- Token lifecycle management inside `Builderforce.ai/agent-runtime` and `Builderforce.ai/api`
- Proactive pre-expiry refresh **and/or** reactive single-retry-on-401 in the HTTP request layer
- Clear error propagation when token refresh itself fails (no silent null returns)
- Unit/integration test coverage for the token-refresh-on-401 code path
- Affected surface: all outbound authenticated calls made by the agent runtime during an execution (MCP tool calls, task service calls, any gateway requests)

### Out of Scope
- The `assignedAgentRef` persistence path — verified correct, no changes needed in `builtinMcpService.ts`, `TaskService`, `Task`, or `TaskRepository`
- Token issuance policy changes (TTL values, revocation rules) unless required as a minimal enabler
- UI/dashboard changes
- Changes to any other microservice not involved in agent execution auth
- Re-investigation of DB write behavior

---

## Functional Requirements

### FR-1 — Token Acquisition Audit
Locate and document the exact call site(s) where the agent runtime obtains its bearer token at execution start. Confirm the token is stored in a way that is accessible to the request layer for the full execution lifetime.

**Search targets:**
- String `401 Token revoked or expired` (error handler)
- Token fetch / bearer assignment in `agent-runtime` boot/init path
- Auth middleware / interceptor in `api` request client

---

### FR-2 — Proactive Token Refresh
The runtime MUST refresh the token before it expires.

- Parse the token expiry (from JWT `exp` claim or from the token-issuance response metadata).
- Schedule a refresh at **`expiry − refresh_buffer`** (recommended buffer: 60 s, configurable).
- The refreshed token MUST be injected into all subsequent outbound requests without restarting the execution.
- If the proactive refresh fails, the system MUST log a warning and immediately attempt an emergency refresh before the next outbound call, rather than letting the call fail with 401.

---

### FR-3 — Reactive Single-Retry on 401
The HTTP/request layer used by the agent runtime MUST implement a 401-intercept-and-retry strategy as a safety net (complementary to FR-2, not a replacement).

- On receiving a `401` response, attempt token refresh exactly once.
- Re-issue the original request with the new token.
- If the second attempt also returns a non-2xx response (including a second 401), surface a clear, thrown error to the caller — do NOT return null or a partial response.
- The retry MUST be transparent to the calling tool-call handler (no change required in MCP layer).

---

### FR-4 — No Silent Null Returns on Auth Failure
Any tool call (e.g. `tasks.update`, `tasks.read`) that fails due to an auth error MUST throw or reject with an explicit, identifiable error. It MUST NOT:
- Return `{ success: true }` with a null field value.
- Return a stale cached read silently.
- Swallow the error and resolve the promise with undefined/null.

Error messages MUST include enough context for log correlation: execution ID, tool call name, HTTP status, and error description.

---

### FR-5 — Test Coverage
Add or repair automated tests covering:

| Test Case | Type |
|-----------|------|
| Request succeeds after transparent 401 + refresh + retry | Unit (request interceptor) |
| Second consecutive 401 after refresh surfaces a thrown error, not null | Unit (request interceptor) |
| Proactive refresh fires before token expiry during a simulated long run | Unit / integration |
| Tool call (`tasks.update`) that receives a 401 mid-write throws clearly — does not resolve with null field | Integration |
| Token refresh failure during execution logs warning and does not silently corrupt subsequent reads | Integration |

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| AC-1 | An execution whose wall-clock duration exceeds the token TTL completes successfully without a `401 Token revoked or expired` abort | End-to-end test / manual execution longer than TTL |
| AC-2 | On a single 401 mid-run, the request layer re-auths and retries transparently; the tool call succeeds and returns correct, persisted data | Unit test (FR-5, row 1) |
| AC-3 | On a second consecutive 401 (refresh also fails), the runtime throws a clear error with execution ID, tool name, and HTTP status — execution is marked failed, not silently degraded | Unit test (FR-5, row 2) |
| AC-4 | `tasks.update` (and equivalent write calls) never resolve with `{ assignedAgentRef: null }` as a result of an expired token — the call either persists correctly or throws | Integration test (FR-5, row 4) |
| AC-5 | Proactive refresh fires and succeeds before token expiry with no 401 ever reaching the wire during a run longer than TTL | Integration test (FR-5, row 3) |
| AC-6 | All new/modified tests pass in CI | CI pipeline green |
| AC-7 | No changes to `TaskRepository`, `TaskService`, `Task`, or `builtinMcpService.ts` persistence paths are required or made | Code review / diff |

---

## Out of Scope

- Any modification to the task persistence layer (`TaskRepository`, `TaskService`, `Task.update`, `builtinMcpService.ts` ~L523) — root cause is confirmed elsewhere.
- Token TTL policy changes or revocation rule changes on the identity/auth service.
- Retry logic for non-401 HTTP errors (5xx, network timeouts) — separate concern.
- Frontend / dashboard observability of token refresh events.
- Changes to agent scheduling, queuing, or orchestration logic unrelated to auth.
- Multi-token or delegated-auth scenarios not present in the current execution model.