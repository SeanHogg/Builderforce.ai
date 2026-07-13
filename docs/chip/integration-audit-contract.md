## Integration Audit Contract (Health Endpoint — /api/v1/audit/health)

**ID:** PROT-INV-2025-Q3-001
**Status:** Draft
**Owner:** PM #149 Implementation Team

### 1. Purpose

Expose the integration health deduction (DTO and endpoint contract) used by `AuditDashboard` for GET `/api/v1/audit/health?segmentId={segmentId}`, aligned to now-defined schemas in `specs/builderforce/10-integration-audit-schema.md` (IntegrationHealth) and now-defined DTOs in `Builderforce.ai/frontend/src/lib/dto/auditQueryOptions.ts`.

### 2. Endpoint

```
GET /api/v1/audit/health?segmentId={segmentId}&integrationType?=&status?=&minScore?=&maxScore?=&includeGaps&includeRecommendations&sortBy=&sortOrder=
```

- The endpoint returns a JSON summary (100 OK) and errors (4xx/5xx) per JSON-API conventions.
- `segmentId` is required. Certain query parameters are optional.

### 3. Request Headers

The endpoint does not require authorization headers at this stage; infrastructure middleware must enforce auth (e.g., via existing segment access primitives).

### 4. Response Shape

The response MUST include a JSON list of objects keyed by integration ID (`id`). Each integration object must surface the following fields (as illustrated below) to match `AuditDashboard` expectations:

#### 4.1 Integration Summary Contract

```json
[
  {
    "id": "UUID-1",
    "type": "source-control",
    "name": "GitHub",
    "status": "CONNECTED",
    "lastSync": "2025-06-23T12:00:00Z",
    "completenessScore": 100,
    "gaps": [],
    "recommendations": []
  },
  {
    "id": "UUID-2",
    "type": "cicd",
    "name": "Jenkins",
    "status": "PARTIAL",
    "lastSync": "2025-06-22T09:30:00Z",
    "completenessScore": 85,
    "gaps": ["Jenkins deployments are missing for prod-environment builds.", "No webhooks configured for deployment events."],
    "recommendations": ["Enable Jenkins webhooks for production build events.", "Enqueue heuristic pipeline deployment logs."]
  }
]
```

Notes:

- Ordering of `lastSync`, `completenessScore`, and `status` must comply with `sortBy` and `sortOrder` if provided.
- `gaps` and `recommendations` are optional arrays only when the corresponding query flags are enabled by the client.
- To preserve stable inputs for sorting/filtering, integrations must always include `id`, `type`, `name`, `status`, `lastSync`, and `completenessScore` regardless of flags.

#### 4.2 Filtered Responses

- If `integrationType` is provided and does not match the integration’s `type`, the integration MUST be excluded from the returned list.
- If `status` is provided and does not match the integration’s `status`, the integration MUST be excluded from the returned list.
- If `minScore` is provided, integrations with `completenessScore < minScore` MUST be excluded.
- If `maxScore` is provided, integrations with `completenessScore > maxScore` MUST be excluded.

#### 4.3 Sorting

- If `sortBy` is provided, client-side sorting MUST be computed on the corresponding field:
  - `lastSync`: ISO-8601 timestamps.
  - `completenessScore`: numbers.
  - `status`: textual enum.
- If `sortOrder` is provided:
  - `asc` implies ascending order.
  - `desc` implies descending order.

#### 4.4 Pagination (implied)

If the integration list exceeds the client’s page size (e.g., 50–100 fallback max), the backend can return a `TotalCount` or standard page markers. This document does NOT prescribe a pagination protocol; a future task may standardize it.

### 5. Parameter Semantics

| Parameter     | Required?                     | Description                                               | Supported Values (in scope for filtering)                         |
|---------------|-------------------------------|-----------------------------------------------------------|-------------------------------------------------------------------|
| segmentId     | Yes                           | Federated segment identifier                               | String                                                             |
| integrationType | Optional                     | Filter integrations by IntegrationType                    | "source_control", "issue_tracker", "communication", "cicd", "monitoring", "calendar" |
| status       | Optional                     | Filter integrations by IntegrationStatus                  | "CONNECTED", "PARTIAL", "MISSING"                                 |
| minScore     | Optional (numeric)            | Minimum allowed completeness score (0‑100)                | Number                                                             |
| maxScore     | Optional (numeric)            | Maximum allowed completeness score (0‑100)                | Number                                                             |
| includeGaps  | Required (true or false)      | Whether to include gaps array in each integration entry   | Boolean                                                            |
| includeRecommendations | Required (true or false) | Whether to include recommendations array in each entry   | Boolean                                                            |
| sortBy       | Optional                      | Field to sort by                                          | "lastSync", "completenessScore", "status"                         |
| sortOrder    | Optional                      | Sort direction                                            | "asc", "desc"                                                      |

### 6. Semantics of Fields

- **id**: integral-uuid reference to IntegrationHealth.id.
- **type**: IntegrationHealth.type.
- **name**: human-readable process name (e.g., "GitHub").
- **status**: IntegrationHealth.status.
- **lastSync**: IntegrationHealth.lastSync (ISO-8601 string).
- **completenessScore**: IntegrationHealth.completenessScore (0‑100 number, not 0‑1).
- **gaps**: Array of auto-detected gap descriptions (strings) corresponding to IntegrationGap.description. Only populated when `includeGaps` is true.
- **recommendations**: Array of auto-generated suggestions (strings) corresponding to IntegrationGap.recommendation. Only populated when `includeRecommendations` is true.

### 7. Scoring Alignments (Out-of-Scope implementation)

Score calculation behavior is outlined in `specs/builderforce/10-prd-integration-audit.md` (section 4.3) and `specs/builderforce/10-integration-audit-schema.md` (model IntegrationCompletenessScore). The backend must align `completenessScore` returned by this contract with the schema and PRD. Assumptions for this turn: use defined weights for criticality and apply recency thresholds as defined in schema and PRD.

### 8. Delivery Expectations for This Turn

- Ensure all supported integration records surface id/type/name/status/lastSync/completenessScore regardless of flags.
- Optionally surface gaps/recommendations when includeGaps/includeRecommendations are set to true.
- Enforce optional integrationType/status/minScore/maxScore filters as specified.
- Support sorting by lastSync, completenessScore, or status.

---

## Mapping to Existing Artifacts

| Artifact                     | Role                                   | Alignment Notes                                                                    |
|------------------------------|----------------------------------------|------------------------------------------------------------------------------------|
| specs/builderforce/00-extraction-strategy.md | Two-app architecture                    | Frontend component uses structured JSON serialized via the health endpoint.        |
| specs/builderforce/10-prd-integration-audit.md | PRD (human-scored)                      | PRD’s 4.4 dashboard view is reflected in summary view; PRD 4.5 recommendations flow through recommendation arrays. |
| specs/builderforce/10-integration-audit-schema.md | Schema model                           | Schema defines models; endpoint contract’s IntegrationHealth↔IntegrationConnection relations and score calculations align with schema. |
| Builderforce.ai/frontend/src/components/integration/AuditDashboard.tsx | Dashboard component                    | Consumes /api/v1/audit/health; ensures the JSON contract matches component expectations. |
| Builderforce.ai/frontend/src/types/integration.ts | Domain types                            | Its `IntegrationHealth` type matches ITO shape surfaced by the JSON contract.       |
| Builderforce.ai/frontend/src/lib/dto/auditQueryOptions.ts | DTO for typed query shapes              | Aligns optional integrationType/status/minScore/maxScore/sortBy/sortOrder contract with AuditDashboard usage. |