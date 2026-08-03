> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1539
> _Each agent that updates this PRD signs its change below._

# PRD: Reliable Kanban Sign-off Recording with Token Expiry Handling

## Problem & Goal
Ada (Product Manager) completed the PRD sign-off for task #586 and committed the updated PRD.md to the branch. However, the `builtin_kanban_signoff` tool returned a `401 Unauthorized` error with the message "Token has been revoked or expired" on two consecutive attempts. As a result, the accountability manifest sign-off could not be recorded automatically, leaving the official sign-off incomplete despite the deliverable being ready.

**Goal:** Ensure that authenticated users can reliably record sign-off actions via `builtin_kanban_signoff` even when their session token has expired, so that accountability manifests are always updated upon task completion. The solution must transparently handle token refresh, and provide a durable fallback when refresh is not possible.

## Target Users / ICP Roles
- **Product Managers** (e.g., Ada) who are responsible for PRD sign-offs and rely on automated sign-off recording.
- **Any authenticated agent** with sign-off authority that executes `builtin_kanban_signoff` as part of a workflow.
- **System administrators** who may need to manually resolve stuck sign-offs or review audit logs.

## Scope
- Modify the `builtin_kanban_signoff` tool to gracefully handle `401` errors caused by expired/revoked tokens.
- Introduce automatic token refresh using the agent's stored refresh token.
- Implement a durable queue for sign-off intents when token refresh is unavailable or fails.
- Add a manual admin override capability with full audit trail.
- Provide clear user-facing notifications when sign-off cannot be completed in real time.
- Logging and monitoring of token refresh attempts and sign-off queue status.

## Functional Requirements

- **FR1 – 401 Detection & Classification:**  
  When `builtin_kanban_signoff` receives a `401` response with a payload indicating token expiry or revocation, the system must recognize it as a recoverable error distinct from invalid credentials.

- **FR2 – Automatic Token Refresh:**  
  The tool must attempt to refresh the user's access token using the stored refresh token (if available) before failing the sign-off.  
  The refresh request must be made to the identity provider's token endpoint.

- **FR3 – Retry on Successful Refresh:**  
  If the token refresh succeeds, the tool must immediately retry the original sign-off request with the new access token.  
  On success, the sign-off is recorded as if no error occurred.

- **FR4 – Durable Sign-off Intent Queue:**  
  If token refresh fails (e.g., refresh token also expired, missing, or network error), the system must persist the sign-off intent (task ID, user ID, timestamp, and any supplemental metadata) in a durable queue.  
  The user must receive a clear message: "Your session has expired and automatic refresh failed. Sign-off for task #586 has been queued. Please re-authenticate, and the sign-off will be applied automatically."

- **FR5 – Automatic Processing of Queued Sign-offs:**  
  Upon the user's next successful authentication (or token refresh), the system must check for pending queued sign-offs and automatically execute them using the fresh token.  
  Duplicate prevention must be enforced (if the sign-off was already manually recorded).

- **FR6 – Manual Admin Override:**  
  An authorized administrator must be able to manually mark a sign-off as complete in the accountability manifest via a secure endpoint (e.g., `admin/manual-signoff`).  
  This action must be logged with the administrator's identity, timestamp, reason, and original task ID.

- **FR7 – Audit Logging:**  
  All token refresh attempts (success/failure), queue insertions, automatic retries, and manual overrides must be logged with correlated identifiers (user, task, request ID) for traceability.

- **FR8 – Notifications:**  
  The user must be informed immediately when a sign-off enters the queue, including a deep-link to re-authenticate.  
  On successful automatic retry after refresh, a confirmation may be sent (optional).

## Acceptance Criteria

- **AC1:** Ada performs the sign-off for task #586 using the fixed tool. If her token has expired, the system automatically refreshes it and completes the sign-off without her manual intervention.
- **AC2:** If automatic refresh fails, Ada sees a clear message that her sign-off is queued; after she re-authenticates, the queued sign-off is applied to the accountability manifest within 1 minute without further action.
- **AC3:** A manual admin override for task #586 successfully marks the sign-off as complete, and the audit log records the override event with all required fields.
- **AC4:** In a test scenario with an expired token, the system refreshes the token and records the sign-off within a total latency of ≤ 5 seconds beyond the normal sign-off duration.
- **AC5:** No duplicate sign-off entries are created when a queued sign-off is processed after a manual override has already recorded the sign-off.
- **AC6:** Audit logs capture: token refresh attempt outcome, queue insertion, automatic retry success, and manual override events, all searchable by task ID and user.

