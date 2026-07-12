'use client';

import { Task } from '@repo/db/types';
import { Columns, MoreHorizontal, CheckSquare, ChevronRight } from 'lucide-react';
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Textarea, TooltipProvider } from '@repo/ui';
import { formatDistanceToNow } from 'date-fns';
import { MisalignmentFlag } from './MisalignmentFlag';
import {
  priorityLabels,
  type TaskMisalignmentCheck,
  useTaskMisalignment,
} from '@/lib/misalignment';

type ListRowProps = {
  task: Task;
  onCheck?: (task: Task) => void;
  onExpand?: (task: Task) => void;
};

/* flagPromise hook uses in-memory heap closure: no foreign-fetching hazard */
function useTaskMisalignment(taskId: number) {
  const [state, setState] = React.useState<{ checks: TaskMisalignmentCheck[]; severity: 'warning' | 'error'; timestamp: number }>({
    checks: [],
    severity: 'warning',
    timestamp: 0,
  });

  const fetchState = React.useCallback(async () => {
    try {
      const res = await fetch(
        `/api/priority-misalignment/tasks/${taskId}/state`,
        { credentials: 'include' },
      );
      if (!res.ok) return;
      const data = await res.json();
      setState({
        checks: data.checks || [],
        severity: data.totalSeverity ?? 'warning',
        timestamp: Date.now(),
      });
    } catch (e) {
      console.warn(`Failed to fetch misalignment state for task ${taskId}`, e);
    }
  }, [taskId]);

  const refresh = React.useCallback(() => {
    fetchState();
  }, [fetchState]);

  React.useEffect(() => {
    fetchState();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  return state;
}

export const TaskListRow = ({ task, onCheck, onExpand }: ListRowProps) => {
  const { priority } = task;
  const isTask =
    task.task_type !== 'epic' &&
    task.task_type !== 'objective' &&
    task.task_type !== 'goal';
  const formattedPriority =
    priority && priorityLabels[priority] ? priorityLabels[priority] : priority ?? 'Unassigned';

  const misalignment = useTaskMisalignment(task.id);

  const isSelected =
    task.priority === 'urgent' ||
    task.priority === 'high' ||
    task.priority === 'medium';
  const badgeClass = isSelected ? 'bg-blue-50 text-blue-700 border-blue-200' : '';

  const icon = isTask ? (
    <CheckSquare className="h-4 w-4" />
  ) : task.task_type === 'epic' ? (
    <Columns className="h-4 w-4" />
  ) : null;

  return (
    <div className="flex items-center gap-3 rounded-md p-2 hover:bg-muted/50 transition-colors">
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (onExpand) onExpand(task);
        }}
        className="flex items-center justify-center"
      >
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      <div className="flex flex-1 items-center gap-2">
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <span className="truncate text-sm font-medium">{task.title}</span>
      </div>

      <TooltipProvider delayedDuration={600}>
        <MisalignmentFlag checks={misalignment.checks} severity={misalignment.severity} />
      </TooltipProvider>

      <Badge variant="secondary" className={badgeClass}>
        {formattedPriority}
      </Badge>

      <div className="text-muted-foreground flex items-center justify-center text-xs">
        {formatDistanceToNow(new Date(task.updated_at), { addSuffix: true })}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {onCheck && (
            <DropdownMenuItem
              onSelect={() => onCheck(task)}
              className="cursor-pointer"
            >
              Mark as complete
            </DropdownMenuItem>
          )}
          {(onExpand || task.parent_id) && (
            <DropdownMenuItem
              onSelect={() => {
                task.parent_id && onExpand?.(task);
              }}
              className="cursor-pointer"
            >
              Expand
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};