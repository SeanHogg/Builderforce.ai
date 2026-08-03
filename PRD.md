> **PRD** — drafted by Ada (Sr. Product Mgr) · task #563
> _Each agent that updates this PRD signs its change below._
> - Ada (Sr. Product Mgr) — initial PRD: Problem, Goal, Scope, FRs, ACs, Out of Scope
> - Business Analyst — Requirements section: User Stories, Data Model, API Contract, NFRs, Business Rules

# Product Requirements Document: Enumerate All Sandbox Environments and Their Configured Egress Rules

## Problem & Goal
**Problem:**  
Platform administrators, security engineers, and DevOps teams lack a single-pane view of all sandbox environments and their egress rules. Egress rules are scattered across environment-specific configurations, making audits, troubleshooting, and compliance checks time-consuming and error-prone. This fragmentation leads to security blind spots, accidental misconfigurations, and delayed incident response.

**Goal:**  
Provide a centralized, read-only capability to enumerate all sandbox environments along with their configured egress rules. This enables rapid visibility, auditability, and compliance verification without requiring manual aggregation or direct access to each environment's configuration store.

## Target Users / ICP Roles
- **Platform Administrators** – Need to oversee all sandbox environments and ensure network policies are consistent.
- **Security Engineers** – Audit egress rules to validate that no overly permissive rules exist and that sandboxes are isolated appropriately.
- **DevOps/SRE Engineers** – Troubleshoot connectivity issues in sandbox environments by quickly checking allowed outbound traffic.
- **Compliance Officers** – Verify that egress rules align with regulatory requirements (e.g., data residency, network segmentation).

## Scope
- **In Scope:**
  - Provide a dedicated API endpoint (`GET /sandboxes/egress-rules`) that returns a list of all sandbox environments.
  - For each environment, include environment metadata (id, name, region, type, status) and its currently active egress rules.
  - Each egress rule must include: rule ID, description, source (CIDR/service), destination (CIDR/FQDN), protocol, port range, and action (ALLOW/DENY).
  - Support filtering by environment attributes (id, name, region, type) and egress rule properties (destination, action) via query parameters.
  - Implement a UI view (sandbox listing page) that displays the same information in a sortable, filterable table.
  - Ensure read-only access; no ability to create, modify, or delete egress rules from this feature.
  - Enforce role-based access control (RBAC); only users with sandbox read permissions can access the data.

## Functional Requirements
- **FR1:** An API endpoint `GET /api/v1/sandboxes/egress-rules` shall return a JSON array of sandbox objects. Each sandbox object contains:
  - `sandboxId`, `name`, `region`, `type`, `status`
  - `egressRules`: array of objects with fields `ruleId`, `description`, `sourceCidr`, `destination`, `protocol`, `portRange`, `action`.
- **FR2:** The endpoint shall accept optional query parameters for filtering: `sandboxId`, `name`, `region`, `type`, `destination` (partial match), `action` (ALLOW/DENY). Multiple filters are combined with AND logic.
- **FR3:** The endpoint shall support pagination (`pageSize`, `pageToken`) and sorting (`sortBy`, `sortOrder`).
- **FR4:** The UI shall present a table with columns: Sandbox Name, Region, Type, Status, Rule Count. Clicking a row expands to show detailed egress rules in a sub-table.
- **FR5:** The UI shall provide a top-level filter bar that mirrors the API filtering capabilities.
- **FR6:** All responses must be consistent with the platform's authentication and authorization model. Only users with `sandbox:read` scope can access the data.
- **FR7:** The system must retrieve egress rules from the authoritative source of truth (e.g., network policy store, infrastructure-as-code repository) and reflect the current state within a maximum staleness of 5 minutes.

## Acceptance Criteria
- **AC1:** Given at least one sandbox environment with egress rules, when a GET request is made to the API without filters, the response includes that environment and its rules correctly formatted.
- **AC2:** When filtering by `region=us-east-1`, the API returns only sandboxes in that region, and their egress rules are still accurate.
- **AC3:** When a user without `sandbox:read` permission calls the API, a 403 Forbidden response is returned.
- **AC4:** The UI table loads within 2 seconds for up to 100 sandboxes, and the expandable sub-table shows rule details without reloading the page.
- **AC5:** Filtering in the UI updates the table in real-time and reflects the same results as the API for the same parameters.
- **AC6:** Pagination works correctly; navigating to the next page shows the next set of results, and the previous page retains the previous results.
- **AC7:** When a sandbox has no egress rules defined, the `egressRules` array is empty, and the UI shows "No rules configured" in the expanded view.

