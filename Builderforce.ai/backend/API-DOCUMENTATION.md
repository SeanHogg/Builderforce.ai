# API Documentation - Reporting Dashboard & Weekly Digest

## Table of Contents
1. [Dashboard API](#dashboard-api)
2. [Weekly Digest API](#weekly-digest-api)
3. [Response Formats](#response-formats)
4. [Error Handling](#error-handling)
5. [Rate Limiting](#rate-limiting)

---

## Dashboard API

### Base URL
```
/api/dashboard
```

### Endpoint: Get Dashboard Metrics

**Endpoint:** `POST /api/dashboard`

**Description:** Fetches comprehensive dashboard metrics with optional filtering by project, time period, and stakeholder.

**Authentication:** JWT token required

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "projectIds": ["proj_001", "proj_002"],
  "timePeriod": "last_30_days",
  "timeRange": {
    "start": "2025-06-01T00:00:00Z",
    "end": "2025-06-17T23:59:59Z"
  },
  "stakeholderIds": ["stakeholder_001", "stakeholder_002"]
}
```

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `projectIds` | string[] | No | All projects | Filter by project IDs |
| `timePeriod` | enum | Yes | `last_30_days` | Time period to filter by |
| `timeRange` | object | Conditional | - | For `custom` time period |
| `stakeholderIds` | string[] | No | All stakeholders | Filter by stakeholder IDs |

**Time Period Values:**
- `last_7_days`: Last 7 days
- `last_30_days`: Last 30 days
- `last_90_days`: Last 3 months
- `last_year`: Last 12 months
- `custom`: Use `timeRange` parameter

**Response:** `200 OK`

```json
{
  "summary": {
    "totalApprovedPriorities": 47,
    "openSignOffs": 23,
    "pendingSignOffs": 14,
    "overdueSignOffs": 5,
    "activeConflicts": 8,
    "overdueEscalations": 2,
    "lastUpdated": "2025-06-17T14:30:00Z"
  },
  "projects": [
    {
      "projectId": "proj_001",
      "projectName": "Customer Experience Platform",
      "priorityMetrics": {
        "totalApproved": 12,
        "pendingReview": 3,
        "totalAssigned": 15
      },
      "signOffMetrics": {
        "open": 5,
        "pending": 7,
        "overdue": 1,
        "lastSignOffDate": "2025-06-12T10:20:00Z"
      },
      "conflictMetrics": {
        "active": 2,
        "thisWeek": 1,
        "types": ["Priority Conflict", "Resource Allocation"]
      },
      "escalationMetrics": {
        "overdue": 0,
        "pending": 2,
        "thisMonth": 3
      }
    }
  ]
}
```

**Error Responses:**

400 Bad Request
```json
{
  "error": "Invalid time period"
}
```

500 Internal Server Error
```json
{
  "error": "Failed to fetch dashboard metrics"
}
```

---

### Endpoint: Invalidate Cache

**Endpoint:** `POST /api/dashboard/cache/invalidate`

**Description:** Manually invalidates the dashboard cache.

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "filterKey": "{\"projectIds\":[\"proj_001\"],\"timePeriod\":\"last_30_days\"}"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Cache invalidated"
}
```

---

## Weekly Digest API

### Base URL
```
/api/digest
```

### Endpoint: Get Latest Digest

**Endpoint:** `GET /api/digest/latest`

**Description:** Fetches the most recent weekly digest for manual consumption.

**Authentication:** Not required (public read access)

**Response:** `200 OK`

```json
{
  "digestId": "digest_1700000000000",
  "generatedAt": "2025-06-17T00:00:00Z",
  "recipients": [
    "approver@example.com",
    "stakeholder@example.com"
  ],
  "content": "📊 23 open sign-offs, 4 pending escalations — full view: /dashboard\n\n🔴 Top Conflicts:\n- Priority Conflict in Customer Experience Platform (P0)\n- Resource Allocation Disagreement (P1)",
  "metrics": {
    "totalOpenSignOffs": 23,
    "pendingEscalations": 4,
    "topConflicts": [
      {
        "id": "conflict_001",
        "title": "Priority Conflict in Customer Experience Platform",
        "priority": "P0",
        "severity": "Critical"
      }
    ],
    "urgentActionItems": [
      {
        "id": "task_001",
        "title": "Resolve priority conflict for Customer Experience Platform",
        "priority": "Urgent",
        "targetDate": "2025-06-20"
      }
    ]
  }
}
```

**Error Responses:**

204 No Content (no digest available)

---

### Endpoint: Get Digest History

**Endpoint:** `GET /api/digest/history`

**Description:** Fetches digest history with pagination support.

**Authentication:** Not required (public read access)

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | integer | No | 10 | Number of digests to return |
| `offset` | integer | No | 0 | Number of digests to skip |

**Response:** `200 OK`

```json
[
  {
    "digestId": "digest_1700000000000",
    "generatedAt": "2025-06-17T00:00:00Z",
    "recipients": ["user@example.com"],
    "content": "...",
    "metrics": {...}
  },
  {
    "digestId": "digest_1700000000001",
    "generatedAt": "2025-06-10T00:00:00Z",
    "recipients": ["user@example.com"],
    "content": "...",
    "metrics": {...}
  }
]
```

**Error Responses:**

500 Internal Server Error
```json
{
  "error": "Failed to fetch digest history"
}
```

---

### Endpoint: Generate Digest

**Endpoint:** `POST /api/digest/generate`

**Description:** Manually triggers a digest generation (useful for testing or on-demand).

**Authentication:** Admin required

**Response:** `200 OK`

```json
{
  "success": true,
  "digest": {
    "digestId": "digest_1700000000002",
    "generatedAt": "2025-06-17T18:30:00Z",
    "recipients": ["user@example.com"],
    "content": "...",
    "metrics": {...}
  }
}
```

**Error Responses:**

500 Internal Server Error
```json
{
  "success": false,
  "error": "Digest generation failed"
}
```

---

### Endpoint: Get Digest Configuration

**Endpoint:** `GET /api/digest/config`

**Description:** Retrieves the current digest configuration.

**Authentication:** Admin required

**Response:** `200 OK`

```json
{
  "enabled": true,
  "digestWindow": {
    "start": "monday",
    "end": "friday",
    "windowName": "weekly"
  },
  "distributionList": {
    "requiredApprovers": [
      "approver1@company.com",
      "approver2@company.com"
    ],
    "informedPartyEmails": [
      "stakeholder1@company.com"
    ],
    "slackChannels": [
      "#stakeholder-updates"
    ]
  },
  "template": {
    "subject": "Weekly Stakeholder Alignment Digest - {period}",
    "bodyFormat": "markdown",
    "sections": {
      "summary": "Key metrics summary for {period}",
      "topConflicts": "Top 2 Conflicts and Overdue Items",
      "urgentItems": "Urgent Action Items"
    }
  },
  "maxLength": 600
}
```

**Error Responses:**

500 Internal Server Error
```json
{
  "error": "Failed to fetch digest config"
}
```

---

### Endpoint: Update Digest Configuration

**Endpoint:** `POST /api/digest/config`

**Description:** Updates the digest configuration.

**Authentication:** Admin required

**Request Body:**
```json
{
  "enabled": true,
  "digestWindow": {
    "start": "wednesday",
    "end": "friday",
    "windowName": "extended-weekly"
  },
  "distributionList": {
    "requiredApprovers": ["approver@company.com"],
    "informedPartyEmails": ["stakeholder@company.com"],
    "slackChannels": ["#stakeholder-alerts"]
  },
  "template": {
    "subject": "Weekly Digest - {period}",
    "bodyFormat": "markdown",
    "sections": {
      "summary": "Weekly Overview",
      "topConflicts": "Critical Issues",
      "urgentItems": "Action Items"
    }
  },
  "maxLength": 800
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Configuration updated"
}
```

**Error Responses:**

400 Bad Request
```json
{
  "error": "Invalid configuration"
}
```

500 Internal Server Error
```json
{
  "error": "Failed to update digest config"
}
```

---

## Response Formats

### DashboardDTO
```typescript
interface DashboardDTO {
  summary: MetricsSummary;
  projects: ProjectMetrics[];
}

interface MetricsSummary {
  totalApprovedPriorities: number;
  openSignOffs: number;
  pendingSignOffs: number;
  overdueSignOffs: number;
  activeConflicts: number;
  overdueEscalations: number;
  lastUpdated: string;
}

interface ProjectMetrics {
  projectId: string;
  projectName: string;
  priorityMetrics: PriorityMetrics;
  signOffMetrics: SignOffMetrics;
  conflictMetrics: ConflictMetrics;
  escalationMetrics: EscalationMetrics;
}
```

### WeeklyDigest
```typescript
interface WeeklyDigest {
  digestId: string;
  generatedAt: string;
  recipients: string[];
  content: string;
  metrics: DigestMetrics;
}

interface DigestMetrics {
  totalOpenSignOffs: number;
  pendingEscalations: number;
  topConflicts: Array<{
    id: string;
    title: string;
    priority: string;
    severity: string;
  }>;
  urgentActionItems: Array<{
    id: string;
    title: string;
    priority: string;
    targetDate: string;
  }>;
}
```

---

## Error Handling

All endpoints follow consistent error response format:

```json
{
  "error": "Error message describing the issue"
}
```

### Common HTTP Status Codes

| Status | Description |
|--------|-------------|
| 200 | Success - request completed successfully |
| 204 | No Content - successful operation with no response body |
| 400 | Bad Request - invalid input or parameters |
| 401 | Unauthorized - authentication required |
| 403 | Forbidden - insufficient permissions |
| 404 | Not Found - resource not found |
| 429 | Too Many Requests - rate limit exceeded |
| 500 | Internal Server Error - server error |

---

## Rate Limiting

All Dashboard API endpoints are rate-limited at 100 requests per minute per authenticated user. Digest endpoints have stricter limits (20 requests per minute) due to resource-intensive operations.

**Rate Limit Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 98
X-RateLimit-Reset: 1718614800
```

**Retry After Header:** (on 429 response)
```
Retry-After: 60
```

---

## Migration Notes

### Breaking Changes
None expected in this release.

### Versioning
API follows semantic versioning: `1.0.0`.

### Backward Compatibility
All endpoints maintain backward compatibility with v1.0.0.

---

## Support

For API-related issues, contact the BuilderForce support team at support@builderforce.ai.