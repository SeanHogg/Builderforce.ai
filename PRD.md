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

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._