## Out of Scope
- Creating, updating, or deleting egress rules (this is a read-only enumeration feature).
- Real-time monitoring or alerting on egress traffic.
- Support for non-sandbox environments (e.g., production, staging).
- Historical change logs or audit trails of egress rule modifications.
- Visualization of egress rules as topology diagrams.
- Integration with external CMDB or SIEM tools in this phase.

## Requirements

### User Stories

#### US-1: Platform Administrator — Fleet Overview
**As a** Platform Administrator,  
**I want to** view all sandbox environments across all regions in a single table,  
**So that** I can quickly assess fleet health, detect environments with no egress rules, and identify configuration inconsistencies without logging into each environment individually.

**Acceptance Criteria:**
- The sandbox list loads within 2 seconds for up to 100 environments.
- The table displays each environment's name, region, type, status, and egress rule count at a glance.
- An active filter indicator shows which filters are currently applied.
- The table is sortable by any column (ascending/descending).

#### US-2: Security Engineer — Egress Rule Audit
**As a** Security Engineer,  
**I want to** filter sandboxes by region and then expand each one to inspect its egress rules,  
**So that** I can verify that no sandbox has an overly permissive rule (e.g., `0.0.0.0/0` destination with ALLOW action) and that each environment's rules match our network security policy.

**Acceptance Criteria:**
- Filtering by `region` narrows the list to only matching sandboxes.
- Expanding a sandbox row reveals its full egress rules in a sub-table.
- The sub-table shows `ruleId`, `description`, `sourceCidr`, `destination`, `protocol`, `portRange`, and `action` for each rule.
- Filtering by `action=ALLOW` and `destination` (partial match) returns only rules matching those criteria across all sandboxes.

#### US-3: DevOps/SRE Engineer — Connectivity Troubleshooting
**As a** DevOps/SRE Engineer,  
**I want to** search for a specific destination FQDN or CIDR across all sandbox egress rules,  
**So that** I can quickly determine whether a sandbox is permitted to reach an external service that is failing, without combing through each environment's config manually.

**Acceptance Criteria:**
- The `destination` query parameter performs a partial (substring) match against rule destinations.
- Combining `destination` with `sandboxId` narrows results to the specific environment and rule of interest.
- When no rules match the filter, the API returns an empty array for `egressRules` on matching sandboxes, and the UI displays "No rules configured" in the sub-table.
- The full request (API call + UI render) completes within 2 seconds.

#### US-4: Compliance Officer — Regulatory Verification
**As a** Compliance Officer,  
**I want to** export or review all sandbox egress rules for a given region,  
**So that** I can document that egress traffic complies with data residency requirements (e.g., all sandboxes in `eu-west-1` only allow egress to destinations within the EU).

**Acceptance Criteria:**
- Filtering by `region` returns only sandboxes in that region with their full egress rules.
- The paginated response includes a `nextPageToken` so the officer can page through large result sets.
- The API response is a stable JSON structure suitable for downstream scripting/export.

#### US-5: Unauthorized Access Prevention
**As a** Security Engineer,  
**I want to** ensure that only users with the `sandbox:read` scope can access the egress rules endpoint,  
**So that** sensitive network configuration details are not exposed to unauthorized personnel.

**Acceptance Criteria:**
- A request with a valid auth token but lacking the `sandbox:read` scope receives HTTP 403.
- A request with no auth token receives HTTP 401.
- The 403 response body includes a machine-readable error code (`FORBIDDEN`) and a human-readable message indicating the missing scope.

---

### Data Model

#### Sandbox Environment

| Field       | Type     | Constraints                          | Description                                      |
|-------------|----------|--------------------------------------|--------------------------------------------------|
| `sandboxId` | string   | Required, non-empty, unique          | Unique identifier for the sandbox environment.   |
| `name`      | string   | Required, non-empty                  | Human-readable display name.                     |
| `region`    | string   | Required, non-empty                  | Cloud/infra region (e.g., `us-east-1`, `eu-west-2`). |
| `type`      | string   | Required, enumerated                 | Sandbox type. Valid values: `development`, `testing`, `staging`, `ephemeral`. |
| `status`    | string   | Required, enumerated                 | Current lifecycle status. Valid values: `active`, `provisioning`, `suspended`, `terminated`. |

#### Egress Rule

| Field         | Type     | Constraints                          | Description                                                   |
|---------------|----------|--------------------------------------|---------------------------------------------------------------|
| `ruleId`      | string   | Required, non-empty, unique per sandbox | Unique identifier for the rule within its sandbox.         |
| `description` | string   | Required, non-empty                  | Human-readable purpose of this rule.                         |
| `sourceCidr`  | string   | Required, non-empty                  | Source CIDR range or service identifier to which the rule applies. |
| `destination` | string   | Required, non-empty                  | Destination CIDR range or FQDN this rule targets. Use `0.0.0.0/0` for any destination. |
| `protocol`    | string   | Required, enumerated                 | IP protocol. Valid values: `TCP`, `UDP`, `ICMP`, `ANY`.      |
| `portRange`   | string   | Required, non-empty                  | Port or port range. Formats: `80`, `443`, `8000-9000`, `*` (any). |
| `action`      | string   | Required, enumerated                 | Rule action. Valid values: `ALLOW`, `DENY`.                  |

