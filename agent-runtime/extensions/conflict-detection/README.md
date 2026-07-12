# Conflict Detection Rules and Alerts

## Overview

The Conflict Detection Rules and Alerts system automatically detects and surfaces prioritization conflicts where two distinct stakeholders assign different P0 priorities to the same team within the same review window. This helps teams proactively identify and resolve conflicts before they cause delays or misaligned priorities.

## Architecture

The system is implemented as a standalone Fastify application extension with the following components:

```
agent-runtime/extensions/conflict-detection/
├── package.json                 # NPM package configuration
├── README.md                    # This file
├── src/
│   ├── api.ts                   # Fastify server and HTTP routes
│   ├── conflict-alert.entity.ts # ConflictAlert entity and factory
│   ├── conflict-detector.service.ts  # Core detection engine
│   ├── conflict-rule.spec.ts   # Formal rule specification
│   └── types.ts                 # TypeScript type definitions
├── tests/                       # Unit and integration tests
└── openapi/                     # OpenAPI documentation
```

## Core Concepts

### Conflict Rule

**Rule:** Detect when two *distinct stakeholders* submit requests that assign *different P0 priorities* to the *same team* within the *same review window*.

- **Stakeholders**: Must be distinct (different user IDs)
- **Priority**: Must be P0 on both sides (P0 vs P1 or P0 vs P2 still qualifies)
- **Team**: Same team ID
- **Review Window**: Requests within the same window (default 30 days)

### Conflict Alert

Each conflict alert includes:
- Unique ID (hashed from involved stakeholders, team, and version)
- Clear labels for conflicting items and stakeholders
- Dated detection timestamp
- Concise summary explaining the rule violation
- Status tracking (open, acknowledged, resolved, dismissed)
- Severity classification (critical, high, medium, low)
- Source request references

### Deduplication

Alerts are deduplicated using stable conflict keys:
```
stakeholderId1__stakeholderId2__teamId__versionId
```

## API Reference

### Endpoints

#### 1. POST /conflicts/detect

Trigger conflict detection on a batch of priority requests.

**Request Body:**
```json
{
  "requests": [
    {
      "id": "req-001",
      "title": "Increase feature X capacity",
      "description": "Need P0 for team engineering",
      "priority": "P0",
      "stakeholderId": "alice",
      "stakeholder": {
        "name": "Alice Smith",
        "role": "Product Manager",
        "email": "alice@example.com"
      },
      "teamId": "engineering",
      "team": {
        "name": "Engineering Team",
        "organization": "Product"
      },
      "versionId": "V1",
      "reviewWindowStart": "2025-06-01T00:00:00Z",
      "reviewWindowEnd": "2025-07-01T00:00:00Z",
      "createdAt": "2025-06-23T08:00:00Z",
      "updatedAt": "2025-06-23T09:00:00Z",
      "sourceSystem": "priority_queue"
    },
    {
      "id": "req-002",
      "title": "Database scaling priority",
      "description": "Critical infrastructure needs P0 priority",
      "priority": "P0",
      "stakeholderId": "bob",
      "stakeholder": {
        "name": "Bob Johnson",
        "role": "Engineering Manager",
        "email": "bob@example.com"
      },
      "teamId": "engineering",
      "team": {
        "name": "Engineering Team",
        "organization": "Product"
      },
      "versionId": "V1",
      "reviewWindowStart": "2025-06-01T00:00:00Z",
      "reviewWindowEnd": "2025-07-01T00:00:00Z",
      "createdAt": "2025-06-23T08:30:00Z",
      "updatedAt": "2025-06-23T09:00:00Z",
      "sourceSystem": "priority_queue"
    }
  ],
  "versionId": "V1",
  "windowThresholdDays": 30
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "conflicts": [
    {
      "id": "alice_bob_engineering__V1",
      "key": {
        "stakeholderId1": "alice",
        "stakeholderId2": "bob",
        "teamId": "engineering",
        "versionId": "V1"
      },
      "title": "Engineering Team — P0 Priority Conflict",
      "description": "Detected: Alice requested P0 for engineering team, Bob requested P1 for same team. Conflicting priorities detected.",
      "summary": "P0 (stakeholder Alice, Engineering) vs P0 (stakeholder Bob, Engineering)",
      "severity": "critical",
      "detectedAt": "2025-06-23T10:30:00Z",
      "status": "open",
      "conflictingPriorities": {
        "stakeholder1": {
          "stakeholderId": "alice",
          "stakeholderName": "Alice Smith",
          "role": "Product Manager"
        },
        "team": {
          "teamId": "engineering",
          "teamName": "Engineering Team"
        },
        "priority1": "P0",
        "priority2": "P0"
      },
      "stakeholders": [
        {
          "stakeholderId": "alice",
          "stakeholderName": "Alice Smith",
          "role": "Product Manager"
        },
        {
          "stakeholderId": "bob",
          "stakeholderName": "Bob Johnson",
          "role": "Engineering Manager"
        }
      ],
      "versionIds": ["V1"],
      "sourceRequestIds": ["req-001", "req-002"],
      "conflictCount": 2
    }
  ],
  "duplicatesFound": 0,
  "timestamp": "2025-06-23T10:30:00Z"
}
```

