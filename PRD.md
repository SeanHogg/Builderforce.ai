> **PRD** — drafted by Ada (Sr. Product Mgr) · task #546
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: JWT Authorization via Query String Deprecation

## Problem & Goal
**Problem:** The `authMiddleware` currently accepts JWT tokens via the `?token=` query string parameter to support WebSocket and legacy clients. This causes tokens to leak into server logs, browser history, and HTTP Referer headers, creating a security vulnerability.

**Goal:** Enforce the secure `Authorization: Bearer` header method for all new endpoints, provide a progressive deprecation path for existing consumers, and eliminate token leakage through URLs.

## Target Users / ICP Roles
- **API Consumers:** Developers integrating with the API (both legacy and new)
- **Platform Engineers:** Responsible for maintaining middleware security and observability
- **Security/Compliance Teams:** Auditing token handling and log hygiene

## Scope
- `authMiddleware` in `api/src/presentation/middleware/authMiddleware.ts`
- All endpoints that currently rely on query string token extraction
- Logging and monitoring additions for token deprecation tracking
- Feature flag integration for progressive rollout

## Functional Requirements

### FR1: Feature-Flagged Deprecation Mode
- Introduce a feature flag (e.g., `AUTH_QUERY_STRING_DEPRECATED`) that controls behavior.
- **Flag ON:** Middleware rejects `?token=` with `400 Bad Request` and a descriptive error message; only `Authorization: Bearer` is accepted.
- **Flag OFF:** Middleware continues to accept `?token=` but logs a structured deprecation warning including `TargetDate`.

### FR2: Deprecation Warning Logging
- When `?token=` is used and flag is OFF, emit a warning log containing:
  - `message`: "JWT via query string is deprecated"
  - `targetDate`: ISO 8601 date when support will be fully removed
  - `clientInfo`: User-Agent, IP (if available), and sanitized route path (no token)
- Log must never include the raw token value.

### FR3: Bearer-Only Authorization Requirement
- All new endpoints must exclusively use `Authorization: Bearer <token>`.
- Middleware must validate the `Authorization` header format (`Bearer <token>`) before falling back to query string extraction.
- Existing endpoints using `?token=` will be migrated to Bearer-only in accordance with the deprecation timeline.

### FR4: Audit & Hard-Limit Documentation
- Document in API docs that tokens must never appear in URLs or logs.
- Expose rate-limit plan caps and audit logging capabilities for token leak detection.
- Add a one-time audit script to identify existing query string token usage in production logs.

## Acceptance Criteria
- **AC1:** With feature flag ON, requests with `?token=` return `400` and `{"error": "Query string token authentication is deprecated. Use Authorization: Bearer header."}`
- **AC2:** With feature flag OFF, requests with `?token=` succeed but produce a structured deprecation log conforming to FR2.
- **AC3:** All stored/transmitted logs contain zero occurrences of JWT tokens from query strings.
- **AC4:** Documentation reflects the new requirement and deprecation timeline.
- **AC5:** Unit and integration tests cover both flag ON/OFF paths, including log assertions.

## Out of Scope
- Auto-migration of legacy clients (client-side changes are the responsibility of client owners)
- Removal of WebSocket-specific authentication mechanisms outside HTTP middleware
- Deprecation of `Authorization: Bearer` header method itself
- Scanning or purging historical logs for already-leaked tokens

## Requirements

_Author: Business Analyst — task #546_

### R1: Environment Variable Feature Flag

**R1.1.** Add a new optional string binding `AUTH_QUERY_STRING_DEPRECATED` to the `Env` interface in `api/src/env.ts`, matching the existing kill-switch pattern (`GUEST_BRAIN_ENABLED`, `DEMO_ACCOUNTS_ENABLED`). The binding is set via `wrangler secret put AUTH_QUERY_STRING_DEPRECATED`.

**R1.2.** Semantics:
- When the binding is the string `"true"` (case-insensitive), the middleware is in **deprecation-ON** mode: query string token authentication is blocked.
- Any other value, absent, or unset → **deprecation-OFF** mode: query string tokens are still accepted with a warning log.

**R1.3.** The flag is read once per request from `c.env.AUTH_QUERY_STRING_DEPRECATED`. No database lookups or external calls are required — this is a zero-latency check.

### R2: Middleware Behavior Change