#### Relationship
- One sandbox may have zero or more egress rules.
- Egress rules belong to exactly one sandbox environment.
- An egress rule is considered "active" if its parent sandbox has `status=active`.

---

### API Contract

#### Endpoint

```
GET /api/v1/sandboxes/egress-rules
```

**Authentication:** Bearer token in `Authorization` header.  
**Authorization:** Requires `sandbox:read` scope.

#### Request — Query Parameters

| Parameter     | Type     | Required | Description                                                        |
|---------------|----------|----------|--------------------------------------------------------------------|
| `sandboxId`   | string   | No       | Exact match on sandbox identifier.                                 |
| `name`        | string   | No       | Case-insensitive partial (substring) match on sandbox name.        |
| `region`      | string   | No       | Exact match on region (e.g., `us-east-1`).                         |
| `type`        | string   | No       | Exact match on sandbox type (`development`, `testing`, `staging`, `ephemeral`). |
| `destination` | string   | No       | Case-insensitive partial (substring) match against egress rule `destination` fields. |
| `action`      | string   | No       | Exact match on egress rule action (`ALLOW` or `DENY`).             |
| `pageSize`    | integer  | No       | Number of sandboxes per page. Default: `20`. Maximum: `100`.       |
| `pageToken`   | string   | No       | Opaque pagination token from the previous response's `nextPageToken`. Omit for the first page. |
| `sortBy`      | string   | No       | Field to sort sandboxes by. Valid values: `name`, `region`, `type`, `status`. Default: `name`. |
| `sortOrder`   | string   | No       | Sort direction. Valid values: `asc`, `desc`. Default: `asc`.       |

**Filter behavior:**
- All provided filters are combined with AND logic.
- When `destination` or `action` filters are applied, a sandbox is included ONLY if it has at least one egress rule matching those filters. Sandboxes with no matching rules are omitted from the response entirely.
- The `egressRules` array on each returned sandbox includes ALL rules for that sandbox when no rule-level filters are applied. When `destination` or `action` is specified, the array is narrowed to only the matching rules.

#### Response — 200 OK

```json
{
  "sandboxes": [
    {
      "sandboxId": "sbx-8a3f2c1",
      "name": "payment-service-dev",
      "region": "us-east-1",
      "type": "development",
      "status": "active",
      "egressRules": [
        {
          "ruleId": "egr-001",
          "description": "Allow outbound HTTPS to payment processor API",
          "sourceCidr": "10.0.1.0/24",
          "destination": "api.stripe.com",
          "protocol": "TCP",
          "portRange": "443",
          "action": "ALLOW"
        },
        {
          "ruleId": "egr-002",
          "description": "Block all other outbound traffic",
          "sourceCidr": "10.0.0.0/16",
          "destination": "0.0.0.0/0",
          "protocol": "ANY",
          "portRange": "*",
          "action": "DENY"
        }
      ]
    }
  ],
  "nextPageToken": "eyJvZmZzZXQiOjIwfQ",
  "totalResults": 42
}
```

| Response Field   | Type     | Description                                                |
|------------------|----------|------------------------------------------------------------|
| `sandboxes`      | array    | List of sandbox objects for the current page.              |
| `nextPageToken`  | string\|null | Opaque token for the next page; `null` when on the last page. |
| `totalResults`   | integer  | Total count of sandboxes matching all filters (ignoring pagination). |

#### Error Responses

| Status | Code              | Condition                                              |
|--------|-------------------|--------------------------------------------------------|
| 400    | `BAD_REQUEST`     | Invalid query parameter value (e.g., unknown `sortBy`). |
| 401    | `UNAUTHORIZED`    | Missing or invalid authentication token.               |
| 403    | `FORBIDDEN`       | Valid token but missing `sandbox:read` scope.          |
| 429    | `TOO_MANY_REQUESTS` | Rate limit exceeded — see BR5.                       |
| 500    | `INTERNAL_ERROR`  | Unrecoverable upstream failure (e.g., source-of-truth store unreachable). |