#### 2. GET /conflicts

List conflicts with optional filtering.

**Query Parameters:**
- `status` (optional): Filter by status (`open`, `acknowledged`, `resolved`, `dismissed`, `all`)
- `versionId` (optional): Filter by version
- `teamId` (optional): Filter by team
- `stakeholderId` (optional): Filter by involved stakeholder
- `severity` (optional): Filter by severity
- `page` (optional, default: 1): Page number
- `limit` (optional, default: 20, max: 100): Items per page

**Example Request:**
```
GET /conflicts?status=open&versionId=V1&severity=critical&page=1&limit=10
```

**Response (200 OK):**
```json
{
  "conflicts": [
    {
      "id": "alice_bob_engineering__V1",
      "key": {
        "stakeholderId1": "alice",
        "stakeholderId2": "bob",
        "teamId": "engineering",
        "versionId": "V1"
      },
      "title": "Engineering Team — P0 Priority Conflict",
      "description": "...",
      "summary": "P0 (Alice) vs P0 (Bob)",
      "severity": "critical",
      "detectedAt": "2025-06-23T10:30:00Z",
      "status": "open",
      "versionIds": ["V1"],
      "sourceRequestIds": ["req-001", "req-002"],
      "conflictCount": 2
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10,
  "totalPages": 1,
  "timestamp": "2025-06-23T10:30:00Z"
}
```

#### 3. GET /conflicts/:id

Get a specific conflict alert by ID.

**Example Request:**
```
GET /conflicts/alice_bob_engineering__V1
```

**Response (200 OK):**
```json
{
  "success": true,
  "conflict": {
    "id": "alice_bob_engineering__V1",
    "key": {
      "stakeholderId1": "alice",
      "stakeholderId2": "bob",
      "teamId": "engineering",
      "versionId": "V1"
    },
    "title": "Engineering Team — P0 Priority Conflict",
    "description": "...",
    "summary": "P0 (Alice) vs P0 (Bob)",
    "severity": "critical",
    "detectedAt": "2025-06-23T10:30:00Z",
    "status": "open",
    "conflictingPriorities": {
      "stakeholder1": {
        "stakeholderId": "alice",
        "stakeholderName": "Alice Smith",
        "role": "Product Manager"
      },
      "team": {
        "teamId": "engineering",
        "teamName": "Engineering Team"
      },
      "priority1": "P0",
      "priority2": "P0"
    },
    "stakeholders": [
      { "stakeholderId": "alice", "stakeholderName": "Alice Smith", "role": "Product Manager" },
      { "stakeholderId": "bob", "stakeholderName": "Bob Johnson", "role": "Engineering Manager" }
    ],
    "versionIds": ["V1"],
    "sourceRequestIds": ["req-001", "req-002"],
    "conflictCount": 2
  },
  "timestamp": "2025-06-23T10:30:00Z"
}
```

#### 4. POST /conflicts/:id/resolve

Manually resolve a conflict alert.

**Request Body:**
```json
{
  "action": "acknowledge",
  "note": "Negotiated and decided to prioritize backend scalability due to critical security requirements",
  "resolverUserId": "charlie"
}
```

**Valid Actions:**
- `acknowledge`: Mark as acknowledged
- `resolve`: Mark as resolved
- `dismiss`: Mark as dismissed