**R2.1. Current flow (reference):** `authMiddleware.ts` line ~59 reads:
```
const tokenParam = c.req.query('token');
const token = header.startsWith('Bearer ') ? header.slice(7) : tokenParam;
```
This unconditionally falls back to the query string when the `Authorization` header is absent or not a `Bearer` token.

**R2.2. New flow:**

```
┌─ Request ─────────────────────────────────────────────────┐
│ 1. Extract Authorization header                           │
│ 2. IF header starts with "Bearer " → use it (as today)    │
│ 3. ELSE IF ?token= is present:                            │
│    a. Read AUTH_QUERY_STRING_DEPRECATED from env           │
│    b. IF flag === "true":                                  │
│       → throw ValidationError with AC1 message (400)       │
│    c. ELSE (flag OFF):                                     │
│       → emit deprecation warning (see R3)                  │
│       → use ?token= value (as today)                       │
│ 4. ELSE → throw UnauthorizedError as today                 │
└────────────────────────────────────────────────────────────┘
```

**R2.3.** The deprecation check must happen **after** the `Authorization: Bearer` header check and **before** the `tokenParam` value is used for verification, so the warning is only emitted when the query string path is actually taken.

**R2.4.** The `isEmulation` short-circuit at the top of `authMiddleware` is unchanged — emulation tokens bypass JWT verification entirely and are not affected by this deprecation.

**R2.5.** Machine tokens (`agentHost:*` / `embed:*`) and cloud agent replay tokens are subject to the same deprecation rules as user JWTs — if they arrive via `?token=`, they are rejected or warned identically.

### R3: Deprecation Warning Log Schema

**R3.1.** When `?token=` is used and the flag is OFF, emit a single `console.warn` call with the following structured payload:

```json
{
  "warning": "deprecated_auth_query_string",
  "message": "JWT via query string is deprecated",
  "targetDate": "2026-06-30T00:00:00.000Z",
  "clientInfo": {
    "userAgent": "<User-Agent header value, or null>",
    "ip": "<cf-connecting-ip or x-forwarded-for, first value only, or null>",
    "path": "<req.path only — no query string, no token>"
  }
}
```

**R3.2.** The payload **must never** include the raw JWT token, the full URL, or the full query string. Only `req.path` (the path segment with no query parameters) is logged. The existing `caughtErrorReporter.ts` `SENSITIVE_CONTEXT_KEY` regex already redacts keys matching `token`, `authorization`, `credential`, `secret`, `password`, `cookie`, and `api_key` — the deprecation log is structured to never carry these values in the first place, providing defense in depth.

**R3.3. `targetDate`** is `"2026-06-30T00:00:00.000Z"` — a hard-coded constant in the middleware file, giving consumers approximately 12 months from the PR merge date to migrate. This date is reviewed at each release and may be advanced if migration data shows readiness.

**R3.4.** The deprecation warning is fire-and-forget: it must not throw, must not block the response, and must not prevent the token from being used while the flag is OFF. Any failure to emit the log (e.g., a malformed `console.warn` argument) is swallowed silently.

### R4: Error Response Format

**R4.1.** When the flag is ON and `?token=` is present, the middleware throws a `ValidationError` (imported from `../../domain/shared/errors`), which the existing `errorHandler.ts` maps to HTTP `400`.

**R4.2.** Response body:

```json
{
  "error": "Query string token authentication is deprecated. Use Authorization: Bearer header."
}
```

**R4.3.** The response must include CORS headers per the existing `errorHandler.ts` → `addCorsToResponse` pattern.

**R4.4.** A `400` status is used (not `401`) because the caller's credentials are not necessarily invalid — the transport is deprecated. This is a client error in how the credential is presented, not in the credential itself.

### R5: Existing Code Preserved

**R5.1.** The `Authorization: Bearer` header path (the primary, secure path) is **unchanged**. No behavioral change occurs for callers already using `Authorization: Bearer`.

**R5.2.** The `tokenParam` variable and its usage in the existing `const token = header.startsWith('Bearer ') ? header.slice(7) : tokenParam` fallback remain intact, but the fallback is gated behind the feature flag check.

**R5.3.** All existing middleware concerns — session version checks, token revocation, terms acceptance, machine token handling, segment resolution — operate identically regardless of how the token was extracted (header or query string, flag ON or OFF).

**R5.4.** The `?token=` query parameter is still read via `c.req.query('token')` exactly as today; only the decision of whether to **use** it changes.

### R6: Test Requirements

