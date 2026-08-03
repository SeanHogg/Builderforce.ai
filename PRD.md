> **PRD** — drafted by Ada (Sr. Product Mgr) · task #560
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Credential Leak Prevention in Logs, Errors, and API Responses

## Problem & Goal

**Problem:** API keys, tokens, and other credentials may inadvertently appear in plain text within application logs, error messages, or API responses. This exposes sensitive data to unauthorized internal consumers, monitoring systems, or external attackers via leaked logs or stack traces.

**Goal:** Audit and harden all integration code paths to guarantee that no full credential values are ever logged, displayed in error payloads, or returned in API responses. Implement consistent masking or scrubbing, fulfilling functional requirement **FR-4.2** and acceptance criterion **AC-INC-4**.

## Target Users / ICP Roles

- **Security Engineers** – Verify that sensitive data handling complies with security policies and perform independent audits.
- **Platform/DevOps Engineers** – Consume logs and error outputs; require confidence that secrets are absent.
- **Compliance Officers** – Need auditable evidence that credential leak prevention controls are effective.
- **Developers** – Build and maintain integration code, error handlers, and tests; must adopt safe logging practices and use masking utilities correctly.

## Scope

- All integration code paths where credentials are initialized, referenced, or transmitted (API clients, HTTP handlers, authentication middleware).
- Logging statements across all layers (structured and unstructured, debug/trace/info/error levels).
- Error handling functions that capture and forward request/response details or stack traces.
- API response formatting, including internal error objects returned to clients.
- Unit, integration, and end-to-end tests designed to verify that no full credentials appear in log captures or error responses.
- Automated masking of known credential fields and patterns in serialized data, headers, and URL query strings.
- Alignment with requirement **FR-4.2** and acceptance criterion **AC-INC-4**.

## Functional Requirements

- **FR1 – Credential Scrubbing in Logging**
  - Intercept all log messages and replace full credential strings with masked representations (e.g., `****` or `[REDACTED]`) before writing to any sink.
  - Masking must apply to both structured fields and unstructured string interpolations.
  - Known patterns (Bearer tokens, Base64 keys, `X-Api-Key`, `Authorization`, etc.) must be detected and masked regardless of context.

- **FR2 – Safe Error Handling**
  - Error handlers must sanitize all error objects, stack traces, and attached metadata that could contain credentials before inclusion in error logs or HTTP error responses.
  - If an upstream service returns an error body containing a credential, it must be stripped before being logged or relayed.

- **FR3 – API Response Integrity**
  - Internal error payloads sent to API clients must never contain raw credentials. Only sanitized, generic messages are permitted.
  - Serialization middleware (JSON, XML) must apply credential masking before rendering output.

- **FR4 – Automated Testing with Leak Detection**
  - All integration tests must include assertions that captured logs and error responses contain zero full credential strings.
  - Test suites must exercise variable credential sources (environment variables, config files, request headers) to validate masking across initialization paths.

- **FR5 – Configurable Masking Rules**
  - Administrators can define additional patterns and field names to treat as credentials.
  - Default configuration covers common credential formats (AWS keys, JWT tokens, session tokens, database connection strings).

## Acceptance Criteria

- **AC1** – No full API key, token, or other credential appears in any log output (including DEBUG/TRACE) under normal or failure conditions.
- **AC2** – Integration test suites automatically scan all captured logs and error responses; zero unmasked credentials found.
- **AC3** – When an error object contains a header like `Authorization: Bearer <token>`, the logged version shows `Authorization: Bearer ****`.
- **AC4** – Any 4xx or 5xx API response that includes internal diagnostics (stack traces, request dumps) does not expose raw credentials.
- **AC5** – Manual inspection of error monitoring dashboards (e.g., Sentry, Datadog) confirms credentials are replaced with `[REDACTED]` or a similar mask.
- **AC6** – The system meets the exact validation criteria defined in FR-4.2 and AC-INC-4.
- **AC7** – CI/CD pipeline runs a dedicated “leak detection” regression suite that fails the build if any test captures an unmasked credential.

## Out of Scope

- Encryption of credentials at rest or in transit (handled by separate security requirements).
- Access control to log storage (e.g., IAM roles for logging platforms).
- Obfuscation of non-credential PII (only credential values targeted; other data types may be covered elsewhere).
- Retroactive remediation of already archived historical logs (this project ensures future protection).
- Auditing of third-party libraries’ internal logging (only integration points maintained by the team).