## Out of Scope
- General redesign of the authentication or token management system.
- Token refresh mechanisms for tools other than `builtin_kanban_signoff`.
- UI changes beyond the notification/inline message regarding queued sign-offs.
- Support for multi-step, multi-user sign-off workflows (e.g., sequential approvals).
- Guaranteed delivery of queued sign-offs across system-wide outages – only local durable queue required.

## Requirements

### REQ-1 — Sign-off Request Lifecycle

The `builtin_kanban_signoff` tool shall execute a three-phase sign-off request lifecycle:

| Phase | Action | Outcome on Success | Outcome on Failure |
|-------|--------|-------------------|-------------------|
| **1. Attempt** | Call kanban sign-off endpoint with current access token | Sign-off recorded → **done** | If 401 with token-expiry payload → proceed to Phase 2; any other error → return error to caller |
| **2. Refresh** | Call identity provider `/token` with stored refresh token | New access token obtained → proceed to Phase 3 | Persist sign-off intent to durable queue → return "queued" response to caller |
| **3. Retry** | Replay original sign-off request with fresh access token | Sign-off recorded → **done** | Persist sign-off intent to durable queue → return "queued" response to caller |

### REQ-2 — Token Expiry Detection

The system shall distinguish a token-expiry `401` from other `401` causes (invalid credentials, revoked API key, etc.) by inspecting the response payload. The classification rules are:

1. Response body contains `"error": "Token has been revoked or expired"` → classify as **TOKEN_EXPIRED** (recoverable via refresh).
2. Response body contains any other `"error"` string in a `401` → classify as **AUTH_FAILED** (not recoverable; do not attempt refresh).
3. No parseable JSON body → classify as **AUTH_UNKNOWN** (not recoverable; log and return error).

### REQ-3 — Token Refresh Flow

3.1 The refresh token shall be stored alongside the access token in the agent's session state, provisioned at authentication time by the identity provider.

3.2 The refresh request shall be an `HTTP POST` to the identity provider's token endpoint (`POST /oauth/token` or equivalent), with body:
```
grant_type=refresh_token
refresh_token=<stored_refresh_token>
client_id=<client_id>
```

3.3 On success (HTTP 200), the response shall contain a new `access_token` and optionally a new `refresh_token` (rotation). The system shall update its stored tokens atomically — the old access token is replaced and, if a new refresh token is issued, the old refresh token is replaced.

3.4 The token refresh shall time out after **5 seconds** — if the identity provider does not respond within that window, the refresh is treated as failed and the sign-off is queued.

3.5 The system shall enforce **at-most-once** refresh semantics: if two concurrent sign-off calls from the same user both encounter `401`, only one refresh request shall be in flight; the second call shall await its result.

### REQ-4 — Durable Sign-off Intent Queue

4.1 Each queued sign-off intent shall be a structured record with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique queue item identifier |
| `task_id` | integer | The task whose sign-off is being recorded |
| `user_ref` | string | The agent or user reference performing the sign-off |
| `role_key` | string | The role being signed off (e.g., `product-manager`) |
| `lane_key` | string | The lane in which sign-off is being recorded |
| `verdict` | string | `approved`, `changes_requested`, `waived`, or `delegated` |
| `summary` | string | The sign-off summary text |
| `contribution` | JSON | The linked contribution evidence (PR URL, diff files, execution ID, etc.) |
| `created_at` | ISO 8601 timestamp | When the intent was queued |
| `status` | enum | `pending`, `processing`, `completed`, `failed`, `duplicate` |
| `attempts` | integer | Number of processing attempts so far |
| `last_error` | string | null | Most recent error message, if any |
| `request_id` | string | Correlating request ID for audit trail |

4.2 The queue shall be **durable** — stored in the application database (not in-memory), surviving process restarts.

4.3 The queue shall be **scoped per user** — a user's queued sign-offs are isolated from other users'.

4.4 On queue insertion, the system shall return a structured response to the caller:
```json
{
  "status": "queued",
  "message": "Your session has expired and automatic refresh failed. Sign-off for task #<id> has been queued. Please re-authenticate, and the sign-off will be applied automatically.",
  "queue_id": "<uuid>",
  "reatuth_url": "/auth/login?redirect=/tasks/<id>"
}
```

### REQ-5 — Automatic Queue Drain

5.1 **Trigger:** When a user successfully authenticates (new login) or refreshes their token (manual or automatic), the system shall fire a `user.authenticated` event.

5.2 **Drain handler:** A listener on `user.authenticated` shall:
1. Query the queue for all `pending` items belonging to that user, ordered by `created_at` ascending.
2. For each item, set status to `processing`, increment `attempts`.
3. Execute the sign-off using the fresh access token.
4. On success: set status to `completed`, log the audit event.
5. On failure: if `attempts < 3`, set status back to `pending` for the next drain cycle; if `attempts >= 3`, set status to `failed` and notify the user.