**R6.1.** Unit tests must be added in a new file `api/src/presentation/middleware/authMiddleware.test.ts` (no existing test file for this middleware exists).

**R6.2.** Test cases:

| Test | Flag State | Input | Expected |
|------|-----------|-------|----------|
| `Authorization: Bearer` header only | OFF | Valid Bearer header, no `?token=` | 200, proceeds as normal |
| `Authorization: Bearer` header only | ON | Valid Bearer header, no `?token=` | 200, proceeds as normal |
| `?token=` only, flag OFF | OFF | No Auth header, valid `?token=` | 200, deprecation warning logged |
| `?token=` only, flag ON | ON | No Auth header, valid `?token=` | 400, AC1 error body |
| Both header and `?token=`, flag OFF | OFF | Valid Bearer header + `?token=` | 200, uses header (no warning — header wins) |
| Both header and `?token=`, flag ON | ON | Valid Bearer header + `?token=` | 200, uses header (no rejection — header wins) |
| No auth at all | OFF | No header, no `?token=` | 401, UnauthorizedError |
| No auth at all | ON | No header, no `?token=` | 401, UnauthorizedError |
| Flag set to non-"true" value | "false" | No header, valid `?token=` | 200, deprecation warning logged (flag is OFF) |
| Flag unset (undefined) | unset | No header, valid `?token=` | 200, deprecation warning logged (flag is OFF) |
| Deprecation warning payload shape | OFF | `?token=` present | Log contains `warning`, `message`, `targetDate`, `clientInfo` keys, no `token` key |
| Deprecation warning token exclusion | OFF | `?token=eyJhbG...` | Log payload contains zero occurrences of the raw JWT string |

**R6.3.** Tests must mock `c.env.AUTH_QUERY_STRING_DEPRECATED` to control the flag state. Use Hono's `c.env` binding — no need to mock Cloudflare Worker globals.

**R6.4.** Log assertions must capture `console.warn` calls via a test spy and validate the structured payload keys and absence of the token value.

### R7: Migration Path for API Consumers

**R7.1.** Consumers currently sending `?token=<jwt>` must migrate to `Authorization: Bearer <jwt>` before the `targetDate`.

**R7.2.** Migration steps for client owners:
1. Replace `?token=<jwt>` query parameter with `Authorization: Bearer <jwt>` HTTP header in all API calls.
2. For WebSocket connections, use the `sec-websocket-protocol` header or the `token` query parameter on the WebSocket upgrade request only (out of scope for this change — see Out of Scope).
3. Verify the client works with `AUTH_QUERY_STRING_DEPRECATED=true` in a staging environment before the hard cutoff.

**R7.3.** Platform engineers should monitor the deprecation warning log volume to track migration progress. A sustained decline in `deprecated_auth_query_string` warnings indicates successful client migration.

### R8: Configuration Surface Summary

| Item | Location | Type | Default | Production Value |
|------|----------|------|---------|-----------------|
| `AUTH_QUERY_STRING_DEPRECATED` | `Env` interface + `wrangler secret` | `string \| undefined` | unset (flag OFF) | `"true"` after migration window |
| Deprecation `targetDate` | Constant in `authMiddleware.ts` | `string` (ISO 8601) | `"2026-06-30T00:00:00.000Z"` | Reviewed per release |
| Warning log level | `console.warn` | — | — | `warn` (non-blocking, observable) |
| Rejection HTTP status | `ValidationError` → `errorHandler` | — | `400` | `400` |

### R9: Security Considerations

**R9.1.** The raw JWT token is never passed to `console.warn`, `reportCaughtError`, or any logging sink — only the sanitized deprecation payload is emitted.

**R9.2.** The `clientInfo.path` field uses `req.path` (pathname only), not `req.url` (which includes the query string). This prevents token leakage even if a future logging pipeline re-serializes the object.

**R9.3.** The existing `caughtErrorReporter.ts` `SENSITIVE_CONTEXT_KEY` regex (`/authorization|cookie|credential|password|secret|token|api[-_]?key/i`) provides defense in depth: if any future code path inadvertently includes the token in a caught error context, it is automatically redacted. This PR does not modify the regex — it is already correct.

**R9.4.** Token values arriving via `?token=` that are later rejected by `verifyJwt` (invalid/expired) produce the same `UnauthorizedError` as today when the flag is OFF, and the same `400` deprecation rejection when the flag is ON — the deprecation rejection is transport-based, not credential-based, so it fires before `verifyJwt` is called on a query-string token.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
