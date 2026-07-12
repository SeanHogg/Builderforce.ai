# Build Plan: Responses Saved as Project Health Baseline

## Overview

This document provides the technical design and implementation plan for the "Project Health Baseline" feature, per PRD #294.

### Goal
Enable users to designate and persist a set of AI responses as a named, versioned project health baseline that can be referenced, compared against, and audited at any future point.

---

## 1. Type System (TypeScript)

### Models

```typescript
// Baseline.ts

export enum BaselineStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived'
}

export enum BaselineVersion {
  v1 = 'v1',
  v2 = 'v2',
  // Monotonically incrementing integers for database
}

export interface BaselineMetadata {
  projectId: number;
  baselineName: string;
  description?: string;
  tags: string[]; // Optional tags for filtering (e.g., 'security', 'performance')
}

export interface BaselineContent {
  // Original AI response content
  responseText: string;
  responseMetadata?: {
    model: string;
    timestamp?: string;
    inputContext?: string;
  };
}

export interface Baseline {
  id: number; // Primary Key
  version: BaselineVersion; // 'v1', 'v2', etc.
  status: BaselineStatus; // 'active' or 'archived'
  
  metadata: BaselineMetadata;
  content: BaselineContent;
  
  author: {
    userId: string;
    name: string;
  };
  
  createdAt: string; // ISO 8601
  updatedAt: string;
  
  auditTrail: BaselineAuditEntry[];
}

export interface BaselineAuditEntry {
  id: string;
  action: 'CREATE' | 'PROMOTE' | 'ARCHIVE' | 'VIEW' | 'COMPARE';
  performedBy: string; // userId
  timestamp: string;
  details?: string;
}
```

---

## 2. Database Schema

```sql
-- migrations/baselines.sql

CREATE TABLE IF NOT EXISTS baselines (
    id SERIAL PRIMARY KEY,
    version VARCHAR(10) NOT NULL CHECK (version IN ('v1', 'v2', 'v3', 'v4', 'v5')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    baseline_name VARCHAR(255) NOT NULL,
    description TEXT,
    tags TEXT[], -- Array of strings
    
    response_text TEXT NOT NULL,
    response_metadata JSONB,
    
    author_id VARCHAR(255) NOT NULL,
    author_name VARCHAR(255),
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(project_id, baseline_name, version)
);

CREATE INDEX idx_baselines_project_id ON baselines(project_id);
CREATE INDEX idx_baselines_status ON baselines(status);
CREATE INDEX idx_baselines_version ON baselines(version);
CREATE INDEX idx_baselines_tags ON baselines USING GIN(tags);
CREATE INDEX idx_baselines_created_at ON baselines(created_at DESC);
CREATE INDEX idx_baselines_name ON baselines(baseline_name);

CREATE TABLE IF NOT EXISTS baseline_audit_log (
    id VARCHAR(36) PRIMARY KEY,
    action VARCHAR(20) NOT NULL CHECK (action IN ('CREATE', 'PROMOTE', 'ARCHIVE', 'VIEW', 'COMPARE')),
    baseline_id INTEGER NOT NULL REFERENCES baselines(id) ON DELETE CASCADE,
    performed_by VARCHAR(255) NOT NULL,
    performed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    details JSONB
);

CREATE INDEX idx_baseline_audit_log_baseline_id ON baseline_audit_log(baseline_id);
CREATE INDEX idx_baseline_audit_log_performed_at ON baseline_audit_log(performed_at DESC);
```

---

## 3. API contracts

### 3.1 Create Baseline

**Endpoint:** `POST /api/baselines`

**Request:**
```json
{
  "baselineName": "performance-baseline-v1",
  "description": "Code performance baseline after major refactor",
  "tags": ["performance", "refactor"],
  "responseText": "The fetch function calls should use React Query for automatic caching and deduplication...",
  "responseMetadata": {
    "model": "builderforce-llm-gpt-4",
    "contextMode": "code-review",
    "timestamp": "2025-06-20T10:30:00Z"
  }
}
```

**Response (201):**
```json
{
  "baseline": {
    "id": 1,
    "version": "v1",
    "status": "active",
    "metadata": {
      "projectId": 123,
      "baselineName": "performance-baseline-v1",
      "description": "Code performance baseline after major refactor",
      "tags": ["performance", "refactor"]
    },
    "content": {
      "responseText": "The fetch function calls should use React Query...",
      "responseMetadata": { ... }
    },
    "author": {
      "userId": "user-123",
      "name": "John Doe"
    },
    "createdAt": "2025-06-20T10:30:00Z",
    "updatedAt": "2025-06-20T10:30:00Z",
    "auditTrail": []
  }
}
```

