/**
 * Task Views — PriorityBadge integration package
 * 
 * This module provides task views with consistent visual priority indicators
 * across the application.
 * 
 * Components:
 * - PriorityBadge: Visual priority indicator with Badge, Dot, Icon, Header variants
 * - TaskListView: Row-based task list view
 * - TaskKanbanView: Kanban board view for tasks
 * - TaskDetailView: Full-screen task detail view
 * 
 * All components use the shared PriorityBadge component with consistent color
 * coding (High=red, Medium=amber, Low=gray) and variants matching the
 * PriorityAlignmentDashboard.
 */

export {
  PriorityBadge,
  type PriorityBadgeProps,
  type PriorityVariant,
  type PriorityScale,
  PriorityBadgeList,
  type PriorityBadgeListProps,
  PriorityBadgeColumn,
  type PriorityBadgeColumnProps,
} from './PriorityBadge';

export {
  TaskListView,
  type TaskListViewProps,
} from './TaskListView';

export {
  TaskKanbanView,
  type TaskKanbanViewProps,
} from './TaskKanbanView';

export {
  TaskDetailView,
  type TaskDetailViewProps,
} from './TaskDetailView';

export type { Task } from './types';