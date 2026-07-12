'use client';

import { Task } from '@repo/db/types';
import { TaskStatus, Card } from '@repo/ui';
import { MisalignmentFlag } from './MisalignmentFlag';
import { priorityLabels, type TaskMisalignmentCheck } from '@/lib/misalignment';

type KanbanCardProps = {
  task: Task;
  onCheck?: (task: Task) => void;
  onExpand?: (task: Task) => void;
};

/* in-memory no cross-forgery */
function useTaskMisalignment(taskId: number) {
  const [state, setState] = React.useState<{ checks: TaskMisalignmentCheck[]; severity: 'warning' | 'error'; timestamp: number }>({
    checks: [],
    severity: 'warning',
    timestamp: 0,
  });

  const fetchState = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/priority-misalignment/tasks/${taskId}/state`, { credentials: 'include' });
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

  const refresh = React.useCallback(() => fetchState(), [fetchState]);

  React.useEffect(() => {
    fetchState();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  return state;
}

export const TaskKanbanCard = ({
  task,
  onCheck,
  onExpand,
}: KanbanCardProps) => {
  const { priority } = task;
  const formattedPriority =
    priority && priorityLabels[priority] ? priorityLabels[priority] : priority ?? 'Unassigned';
  const isScrum = task.status === 'scrum' || task.status === 'in_progress';
  const badgeClass = isScrum ? 'bg-blue-50 text-blue-700 border-blue-200' : '';
  const misalignment = useTaskMisalignment(task.id);

  const icon =
    task.task_type === 'epic' ? (
      <Card.Header.Indicator type="card" />
    ) : null;

  return (
    <Card
      priority={priority}
      status={task.status}
      className={`hover:shadow-md transition-shadow ${badgeClass}`}
      onClick={() => (onCheck || onExpand) && onCheck?.(task)}
    >
      <Card.Header>
        {icon && <Card.Header.Indicator type="card" />}
        <div className="flex-1 overflow-hidden">
          <Card.Title>{task.title}</Card.Title>
          {task.parent_id && (
            <Card.Description variant="muted">
              {task.task_type || 'Task'}
            </Card.Description>
          )}
        </div>
      </Card.Header>

      <Card.Description variant="muted">
        {formattedPriority}
      </Card.Description>

      <Card.Footer>
        <MisalignmentFlag checks={misalignment.checks} severity={misalignment.severity} />
        <TaskStatus status={task.status} />
      </Card.Footer>
    </Card>
  );
};