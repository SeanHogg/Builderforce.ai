/**
 * CompactListProgress Usage Examples
 *
 * This file shows how to use the CompactListProgress component in various list views.
 * These examples demonstrate the component's reusability across different domains.
 */

import { CompactListProgress, type ProgressItem } from './CompactListProgress';

// ----------------------------------------------------------------------
// Example 1: Task Progress List (common use case)
// ----------------------------------------------------------------------
// Demonstrates displaying progress for tasks in a project view.
//

interface TaskWithProgress extends Omit<ProgressItem, 'id'> {
  assignee: string;
  dueDate?: string;
}

const taskItems: ProgressItem[] = [
  {
    id: 'task-1',
    label: 'Draft initial requirements',
    completed: 3,
    total: 8,
    status: 'in_progress',
  },
  {
    id: 'task-2',
    label: 'Setup development environment',
    completed: 5,
    total: 5,
    status: 'completed',
  },
  {
    id: 'task-3',
    label: 'Design database schema',
    completed: 0,
    total: 4,
    status: 'not_started',
  },
  {
    id: 'task-4',
    label: 'Implement authentication flow',
    completed: 2,
    total: 6,
    status: 'in_progress',
  },
  {
    id: 'task-5',
    label: 'Write unit tests',
    completed: 8,
    total: 10,
    status: 'in_progress',
  },
];

/**
 * Example task list component showing progress breakdown.
 * Sort by progress descending so team sees what's nearing completion first.
 */
export function TaskProgressList() {
  return (
    <div style={{ padding: '16px' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px' }}>
        Task Progress
      </h3>
      <CompactListProgress items={taskItems} sortBy="progress_desc" />
    </div>
  );
}

// ----------------------------------------------------------------------
// Example 2: Sprint Goal Progress (product backlog view)
// ----------------------------------------------------------------------
// Demonstrates displaying progress for sprint/goal items.
//

const sprintItems: ProgressItem[] = [
  {
    id: 'goal-1',
    label: 'User authentication',
    completed: 4,
    total: 5,
    status: 'in_progress',
  },
  {
    id: 'goal-2',
    label: 'Payment integration',
    completed: 0,
    total: 3,
    status: 'not_started',
  },
  {
    id: 'goal-3',
    label: 'Dashboard redesign',
    completed: 12,
    total: 15,
    status: 'in_progress',
  },
  {
    id: 'goal-4',
    label: 'Performance optimization',
    completed: 5,
    total: 5,
    status: 'completed',
  },
  {
    id: 'goal-5',
    label: 'Accessibility audit',
    completed: 0,
    total: 4,
    status: 'not_started',
  },
];

/**
 * Example sprint goal list showing completion rates.
 * Sort by status so not-started items appear first.
 */
export function SprintGoalProgress() {
  return (
    <div style={{ padding: '16px' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px' }}>
        Sprint Goals
      </h3>
      <CompactListProgress items={sprintItems} sortBy="status" />
    </div>
  );
}

// ----------------------------------------------------------------------
// Example 3: API Response Integration (server-rendered list)
// ----------------------------------------------------------------------
// Demonstrates consuming data from an API and displaying it in the list.
//

interface ApiResponse {
  id: string;
  label: string;
  completed: number;
  total: number;
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked';
}

async function fetchApiProgress(): Promise<ApiResponse[]> {
  // Example API call
  const response = await fetch('/api/project/123/progress');
  return response.json();
}

/**
 * Example list that fetches progress data and renders it.
 * This shows how the component integrates with real data sources.
 */
export async function ApiProgressList() {
  const items = await fetchApiProgress();

  return (
    <div style={{ padding: '16px' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px' }}>
        API Progress Data
      </h3>
      <CompactListProgress items={items} sortBy="progress_desc" isLoading={false} />
    </div>
  );
}

// ----------------------------------------------------------------------
// Example 4: Error Handling with Blocked Items
// ----------------------------------------------------------------------
// Demonstrates how the component handles blocked items with red styling.
//

const criticalItems: ProgressItem[] = [
  {
    id: 'cr-1',
    label: 'Deploy to staging',
    completed: 0,
    total: 3,
    status: 'blocked',
  },
  {
    id: 'cr-2',
    label: 'Final QA check',
    completed: 1,
    total: 5,
    status: 'in_progress',
  },
  {
    id: 'cr-3',
    label: 'Documentation updates',
    completed: 2,
    total: 3,
    status: 'completed',
  },
];

/**
 * Example of a critical workflow with blocked items highlighted.
 */
export function CriticalPathProgress() {
  return (
    <div style={{ padding: '16px' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px', color: '#f59e0b' }}>
        Critical Path
      </h3>
      <CompactListProgress items={criticalItems} sortBy="status" />
    </div>
  );
}

// ----------------------------------------------------------------------
// Example 5: Percentage-Only Display (alternative value format)
// ----------------------------------------------------------------------
// Demonstrates rendering just percentages instead of fractions.
//

const percentageItems: ProgressItem[] = [
  { id: 'p-1', label: 'API integration', completed: 92, total: 100, status: 'completed' },
  { id: 'p-2', label: 'Frontend optimization', completed: 67, total: 100, status: 'in_progress' },
  { id: 'p-3', label: 'Database migration', completed: 15, total: 50, status: 'in_progress' },
  { id: 'p-4', label: 'Backup setup', completed: 100, total: 100, status: 'completed' },
];

/**
 * Example using percentage-only display mode.
 */
export function PercentageOnlyList() {
  return (
    <div style={{ padding: '16px' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px' }}>
        Percentages Only
      </h3>
      <CompactListProgress
        items={percentageItems}
        valueFormat="percent"
        emptyText="No progress data available"
      />
    </div>
  );
}

// ----------------------------------------------------------------------
// Usage Summary
// ----------------------------------------------------------------------
/*
## Basic Usage

```tsx
import { CompactListProgress } from '@/components/lists';

<CompactListProgress items={data} sortBy="progress_desc" />
```

## Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| items | ProgressItem[] | No | [] | Array of progress items |
| sortBy | 'progress_desc' \| 'progress_asc' \| 'status' \| 'label_asc' | No | undefined | Sort order for items |
| isLoading | boolean | No | false | Show loading state with skeletons |
| emptyText | string | No | 'No items to display' | Empty state message |
| showValue | boolean | No | true | Show numeric value column |
| valueFormat | 'fraction' \| 'percent' | No | 'fraction' | Value display format |
| skeletonRowCount | number | No | 3 | Number of skeleton rows to show |
| className | string | No | undefined | Additional CSS class |
| aria-label | string | No | undefined | Accessible list label |

## Data Shape

```typescript
interface ProgressItem {
  id: string;           // Unique identifier
  label: string;        // Display name
  completed: number;    // Completed units
  total: number;        // Total units
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked';
}
```

## Key Behaviors

1. **Compact Layout**: Rows are 40px max height, bars are 6px
2. **Responsive**: Truncates labels, no horizontal scroll
3. **Accessible**: Full ARIA support including keyboard navigation
4. **Safe Division**: Handles `total = 0` gracefully (shows 0%)
5. **Sorted by Default**: Maintains input order unless sortBy is specified
*/