## Requirements

> **Authored by:** Business Analyst (code-creator + code-reviewer + test-generator personas)
> **Date:** 2025-07-16
> **Based on:** Full audit of `api/src/` error handling, logging, and credential display code paths against the repo on branch `builderforce/task-560`.

### R1 — Expand `redactSecrets()` Coverage to All Log and Error Sinks

**Current state:** The `redactSecrets()` utility in `api/src/infrastructure/security/redactSecrets.ts` is comprehensive (16 patterns covering Bearer tokens, API key prefixes, PEM blocks, env-style assignments, and JSON fields) but is **only called from `traceLogger.ts`**. The error-reporting pipeline (`persistCaughtError.ts` → `api_error_log` + Sentry), the global `console.error` calls, and the unhandled-error handler do not use it.

**Requirement:**

1. `persistCaughtError.ts` MUST call `redactSecrets()` on `record.message` and `record.stack` before inserting into `api_error_log` and before forwarding to Product Quality (Sentry).
2. `caughtErrorReporter.ts` `sanitizeContextValue()` MUST extend its redaction beyond key-name matching: after the current key-name check, every string value MUST be scanned through `redactSecrets()` to catch secrets embedded in generic keys (e.g. `{ response: "Authorization: Bearer abc123", body: "apiKey=sk-..." }`).
3. `caughtErrorReporter.ts` `reportCaughtError()` and `reportUnhandledError()` console.error calls MUST redact the `record.message`, `record.stack`, and serialized `record.context` through `redactSecrets()` before emitting to stdout/stderr.
4. Every call site that writes to `console.error`/`console.warn`/`console.log` with user-supplied or request-derived data MUST be identified and either (a) routed through a centralized logger that applies `redactSecrets()`, or (b) individually audited as safe (no credentials possible in the logged value).

**Verification:** Inject a known secret pattern (e.g., `sk-test1234567890abcdef`) into an error path and confirm it appears as `sk-test…cdef` in `api_error_log.context`, the Sentry event, and the Worker console output.

---

### R2 — Sanitize `err.message` in the Global Error Handler Before It Reaches the Client

**Current state:** `api/src/presentation/middleware/errorHandler.ts` catch-all branch (the `else` block, line 35–39) returns `{ error: message }` where `message` is `err.message`. If a third-party API call throws with a message like `"HTTP 401: invalid token sk-abc123..."`, that raw token is returned to the API caller.

**Requirement:**

1. The `errorHandler.ts` catch-all branch MUST apply `redactSecrets()` to the error message before including it in the JSON response body.
2. Domain errors (`ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`) are assumed safe (the application constructs their messages), but MUST be documented as such with a comment so future contributors know not to pass unsanitized external data into them.
3. If the `redactSecrets()` pass changes the message (indicating a secret was present), the handler MUST ALSO log a `[SECURITY]`-prefixed warning through `reportCaughtError()` so the operations team can investigate how a secret entered the error path — this is a signal that something upstream is leaking.

**Verification:** Throw an error with message `"API call failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdef"` — the HTTP 500 response body must show `"API call failed: Authorization: Bearer eyJhbG…f"` and a `[SECURITY]` warning must be logged.

---

### R3 — Integration Routes: Audit and Harden Connectivity-Test Error Paths

**Current state:** `api/src/presentation/routes/integrationRoutes.ts` connectivity tests (`testGitHub`, `testJira`, `testBitbucket`, etc.) catch network errors and return `{ ok: false, message: e.message }`. If the thrown error's message contains the token (e.g., a DNS resolution error from a misconfigured proxy that echoes the full request URL including `?token=abc`), it could leak. Additionally, the connectivity test functions pass raw `creds` (decrypted credentials) to `fetch()` — but they never log these, which is correct.

**Requirement:**

1. All `test*()` functions in `integrationRoutes.ts` MUST apply `redactSecrets()` to any `e.message` or `String(e)` before returning it in the `message` field.
2. The `POST /api/integrations/:id/test` response (which returns `result.message` to the caller) is already gated behind `requireRole(TenantRole.MANAGER)` — this is acceptable but must be documented as a deliberate risk-acceptance: managers with access to the integrations page can see masked tokens in the detail view (`****` + last 4 chars) and connectivity test results.
3. Add a comment in each `test*()` function noting that `creds` must never be logged, serialized, or embedded in error messages — the `redactSecrets()` call on the catch path is the defense-in-depth.

