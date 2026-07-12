# OAuth / Token-Based Connector Framework

Overview:
- Purpose: Provide a unified, reusable set of OAuth 2.0 and token-based connectors for third-party services.
- Target: Any internal service or agent (including AI agents) can integrate with an external API securely and reliably, without duplicating auth logic.
- Scope (Phase 1): Core framework, credential-store abstraction, Client Credentials + API-key connectors, and five priority integrations (GitHub, Google, Slack, OpenAI, Anthropic).

## Goals

- (FR-1) Every connector implements a common `BaseConnector` interface with `get_token()`, `refresh_token()`, `revoke_token()`, and `is_valid() → bool`.
- (FR-3) `get_token()` transparently returns a valid token, triggering a refresh if the token will be invalid within a configurable threshold (default: 5 minutes).
- (FR-4) Credential storage is pluggable: `CredentialStore` interface with implementations for Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, encrypted local files (dev only), and env variables (testing).
- (FR-5) Registry of supported services; a YAML/JSON file declares provider metadata; CI validates the registry against a JSON Schema.
- (FR-6) Connector reuse by wrapping existent libraries (e.g., `authlib`, `msal`, `google-auth`, `slack-sdk`) — still conform to the `BaseConnector` contract.
- (FR-7) Observability: structured logs for each token acquisition/refresh and Prometheus metrics (`connector_token_requests_total`, `connector_token_refresh_total`, `connector_token_errors_total` labeled by provider and error_type).
- Phase 1 integrations: Productivity (Google, Slack), Developer (GitHub, Linear — used later), Data (Snowflake — later), AI (OpenAI, Anthropic — later for 4).

## Design Principles

- (PRD FR-9) Keep secrets out of logs (AC-04): no plaintext tokens in logs.
- (FR-10) Maintain thread-safety: lock-based or atomic store operations prevent refresh storms when `get_token()` is called concurrently (AC-03).
- (FR-11) Modular without friction: adding a new connector requires only `BaseConnector` implementation, a registry entry, and an integration test (AC-09).

## Project Layout

```
connectors/
├── core/
│   ├── BaseConnector.ts        # Unified interface
│   ├── TokenResponse.ts        # Normalized token type
│   ├── ConnectorError.ts       # Hierarchy of errors
│   ├── CredentialStore.ts      # Storage abstraction
│   ├── CredentialStores/       # Interface implementations
│   │   ├── VaultStore.ts
│   │   ├── AwsSsmStore.ts
│   │   ├── GcpSecretManagerStore.ts
│   │   ├── AzureKeyVaultStore.ts
│   │   ├── EnvStore.ts
│   │   └── EncryptedFileStore.ts
│   └── HttpClient.ts           # HTTP primitives (timeout, retries)
├── registry/
│   ├── schema.json             # JSON Schema for provider metadata
│   └── providers.yaml          # Registered services (Phase 1: GitHub, Google, Slack, OpenAI, Anthropic)
├── providers/
│   ├── github.ts
│   ├── google.ts
│   ├── slack.ts
│   ├── openai.ts
│   └── anthropic.ts
├── cli/
│   ├── index.ts                # CLI entry point
│   ├── commands/
│   │   ├── list.ts
│   │   ├── test.ts
│   │   └── rotate.ts
│   └── schema.ts               # CLI command schemas (zod)
├── metrics/
│   ├── index.ts                # Prometheus metrics (automatic increment on token events)
├── tests/
│   ├── conftest.ts             # Pytest fixtures for integration tests
│   ├── core/
│   │   └── test_base_connector.ts
│   └── providers/
│       ├── github.test.ts
│       ├── google.test.ts
│       └── ...
├── setup.py                     # Python package (Phase 1 SDK)
├── pyproject.toml              # Poetry/Toml + dependencies
└── README.md                   # This file
```

## Python SDK (Phase 1)

Goal: Expose a Python-first SDK exposing `get_token()`, `refresh_token()`, `revoke_token()`, and `is_valid()` for consumers.

- `from connectors import BaseConnector, GitHubConnector, CredentialStore`

## Usage Example

