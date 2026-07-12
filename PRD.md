> **PRD** — drafted by John Coder ((V2) (Durable)) · task #656
> _Each agent that updates this PRD signs its change below._

# PRD: Agent Execution Auth Token Lifecycle Fix

## Problem & Goal

### Problem
Long-running agent executions intermittently abort with `401 Token revoked or expired` when the API/gateway auth token expires mid-run. This failure has two cascading effects:

1. **Hard abort**: The execution terminates mid-flight, losing all in-progress work.
2. **Silent data corruption**: Tool calls made near the moment of token expiry (e.g. `tasks.update`) appear to succeed but return stale or null field values — giving the agent a false signal that state was persisted when it was not reliably read back. This has been misread as a persistence bug; it is not. The DB write path is correct.

### Goal
Make agent executions resilient to token expiry by (a) proactively refreshing tokens before they expire, or (b) transparently retrying on `401` with a fresh token. Ensure no tool call can silently return degraded data due to an auth failure.

---

## Target Users / ICP Roles

| Role | Impact |
|---|---|
| **Agent runtime operators / platform engineers** | Own the fix; responsible for token lifecycle and retry logic |
| **Agent authors / AI workflow builders** | Experience the symptom — long-running agents silently fail or corrupt state |
| **QA / reliability engineers** | Need regression coverage for the token-refresh path |

---

## Scope

### In Scope
- Token acquisition, storage, and refresh logic in `Builderforce.ai/agent-runtime`
- Bearer auth / token-refresh logic in `Builderforce.ai/api` (gateway layer)
- The HTTP request layer shared by tool calls (MCP handler, `builtinMcpService.ts` and equivalents)
- Retry-on-401 middleware/interceptor
- Error surfacing for a second consecutive auth failure
- Unit/integration tests for the token-refresh-on-401 path

### Out of Scope
- `TaskRepository`, `TaskService`, `Task.update`, or any persistence layer — root cause is confirmed NOT here; do not refactor or re-investigate
- `assignedAgentRef` field semantics or schema changes
- General agent execution retry logic unrelated to auth
- UI/UX changes
- Token revocation policy (i.e., why tokens are being revoked — that is a separate security/infra concern)

---

## Functional Requirements

### FR-1 — Token Expiry Detection & Proactive Refresh
- **FR-1.1**: The agent runtime MUST read the token expiry time (`exp` claim or equivalent TTL) at token acquisition time.
- **FR-1.2**: A background refresh MUST be scheduled to fire at `expiry_time − refresh_buffer` (recommended buffer: 60 seconds, configurable) so that a valid token is always available before any in-flight request needs it.
- **FR-1.3**: If the proactive refresh fails, the runtime MUST log a warning and retry the refresh up to N times (recommended N=3, configurable) before treating it as a hard failure.

### FR-2 — Reactive Retry on 401
- **FR-2.1**: The shared HTTP request layer (used by all tool calls including MCP handlers) MUST intercept `401 Token revoked or expired` responses.
- **FR-2.2**: On first `401`, the interceptor MUST synchronously acquire a fresh token, then retry the original request exactly once with the new token.
- **FR-2.3**: If the retried request also returns a `401`, the interceptor MUST throw a hard, descriptive error (e.g. `AuthError: Token refresh failed after retry — execution cannot continue`) and propagate it up to the execution harness, which must then cleanly abort the run with an error status.
- **FR-2.4**: The retry MUST replay the full original request (headers, body, method) with only the `Authorization` header replaced.

### FR-3 — No Silent Data Degradation
- **FR-3.1**: A tool call response MUST NOT be returned to the agent as a success if the underlying HTTP request failed due to auth and was not successfully retried. The tool call MUST surface an error.
- **FR-3.2**: Stale or null field values resulting from an auth failure (not a real null write) MUST NOT be returned to the agent. If auth cannot be recovered, the tool call errors — it does not return partial/null data.
- **FR-3.3**: The error message surfaced to the agent for an unrecoverable auth failure MUST be distinct from a legitimate "field is null" result so that observability tooling can differentiate them.

### FR-4 — Observability
- **FR-4.1**: Every token refresh attempt (proactive or reactive) MUST emit a structured log event: `{ event: "token_refresh", trigger: "proactive"|"401_retry", success: boolean, execution_id, timestamp }`.
- **FR-4.2**: A failed token refresh that results in execution abort MUST emit a structured error log distinguishable from other 401 causes.

---

## Acceptance Criteria

| # | Criterion | Verification method |
|---|---|---|
| AC-1 | A synthetic execution that runs longer than one token TTL completes successfully without a `401` abort | Integration test / execution #3920 replay |
| AC-2 | When the token server returns `401` on first attempt, the runtime retries exactly once and succeeds; only one refresh is issued | Unit test with mocked token server |
| AC-3 | When both the original request and the retry return `401`, the execution harness receives a hard `AuthError` and marks the run as failed (not hung, not silently degraded) | Unit test |
| AC-4 | `tasks.update` (and any tool call) never returns `{ assignedAgentRef: null }` as a success response when the actual cause is an expired token — it returns a clear error instead | Unit test mocking 401 mid-tool-call |
| AC-5 | Proactive refresh fires before token expiry (within the configured buffer window) and does not interrupt in-flight requests | Unit test with injectable clock |
| AC-6 | Structured log events are emitted for each refresh attempt with correct fields | Log assertion in unit/integration tests |
| AC-7 | All new and modified code paths have ≥ 80% test coverage on the auth/retry logic specifically | CI coverage report |

---

## Out of Scope

- Any changes to `TaskRepository`, `TaskService`, `Task.update`, `TaskRepository.update`, or database schema — the persistence path is verified correct and must not be touched
- Investigation or changes to why tokens are being revoked server-side
- General execution retry / checkpoint/resume logic
- Rate limiting, throttling, or backoff unrelated to auth
- Frontend/dashboard changes
- Multi-tenant token isolation (separate workstream)