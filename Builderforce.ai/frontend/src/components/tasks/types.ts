/**
 * Shared task type used by all task views (ListView, KanbanView, DetailView).
 */

export interface Task {
  id: string | number;
  key?: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  taskType?: 'task' | 'epic' | 'gap';
  assignedUserId?: string | null;
  assigneeName?: string;
  timestamp?: string;
  subtasks?: Task[];
}