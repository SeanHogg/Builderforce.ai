> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #311
> _Each agent that updates this PRD signs its change below._

# PRD: OAuth / Token-Based Connector Framework

## Problem & Goal

Integrating multiple third-party services today requires each engineering team to independently implement authentication flows, token lifecycle management, and credential storage — leading to duplicated code, inconsistent security practices, and slow time-to-integration. The goal is to build (or reuse where viable) a unified set of OAuth 2.0 and token-based connectors that any internal service or agent can consume to authenticate against external APIs securely and reliably.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Platform / Integration Engineers** | Reusable, well-documented connectors that abstract auth complexity |
| **Product Engineers** | Drop-in auth for new third-party integrations without writing boilerplate |
| **Security Engineers** | Centralized credential storage, rotation, and audit logging |
| **DevOps / SRE** | Observable token refresh cycles, alerting on auth failures |
| **AI Agents / Downstream Automation** | Programmatic, headless token acquisition and refresh without human intervention |

---

## Scope

### In Scope

- OAuth 2.0 flows: Authorization Code, Client Credentials, Device Code, and Refresh Token grant types
- API-key / static-token connectors (Bearer, Basic Auth, custom header schemes)
- Token lifecycle management: acquisition, storage, refresh, expiry detection, and revocation
- A connector registry listing all supported services with their auth metadata
- Adapters for at minimum the following service categories:
  - **Productivity / Collaboration**: Google Workspace, Microsoft 365 / Entra ID, Slack, Notion
  - **Developer Tooling**: GitHub, GitLab, Jira, Linear, Confluence
  - **Data / Analytics**: Snowflake, BigQuery (GCP SA), Databricks
  - **CRM / Sales**: Salesforce, HubSpot
  - **Communication**: Twilio, SendGrid, Mailgun
  - **Cloud Providers**: AWS (STS/IAM), GCP (service accounts), Azure (managed identity)
  - **AI / Model APIs**: OpenAI, Anthropic, Cohere, Azure OpenAI
- Secure credential storage interface (pluggable backend: Vault, AWS Secrets Manager, GCP Secret Manager, env-based for local dev)
- SDK-style interface (Python-first, TypeScript secondary) exposing `get_token()`, `refresh_token()`, `revoke_token()`, `is_valid()`
- CLI tool for registering new OAuth apps and seeding credentials

### Phased Delivery

| Phase | Deliverables |
|---|---|
| **Phase 1** | Core framework, credential store abstraction, Client Credentials + API-key connectors, 5 priority integrations (GitHub, Google, Slack, OpenAI, Anthropic) |
| **Phase 2** | Authorization Code flow with PKCE, Device Code flow, remaining integrations listed above |
| **Phase 3** | Connector plugin SDK for community/third-party additions, webhook-based token rotation alerts |

---

## Functional Requirements

### FR-1 — Connector Interface

1. Every connector **must** implement a common `BaseConnector` interface with the methods: `get_token()`, `refresh_token()`, `revoke_token()`, and `is_valid() → bool`.
2. Connectors **must** return a normalized `TokenResponse` object containing: `access_token`, `token_type`, `expires_at` (UTC ISO-8601), `scopes`, and optional `refresh_token`.
3. Connectors **must** surface provider-specific errors mapped to a standardized `ConnectorError` hierarchy (`AuthError`, `TokenExpiredError`, `ScopeError`, `RateLimitError`, `ProviderError`).

### FR-2 — OAuth 2.0 Flows

1. **Authorization Code + PKCE**: generate authorization URL, handle redirect/callback, exchange code for tokens.
2. **Client Credentials**: accept `client_id` + `client_secret`, return access token without user context.
3. **Device Code**: poll token endpoint until user completes browser-based authorization.
4. **Refresh Token**: automatically invoke refresh before expiry; configurable threshold (default: 5 minutes before `expires_at`).

### FR-3 — Token Lifecycle & Auto-Refresh