**Error (403):** Permission denied (user not editor)

**Error (400):** Missing baselineName, responseText is too large (> 10,000 tokens)

---

### 3.2 List Baselines

**Endpoint:** `GET /api/baselines?projectId={id}&status={status}&tags={tag}&name={name}&limit={limit}&offset={offset}`

**Response (200):**
```json
{
  "baselines": [
    {
      "id": 1,
      "version": "v2",
      "status": "archived",
      "metadata": { ... },
      "content": { ... },
      "author": { ... },
      "createdAt": "2025-06-15T14:00:00Z",
      "updatedAt": "2025-06-15T14:00:00Z"
    }
  ],
  "total": 25,
  "returned": 10,
  "truncated": false
}
```

---

### 3.3 Baseline Comparison (Diff)

**Endpoint:** `GET /api/baselines/diff?baselineId1={id1}&baselineId2={id2}`

**Response (200):**
```json
{
  "baseline1": {
    "id": 1,
    "name": "performance-baseline-v1",
    "version": "v1",
    "content": { ... }
  },
  "baseline2": {
    "id": 2,
    "name": "performance-baseline-v2",
    "version": "v2",
    "content": { ... }
  },
  "diff": {
    "added": [
      {
        "type": "sentence",
        "content": "Fallback to using local cache if API fails",
        "context": "...",
        "startLine": 12,
        "endLine": 15
      }
    ],
    "removed": [
      {
        "type": "sentence",
        "content": "Always use the network directly",
        "startLine": 8,
        "endLine": 10
      }
    ],
    "unchanged": [
      {
        "type": "sentence",
        "content": "The fetch function calls should use React Query for automatic caching",
        "startLine": 1
      }
    ]
  },
  "health Delta Summary": {
    "summary": "The new baseline adds fallback caching and debouncing, improving resilience against network failures",
    "summary_type": "positive"
  }
}
```

---

### 3.4 Promote Baseline (Set Active)

**Endpoint:** `POST /api/baselines/{id}/promote`

**Request Body:**
```json
{
  "streamName": "performance-baseline"
}
```

**Response (200):**
```json
{
  "message": "Baseline v2 promoted to active",
  "newBaseline": { ... },
  "previouslyActive": {
    "id": 1,
    "version": "v1",
    "status": "archived"
  }
}
```

**Error (400):** Cannot promote a non-archived baseline

**Error (403):** Permission denied

---

### 3.5 Archive Baseline

**Endpoint:** `POST /api/baselines/{id}/archive`

**Response (200):**
```json
{
  "message": "Baseline archived successfully",
  "baseline": { ... }
}
```

---

### 3.6 Get Active Baseline

**Endpoint:** `GET /api/baselines/active?projectId={id}&streamName={streamName}`

**Response (200):**
```json
{
  "baseline": {
    "id": 2,
    "version": "v2",
    "status": "active",
    "metadata": { ... },
    "content": { ... },
    "author": { ... },
    "createdAt": "2025-06-15T14:00:00Z"
  }
}
```

**Error (404):** No active baseline found for this stream

---

## 4. Frontend Component Structure

```
frontend/src/
├── components/
│   ├── project-health-baseline/
│   │   ├── BaselineManager.tsx          # Main container
│   │   ├── BaselineList.tsx             # List view
│   │   ├── BaselineCard.tsx             # Single baseline display
│   │   ├── BaselineDiffViewer.tsx       # Side-by-side diff
│   │   ├── BaselineCreateDialog.tsx     # Create baseline modal
│   │   ├── BaselineCompareDialog.tsx    # Compare baselines
│   │   ├── BaselinePromoteButton.tsx    # Promote to active
│   │   ├── BaselineArchiveButton.tsx    # Archive button
│   └── permissions/
│       └── BaselinePermissionGuard.tsx  # Role-based access control
├── hooks/
│   ├── useBaselines.ts                  # CRUD hooks
│   └── useBaselineDiff.ts              # Diff computation
└── utils/
    ├── baselineDiff.ts                  # Diff algorithm
    └── baselineValidation.ts            # Validation helpers
```

---

## 5. Domain Logic

### 5.1 Baseline Versioning

