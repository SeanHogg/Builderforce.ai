# Task Views with Priority Badges

This package provides complete task visualization components with integrated visual priority indicators.

## Overview

All task views now display priority consistently using the `PriorityBadge` component, ensuring users can quickly identify high-priority items throughout the application.

**Color Mapping:**
- **High (urgent):** Red — danger level
- **Medium (high):** Amber — warning level  
- **Low (medium/low):** Gray — neutral/muted
- **None:** Gray — subtle indicator

## Components

### PriorityBadge

The core priority indicator component with four variants:

```tsx
<PriorityBadge
  priority="urgent"           // Priority level
  variant="badge"             // badge | dot | icon | header
  scale="md"                   // sm | md | lg
  label="Custom label"         // Optional override
  icon={<span>⚠️</span>}       // Optional icon
  showLabel={true}            // Hide label entirely
  link={onPriorityClick}       // Make clickable
/>
```

**Variants:**
- `badge`: Full badge with background color
- `dot`: Compact dot indicator for inline use
- `icon`: Icon with optional label
- `header`: Large, prominent header style

### TaskListView

Row-based task list view with priority badges:

```tsx
<TaskListView
  tasks={tasks}
  loading={false}
  selectedTaskId={selectedId}
  onSelectTask={(task) => setSelected(task)}
/>
```

Displays:
- Priority badge in first column
- Task title with key
- Status with text transform
- Assignee name

### TaskKanbanView

Kanban board view with priority indicators on cards:

```tsx
<TaskKanbanView
  tasks={tasks}
  loading={false}
  onTaskSelect={(task) => setSelected(task)}
/>
```

Features:
- 5 columns: To Do, In Progress, In Review, Done, Blocked
- Dot variant priority on card header
- Compact priority label on cards
- Drag-and-drop placeholder for host integration

### TaskDetailView

Full-screen task detail view with prominent priority indicators:

```tsx
<TaskDetailView
  task={task}
  loading={false}
  onEdit={(task) => openEdit(task)}
  onClose={() => closeDetail()}
/>
```

Header includes:
- Large header-style priority badge
- Compact icon variant below priority tag
- Task status
- Quick action buttons (Edit, Close)

Body sections:
- Description with pre-wrap
- Subtask explorer with compact dots
- Completion progress bar
- Related tasks (placeholder)

## Integration Guide

### Step 1: Import Components

```tsx
import {
  PriorityBadge,
  TaskListView,
  TaskKanbanView,
  TaskDetailView
} from '@builderforce/tmis/components/tasks';
```

### Step 2: Use in Your Views

#### For a simple list augmentation:

```tsx
<div className="task-row">
  <PriorityBadge priority={task.priority} variant="dot" scale="sm" />
  <span>{task.title}</span>
</div>
```

#### For the full integrated solution:

```tsx
// In your main view:
const [selectedTaskId, setSelectedId] = useState<number | null>(null);
const [view, setView] = useState<'list' | 'kanban' | 'detail'>('list');
const [tasks, setTasks] = useState<Task[]>([]);

const handleTaskSelect = (task: Task) => {
  setSelectedId(task.id);
  setView('detail');
};

const currentTask = tasks.find(t => t.id === selectedTaskId);

return (
  <>
    <TabList>
      <Tab active={view === 'list'} onClick={() => setView('list')}>List</Tab>
      <Tab active={view === 'kanban'} onClick={() => setView('kanban')}>Kanban</Tab>
    </TabList>

    {view === 'list' && <TaskListView tasks={tasks} onSelectTask={handleTaskSelect} />}
    {view === 'kanban' && <TaskKanbanView tasks={tasks} onTaskSelect={handleTaskSelect} />}
    {view === 'detail' && currentTask && (
      <TaskDetailView
        task={currentTask}
        onClose={() => { setSelectedId(null); setView('list'); }}
      />
    )}
  </>
);
```

## Task Data Structure

All views accept this type:

```typescript
interface Task {
  id: string | number;
  key?: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;        // 'urgent' | 'high' | 'medium' | 'low' | 'none'
  taskType?: 'task' | 'epic' | 'gap';
  assignedUserId?: string | null;
  assigneeName?: string;
  subtasks?: Task[];
}
```

## Consistency with PriorityAlignmentDashboard

All views use the same color palette and visual language:

| Priority | Badge | Dot | Icon | Header |
|----------|-------|-----|------|--------|
| High/urgent | Red background, white text (badge) | Red dot | Red icon/text | Large red header |
| Medium/high | Amber background | Amber dot | Amber icon/text | Large amber header |
| Low/medium | Gray/text only | Gray dot | Gray icon/text | Large gray header |
| None | Gray text only | Transparent dot | Transparent icon | Gray text |

## Accessibility

- All priority indicators have `aria-hidden` for decorative elements
- Priority badge colors have sufficient contrast ratios
- Interactive elements are keyboard accessible
- Hover states provide visual feedback

## Browser Support

- All components use inline styles with CSS variables for theming
- Supports modern browsers (Chrome, Firefox, Safari, Edge)
- No external dependencies

## Testing

Use the `ExampleIntegration.tsx` file for reference tests:

```tsx
import { ExampleFullListView } from './components/tasks/ExampleIntegration';
import { createMockTasks } from './components/tasks/ExampleIntegration';

// Render to screen for manual testing
render(<ExampleFullListView tasks={createMockTasks(5)} />);
```

## Future Enhancements

- Add mobile-responsive variants
- Enable priority editing directly from views
- Connect to backend for real-time priority updates
- Add drag-and-drop functionality to TaskListView
- Support for custom priority levels
- Priority trend indicators and visual alerts

## Architecture Notes

- Components are deliberately thin and presentational
- Consumers decide on fetch/filter/route logic
- Drag-and-drop semantics are included for future host integration
- All styles use CSS variables for theming support
- No external state management required
- TypeScript types ensure type safety across views