1. `get_token()` **must** transparently return a valid token, triggering a refresh if the current token will expire within the configured threshold.
2. Failed refreshes **must** emit a structured log event and raise `TokenExpiredError` rather than silently returning an expired token.
3. Connectors **must** support concurrent access without race conditions (lock-based or atomic store operations).

### FR-4 — Credential Storage

1. The storage backend **must** be swappable via a `CredentialStore` interface without changing connector code.
2. Supported backends: HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, local encrypted file (dev only), environment variables (CI/testing only).
3. Credentials at rest **must** be encrypted; plaintext credentials **must never** be logged.

### FR-5 — Connector Registry

1. A machine-readable registry (YAML/JSON) **must** declare each connector's: `provider_id`, `auth_type`, `token_url`, `auth_url`, `default_scopes`, `pkce_required`, `token_expiry_behavior` (fixed / sliding / provider-reported).
2. The registry **must** be validated against a JSON Schema on every CI run.

### FR-6 — Reuse & Vendoring Policy

1. Before building a new connector, engineers **must** evaluate existing open-source libraries (e.g., `authlib`, `msal`, `google-auth`, `slack-sdk`). Approved libraries are listed in the connector registry metadata.
2. Wrapper connectors that delegate to an approved library **must** still conform to `BaseConnector`.

### FR-7 — Observability

1. Every token acquisition and refresh **must** emit a structured log event with: `provider_id`, `grant_type`, `success`, `latency_ms`, `expires_at` (no secret values).
2. Prometheus-compatible metrics **must** be exposed: `connector_token_requests_total`, `connector_token_refresh_total`, `connector_token_errors_total` (labeled by `provider` and `error_type`).

### FR-8 — CLI Tooling

1. CLI **must** support: `connector register <provider>`, `connector test <provider>`, `connector rotate <provider>`, `connector list`.
2. `connector test` **must** perform a live token fetch and validate `is_valid()` returns `True`.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | All connectors pass a shared integration test suite that validates `get_token()`, `is_valid()`, and `refresh_token()` against each provider's sandbox / test environment. |
| AC-02 | A token that is 4 minutes from expiry triggers an automatic refresh when `get_token()` is called (threshold default = 5 min). |
| AC-03 | Concurrent calls to `get_token()` from 10 parallel threads return a valid token with exactly one refresh network call made (no duplicate refresh storms). |
| AC-04 | No secret values (tokens, client secrets) appear in any log output at any log level. |
| AC-05 | Swapping the credential store backend requires zero changes to connector code — only configuration changes. |
| AC-06 | The connector registry YAML fails CI if it does not conform to the published JSON Schema. |
| AC-07 | `connector test <provider>` exits `0` for all Phase 1 providers in a clean CI environment seeded with test credentials. |
| AC-08 | `connector_token_errors_total` metric increments correctly when a provider returns a 401 and a 429, with correct `error_type` labels. |
| AC-09 | Adding a new connector requires only: implementing `BaseConnector`, adding a registry entry, and providing one integration test — no changes to core framework code. |
| AC-10 | Documentation (README + per-connector reference page) is auto-generated from the registry and connector docstrings in CI. |

---

## Out of Scope

- **End-user OAuth consent UI**: this framework is headless/server-side; frontend consent screens are owned by individual product teams.
- **SAML / OIDC identity federation** for internal SSO (handled by the Identity Platform team).
- **Secret rotation scheduling**: the connector will call `rotate`, but scheduling and policy enforcement is handled by the secrets management platform.
- **Per-user token isolation / multi-tenant token vaulting**: Phase 1 targets service-to-service credentials only; user-delegated token stores are deferred.
- **Non-HTTP protocols** (SFTP key auth, database connection strings, MQTT credentials).
- **Billing or quota management** for third-party API usage.
- **Connector business logic** beyond authentication (e.g., making API calls, data transformation).