Error response body shape:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "The `sandbox:read` scope is required to access this resource."
  }
}
```

---

### Non-Functional Requirements

#### NFR-1: Performance
- **NFR-1.1:** The API must respond within 500ms (p95) for queries returning up to 100 sandboxes.
- **NFR-1.2:** The UI table must render within 2 seconds for up to 100 sandboxes (AC4).
- **NFR-1.3:** Expanding a sandbox row to show egress rules must complete within 100ms client-side (no additional network request).

#### NFR-2: Data Freshness / Staleness
- **NFR-2.1:** Egress rule data must reflect the authoritative source of truth within a maximum staleness of 5 minutes (FR7, AC1).
- **NFR-2.2:** The API response must include a `Cache-Control` header with `max-age=300` to allow downstream caching but enforce the staleness ceiling.
- **NFR-2.3:** The response must include a `X-Data-Timestamp` header indicating the UTC epoch time (in seconds) when the data was last synchronized from the source of truth.

#### NFR-3: Reliability
- **NFR-3.1:** If the source-of-truth store is unreachable, the API must serve the most recently cached data (within the 5-minute window) with a `X-Data-Timestamp` reflecting the cache age and an `X-Data-Stale: true` header, rather than returning a 500.
- **NFR-3.2:** If no cached data exists and the source of truth is unreachable, return a 500 with code `UPSTREAM_UNAVAILABLE`.

#### NFR-4: Security
- **NFR-4.1:** All requests must be authenticated via the platform's standard Bearer token mechanism.
- **NFR-4.2:** Authorization must be enforced at the API layer; the `sandbox:read` scope must be validated before any data access.
- **NFR-4.3:** All communication must occur over HTTPS.

#### NFR-5: Observability
- **NFR-5.1:** The API must log every request with: authenticated user/principal, requested filters, response status, and response time.
- **NFR-5.2:** The API must emit a structured log event when it serves stale data (NFR-3.1), including the age of the cached data in seconds.
- **NFR-5.3:** An availability metric (request count, error rate, p95 latency) must be surfaced on the platform dashboard.

---

### Business Rules

#### BR-1: Sandbox Scope
Only sandbox-type environments are included. Production and staging environments are explicitly excluded. The sandbox type filter defaults to returning all sandbox types (`development`, `testing`, `staging`, `ephemeral`) — the "staging" type in this context refers to a sandbox used as a staging clone, not a production staging environment.

#### BR-2: Egress Rule Flat-List Model
Egress rules are returned as a flat array per sandbox. There is no nesting, grouping, or priority ordering implied by the response. The order of rules in the array is the order returned by the source of truth and must be preserved across paginated pages for a given sandbox.

#### BR-3: Zero-Rule Sandboxes
A sandbox with no egress rules is still included in the response. Its `egressRules` array is empty (`[]`). The UI must display "No rules configured" in the expanded sub-table (AC7).

#### BR-4: De-duplication
If a sandbox appears in the response (by matching sandbox-level filters), its egress rules are attached exactly once. The pagination boundary is drawn at the sandbox level — a sandbox is never split across two pages. All egress rules for a given sandbox appear together.

#### BR-5: Rate Limiting
The endpoint is subject to a rate limit of 60 requests per minute per authenticated principal. Exceeding this limit returns HTTP 429. The response must include `Retry-After` header indicating seconds to wait.

#### BR-6: Filter Interaction with Egress Rules
When both sandbox-level filters (`sandboxId`, `name`, `region`, `type`) and rule-level filters (`destination`, `action`) are present, a sandbox must match ALL sandbox-level filters AND have at least one egress rule matching ALL rule-level filters to appear in the result set.

#### BR-7: Case Sensitivity
- `region`, `type`, `action`, and `protocol` values are case-sensitive exact matches.
- `name` and `destination` filters are case-insensitive substring matches.
- `sandboxId` is a case-sensitive exact match.

#### BR-8: Sort Behavior
Sorting applies to sandboxes, not to individual egress rules. When `sortBy` is specified, sandboxes are ordered by that field. Within each sandbox, egress rules retain their source-of-truth ordering (BR-2).

#### BR-9: Pagination Token Opacity
`pageToken` and `nextPageToken` are opaque strings. The client must not construct, decode, or interpret them. Passing a stale or invalid token returns HTTP 400.

---

### Constraints & Dependencies

| Constraint / Dependency             | Impact                                                              |
|--------------------------------------|---------------------------------------------------------------------|
| Source-of-truth store availability   | If the store is down beyond the 5-minute cache window, the API cannot serve fresh data (NFR-3.2). |
| Platform auth service                | The endpoint depends on the platform's existing authentication and RBAC infrastructure (FR6). |
| Existing sandbox environment registry | This feature reads from the same dataset that powers sandbox provisioning; it does not introduce a new data store. |
| Frontend component library           | The UI must use the platform's existing table, filter-bar, and expandable-row components to maintain consistency. |
| No write path                        | This feature does not require any database migrations, new tables, or write endpoints. |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