**Verification:** Mock a `fetch()` failure that throws `Error("connect ECONNREFUSED https://api.github.com?token=ghp_1234567890abcdef")` — the test result message must show the token redacted.

---

### R4 — Hardened `caughtErrorReporter` Context Value Scanning

**Current state:** `sanitizeContextValue()` in `caughtErrorReporter.ts` checks `SENSITIVE_CONTEXT_KEY` regex against the **key name** only. String values under non-sensitive keys pass through unexamined. Depth-limited to 5 and entry-capped at 50, which prevents runaway recursion but means deeply nested credentials are silently truncated rather than redacted.

**Requirement:**

1. After the key-name check, `sanitizeContextValue()` MUST apply `redactSecrets()` to every string value before returning it. This ensures secrets hidden under generic keys (`body`, `response`, `headers`, `data`, `raw`) are caught.
2. The `redactSecrets()` pass MUST run BEFORE the `MAX_CONTEXT_STRING` truncation (the current order is: key-check → length-truncate → return; change to: key-check → redact → length-truncate → return) so a secret at the tail of a long string is still masked.
3. Objects truncated by `MAX_CONTEXT_DEPTH` or `MAX_CONTEXT_ENTRIES` MUST produce a `[TRUNCATED]` marker in the sanitized output so operators know the record is incomplete.

**Verification:** Report an error with context `{ data: { raw: '{"Authorization":"Bearer eyJhbGciOiJIUzI1NiJ9.secret"}' } }` — the persisted context must show the Bearer token redacted.

---

### R5 — Leak Detection Test Suite (FR4 / AC2 / AC7)

**Current state:** `caughtErrorReporter.test.ts` tests key-name redaction but does not test value-pattern scanning. No test exercises `redactSecrets()` against real secret-shaped payloads in the error pipeline. No CI step fails on detected secrets.

**Requirement:**

1. Create a dedicated test file `api/src/infrastructure/security/redactSecrets.test.ts` with:
   - Parameterized tests for every `SECRET_PATTERNS` entry (each pattern is exercised with at least one positive match and one negative non-match).
   - Edge cases: empty string, string with only secret characters, string matching multiple patterns, already-redacted strings (idempotency).
   - Performance: a 100KB string with zero secrets must complete in <50ms (to ensure the regex set does not cause ReDoS).
2. Create `api/src/application/observability/caughtErrorReporter.leak.test.ts` with:
   - A test that passes context containing known secret patterns (Bearer token, `sk-` key, GitHub PAT, AWS key) through `reportUnhandledError()` and asserts zero full secrets appear in the delivered sink record (message, stack, context values).
   - A test that the `[SECURITY]` warning fires when a secret is detected during error handling.
3. Create `api/src/presentation/middleware/errorHandler.leak.test.ts` with:
   - A test that the catch-all 500 response body never contains a raw credential string.
   - A test that the `[SECURITY]` warning fires when `redactSecrets()` modifies the error message.
4. Add a `package.json` script `"test:leak"` that runs only the `*.leak.test.ts` files via vitest.
5. These tests MUST be run in CI and the build must fail if any test captures an unmasked credential (AC7).

**Verification:** Run `npm run test:leak` — all tests pass. Temporarily disable redaction in one path and confirm the test fails with the detected secret string.

---

### R6 — Configurable Masking Rules (FR5)

**Current state:** `SECRET_PATTERNS` in `redactSecrets.ts` is a hardcoded `const` array. There is no mechanism for administrators to add patterns at runtime, and no environment-variable-based extension mechanism.

**Requirement:**

1. `redactSecrets.ts` MUST export a `registerSecretPattern(pattern: RegExp): void` function that appends to the active pattern list at runtime.
2. On Worker cold-start, `redactSecrets.ts` MUST read an optional `SECRET_REDACT_EXTRA_PATTERNS` environment variable (JSON array of regex source strings with flags, e.g. `[{"source":"my-custom-key-[a-z0-9]+","flags":"gi"}]`) and register each as an additional pattern.
3. Patterns registered via env var or `registerSecretPattern()` MUST NOT be removable (no deregistration) to prevent accidental disabling.
4. The env-var mechanism MUST be documented in `redactSecrets.ts` with a comment explaining the format and noting that bad regexes that throw on construction or cause catastrophic backtracking are logged and skipped (never crash the Worker).

