# Blocked Items - Quick Start Guide

## What You Need to Know

This feature allows users to manually mark tasks as blocked with a reason, and provides filtering and visual indicators to help teams manage bottlenecks.

## Installing and Using the Components

### Step 1: Import the Components

```tsx
import {
  BlockerBadge,
  BlockerDrawer,
  BlockerFilter,
  useBlocker,
  BoardCard,
} from '@/components/board';
```

### Step 2: Add the Indicator to Your Task Display

Add this to your task cards where the blocked status should be shown:

```tsx
{/* Visual indicator - FR1.4 */}
{task.isBlocked && (
  <BlockerBadge
    isBlocked={true}
    blockerReason={task.blockerReason}
    indicator="🚫"
  />
)}
```

### Step 3: Add the Toggle and Reason UI to Detail Views

Use `BlockerDrawer` in your task detail view:

```tsx
{/* Block/unblock and set reason - FR1.1, FR1.2, FR1.6 */}
<BlockerDrawer
  task={task}
  onUpdate={(updated) => {
    // API call to update the task
    // Example: axios.patch(`/api/board/tickets/${task.id}`, updated)
    // Reload the task or update local state
  }}
  disabled={false}
/>
```

### Step 4: Add Filtering (Optional)

Add the filter to your list view:

```tsx
{/* Filter to show only blocked tasks - FR1.5 */}
<BlockerFilter
  isBlockedFilterActive={showBlockedOnly}
  onToggleFilter={() => setShowBlockedOnly(!showBlockedOnly)}
  blockedCount={tasks.filter(t => t.isBlocked).length}
/>
```

## Task Data Structure

Your task objects must include these fields:

```typescript
interface Task {
  id: number;
  title: string;
  status: string;
  isBlocked: boolean;        // NEW: Whether task is blocked
  blockerReason?: string;    // NEW: Reason (max 255 chars)
  blockedIndicator?: string; // Optional custom indicator
  // ... existing fields
}
```

## Updating Task Backend

When toggling blocked status:

**Mark as blocked:**
```json
PATCH /api/board/tickets/{id}
{
  "isBlocked": true,
  "blockerReason": "Waiting for stakeholder approval"
}
```

**Unmark as blocked:**
```json
PATCH /api/board/tickets/{id}
{
  "isBlocked": false,
  "blockerReason": null
}
```

**Backend validation (required):**
- When `isBlocked: true`, `blockerReason` must be non-empty
- `blockerReason` length must not exceed 255 characters
- Return appropriate error if validation fails

## Testing the Feature

See the demo component:
`src/dashboard/priority-alignment/__mock__/BlockedItemsDemo.tsx`

Run the demo to see all features in action:
- Visual indicators
- Block/unblock functionality
- Reason input and validation
- Filtering
- Modal detail view

## Common Questions

### Q: What if I don't want a visual indicator?
A: All blocked indicator calls are conditional. Only render when `isBlocked` is true.

### Q: Can I change the emoji/icon?
A: Yes, provide a custom `indicator` prop (any string) to `BlockerBadge`.

### Q: What happens when unblocking?
A: `BlockerDrawer` automatically clears the `blockerReason` when `isBlocked` becomes false.

### Q: How do I enforce the 255 character limit?
A: The component enforces it visually, but the backend must also validate to prevent storing longer strings.

### Q: Can I use multiple blockers for a single task?
A: No, the spec allows only a single blocker reason per task.

## Need Help?

Check the full implementation doc:
`prd-implementation/BLOCKED-ITEMS-IMPLEMENTATION.md`