**Response (200 OK):**
```json
{
  "success": true,
  "conflict": {
    "id": "alice_bob_engineering__V1",
    "status": "resolved",
    "resolutionNote": "Negotiated and decided to prioritize backend scalability due to critical security requirements",
    "resolvedBy": "charlie",
    "resolvedAt": "2025-06-23T11:00:00Z",
    "conflictingPriorities": {
      "stakeholder1": { "stakeholderId": "alice", "stakeholderName": "Alice Smith", "role": "Product Manager" },
      "team": { "teamId": "engineering", "teamName": "Engineering Team" },
      "priority1": "P0",
      "priority2": "P0"
    },
    "stakeholders": [
      { "stakeholderId": "alice", "stakeholderName": "Alice Smith", "role": "Product Manager" },
      { "stakeholderId": "bob", "stakeholderName": "Bob Johnson", "role": "Engineering Manager" }
    ],
    "versionIds": ["V1"],
    "sourceRequestIds": ["req-001", "req-002"],
    "conflictCount": 2
  },
  "timestamp": "2025-06-23T11:00:00Z"
}
```

### Health Check

#### GET /conflicts/health

Check service health.

**Response (200 OK):**
```json
{
  "status": "healthy",
  "service": "conflict-detection",
  "version": "1.0.0",
  "timestamp": "2025-06-23T10:30:00Z"
}
```

## OpenAPI Specification

Complete OpenAPI 3.0 documentation is available in the `openapi/` directory with full schema definitions and request/response examples.

## Integration Guide

### Adding Conflict Detection to Your System

1. **Import the service:**

```typescript
import { ConflictDetectionService } from './conflict-detector.service.js';
import { registerConflictDetectionRoutes } from './api.js';

// Initialize detector
const detector = new ConflictDetectionService();

// Register API routes
fastify.register(registerConflictDetectionRoutes, {
  prefix: '/api/teams'
});
```

2. **Trigger detection from upstream system:**

```typescript
import { detectConflicts } from '../conflict-detection/api.js';

// On new priority request
const detected = await detectConflicts({
  requests: [newRequest],
  versionId: currentVersionId
});

if (detected.conflicts.length > 0) {
  // Publish alerts to notification system, logs, etc.
  console.log('Detected conflicts:', detected.conflicts);
}
```

3. **Periodic batch detection:**

```typescript
// Run every hour
setInterval(async () => {
  const allRequests = await priorityQueue.getAllRequests();
  const detected = await detector.detectConflicts({
    requests: allRequests
  });
  
  if (detected.conflicts.length > 0) {
    await publishAlerts(detected.conflicts);
  }
}, 60 * 60 * 1000);
```

## Testing

Run tests with:

```bash
npm test
```

Test Coverage:

- Unit tests for conflict detection logic
- Integration tests for API endpoints
- Deduplication scenarios
- Various priority combinations (P0/P1, P0/P2, etc.)
- Edge cases (single stakeholder, single team, etc.)

## Development Notes

### Data Layer

The current implementation uses an in-memory mock database. For production:

- Replace `mockConflictsDatabase` with PostgreSQL table
- Implement proper CRUD operations
- Add proper indexing on conflict keys
- Implement persistence layer for alert status updates

### Rule Configuration

The conflict rule is centrally defined in `conflict-rule.spec.ts`. To add new rules:

1. Update the rule specification
2. Add rule evaluator in `conflict-detector.service.ts`
3. Extend the ConflictRule type in `types.ts`
4. Add validation logic in `conflict-detector.service.ts`

### Feedback Mechanism

When conflicts are detected:
1. Alert is created with clear labels
2. Conflict resolvers can:
   - Acknowledge the conflict
   - Resolve by recording the decision
   - Dismiss if not relevant
3. Resolution note is captured

No automated resolution is performed — this is a manual process as per requirements.

## Security Considerations

- All endpoints should require API key or JWT authentication
- Implement RBAC checks for `/conflicts/list` and `/conflicts/:id/resolve`
- Validate all input data to prevent injection attacks
- Sanitize stakeholder and team data in responses
- Log all conflict alerts and resolutions for audit trails

## Known Limitations

- In-memory database (replace with PostgreSQL in production)
- No real-time push notifications (visibility via API only)
- Single rule implementation (need extensibility for additional rules)
- No telemetry or metrics collection
- No periodic background detection (manual or triggered only)

## Future Enhancements

- Add additional conflict detection rules (e.g., resource over-commitment)
- Implement periodic batch detection
- Add GraphQL API endpoints
- Integrate with Slack/email notification system
- Add dashboard analytics and visualizations
- Support for custom priority frameworks
- Conflict resolution workflows with approvals
- Historical conflict analysis and reporting

## License

Part of the Builderforce.ai platform.