> **PRD** — drafted by Ada (Sr. Product Mgr) · task #579
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: GAP ID System

## Problem & Goal
**Problem:** The current product ecosystem lacks a unified identifier to correlate user actions, transactions, and support tickets across microservices. This results in fragmented customer views, delayed troubleshooting, and reporting inaccuracies.
**Goal:** Introduce a universally unique `GAP ID` (Generated Accountable Persona Identifier) that is persistent, cross-service, non-reversible, and automatically attached to every critical action, enabling seamless tracing and single-customer-view aggregation.

## Target Users / ICP Roles
- **Customer Support Agents:** Query all user history from one identifier without hopping between systems.
- **DevOps / SRE Engineers:** Trace a failing request across service logs, metrics, and traces.
- **Data Analysts & BI:** Join datasets for funnel, retention, and ROI analysis without fuzzy matching.
- **Product Managers:** View holistic user journeys across product lines to make informed prioritization decisions.

## Scope
### In Scope
- Generation specification and pseudo-random structure of GAP ID.
- Attachment rules: when and how GAP ID joins API requests, events, analytics payloads, and error reports.
- Read API for internal services and admin panel.
- Immutability guarantees and privacy safeguards (non-reversible, non-PII-derivable).
- Migration strategy for existing user records (associate historical data with new GAP IDs).
- Rate-limiting and idempotency handling for generation.

### Out of Scope
- External customer-facing display (GAP ID is never shown to end users).
- Authentication or authorization logic (GAP ID does not replace bearer tokens or API keys).
- Cross-partner or inter-company data sharing (only within the current product suite).
- Real-time notification of ID lifecycle events.
- Multi-region master-master ID generation conflicts (post-MVP consideration).
- Billing or metering related to ID issuance.

## Functional Requirements
1. **ID Generation**
   - Generate an opaque, URL-safe string of exactly 24 characters.
   - Include a 4-character service prefix (`gap_`) and a 2-character checksum/discriminator for basic offline validation.
   - IDs MUST be universally unique (collision probability < 1e-15).
   - Never encode personally identifiable information (PII), timestamps, or sequential data within the ID.

2. **ID Attachment**
   - Auto-inject the GAP ID into:
     - HTTP request headers (`X-GAP-ID`) for all internal service calls originating from user action.
     - Structured log payload (field `gap_id`).
     - Analytics/event streams (top-level attribute `gap_id`).
     - Error and crash reports.
   - Must propagate downstream to any service called synchronously or asynchronously (via span context).

3. **ID Retrieval & Lookup**
   - Provide a gRPC/REST endpoint: `GET /internal/v1/gap-id/resolve?external_user_id=<id>&namespace=<tenant>`
   - Support privacy-preserving reverse lookup only by hashed mapping, never exposing the mapping data to 3rd parties.

4. **Immutability & Storage**
   - Once generated for a user, GAP ID MUST NEVER change.
   - Mapping between native user ID <-> GAP ID stored in an encrypted, access-controlled datastore.
   - Enable soft-deletion policy: mapping retains for 90 days post account deletion for audit/compliance.

5. **Migration & Backfilling**
   - Utility to bulk-assign GAP IDs to existing users without a GAP ID.
   - Updated historical data events re-processed with the new identifier where technically feasible (e.g., re-index logs).

## Acceptance Criteria
- A newly created user gets a GAP ID assigned within 200ms of account creation.
- GAP ID appears in >99.9% of sampled log and analytics payloads post-integration.
- No two active user accounts share the same GAP ID (validated via continuous integration test).
- Lookup endpoint returns correct GAP ID in <100ms p95 latency.
- Migration script successfully assigns GAP IDs to all existing users without interruption to production traffic.
- Customer support team can trace a complete user journey in a single dashboard query using GAP ID.
- ID does not contain PII, sequential counters, or timestamps; validated by automated audit tool.
- Architecture review confirms no single point of failure in generation and no region-conflict edge cases.

## Out of Scope
- Tools/UI for customers to view or manage their own GAP ID.
- Export or API to expose GAP ID to third-party integrations or external vendors.
- Automatic repair of broken/missing GAP ID chains in old archived data.
- Integration with biometric or liveness detection systems.
- Replacement of existing user ID in customer-facing emails, invoices, or promotions.

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