```python
from connectors import GitHubConnector, CredentialStore

# Load credentials from pluggable store
store = CredentialStore.load("aws-ssm")
config = store.retrieve("github-client-credentials")
connector = GitHubConnector(client_id=config['client_id'], client_secret=config['client_secret'], scopes=['repo:status'], token_url='https://github.com/login/oauth/access_token')

token = connector.get_token()   # Auto-refresh if needed
print(token.access_token)
```

## Registry Format (Phase 1)

- `providers.yaml` (example entries):

```yaml
github:
  provider_id: github
  auth_type: client_credentials
  token_url: https://github.com/login/oauth/access_token
  auth_url: https://github.com/login/oauth/authorize
  default_scopes:
    - repo:status
  pkce_required: true
  token_expiry_behavior: provider_reported

google:
  provider_id: google
  auth_type: client_credentials
  token_url: https://oauth2.googleapis.com/token
  auth_url: https://accounts.google.com/o/oauth2/v2/auth
  default_scopes:
    - 'https://www.googleapis.com/auth/spreadsheets'
  pkce_required: true
  token_expiry_behavior: provider_reported

slack:
  provider_id: slack
  auth_type: device_code
  token_url: https://slack.com/api/oauth.v2.access
  auth_url: https://slack.com/oauth/v2/authorize
  default_scopes:
    - chat:write
    - channels:read
  pkce_required: true
  token_expiry_behavior: provider_reported

openai:
  provider_id: openai
  auth_type: client_credentials
  token_url: https://api.openai.com/v1/auth/token
  auth_url: https://platform.openai.com/oauth2/authorize
  default_scopes:
    - "api"
  pkce_required: false
  token_expiry_behavior: provider_reported

anthropic:
  provider_id: anthropic
  auth_type: client_credentials
  token_url: https://api.anthropic.com/v1/auth/token
  auth_url: https://console.anthropic.com/project/default/connections/manage
  default_scopes:
    - "session:write"
  pkce_required: false
  token_expiry_behavior: provider_reported
```

## Tests (Phase 1)

- All connectors pass integration tests validating `get_token()`, `is_valid()`, and `refresh_token()` against each provider’s sandbox/test environment (AC-01).
- 10 parallel threads each call `get_token()`; assertion checks that a single refresh network call is made (AC-03).
- `connector test <provider>` exits 0 for all Phase 1 providers in a clean CI environment seeded with test credentials (AC-07).

## Dependencies (Phase 1)

- TS: `zod`, `prom-client`, `dotenv`/`@env-d` (or appropriate library for env loading), `node-fetch` (or native fetch).
- Python: `authlib`, `slack-sdk`, `openai`, `anthropic`, `google-auth`, `azure-identity`, `cryptography`
- Cloud SDKs: `boto3` (AWS), `google-cloud-secret-manager` (GCP), `azure-identity` (Azure)
- Serialization: `pyyaml`, `fastavro` (for registry validation in CI with JSON Schema)

## Security & Data Privacy

- Secrets at rest are encrypted; plaintext secrets never logged (AC-04).
- Credential storage backends enforce encryption at rest (e.g., AWS KMS).
- Token refresh emits logs and metrics labeled by provider but without secret values (FR-7).

## Documentation (Auto-Generated)

- CI uses triggers or scripts to automatically generate `connectors/SDK.md` from the registry and connector docstrings (AC-10).

## Out of Scope (Phase 1)

- End-user OAuth consent UI: handled by product teams.
- SAML / OIDC identity federation: handled by identity platform teams.
- Secret rotation scheduling: handled by secrets management platforms.
- Per-user token isolation / multi-tenant token vaulting: deferred.
- Non-HTTP protocols (e.g., database connection strings, SFTP): deferred (Connector business logic beyond auth).
- Billing or quota management for third-party API usage.

## Next Steps

- Phase 2: Authorization Code flow with PKCE, Device Code flow, additional integrations.
- Phase 3: Connector plugin SDK for community contributions, webhook-based token rotation alerts.

## Dependencies

- [Phase 1 libraries to reuse or investigate: `authlib`, `msal`, `google-auth`, `slack-sdk`] — reference in registry metadata (FR-6).