On baseline creation:
- Check if any active baselines exist for the `streamName`
- If no active exist, new baseline gets `v1` (if stream doesn't exist) or next version (if stream exists)
- If active exists, increment version number (v1 → v2, v2 → v3)

### 5.2 Immutability Constraint

After baseline is created, `responseText` and metadata are immutable to maintain integrity. Only:
- Description and tags can be extended via metadata JSONB
- New audit entries can be appended

### 5.3 Status Transitions

```
CREATE → ACTIVE
CREATE → ARCHIVED (if explicitly marked so)

ACTIVE → ARCHIVED (manual archive or promotion)
ARCHIVED → ACTIVE (promotion only)

ARCHIVED → ARCHIVED (no change)
ACTIVE → ACTIVE (no change)
```

### 5.4 Diff Algorithm (Paragraph-Level)

Splits responses into paragraphs or semantic fragments, then computes:
```typescript
type DiffBlock = {
  type: 'added' | 'removed' | 'unchanged',
  content: string,
  textDiff: {
    added: string[],
    removed: string[]
  },
  position: { startLine: number, endLine: number }
}
```

Algorithm: Longest Common Subsequence (LCS) on paragraph-level tokens.

---

## 6. Permissions (RBAC)

| Role | Create | View | Compare | Promote | Archive | Delete |
|------|--------|------|---------|---------|---------|--------|
| Owner | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Editor | ✅ | ✅ | ✅ | ✅ | No | No |
| Viewer | No | ✅ | ✅ | No | No | No |

Implementation on backend:
```typescript
// In permission middleware
if (action === 'CREATE' || action === 'PROMOTE') {
  if (user.role === 'owner' || user.role === 'admin' || user.role === 'editor') {
    return true;
  }
  throw new Error('PERMISSION_DENIED');
}
```

---

## 7. Audit Requirements

All actions logged to `baseline_audit_log`:
- CREATE: baselineName, tags, responseLength, model
- PROMOTE: oldStatus, newStatus
- ARCHIVE: status
- VIEW: baselineId, timestamp
- COMPARE: baseline1Id, baseline2Id, diffStats (addedCount, removedCount)

Timing requirement: < 5 seconds after action
Status: Memoize successful audit write; retry on failure

---

## 8. Implementation Checklist

### Backend (Platform Team)
- [ ] Create database migrations
- [ ] Implement Baseline service layer
- [ ] Create API endpoints (CRUD + diff + promote)
- [ ] Add RBAC middleware
- [ ] Implement audit logging
- [ ] Add diff algorithm
- [ ] Create LLM prompt for health delta summary

### Frontend (Web/App Team)
- [ ] Create component library
- [ ] Implement baseline list view
- [ ] Create flow to save baseline
- [ ] Implement diff viewer
- [ ] Add role-based UI (disable Create/Promote buttons for non-Editiors)
- [ ] Add notifications on promotion

### DevOps
- [ ] Add migration script to deploy schema
- [ ] Update API docs
- [ ] Load testing on diff endpoint (10k token responses)
- [ ] Add indexing strategies

### Testing
- [ ] Unit tests for validation rules
- [ ] Integration tests for CRUD and diff
- [ ] Permission tests (viewer cannot create)
- [ ] Audit log verification
- [ ] Rate limit handling on large responses

---

## 9. Out-of-Scope Considerations

- Real-time continuous rate monitoring (future)
- Cross-project baselines (scope is single project only)
- Git-style branching of streams
- Export to external tools (Jira, Linear, Notion)
- Automated nightly snapshots
- Binary/media support (text only for v1)

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Baseline creation time | < 2 seconds |
| List baselines response time | < 500ms |
| Diff computation time (10k tokens) | < 10 seconds |
| Audit log latency | < 5 seconds |
| Reviewer approval rate (post PRD) | Not applicable |
| Feature adoption (post PRD) | TBD |

---

## 11. Open Questions

1. **Response encoding:** How should we handle non-ASCII characters and emojis in responseText? (UTF-8 with index preservation)
2. **Metadata versioning:** Should responseMetadata be editable? (Decided: immutable in V1, JSON extension allowed)
3. **Token counting:** How do we count tokens for the limit (10,000)? (Use approximate character count: 1 token ≈ 4 characters)
4. **Backexport of AI responses:** Where are these coming from in the frontend? (Need this integration with central AI response storage)
5. **Conflict resolution:** What if two users create baselines with the same streamName at the same time? (Garbage collect based on timestamp)

---

## 12. Rollout Plan

### Phase 1: Core Infrastructure (Weeks 1-2)
- Database schema
- API endpoints (CRUD)
- Basic RBAC

### Phase 2: Diff & Comparison (Week 3)
- Diff algorithm and endpoints
- Health delta summary LLM
- Frontend diff viewer

### Phase 3: Promotion & Notifications (Week 4)
- Promote/Archive workflow
- In-app notifications
- Audit UI (optional)

### Phase 4: Polish & Testing (Week 5)
- Load testing
- Edge cases
- Documentation

---

**Document Version:** 1.0
**Last Updated:** 2025-06-20
**Owner:** BuilderForce Platform Team