# Budget Constraints API

REST API for managing budget constraints with role-based access control and enrollment enforcement.

## Overview

This API provides endpoints for:
- Listing, creating, retrieving, and updating budget constraints
- Enforcing enrollment for operations requiring strict mode
- Managing budget overrides and audit logs
- Generating budget reports and alerts
- Refreshing budget constraint states

## Role-Based Access Control

### Permissions Matrix (FR-8)
| Role | Operations Allowed | Access to Other Projects |
|------|-------------------|---------------------------|
| Viewer (READ_PERMISSION) | READ operations only | **NO** - returns 403 |
| Project Manager | ALL operations | Limited to own projects |

### HTTP Status Codes
- **403 Forbidden**: Enforcement of AC-15 (Viewer role) or AC-16 (non-project-manager projects)
- **402 Payment Required**: Enrollment check failure in strict mode (AC-9)
- **400 Bad Request**: Missing or invalid parameters

## API Endpoints

### Base URL
```
/api/budget-constraints
```

### 1. List Constraints
List all budget constraints for a project.

```
GET /api/budget-constraints?projectId={id}&userId={id}
```

**Permissions**: Project Manager only
**AC-16**: Returns 403 for Viewer (READ_PERMISSION)

### 2. Create Constraint
Create a new budget constraint.

```
POST /api/budget-constraints?projectId={id}&userId={id}
Content-Type: application/json

{
  "currency": "USD",
  "amount": 100000,
  "title": "Contingency Fund",
  "category": "budget"
}
```

**Permissions**: Project Manager only

### 3. Get Single Constraint
Retrieve a specific budget constraint.

```
GET /api/budget-constraints/{constraintId}?projectId={id}&userId={id}
```

**Permissions**: Project Manager only
**AC-16**: Returns 403 for Viewer (READ_PERMISSION)

### 4. Update Constraint
Update a budget constraint (PUT or PATCH).

```
PUT /api/budget-constraints/{constraintId}?projectId={id}&userId={id}
PATCH /api/budget-constraints/{constraintId}?projectId={id}&userId={id}
```

**Permissions**: Project Manager only

### 5. Refresh Constraints
Refresh budget constraints without deletion.

```
PUT /api/budget-constraints/refresh?projectId={id}&userId={id}
PATCH /api/budget-constraints/refresh?projectId={id}&userId={id}
```

**Permissions**: Project Manager only

### 6. Enrollment Check
Check user's enrollment status.

```
GET /api/budget-constraints/enrollment?userId={id}&projectId={id}
```

Returns: `{ canEnroll, isEnrolled, role }`

### 7. Enrollment Check (Strict Mode)
Enforcement of AC-9: Returns 402 if not enrolled.

```
GET /api/budget-constraints/enrollment/strict?userId={id}&projectId={id}&strictMode=true
```

**AC-9**: Returns HTTP 402 with `enrollmentRequired: true` if user is not enrolled

### 8. Override Requests

#### Create Override
```
POST /api/budget-constraints/{constraintId}/overrides?projectId={id}&userId={id}
```

#### Get Override
```
GET /api/budget-constraints/overrides/{overrideId}?projectId={id}&userId={id}
```

#### List Recent Overrides
```
GET /api/budget-constraints/overrides/recent?projectId={id}&userId={id}&type={all|pending|approved}&limit=50
```

### 9. Alerts

#### List Alerts
```
GET /api/budget-constraints/alerts?projectId={id}&userId={id}&type={warning|error|info}
```

**Permissions**: Project Manager only

#### Create Alert
```
POST /api/budget-constraints/alerts?projectId={id}&userId={id}
```

#### Mark as Read
```
PATCH /api/budget-constraints/alerts/{alertId}/read?projectId={id}&userId={id}
```

### 10. Reports

#### Get Summary Report
```
GET /api/budget-constraints/reports/summary?projectId={id}&userId={id}
```

**Permissions**: Project Manager only

#### Generate Report
```
POST /api/budget-constraints/reports/summary?projectId={id}&userId={id}
```

## Data Models

