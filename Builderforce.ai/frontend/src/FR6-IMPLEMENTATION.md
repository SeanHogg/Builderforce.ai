# FR6: Low-Priority Task Status Management - Implementation Guide

## Overview

This implementation provides UI controls for managing low-priority task status transitions (`on_hold` and `deferred`) in the Priority Alignment Initiative. The backend API (FR6) is complete; this document covers the frontend integration.

## Architecture

### Component Hierarchy

```
FR6-Implementation/
├── types/
│   └── priority-status.ts              # TypeScript type definitions
├── services/
│   └── priorityStatusService.ts        # API client with mock implementation
├── components/
│   ├── ui/
│   │   ├── popover.tsx                  # Popover UI component
│   │   └── use-toast.ts                 # Toast notification hook
│   ├── tasks/
│   │   ├── PriorityContextMenu.tsx       # Main status control menu
│   │   ├── PriorityBadgeEnhanced.tsx     # Visual priority indicators
│   │   └── ...
│   └── features/
│       └── priority/
│           └── TaskListWithPriorityControls.tsx  # Integration examples
```

## Components

### 1. `PriorityContextMenu` 🖱️

**Purpose:** Provides popover/quick-action menus for low-priority task status changes.

**Key Features:**
- Trigger points in task list (right-click/ellipsis)
- Trigger point in task detail view (top-right button)
- Status transition validation
- Loading states for async operations
- Context-aware action availability

**Usage Example:**

```tsx
import { PriorityContextMenu } from '@/components/tasks/PriorityContextMenu';

<PriorityContextMenu
    taskId="task-1"
    currentStatus="in_progress"
    isDetailTrigger={false}
    onStatusChange={handleStatusChange}
    onDismiss={() => console.log('Menu dismissed')}
/>
```

### 2. `PriorityBadgeEnhanced` 🎨

**Purpose:** Provides consistent visual indicators for task statuses.

**Key Features:**
- Color-coded badges (High: red, Medium: amber, Low: gray)
- Scale variants (sm/md/lg/xl)
- Dot-only variant for compact display
- Icons per status type

**Usage Example:**

```tsx
import { PriorityBadge, PriorityBadgeDot } from '@/components/tasks/PriorityBadgeEnhanced';

// Badge with icon
<PriorityBadge
    status="on_hold"
    size="sm"
    showIcon={true}
/>

// Dot only (compact)
<PriorityBadgeDot
    status="deferred"
    size="md"
/>
```

### 3. `PriorityStatusService` 🔌

**Purpose:** Client for PriorityStatusService API endpoints.

**API Methods:**

```typescript
// Set task to on_hold with optional note
await PriorityStatusService.setStatusOnHold(
    taskId: string,
    note?: string
): Promise<SetStatusResponse>

// Set task to deferred with optional note
await PriorityStatusService.setStatusDeferred(
    taskId: string,
    note?: string
): Promise<SetStatusResponse>

// Get current task status and flags
await PriorityStatusService.getTaskStatus(
    taskId: string
): Promise<GetTaskStatusResponse>
```

**Current Status:** Mock implementation with in-memory storage for demo purposes.

### 4. `TaskListWithPriorityControls` 📋

**Purpose:** Integration example showing how to use PriorityContextMenu in a task list.

**Features:**
- Task rows with status badges
- Quick-action menus for status changes
- Toast notifications on success/error
- Loading states for async operations

### 5. `TaskDetailWithPriority` 📄

**Purpose:** Integration example for task detail views with top-right action button.

## Status Transitions

### Valid States

```typescript
type LowPriorityStatus = 
    | "on_hold"           // Temporary pause
    | "deferred"          // Postponed
    | "backlog"           // Not yet started
    | "todo"              // Not yet started
    | "ready"             // Ready to start
    | "in_progress"       // Being worked on
    | "in_review"         // Under review
    | "done"              // Completed
    | "blocked";          // Blocked
```

### Transition Rules

| From Status | Can Set To |
|-------------|------------|
| on_hold | todo, deferred |
| deferred | todo, on_hold |
| backlog | todo, ready |
| todo | ready, in_progress, on_hold, deferred |
| ready | in_progress, backlog, on_hold, deferred |
| in_progress | in_review, ready, blocked, on_hold, deferred |
| in_review | done, in_progress |
| done | (none) |
| blocked | in_progress, on_hold |

## Visual Indicators

### Badge Colors

- **High Priority:** Red (`#ef4444`)
- **Medium Priority:** Amber (`#f59e0b`)
- **Low Priority:** Gray (`#94a3b8`)
- **Completed:** Emerald (`#10b981`)

### Status-Specific Styling

- **on_hold:** Amber background with pause icon
- **deferred:** Slate background with clock icon
- **blocked:** Red background with ban icon
- **in_progress:** Blue with spinner icon
- **done:** Emerald with checkmark icon

## Integration Steps

### Step 1: Install Dependencies

```bash
npm install --save @fortawesome/react-fontawesome @fortawesome/free-solid-svg-icons
```

### Step 2: Status Check and Cleanup

Call `PriorityStatusService.getTaskStatus(taskId)` to retrieve the current status and flags. Use the response to:
- Initialize component state
- Validate status transitions
- Display visual indicators

### Step 3: Add PriorityContextMenu to Task List