**Verification:** Set `SECRET_REDACT_EXTRA_PATTERNS='[{"source":"acme-secret-[0-9a-f]{16}","flags":"gi"}]'` — confirm `redactSecrets("use acme-secret-1234567890abcdef here")` returns `"use acme-secret-…cdef here"`.

---

### R7 — Audit Logging for Secret Detection Events

**Current state:** When `redactSecrets()` modifies a string, there is no signal that a secret was present. Security engineers and compliance officers have no way to audit whether credentials are routinely appearing in logs — only that they are being masked.

**Requirement:**

1. `redactSecrets()` MUST return, alongside the redacted string, a count of how many replacements were made. The signature changes from `(text: string) => string` to `(text: string) => { redacted: string; replaced: number }`.
2. Every call site that uses `redactSecrets()` MUST log a structured `[SECURITY:redaction]` event (at WARN level) when `replaced > 0`, including `count: replaced`, `source` (the module that called redaction, e.g. `"traceLogger"`, `"errorHandler"`, `"persistCaughtError"`), and the original length vs. redacted length delta. Do NOT include the original string or the redacted string — only the metadata.
3. The `[SECURITY:redaction]` events MUST be queryable from the admin Logs page (extend `errorLogQuery.ts` or add a new query) so compliance officers can produce an audit report of secret-leak attempts by module and frequency.
4. Backward compatibility: Existing callers (`traceLogger.ts` `redactedJsonOrNull()`) MUST be updated to the new return shape. Since `redactSecrets` is only imported in `traceLogger.ts` and `redactSecrets.test.ts` (new), this is a contained change.

**Verification:** Call `redactSecrets("apiKey=sk-abc123")` — result is `{ redacted: "apiKey=sk-abc…c123", replaced: 1 }`. A `[SECURITY:redaction]` event with `count:1` and `source:"test"` is logged.

---

### R8 — Documentation and Developer Guardrails

**Current state:** No project-level documentation tells developers how to safely log or handle credentials. The `SECRET_PATTERNS` comment block links to `agent-runtime/src/logging/redact.ts` (which does not exist in this repo).

**Requirement:**

1. Remove or correct the stale reference to `agent-runtime/src/logging/redact.ts` in `redactSecrets.ts` — the API's `redactSecrets.ts` is its own source of truth and must not imply synchronization with a non-existent file.
2. Add a `CONTRIBUTING.md` section titled "Safe Logging & Credential Handling" with:
   - Never `console.log(err)` or `console.error(JSON.stringify(response))` — always go through `reportCaughtError()` or `redactSecrets()`.
   - If you add a new secret-shaped field to any API, add a pattern to `SECRET_PATTERNS` in `redactSecrets.ts`.
   - The integration routes's `maskToken()` pattern (show `****` + last 4) is the approved display format for credential values in API responses.
3. Add an `.cursor/rules/safe-logging.md` (or equivalent) rule that lints against raw `console.log` calls with request/response objects.

**Verification:** The stale `agent-runtime` reference is gone from `redactSecrets.ts`. `CONTRIBUTING.md` has the new section.

---

### Gap Summary (Discovered During Audit)

| # | Gap | Severity | Mitigation |
|---|-----|----------|------------|
| G1 | `errorHandler.ts` catch-all returns raw `err.message` to clients | **HIGH** | R2 — apply `redactSecrets()` before responding |
| G2 | `persistCaughtError.ts` stores raw `message` + `stack` in DB and Sentry | **HIGH** | R1 — apply `redactSecrets()` before persistence |
| G3 | `caughtErrorReporter.ts` only redacts by key name, not value content | **HIGH** | R4 — scan all string values through `redactSecrets()` |
| G4 | No test suite detects secret leaks in error/log paths | **MEDIUM** | R5 — dedicated `*.leak.test.ts` suite |
| G5 | No audit trail when secrets are redacted | **MEDIUM** | R7 — structured `[SECURITY:redaction]` events |
| G6 | No runtime-configurable pattern extension | **LOW** | R6 — env-var and `registerSecretPattern()` API |
| G7 | Stale reference to non-existent `agent-runtime/src/logging/redact.ts` | **LOW** | R8 — correct the comment |
| G8 | Integration connectivity tests return `e.message` without redaction | **LOW** | R3 — apply `redactSecrets()` in catch blocks |
| G9 | `redactSecrets()` return type change breaks `traceLogger.ts` caller | **N/A (this work)** | R7§4 — update `redactedJsonOrNull()` |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._