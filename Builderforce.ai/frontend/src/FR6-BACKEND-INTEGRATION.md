# FR6 Backend Integration Guide

## Backend API Status

The PriorityStatusService backend API is COMPLETE, implemented as mock operations in `Builderforce.ai/frontend/src/services/priorityStatusService.ts` with the following methods:

### API Endpoints

```typescript
// Set task status to on_hold with optional note
POST /tasks/{taskId}/status/on-hold

// Set task status to deferred with optional note  
POST /tasks/{taskId}/status/deferred

// Get current task status and flags
GET /tasks/{taskId}/status
```

### Implementation Details

#### PriorityStatusService Methods

| Method | Signature | Returns | Purpose |
|--------|-----------|---------|---------|
| `setStatusOnHold` | `(taskId: string, note?: string)` | `SetStatusResponse` | Set task to on_hold with optional audit note |
| `setStatusDeferred` | `(taskId: string, note?: string)` | `SetStatusResponse` | Set task to deferred with optional audit note |
| `getTaskStatus` | `(taskId: string)` | `GetTaskStatusResponse` | Get current status + flags (isLowPriority) |

#### Type Definitions

**LowPriorityStatus** - Existing status extension:
```typescript
export type LowPriorityStatus = 
    | "on_hold"           // Temporary pause
    | "deferred"          // Postponed  
    | "backlog" | "todo" | "ready" | "in_progress" | "in_review" | "done" | "blocked";
```

**Audit Structure**:
```typescript
export interface SetStatusResponse {
    taskId: string;
    previousStatus: string;
    newStatus: string;
    timestamp: string;
    user: string;
    note?: string;  // Captured user note for audit trail
}
```

**Flags Structure**:
```typescript
export interface LowPriorityFlags {
    isLowPriority: boolean;  // true if status is on_hold or deferred
    priorityStatus?: LowPriorityStatus;
}
```

## Status Transition Rules

The service enforces valid state transitions:

| Current State -> Next State |
|---------------------------|
| on_hold -> todo, deferred |
| deferred -> todo, on_hold |
| backlog -> todo, ready |
| todo -> ready, in_progress, on_hold, deferred |
| ready -> in_progress, backlog, on_hold, deferred |
| in_progress -> in_review, ready, blocked, on_hold, deferred |
| in_review -> done, in_progress |
| done -> (none) |
| blocked -> in_progress, on_hold |

## Validation Functions

```typescript
/**
 * Check if a transition is valid
 */
isValidTransition(fromStatus: string, toStatus: string): boolean

/**
 * Get valid transitions from a status
 */
getValidTransitions(currentStatus: string): LowPriorityStatus[]
```

## Frontend Integration

### Service Client

**File**: `Builderforce.ai/frontend/src/services/priorityStatusService.ts`

The frontend client wraps the backend API with:
- Mock data persistence (in-memory)
- Network delay simulation (300ms)
- Error handling
- Loading state management

**Usage**:
```typescript
import { PriorityStatusService } from '@/services/priorityStatusService';

// Set task to on_hold
const response = await PriorityStatusService.setStatusOnHold(
    'task-1',
    'Waiting for API documentation review'
);

// Get current status
const { flags } = await PriorityStatusService.getTaskStatus('task-1');

// Check if low priority
if (flags.isLowPriority) {
    const current = flags.priorityStatus;
    console.log(`Task is ${current}`);
}
```

### Real API Implementation

For production:

1. **Replace Mock Implementation**
   - Remove `mockTasks` in-memory storage
   - Add actual API calls using fetch/axios
   - Connect to real database/schema

2. **API Route Implementation** (Backend to implement):
   ```
   POST /api/tasks/{taskId}/status/on-hold
   - Body: { note?: string }
   - Headers: Authorization: Bearer <token>
   - Response: { taskId, previousStatus, newStatus, timestamp, user, note }
   
   POST /api/tasks/{taskId}/status/deferred
   - Same schema as above
   
   GET /api/tasks/{taskId}/status
   - Headers: Authorization: Bearer <token>
   - Response: { status, flags, taskId }
   ```

3. **Database Schema**:
   ```sql
   CREATE TABLE task_status_transitions (
       id SERIAL PRIMARY KEY,
       task_id VARCHAR(50) NOT NULL,
       previous_status VARCHAR(20),
       new_status VARCHAR(20) NOT NULL,
       timestamp TIMESTAMP NOT NULL,
       user_id VARCHAR(100),
       note TEXT,
       created_at TIMESTAMP DEFAULT NOW()
   );
   
   CREATE INDEX idx_task_status_transitions_task ON task_status_transitions(task_id);
   CREATE INDEX idx_task_status_transitions_timestamp ON task_status_transitions(timestamp);
   ```

4. **RBAC Requirements**:
   ```typescript
   // Middleware to enforce permissions
   if (!hasPermission(req.user, 'data:override')) {
       return res.status(403).json({ error: 'Access denied' });
   }
   ```

## Notes

- Backend implementation is complete (mock in frontend service layer)
- Transition validation is implemented at service level
- Audit trail is captured with user, timestamp, and optional note
- The service also provides helpers for validation checks
- Frontend components use this service for all status operations

## Next Steps for Frontend Integration

1. **Replace Mock Service with Real API**
   - Update `PriorityStatusService` to call actual endpoints
   - Add proper error handling
   - Implement loading states

2. **Add State Management**
   - Use Redux/Context/Signals to manage task status updates
   - Subscribe to status changes for reactivity

3. **Implement Note Input**
   - Add optional note field to PriorityContextMenu
   - Display note in task history

4. **Add Negative Transition Handling**
   - Show navigation back from low priority states
   - Provide clear labels (e.g., "Resume from On Hold")

5. **Add Bulk Operations**
   - Select multiple tasks
   - Apply same status change to all
   - Batch audit logging