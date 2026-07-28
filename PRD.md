> **PRD** — drafted by Product Manager · task #545
> _Each agent that updates this PRD signs its change below._

# WIP PRD: Enforce PS256/RS256 JWT Signing with REQUIRED_ALGO and Rotation

## Problem & Goal
JWT_SECRET currently serves as HMAC-SHA256 key material with domain separation across guest, container, upload, and encrypted MCP/provider keys. Default signer behavior permits HS256, increasing blast radius and preventing safe algorithm rotation.  
Goal: Mandate PS256 or RS256 via REQUIRED_ALGO, reject HS256 and non-standard algorithms at runtime, and establish a documented rotation cadence with audit evidence.

## Target users / ICP roles
- Platform engineers maintaining api/ signers and wrangler.toml
- Security/compliance reviewers requiring rotation evidence
- Downstream service owners (guest, container, upload flows)

## Scope
- api/src/env.ts: extend Env type with REQUIRED_ALGO
- api/wrangler.toml: add REQUIRED_ALGO = "PS256" (or "RS256")
- All JWT sign/verify call sites (guest, container, uploadSign) to enforce REQUIRED_ALGO and support deterministic key rotation
- Fail-fast on mismatch; 30-day rotation policy documented in code comments and runbooks

## Functional requirements
- REQUIRED_ALGO must be present and set to PS256 or RS256; any other value or absence causes immediate startup failure
- Sign and verify operations must reject HS256 and any algorithm other than REQUIRED_ALGO
- Key material from `wrangler secret put JWT_SECRET` must be used only with the mandated algorithm; rotation support via seed/variant mechanism with minimal overhead
- Rotation cadence (30 days) and audit log entries must be generated on each key change

## Acceptance criteria
- `wrangler dev` and production deploys fail fast if REQUIRED_ALGO is missing or set to HS256
- All existing signer paths produce and verify tokens exclusively with PS256/RS256
- Rotation test (simulated 30-day cadence) succeeds with deterministic seed/variant and produces auditable evidence
- No HS256 tokens can be issued or accepted after change

## Out of scope
- Implementation of full JWKS endpoint or external KMS integration
- Migration of legacy HS256 tokens in production data
- Changes to non-JWT secrets or other signing mechanisms

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