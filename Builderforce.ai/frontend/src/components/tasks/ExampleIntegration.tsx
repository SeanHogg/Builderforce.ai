/**
 * ExampleIntegration — demonstrates how to integrate priority badges into
 * existing task views.
 * 
 * This file shows usage examples for the three main task views and should be
 * adapted into your existing app code base.
 */

import React from 'react';
import { PriorityBadge, TaskListView, TaskKanbanView, TaskDetailView } from './index';
import type { Task } from './types';

/**
 * SCENARIO 1: Basic PriorityBadge usage
 * 
 * Useful for inline indicators in existing components where you already show
 * tasks in simplified list/card view.
 */
export function ExampleInlinePriority({ task }: { task: Task }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <PriorityBadge
        priority={task.priority ?? 'none'}
        variant="badge"
        scale="sm"
        showLabel
      />
      <span>{task.title}</span>
    </div>
  );
}

/**
 * SCENARIO 2: Integrated into an existing list component
 * 
 * Show how to augment a simple list with PriorityBadge without refactoring the
 * entire view.
 */
export function ExampleAugmentedList({ tasks }: { tasks: Task[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {tasks.map((task) => (
        <div
          key={task.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 12,
            borderRadius: 8,
            background: 'var(--bf-surface-elevated, rgba(128,128,128,0.08))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
            <PriorityBadge
              priority={task.priority ?? 'none'}
              variant="dot"
              scale="sm"
              showLabel={task.priority !== 'none'}
            />
            <span style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--bf-text-primary, #e4e4e4)',
            }}>
              {task.title}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--bf-text-secondary, #b4b4b4)' }}>
            {(task.status ?? 'todo').replace(/[_-]+/g, ' ')}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * SCENARIO 3: Full integration using the dedicated TaskListView component
 * 
 * Drop-in replacement for your existing task list that automatically includes
 * visual priority indicators for all tasks.
 */
export function ExampleFullListView({ tasks }: { tasks: Task[] }) {
  const handleTaskSelect = (task: Task) => {
    // TODO: Navigate to task detail view or open modal
    console.log('Task selected:', task.id);
  };

  return <TaskListView tasks={tasks} onSelectTask={handleTaskSelect} />;
}

/**
 * SCENARIO 4: Kanban view with consistent priorities
 * 
 * Kanban board that automatically displays the unified priority indicators.
 */
export function ExampleKanbanView({ tasks }: { tasks: Task[] }) {
  const handleTaskSelect = (task: Task) => {
    // TODO: Navigate to task detail view or open modal
    console.log('Task selected:', task.id);
  };

  return <TaskKanbanView tasks={tasks} onTaskSelect={handleTaskSelect} />;
}

/**
 * SCENARIO 5: Task detail view with prominent header priority
 * 
 * Full-screen view that includes the multi-badge header with two priority
 * indicators and links for quick attention.
 */
export function ExampleDetailView({ task }: { task: Task }) {
  const handleEdit = (task: Task) => {
    // TODO: Open edit modal or navigate to edit view
    console.log('Edit task:', task.id);
  };

  const handleClose = () => {
    // TODO: Navigate back to list/kanban
    console.log('Close detail view');
  };

  return <TaskDetailView task={task} onEdit={handleEdit} onClose={handleClose} />;
}

/**
 * DATA MOCKING HELPERS
 * 
 * Useful for testing and examples.
 */
export function createMockTasks(count: number = 10): Task[] {
  const priorities: Array<string> = ['urgent', 'high', 'medium', 'low', 'none'];
  const statuses = ['todo', 'in_progress', 'in_review', 'done', 'blocked'];
  
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    key: `TASK-${1000 + i}`,
    title: [
      'Fix authentication bug',
      'Implement user onboarding flow',
      'Update API authentication middleware',
      'Design new dashboard layout',
      'Refactor payment integration',
      'Add email notification system',
      'Improve search performance',
      'Optimize database queries',
      'Add dark mode support',
      'Write API documentation',
    ][i % 10] || `Task ${i + 1}`,
    status: statuses[Math.floor(Math.random() * statuses.length)],
    priority: priorities[Math.floor(Math.random() * priorities.length)],
    assigneeName: ['Alice Smith', 'Bob Johnson', 'Carol Lee', 'David Kim', 'Eva Patel'][i % 5] || 'Unassigned',
    description: `This is a sample description for task #${i + 1}. It provides context about what needs to be done.`,
    subtasks: Math.random() > 0.5
      ? Array.from({ length: Math.floor(Math.random() * 4) }, (_, j) => ({
          id: `${i}-${j}`,
          title: `Subtask ${j + 1} of task #${i + 1}`,
          status: ['todo', 'in_progress', 'done'][Math.floor(Math.random() * 3)] as any,
          priority: priorities[Math.floor(Math.random() * priorities.length)],
        }))
      : undefined,
  }));
}

// Example usage:
// const tasks = createMockTasks(5);
// return <ExampleFullListView tasks={tasks} />;