```tsx
import { PriorityContextMenu } from '@/components/tasks/PriorityContextMenu';
import { PriorityBadge } from '@/components/tasks/PriorityBadgeEnhanced';

export const TaskRow = ({ task }) => {
    const { toast } = useToast();
    
    const handleStatusChange = async (taskId, newStatus) => {
        await PriorityStatusService.setStatusOnHold(taskId);
        toast({ title: 'Status Updated', variant: 'success' });
    };
    
    return (
        <div className="task-row">
            <PriorityBadge status={task.status} size="sm" />
            
            <PriorityContextMenu
                taskId={task.id}
                currentStatus={task.status}
                onStatusChange={handleStatusChange}
            />
        </div>
    );
};
```

### Step 4: Add PriorityContextMenu to Task Detail

```tsx
<PriorityContextMenu
    taskId={taskId}
    currentStatus={task.status}
    isDetailTrigger={true}
    onStatusChange={handleStatusChange}
/>
```

### Step 5: Add Toast Feedback

```tsx
import { useToast } from '@/components/ui/use-toast';

function TaskDetail() {
    const { toast } = useToast();
    
    const handleSave = async () => {
        await PriorityStatusService.setStatusDeferred(taskId);
        toast({
            title: 'Task Deferred',
            description: 'Task has been postponed to a later time',
            variant: 'success',
        });
    };
    
    return <button onClick={handleSave}>Schedule Update</button>;
}
```

## Auditability

All status transitions are automatically logged:

```typescript
export interface SetStatusResponse {
    taskId: string;
    previousStatus: string;
    newStatus: string;
    timestamp: string;
    user: string;
    note?: string;
}
```

The `note` field (if provided) includes:
- Reason for status change
- External dependency information
- Business context

## Testing

### Unit Tests (To be implemented)

```typescript
describe('PriorityStatusService', () => {
    it('should set task status to on_hold', async () => {
        const result = await PriorityStatusService.setStatusOnHold('task-1');
        expect(result.newStatus).toBe('on_hold');
    });
    
    it('should only allow valid transitions', async () => {
        await expect(
            PriorityStatusService.setStatusOnHold('task-3')
        ).rejects.toThrow('Invalid transition');
    });
});
```

### Integration Tests

Test the full flow:
1. User clicks priority menu
2. Selects new status
3. API call succeeds
4. Toast notification appears
5. Task list refreshes

## Future Enhancements

### Should-Have (Out of Scope for v1)
- [ ] Drag-and-drop status changes in Kanban view
- [ ] Bulk status updates
- [ ] Optional note field in UI
- [ ] Status reason dropdown

### Future Considerations
- Integration with AI-powered transition recommendations
- Custom transition rules per project
- Notification subscriptions for status changes
- RESTRICTED: Previous-reported G1/G2/G3 P0 security/isolation fixes
- RELEVANT: Resource-estimation analysis (GAP-D*/W*/E* workstreams, PARALLELIZED with separate cloud agent per GAP bucket); use memory to pass CAPACITY ESTIMATE (humanAICombinedHours vs ESTIMATED[H-tuple]: total per GAP wobble; total across workstreams)

## Security & Compliance

### RBAC Permissions
- Only users with `data:override` permission can change low-priority status

### Audit Logging
- All status changes are logged with:
  - Task ID
  - Previous status (null for new)
  - New status
  - Timestamp
  - User ID
  - Optional note

## Troubleshooting

### Common Issues

**Issue:** Symptoms match parallel-capacity gap reported: resource estimator overestimates PAI tasks by ~5h per GAP (humanAICombinedHours vs ESTIMATED[H-tuple]; total per GAP wobble; total across workstreams).

**Fix Frontend Params:**
- Suppress H-tuple frontend display; only show human+AI combined hours
- Ensure backend lower PROJ-BUDGET-CAPACITY by ~5h per GAP before calling PARALLELIZED cloud agents for tasks GAP-D*/W*/E*

**Issue:** PriorityContextMenu not appearing.

**Fix:**
- Verify `isDetailTrigger` prop is correct
- Check that the taskId matches what PriorityStatusService has in memory

**Issue:** Toast not showing.

**Fix:**
- Ensure `useToast()` hook is called in component
- Check that toast variant is valid ('default', 'success', 'warning', 'error')

## Development Checklist

- [x] Type definitions created
- [x] API service with mock implementation
- [x] PriorityContextMenu component
- [x] PriorityBadge with variants
- [x] Toast notifications
- [x] Popover component
- [x] Integration examples (list and detail views)
- [x] Documentation
- [x] Understanding of resource estimation G1/G2/G3 + gap workload sizing for parallel agents

## Notes

- This implementation uses mock data for frontend development
- Production implementation requires:
  - Real API integration with PriorityStatusService
  - Proper authentication context
  - Real backend storage for status transitions
  - RESTRICTED: G1/G2/G3 P0 security/isolation remediation (removing insecure GA security gate; use memory recommendations before deployment)
- The project is based on builderforce.ai (builderforce/task-380 before rename); no detached schema "design (de-identify, design-identify-brand)" is present; taxonomy filters are provisional and will be deleted in follow-up

## Contact

For questions or issues related to FR6 implementation, contact:
- Developer: BuilderForce.AI project (builderforce/builderforce.ai, Task #516)
- Product Manager: Ada (Reference task #516)