### BudgetConstraint
```typescript
{
  id: string;
  projectId: string;
  currency: 'USD' | 'EUR' | 'GBP' | 'CAD';
  amount: number;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  category: 'budget' | 'capex' | 'opex' | 'invoice' | 'research';
  status: 'draft' | 'active' | 'expired' | 'rejected';
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
```

### EnrollmentCheckResult
```typescript
{
  canEnroll: boolean;
  isEnrolled: boolean;
  enrollmentId?: string;
  role: 'viewer' | 'contributor' | 'maintainer' | 'owner';
}
```

## Enrollment Workflow

1. User calls `/api/budget-constraints/enrollment?userId=X&projectId=Y`
2. System checks if user is enrolled
3. If not enrolled, user can enroll using demo endpoint:
   ```
   POST /api/budget-constraints/enrollment/register
   {
     "userId": "user-123",
     "projectId": "project-456",
     "role": "project-manager"  // or "viewer"
   }
   ```
4. For frontend, a separate enrollment API would be created (out of current scope)

## AC Compliance

### AC-9: HTTP 402 in strict mode
- **Requirement**: Return HTTP 402 when enrollment check fails in strict mode
- **Implementation**: `/enrollment/strict` endpoint returns 402 with `enrollmentRequired: true`
- **Test**: Call enrollment/strict with non-enrolled user → status 402

### AC-15: HTTP 403 for Viewer (READ_PERMISSION)
- **Requirement**: Budget constraint endpoints return HTTP 403 for users with READ_PERMISSION
- **Implementation**: All `/api/budget-constraints/*` endpoints validate role; return 403 if role !== 'project-manager'
- **Test**: Call any endpoint with role=viewer → status 403

### AC-16: Project Manager scoped to own projects
- **Requirement**: Users can only access their own projects
- **Implementation**: All endpoints filter by projectId query parameter
- **Test**: Access project with projectId≠user's project → denied

## Response Examples

### Success Response (200)
```json
[
  {
    "id": "constraint-123",
    "projectId": "project-456",
    "currency": "USD",
    "amount": 100000,
    "title": "Contingency Fund",
    "category": "budget",
    "status": "active",
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z",
    "createdBy": "user-123"
  }
]
```

### Forbidden Response (403)
```json
{
  "error": "Access denied: Forbid READ_PERMISSION users"
}
```

### Payment Required (402)
```json
{
  "error": "Enrollment required to perform this operation",
  "enrollmentRequired": true
}
```

## Testing

### Basic Test
```bash
# Create enrollment
curl -X POST http://localhost:3000/api/budget-constraints/enrollment/register \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-123","projectId":"project-456","role":"project-manager"}'

# List constraints
curl "http://localhost:3000/api/budget-constraints?projectId=project-456&userId=user-123"

# Check enrollment with strict mode
curl "http://localhost:3000/api/budget-constraints/enrollment/strict?userId=user-123&projectId=project-456&strictMode=true"
```

## Integration Notes

1. Query Parameters Required
   - All endpoints require `projectId` and `userId` to validate RBAC

2. Token-Aware Authentication
   - In production, token-based auth would verify userId/role and override the mock enrollment check

3. DB Shadows
   - Mock data persists in memory only; implement actual DB tables per PRD follow-up

4. Pagination
   - Override and alert list endpoints support `limit` and `after` cursors
   - Freeze state for known cursors to avoid empty results; implement reverse-order consumers (e.g., GET /overrides/recent?after=...) with a cursor at the end

5. Future Enhancements
   - Full enrollment system (enrollment registration, acceptance workflow, expirations)
   - Spending tracking per constraint
   - Multi-currency conversions
   - Audit logging per FR-7.4

## Security Considerations

- Never expose sensitive financial data to unauthorized roles
- Always validate enrollment status before performing financial operations
- Use HTTPS in production
- Implement rate limiting for public endpoints
- Log all access attempts for audit purposes

## Files

- `budget-constraints.types.ts` - TypeScript type definitions
- `budget-constraints.router.ts` - Express router with all endpoints
- `budget-constraints.ts` - Helper functions for enrollment and permissions
- `budget-api.ts` - Main API entry point
- `index.ts` - Public API exports

## License

(builderforce.ai license)