5.3 **Duplicate prevention:** Before executing a queued sign-off, the system shall check the accountability manifest to confirm no sign-off already exists for the same `(task_id, user_ref, role_key)` tuple. If one exists, set the queue item status to `duplicate` and skip execution.

### REQ-6 — Manual Admin Override

6.1 A secure endpoint shall be exposed: `POST /api/admin/manual-signoff`

6.2 The endpoint shall accept:
```json
{
  "task_id": 586,
  "role_key": "product-manager",
  "lane_key": "backlog",
  "verdict": "approved",
  "summary": "Manual override — PRD deliverable verified on branch",
  "reason": "Token refresh infrastructure unavailable; sign-off verified via branch inspection",
  "contribution": {
    "pr_url": "https://github.com/SeanHogg/Builderforce.ai/pull/480",
    "execution_id": 24510
  }
}
```

6.3 The endpoint shall be restricted to users with the `admin` or `kanban:admin` role — enforced by middleware before the handler executes.

6.4 On success, the override shall:
1. Record the sign-off in the accountability manifest identically to a normal `builtin_kanban_signoff` call.
2. Write an audit log entry with `override: true`, the administrator's identity, timestamp, reason, and original task ID.
3. Scan the durable queue for any pending intent matching this `(task_id, role_key)` and mark it `duplicate`.

6.5 The endpoint shall return the created sign-off record with a `201 Created` status.

### REQ-7 — Audit Log Schema

7.1 Every auditable event shall be written to a structured audit log with the following columns:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `event_type` | enum | `token_refresh_attempt`, `token_refresh_success`, `token_refresh_failed`, `signoff_queue_inserted`, `signoff_queue_retry_success`, `signoff_queue_retry_failed`, `signoff_queue_duplicate`, `signoff_manual_override` |
| `user_ref` | string | The agent/user performing (or attempting) the action |
| `task_id` | integer | The task being signed off (nullable for token-only events) |
| `request_id` | string | Correlating request identifier |
| `outcome` | string | `success`, `failure`, `queued`, `duplicate` |
| `detail` | JSON | Free-form event payload (error messages, token metadata — never the token itself) |
| `created_at` | ISO 8601 timestamp | When the event occurred |

7.2 The audit log shall be **append-only** — no updates or deletes.

7.3 The audit log shall be queryable by `task_id`, `user_ref`, `event_type`, and date range via an admin dashboard or API.

### REQ-8 — User-Facing Messaging

8.1 **Successful sign-off (normal path):** No change from current behavior — the caller receives the standard success response.

8.2 **Successful sign-off (after transparent refresh):** No visible change to the caller — the response is identical to the normal success case, with an additional `refreshed: true` boolean in the response metadata for tracing.

8.3 **Queued sign-off:** The caller receives the structured response defined in REQ-4.4. The platform shall also surface this as a toast/notification in the UI: "Sign-off queued — re-authenticate to apply."

8.4 **Queue drained after re-auth:** The user receives a confirmation notification: "Your queued sign-off for task #<id> has been applied." If multiple queued sign-offs were drained, a summary is shown: "N queued sign-offs have been applied."

8.5 **Admin override:** The administrator receives a confirmation response. The original user (if different from the admin) receives a notification: "An administrator has manually recorded your sign-off for task #<id>."

### REQ-9 — Performance Constraints

9.1 Token refresh shall not add more than **3 seconds** to the total sign-off latency (95th percentile). Combined with the typical sign-off duration, the total latency for a refresh-then-retry path shall be ≤ 5 seconds beyond the normal duration (AC4).

9.2 Queue drain on authentication shall complete within **30 seconds** for up to 50 queued items. If more items are queued, the drain shall be batched with a configurable page size (default: 50).

9.3 The audit log write shall be non-blocking (fire-and-forget with error logging) — a failed audit write shall not prevent the sign-off from succeeding.

### REQ-10 — Security

10.1 Refresh tokens shall be stored encrypted at rest (AES-256-GCM or equivalent).

10.2 The manual admin override endpoint shall require both authentication AND the `admin` or `kanban:admin` role.

10.3 Audit logs shall never contain access tokens or refresh tokens in any field.

10.4 The sign-off intent queue shall not expose queue items of one user to another user — query scoping shall enforce `user_ref` isolation.

10.5 Rate-limiting shall be applied to the token refresh endpoint (max 5 refreshes per user per minute) to prevent abuse.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
